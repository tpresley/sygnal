/*
 * PLAN-4 GS-8: undo / redo.
 *
 *   Editor.model = undoable({ TYPE: ..., LOAD: ... }, { key: 'doc', coalesceMs: 500, resetOn: ['LOAD'] })
 *     → state.history = { past, future }; adds UNDO and REDO (the host's intent triggers them)
 *   Editor.uses = { history: undo({ key: 'doc', undo: UndoButton, redo: RedoButton }) }
 *     → the same as a behavior: state.history also has canUndo / canRedo, the actions are
 *       'history.UNDO' / 'history.REDO', and the controls trigger them
 *
 * Every STATE reducer (function entries, `STATE` of object entries, 'ACTION | STATE' keys) is
 * wrapped: when its result has a different state[key], the old state[key] is pushed onto
 * `past` (at most `limit`, default 100) and `future` is cleared. With `track`, only those
 * actions are recorded; built-in actions (INITIALIZE ...) only when tracked. A change by the
 * same action within `coalesceMs` of the previous one joins that step (typing). `resetOn`
 * actions clear the history and are not recorded. Snapshots are references: reducers must
 * return new objects (they do in Sygnal). A model's own UNDO / REDO entry runs after the
 * built-in one (as a host entry for a behavior action does, D123).
 *
 * SYG226 (dev, warn): a `track` / `resetOn` name with no model entry.
 */
import { defineBehavior } from './behaviors'

const ABORT = Symbol.for('sygnal.ABORT')
const isAbort = (v: any): boolean => typeof v == 'symbol' && v.description == 'sygnal.ABORT'
const BUILT_IN = /^(BOOTSTRAP|INITIALIZE|DISPOSE|READY|RESOURCE)$/
// the last recorded change of a history, keyed by its `past` array (which a behavior's calculated
// fields keep while they copy the history object): [action, time] (coalescing; never in state)
const last = new WeakMap<object, [string, number]>()
const reported = new WeakSet<object>()

export interface UndoOptions { key: string, limit?: number, track?: string[], coalesceMs?: number, resetOn?: string[] }

const actionOf = (a: string) => a.split('|')[0].trim()

// SYG226: report through the diagnostics core when it is enabled (dev); nothing in production
const check = (model: any, o: UndoOptions, component?: any, skip?: any) => {
  const known = new Set(Object.keys(model || {}).map(actionOf))
  for (const a of [...(o.track || []), ...(o.resetOn || [])]) {
    if (known.has(a) || skip?.[a.split('.')[0]]) continue
    try {
      (globalThis as any).__SYGNAL_DIAGNOSTICS__?.report('SYG226', {
        severity: 'warn', component, data: {action: a},
        message: `undo ${o.track?.includes(a) ? 'track' : 'resetOn'} names '${a}', which has no model entry`,
        fix: `Use the name of a model entry, or add '${a}' to the model`,
      })
    } catch (e) { queueMicrotask(() => { throw e }) }
  }
}

