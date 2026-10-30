/*
 * What a `sygnal/yjs` subpath could be (research spike, not shipped): a driver that owns a Y.Doc
 * and a `shared()` behavior that binds one slice of a component's state to it.
 *
 *   const drivers = { SHARED: makeYjsDriver({ doc, awareness, text: ['text'] }) }
 *   Board.uses = { board: shared({ presence: 'peers' }) }        // state.board is shared
 *   Board.model = {
 *     ADD:  (state, item) => ({ ...state, board: { ...state.board, items: [...state.board.items, item] } }),
 *     UNDO: { SHARED: { undo: 'board' } },                      // this user's changes only
 *     HERE: { SHARED: (_, cursor) => ({ presence: { cursor } }) },
 *   }
 *
 * The model stays the only writer of state:
 * - local: every new value of state[key] reaches the driver as data (`board.LOCAL`, a sink-only
 *   action fed by the STATE stream). The driver diffs it against the previous value it saw and
 *   applies the difference to the Y.Doc in one transaction (mapping.ts). Reducers are unchanged
 *   and know nothing about Yjs: whatever changes the slice (the host, a Collection item, undo of
 *   a local behavior, persist's RESTORE) is synced.
 * - remote: a document change from elsewhere (a peer, an undo) becomes the action
 *   `board.REMOTE` with `{ value, base }`; its reducer takes `value` only if state[key] is still
 *   `base` (the value the driver last saw). If local changes are on their way to the driver, the
 *   REMOTE is dropped (ABORT) and the driver emits a fresh one after writing them, so a remote
 *   value never overwrites an unsynced local edit.
 * - presence (y-protocols awareness) is a source, not state: `presence: 'peers'` writes the other
 *   clients' awareness states to state.peers; the SHARED sink's `{ presence }` sets this client's.
 * - undo / redo are commands to the driver: a Y.UndoManager per slice, tracking this client's
 *   transactions only, so undo never reverts someone else's change.
 */
import * as Y from 'yjs'
import xs from 'xstream'
import {ABORT} from 'sygnal'
import {writeMap, read, reconcile, type MapOptions} from './mapping.ts'

export interface YjsDriverOptions extends MapOptions {
  doc: Y.Doc
  /** a y-protocols Awareness for presence (optional) */
  awareness?: any
  /** Y.UndoManager per slice (default true); captureTimeout merges rapid local edits (default 500 ms) */
  undo?: boolean
  captureTimeout?: number
  /** called after each local write with the encoded update size and the time spent (the spike's measurements) */
  onWrite?: (info: {key: string; bytes: number; ms: number}) => void
}

interface Slice {
  key: string; y: Y.Map<any>; um?: Y.UndoManager
  started: boolean; last: any; emitted: any; synced: boolean
  out: Set<any>
}

// whether a transaction changed the slice `k` (its map or one of its path-named root types)
const touches = (tr: Y.Transaction, k: string) => {
  for (const t of tr.changedParentTypes.keys()) {
    let r: any = t
    while (r._item) r = r._item.parent
    const n = [...r.doc.share].find(([, v]: any) => v === r)?.[0]
    if (n === k || n?.startsWith(k + '.')) return true
  }
  return false
}

