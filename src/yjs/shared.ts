/*
 * 'sygnal/yjs' (research: dev-plans/research/crdt-state): shared(), the behavior that binds one
 * top-level state key to the Yjs driver's document.
 *
 *   Board.uses = { board: shared({ presence: 'peers', history: 'history' }) }   // state.board is shared
 *   Board.model = {
 *     ADD:  (state, item) => ({ ...state, board: { ...state.board, items: [...state.board.items, item] } }),
 *     UNDO: { SHARED: { undo: 'board' } },                      // this user's changes only
 *     HERE: { SHARED: (_, id) => ({ presence: { editing: id } }) },
 *   }
 *
 * The model stays the only writer of state:
 * - `board.LOCAL`: every new value of state.board reaches the driver as data, once per flush (the
 *   values of one flush coalesce: a burst of actions is one Yjs transaction).
 * - `board.REMOTE` ({ value, base }): a document change from elsewhere; it applies only while
 *   state.board is still `base` (no unsynced local edit is overwritten), and its driver sink tells
 *   the driver the state it committed either way.
 * - `board.PRESENCE` / `board.HISTORY` with `presence: 'peers'` / `history: 'history'`: the other
 *   clients' awareness states and { canUndo, canRedo } in those state keys.
 * LOCAL and REMOTE are marked as built-in actions (`Symbol.for('sygnal.builtIn')` on their
 * handlers): the action log calls them 'built-in', so DevTools hides them with INITIALIZE (Q5).
 *
 * `ownsState: false`: the host's initialState keeps state[key] (the first value seeds an empty
 * document); the behavior adds no slice of its own, and sygnal-check's SYG127 reads the marker.
 * `undo()` on the same key reverts other users' changes: SYG260 (dev) points to `{ SHARED: { undo } }`.
 *
 * sygnal/canvas's `history(key)` routes here (maintainer decision 7, one API): model entries that
 * are its `undo` / `redo` become `{ [driver]: { undo: key } }` / `{ redo: key }`, its `commit`
 * bumps `state[step]` instead of keeping snapshots, and the LOCAL command carries that step, so the
 * driver closes this user's undo step at each commit (one step per gesture). `after` runs on the
 * state an undo / redo brings back. The marker is `Symbol.for('sygnal.history')`: no import.
 */
import {xs, ABORT} from '../index'

export interface SharedOptions {
  /** the driver's name (default 'SHARED') */
  driver?: string
  /** the state key that gets the other clients' presence states */
  presence?: string
  /** the state key that gets { canUndo, canRedo } of this client's history */
  history?: string
  /** the slice's shape; inferred where it says nothing */
  shape?: any
  /** 'whenSynced' (default): seed an empty document after the provider's first sync; 'ifEmpty': at once */
  seed?: 'whenSynced' | 'ifEmpty'
}

const BUILT_IN = Symbol.for('sygnal.builtIn')
const HISTORY = Symbol.for('sygnal.history')
const builtIn = <F>(f: F): F => ((f as any)[BUILT_IN] = true, f)

// SYG260: an undo() behavior of the host whose `key` is this shared key (reported once per use)
const reported = new WeakSet<object>()
const checkUndo = (c: any, k: string) => {
  const d = (globalThis as any).__SYGNAL_DIAGNOSTICS__, u = c.view?.uses
  if (!d || !u) return
  for (const n in u) {
    const b = u[n], key = b?.options?.key
    if (!b?.model?.UNDO || !b.model.REDO || !(key === k || Array.isArray(key) && key.includes(k)) || reported.has(b)) continue
    reported.add(b)
    try {
      d.report('SYG260', {
        severity: 'warn', component: c, data: {key: k, uses: n},
        message: `undo() (uses key '${n}') records '${k}', which shared() syncs: its UNDO restores a snapshot of the whole slice and reverts other users' changes made since`,
        fix: `Remove undo() for '${k}' and use the driver's per-user undo: UNDO: { SHARED: { undo: '${k}' } }, REDO: { SHARED: { redo: '${k}' } }, with shared({ history: 'history' }) for canUndo / canRedo`,
      })
    } catch (e) { queueMicrotask(() => { throw e }) }
  }
}

