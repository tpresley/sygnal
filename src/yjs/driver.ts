/*
 * 'sygnal/yjs' (research: dev-plans/research/crdt-state): makeYjsDriver, the driver that owns a Y.Doc
 * for `shared()` slices.
 *
 *   const drivers = { SHARED: makeYjsDriver({ doc, provider, text: ['text'] }) }
 *
 * Sink commands (data, from model entries):
 *   { key, value, shape?, seed? }   state[key]'s new value (shared()'s `key.LOCAL`, coalesced per flush)
 *   { undo: key } / { redo: key }   this client's own changes to state[key] (a Y.UndoManager per slice)
 *   { presence: { ... } }           this client's awareness state (merged)
 *   { connect: boolean }            provider.connect() / provider.disconnect() (go offline and back)
 * Sources: remote(key) ({ value, base }), presence() (the other clients), history(key)
 * ({ canUndo, canRedo }), doc.
 *
 * - Local: the new value is diffed against the last one the driver saw and written in one
 *   transaction (mapping.ts writeMap, a 3-way idempotent write).
 * - Remote: every transaction from elsewhere (a peer, a sync, an undo) updates the driver's mirror of
 *   the slice incrementally (only the types it changed are read again) and emits { value, base };
 *   shared()'s REMOTE reducer applies it only while state[key] is still `base`.
 * - Seeding (Q3): `seed: 'whenSynced'` (default) waits for the provider's first sync, then seeds an
 *   empty document from the app's value, or else takes the document's content (writing any edits
 *   the app made before the sync onto it). `seed: 'ifEmpty'` seeds at once (a local-only document).
 *   Without `provider` / `synced` the document counts as synced.
 */
import * as Y from 'yjs'
import {xs} from '../index'
import {writeMap, read, reconcile, normShape, type MapOptions, type ShapeNode, type Dirty} from './mapping'

export interface YjsDriverOptions {
  doc: Y.Doc
  /** a y-protocols Awareness for presence (default: provider.awareness) */
  awareness?: any
  /** y-websocket, Hocuspocus, y-webrtc, y-indexeddb, createNetwork()'s peer: its first sync, its awareness, connect / disconnect */
  provider?: any
  /** resolves when the document has synced (instead of provider's sync events) */
  synced?: PromiseLike<unknown>
  /** field names whose strings are Y.Text (character-level merge) */
  text?: string[]
  /** a Y.UndoManager per slice (default true); captureTimeout merges rapid local edits (default 500 ms) */
  undo?: boolean
  captureTimeout?: number
}

interface Slice {
  key: string; y: Y.Map<any>; um?: Y.UndoManager
  // started: the slice is bound to the document (after seeding); first: the app's first value
  started: boolean; first: any; last: any; mirror: any
  // the REMOTE values sent since the last local write, and the latest one with its base
  emitted: Set<any>; sent: any; sentBase: any
  shape?: ShapeNode; seed: string
  out: Set<any>
}

const report = (code: string, message: string, fix: string, data: any) => {
  try {
    (globalThis as any).__SYGNAL_DIAGNOSTICS__?.report(code, {severity: 'warn', message, fix, data})
  } catch (e) { queueMicrotask(() => { throw e }) }
}

// the promise of a provider's first sync; null: synced now
const syncedOf = (o: YjsDriverOptions): PromiseLike<unknown> | null => {
  if (o.synced) return o.synced
  const p = o.provider
  if (!p || p.synced === true || p.isSynced === true) return null
  if (p.whenSynced?.then) return p.whenSynced
  if (typeof p.on != 'function') return null
  return new Promise<void>((r) => {
    // y-websocket: 'sync' (true); y-webrtc: 'synced' ({ synced }); Hocuspocus: 'synced' ({ state })
    const f = (x: any) => {
      if (x === false || x?.synced === false || x?.state === false) return
      for (const e of ['sync', 'synced']) p.off?.(e, f)
      r()
    }
    for (const e of ['sync', 'synced']) p.on(e, f)
  })
}