const wrap = (model: any, o: UndoOptions, hk: string, ns: string, S = 'STATE'): any => {
  const {key, limit = 100, track, coalesceMs = 0, resetOn = []} = o
  const out: any = {}
  const hist = (s: any) => s?.[hk] || {past: [], future: []}
  for (const a in model) {
    const e = model[a], [name, sink] = a.split('|').map(x => x.trim())
    const reset = resetOn.includes(name)
    const f0 = sink ? (sink == S ? e : null) : typeof e == 'function' ? e : e?.[S]
    // a constant STATE value isn't a reducer: the entry is left alone (G-214)
    if (f0 != null && typeof f0 != 'function') { out[a] = e; continue }
    const f = f0
    // an entry without a STATE reducer is left alone, except a resetOn object entry (gets one)
    if (!(f || reset && !sink) || !(reset || (track ? track.includes(name) : !BUILT_IN.test(name)))) { out[a] = e; continue }
    const w = (s: any, ...x: any[]) => {
      const r = f ? f(s, ...x) : s, h = hist(s)
      if (!r || typeof r != 'object' || isAbort(r)) return r
      if (reset) return h.past.length || h.future.length ? {...r, [hk]: {...h, past: [], future: []}} : r
      if (r === s || r[key] === s[key]) return r
      const at = Date.now(), prev = last.get(h.past)
      const join = coalesceMs > 0 && prev && prev[0] == name && at - prev[1] < coalesceMs && h.past.length
      const nh = {...h, past: join ? h.past : [...h.past, s[key]].slice(-limit), future: []}
      last.set(nh.past, [name, at])
      return {...r, [hk]: nh}
    }
    out[a] = sink || typeof e == 'function' ? w : {...e, [S]: w}
  }
  const step = (from: 'past' | 'future', to: 'past' | 'future') => (s: any) => {
    const h = hist(s), list = h[from]
    if (!list.length) return ABORT
    const v = from == 'past' ? list[list.length - 1] : list[0]
    return {...s, [key]: v, [hk]: {...h,
      [from]: from == 'past' ? list.slice(0, -1) : list.slice(1),
      [to]: to == 'past' ? [...h[to], s[key]] : [s[key], ...h[to]]}}
  }
  const add = (a: string, f: any) => {
    const own = out[ns + a]
    if (!own) return out[ns + a] = f
    const g = typeof own == 'function' ? own : own[S]
    // the model's own entry runs after the built-in step (its ABORT keeps the step)
    const both = typeof g != 'function' ? f : (s: any, ...x: any[]) => {
      const r = f(s, ...x), q = g(isAbort(r) ? s : r, ...x)
      return isAbort(q) ? r : q
    }
    out[ns + a] = typeof own == 'function' ? both : {...own, [S]: both}
  }
  add('UNDO', step('past', 'future'))
  add('REDO', step('future', 'past'))
  return out
}

/**
 * Wraps a model's STATE reducers so `state[key]` gets undo / redo (GS-8): `state.history =
 * { past, future }`, plus UNDO and REDO entries for the intent to trigger. Options: `key` (the
 * state key to snapshot), `limit` (100), `track` (only these actions), `coalesceMs` (join rapid
 * changes by one action), `resetOn` (actions that clear the history). Returns a new model.
 */
export const undoable = (model: any, options: UndoOptions): any => {
  check(model, options)
  return wrap(model, options, 'history', '')
}

/**
 * undoable() as a behavior (GS-8 + GS-1): `uses = { history: undo({ key: 'doc', undo: Undo,
 * redo: Redo }) }` gives `state.history = { past, future, canUndo, canRedo }` and the actions
 * 'history.UNDO' / 'history.REDO' (the `undo` / `redo` controls trigger them; so can a host
 * intent action of that name). The other options are undoable()'s; `track` and `resetOn` name
 * the host's actions.
 */
export const undo = (options: UndoOptions & { undo?: any, redo?: any }): any => {
  const b = defineBehavior({
    initialState: {past: [], future: []},
    intent: ({DOM}: any, {undo, redo}: any) => ({
      ...(undo && {UNDO: DOM.click(undo)}),
      ...(redo && {REDO: DOM.click(redo)}),
    }),
    // placeholders (no change): they make the actions behavior-owned; the full-state UNDO / REDO
    // that wrap() adds for 'key.UNDO' runs after them, as a host entry would (D123)
    model: {UNDO: () => ABORT, REDO: () => ABORT},
    calculated: {canUndo: (h: any) => h.past.length > 0, canRedo: (h: any) => h.future.length > 0},
  })(options), merge = b.merge
  b.merge = (c: any, k: string) => {
    if (!reported.has(b)) reported.add(b), check(c.model, options, c, c.view?.uses)
    c.model = wrap(c.model || {}, options, k, k + '.', c.stateSourceName)
    merge(c, k)
  }
  return b
}