/** `uses = { [key]: shared(options) }`: state[key] lives in the Yjs driver's document */
export const shared = (opts: SharedOptions = {}) => ({
  options: opts,
  ownsState: false as const,
  merge(c: any, k: string) {
    const D = opts.driver || 'SHARED', S = c.stateSourceName || 'STATE', model = c.model = {...c.model}
    const {shape, seed} = opts
    checkUndo(c, k)
    // sygnal/canvas history(k): its undo / redo entries go to this user's UndoManager
    let hist: any = null
    for (const name in model) {
      const e = model[name], f = typeof e == 'function' ? e : e?.[S], h = f?.[HISTORY]
      if (!h || h.field !== k) continue
      hist = h
      const cmd = f === h.undo ? {undo: k} : {redo: k}, rest = typeof e == 'function' ? {} : {...e}
      delete rest[S]
      model[name] = {...rest, [D]: () => cmd}
    }
    if (hist) hist.shared = {history: opts.history}
    const step = hist?.step
    // the committed slice when the action runs (not the action's data: a REMOTE queued before it may have moved it on)
    model[k + '.LOCAL'] = {[D]: builtIn((s: any) => step ? {key: k, value: s?.[k], shape, seed, step: s?.[step] ?? 0} : {key: k, value: s?.[k], shape, seed})}
    model[k + '.REMOTE'] = {
      [S]: builtIn((s: any, d: any) => s?.[k] !== d.base ? ABORT : d.undo && hist ? hist.after({...s, [k]: d.value}) : {...s, [k]: d.value}),
      // the state the REMOTE committed (its value, or the app's own newer one) is the driver's new base
      [D]: builtIn((s: any) => ({key: k, value: s?.[k]})),
    }
    if (opts.presence) model[k + '.PRESENCE'] = {[S]: (s: any, peers: any) => ({...s, [opts.presence!]: peers})}
    if (opts.history) model[k + '.HISTORY'] = {[S]: (s: any, h: any) => ({...s, [opts.history!]: h})}
    const own = c.intent, owned = c._behaviorActions ||= {}
    for (const a of ['LOCAL', 'REMOTE', 'PRESENCE', 'HISTORY']) owned[k + '.' + a] = k
    c.intent = (so: any) => {
      // no Yjs driver (renderComponent without one: a fake source): the reducers still run
      const h = own?.(so) || {}, st = so[S], src = typeof so[D]?.remote == 'function' ? so[D] : null
      // state[key]'s latest value once per flush (a microtask after the first change of a burst)
      let prev: any, latest: any, queued = false, sub: any, prevStep: any, latestStep: any
      const local$ = xs.create({
        start: (l: any) => {
          sub = st.stream.subscribe({
            next: (s: any) => {
              latest = s?.[k]
              if (step) latestStep = s?.[step]
              if (queued) return
              queued = true
              queueMicrotask(() => {
                queued = false
                if (sub && latest !== undefined && (latest !== prev || latestStep !== prevStep)) prevStep = latestStep, l.next(prev = latest)
              })
            },
            error: () => {}, complete: () => {},
          })
        },
        stop: () => { sub?.unsubscribe(); sub = undefined },
      })
      const o: any = {
        [k + '.LOCAL']: local$,
        [k + '.REMOTE']: src ? src.remote(k) : xs.never(),
        ...(opts.presence && {[k + '.PRESENCE']: src ? src.presence() : xs.never()}),
        ...(opts.history && {[k + '.HISTORY']: src ? src.history(k) : xs.never()}),
        // the host's own actions (and renderComponent's simulateAction streams) win
        ...h,
      }
      // renderComponent's marker (non-enumerable) for a behavior merged after this one
      if (h.__sygnalTestActions) Object.defineProperty(o, '__sygnalTestActions', {value: h.__sygnalTestActions})
      return o
    }
  },
})