export const makeYjsDriver = (o: YjsDriverOptions) => (sink$: any) => {
  const {doc} = o, provider = o.provider, awareness = o.awareness ?? provider?.awareness
  const local = {}, seed = {}, slices = new Map<string, Slice>(), warned = new Set<string>()
  const opts: MapOptions = {
    text: o.text,
    ambiguous: (path) => {
      if (warned.has(path)) return
      warned.add(path)
      report('SYG261', `shared(): '${path}' is an empty array, so its kind is a guess: an id-keyed collection. A list of plain values would be stored as a collection until it has items`,
        `Declare it: shared({ shape: { ${path.split('.').pop()}: 'list' } }) for plain values, or collection() for items with an id`, {path})
    },
  }
  const first = syncedOf(o)
  let synced = !first
  first?.then(() => {
    synced = true
    for (const s of slices.values()) if (!s.started && s.first !== undefined) start(s)
  })

  // the root-level types' names (doc.share), by type. Read again on a miss: a type that arrived in
  // an update is a placeholder until its first getMap() / getText(), which puts a new object in
  // doc.share under the same name (the size doesn't change)
  let names = new Map<any, string>()
  const nameOf = (t: any) => {
    let n = names.get(t)
    if (n === undefined) { names = new Map([...doc.share].map(([k, v]) => [v, k])); n = names.get(t) }
    return n
  }
  // what a transaction changed (mapping.ts Dirty)
  const dirtyOf = (tr: Y.Transaction): Dirty => {
    const types = new Set<any>(), roots = new Set<string>()
    for (const t of tr.changed.keys()) {
      let r: any = t
      types.add(r)
      while (r._item) { r = r._item.parent; types.add(r) }
      const n = nameOf(r)
      if (n) roots.add(n)
    }
    return {types, roots, changed: tr.changed as any}
  }
  const touches = (d: Dirty, k: string) => {
    for (const n of d.roots) if (n === k || n.startsWith(k + '.')) return true
    return false
  }

  const onTransaction = (tr: Y.Transaction) => {
    if (!slices.size || !tr.changed.size) return
    const d = dirtyOf(tr)
    for (const s of slices.values()) {
      if (!s.started || !touches(d, s.key)) continue
      s.mirror = read(s.y, s.key, s.mirror, d)
      if (tr.origin !== local && tr.origin !== seed) emit(s)
    }
  }
  doc.on('afterTransaction', onTransaction)

  const slice = (k: string): Slice => {
    let s = slices.get(k)
    if (s) return s
    s = {key: k, y: doc.getMap(k), started: false, first: undefined, last: undefined, mirror: undefined, emitted: new Set(), sent: undefined, sentBase: undefined, seed: 'whenSynced', out: new Set()}
    if (o.undo !== false) s.um = new Y.UndoManager(s.y, {trackedOrigins: new Set([local]), captureTimeout: o.captureTimeout ?? 500})
    slices.set(k, s)
    return s
  }
  // the slice's path-named root types join its undo scope inside the transaction that may create them
  const scope = (s: Slice) => {
    if (s.um) for (const [n, t] of doc.share) if (n.startsWith(s.key + '.')) s.um.addToScope(t as any)
  }
  const write = (s: Slice, prev: any, next: any, origin: any) =>
    doc.transact(() => { writeMap(s.y, prev, next, opts, s.key, s.shape); scope(s) }, origin)
  // the document's content as a REMOTE action, unless the app already has it (or has it on its way)
  const emit = (s: Slice) => {
    // the mirror takes the app's objects wherever they are equal (Collection items keep their identity)
    if (s.mirror !== s.sent) s.mirror = reconcile(s.last, s.mirror)
    const value = s.mirror
    if (value === s.last || value === s.sent && s.sentBase === s.last) return
    s.sent = value; s.sentBase = s.last; s.emitted.add(value)
    for (const l of s.out) l.next({value, base: s.last})
  }
  // bind the slice to the document: seed an empty one from the app's value, or else take its
  // content (with the app's edits since its first value written onto it)
  const start = (s: Slice) => {
    s.started = true
    const v = s.last
    if (s.y.size == 0) write(s, {}, v, seed)
    else if (v !== s.first) write(s, s.first, v, local)
    s.mirror = read(s.y, s.key)
    emit(s)
  }

  /*
   * state[key]'s value: from `key.LOCAL` (coalesced per flush) and from every `key.REMOTE` (its
   * driver sink sends the state the REMOTE reducer committed: the REMOTE value when it applied,
   * else the app's own newer value). So the driver always diffs from a value the app really had.
   */
  const onLocal = (c: any) => {
    const s = slice(c.key), v = c.value
    if (v === undefined) return
    if (!s.started) {
      if (s.first === undefined) { s.first = v; s.shape = normShape(c.shape); s.seed = c.seed || 'whenSynced' }
      s.last = v
      if (synced || s.seed == 'ifEmpty') start(s)
      return
    }
    // the app took a REMOTE value (or nothing changed): any newer document content follows
    if (v === s.last || s.emitted.has(v)) {
      // REMOTE actions run in order: the ones sent before this one were answered already
      if (v !== s.last) for (const e of s.emitted) { s.emitted.delete(e); if (e === v) break }
      s.last = v
      return emit(s)
    }
    write(s, s.last, v, local)
    s.last = v
    s.emitted.clear()
    emit(s)
  }

  sink$.addListener({
    next: (c: any) => {
      if (!c) return
      if ('value' in c && c.key) onLocal(c)
      if (c.undo) slice(c.undo).um?.undo()
      if (c.redo) slice(c.redo).um?.redo()
      if (c.presence && awareness) awareness.setLocalState({...awareness.getLocalState(), ...c.presence})
      if (typeof c.connect == 'boolean') c.connect ? provider?.connect?.() : provider?.disconnect?.()
    },
    error: () => {},
    complete: () => {
      doc.off('afterTransaction', onTransaction)
      for (const s of slices.values()) s.um?.destroy()
    },
  })
  const others = () => [...awareness.getStates()].filter(([id]) => id !== awareness.clientID).map(([id, st]: any) => ({id, ...st}))
  return {
    /** remote content for state[key], as { value, base } */
    remote: (k: string) => {
      let l: any
      return xs.create({start: (x: any) => { slice(k).out.add(l = x) }, stop: () => { slice(k).out.delete(l) }})
    },
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
    history: (k: string) => {
      let f: any
      const um = () => slice(k).um, ev = ['stack-item-added', 'stack-item-popped', 'stack-cleared']
      return xs.create({
        start: (l: any) => {
          const u = um()
          f = () => l.next({canUndo: !!u?.canUndo(), canRedo: !!u?.canRedo()})
          f(); for (const e of ev) u?.on(e as any, f)
        },
        stop: () => { for (const e of ev) um()?.off(e as any, f) },
      })
    },
    doc,
  }
}