export const makeYjsDriver = (o: YjsDriverOptions) => (sink$: any) => {
  const {doc, awareness} = o, local = {}, seed = {}, slices = new Map<string, Slice>()
  const slice = (k: string): Slice => {
    let s = slices.get(k)
    if (s) return s
    const y = doc.getMap(k)
    s = {key: k, y, started: false, last: undefined, emitted: undefined, synced: true, out: new Set()}
    if (o.undo !== false) s.um = new Y.UndoManager(y, {trackedOrigins: new Set([local]), captureTimeout: o.captureTimeout ?? 500})
    // the slice's nested root types ('board.items#c') are separate types: observe the whole document
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin === local || tr.origin === seed || !touches(tr, k)) return
      s!.synced = false; emit(s!)
    })
    slices.set(k, s)
    return s
  }
  // the slice's path-named root types join its undo scope inside the transaction that may create them
  const scope = (s: Slice) => {
    if (s.um) for (const [n, t] of doc.share) if (n.startsWith(s.key + '.')) s.um.addToScope(t as any)
  }
  // the document's content as a REMOTE action, unless the app already has it
  const emit = (s: Slice) => {
    if (!s.started) return
    const value = reconcile(s.last, read(s.y, s.key))
    if (value === s.last) { s.synced = true; return }
    s.emitted = value
    for (const l of s.out) l.next({value, base: s.last})
  }
  const onLocal = (k: string, v: any) => {
    const s = slice(k)
    if (!s.started) {
      s.started = true
      // an empty document is seeded from the initial state (two clients seeding the same ids merge);
      // otherwise the document wins and the app gets its content
      if (s.y.size == 0) { doc.transact(() => writeMap(s.y, {}, v, o, k), seed); s.last = v; return }
      s.last = v
      return emit(s)
    }
    if (v === s.last) return
    if (v === s.emitted) { s.last = v; if (!s.synced) emit(s); return }
    const t = performance.now()
    let bytes = 0
    const count = (u: Uint8Array, origin: any) => { if (origin === local) bytes += u.length }
    if (o.onWrite) doc.on('update', count)
    doc.transact(() => { writeMap(s.y, s.last, v, o, k); scope(s) }, local)
    if (o.onWrite) { doc.off('update', count); o.onWrite({key: k, bytes, ms: performance.now() - t}) }
    s.last = v
    if (!s.synced) emit(s)
  }
  sink$.addListener({
    next: (c: any) => {
      if (!c) return
      if ('value' in c && c.key) onLocal(c.key, c.value)
      if (c.undo) slice(c.undo).um?.undo()
      if (c.redo) slice(c.redo).um?.redo()
      if (c.presence && awareness) awareness.setLocalState({...awareness.getLocalState(), ...c.presence})
    },
    error: () => {}, complete: () => {},
  })
  const others = () => [...awareness.getStates()].filter(([id]) => id !== awareness.clientID).map(([id, st]: any) => ({id, ...st}))
  return {
    /** remote content for state[key], as { value, base } */
    remote: (k: string) => xs.create({start: (l: any) => { slice(k).out.add(l) }, stop: () => {}}),
    /** the other clients' presence states, on every awareness change */
    presence: () => {
      if (!awareness) return xs.empty()
      let f: any
      return xs.create({
        start: (l: any) => { f = () => l.next(others()); f(); awareness.on('change', f) },
        stop: () => { awareness.off('change', f) },
      })
    },
    /** { canUndo, canRedo } for state[key]'s per-user history */
    history: (k: string) => xs.create({
      start: (l: any) => {
        const um = slice(k).um, f = () => l.next({canUndo: !!um?.canUndo(), canRedo: !!um?.canRedo()})
        f(); um?.on('stack-item-added', f); um?.on('stack-item-popped', f); um?.on('stack-cleared', f)
      },
      stop: () => {},
    }),
    doc,
  }
}

/** `uses = { [key]: shared({ driver?, presence?, history? }) }`: state[key] lives in the driver's Y.Doc */
export const shared = (opts: {driver?: string; presence?: string; history?: string} = {}) => ({
  options: opts,
  merge(c: any, k: string) {
    const D = opts.driver || 'SHARED', S = c.stateSourceName || 'STATE', model = c.model = {...c.model}
    model[k + '.LOCAL'] = {[D]: (_: any, value: any) => ({key: k, value})}
    model[k + '.REMOTE'] = {[S]: (s: any, d: any) => s?.[k] === d.base ? {...s, [k]: d.value} : ABORT}
    if (opts.presence) model[k + '.PRESENCE'] = {[S]: (s: any, peers: any) => ({...s, [opts.presence!]: peers})}
    if (opts.history) model[k + '.HISTORY'] = {[S]: (s: any, h: any) => ({...s, [opts.history!]: h})}
    const own = c.intent, owned = c._behaviorActions ||= {}
    for (const a of ['LOCAL', 'REMOTE', 'PRESENCE', 'HISTORY']) owned[k + '.' + a] = k
    c.intent = (so: any) => {
      const h = own?.(so) || {}, src = so[D]
      let prev: any = {}
      const local$ = so[S].stream.map((s: any) => s?.[k]).filter((v: any) => v !== undefined && v !== prev && ((prev = v), true))
      return {
        ...h,
        [k + '.LOCAL']: local$,
        [k + '.REMOTE']: src.remote(k),
        ...(opts.presence && {[k + '.PRESENCE']: src.presence()}),
        ...(opts.history && {[k + '.HISTORY']: src.history(k)}),
      }
    }
  },
})
