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
 * same action within `coalesceMs` of the previous one joins that step (typing). With
 * `coalesce` (4-G1, D143) only the listed actions join (`coalesceMs` then defaults to 500);
 * every other action is always its own step (two quick clicks on Larger are two). `resetOn`
 * actions clear the history and are not recorded. Snapshots are references: reducers must
 * return new objects (they do in Sygnal). A model's own UNDO / REDO entry runs after the
 * built-in one (as a host entry for a behavior action does, D123).
 *
 * Gestures (3-H G-447): another behavior in the host's `uses` that declares `undoStep` (its
 * actions that complete a step: sortable's DROPPED) makes its other actions gesture steps. Their
 * changes aren't recorded; `history.base` holds the value from before the gesture until the
 * completing action records it as one entry. Works in either `uses` order (undo first: the
 * behavior's actions get host entries that run after them). undo() as a behavior only:
 * undoable() can't see `uses`. 3-L: a recorded action, UNDO or REDO during a gesture first
 * records the value from before it (G-473: it stays reachable); a gesture step that brings the
 * value back to where the gesture started (a cancel) leaves nothing pending, nor does a gesture
 * action after the value was changed outside the gesture (G-475 / G-479). `track` / `coalesce`
 * naming any of a gesture behavior's actions apply to its steps; `resetOn` naming one of them
 * resets the history at that action (G-477). 3-O: an untracked gesture is like an untracked
 * action, its changes are never recorded, nor pending (G-506); drops join only when `coalesce`
 * names a gesture action (G-507); REDO mid-gesture records the value from before the gesture in
 * place of the current one, as a recorded action does (G-508); "back where it started" compares
 * arrays and plain objects shallowly (G-509).
 *
 * SYG226 (dev, warn): a `track` / `resetOn` / `coalesce` name with no model entry (nor an action
 * of a behavior in the host's `uses`).
 */
import { defineBehavior } from './behaviors'
import { ABORT, isAbort } from '../shared'

const BUILT_IN = /^(BOOTSTRAP|INITIALIZE|DISPOSE|READY|RESOURCE)$/
// the last recorded change of a history, keyed by its `past` array (which a behavior's calculated
// fields keep while they copy the history object): [action, time] (coalescing; never in state)
const last = new WeakMap<object, [string, number]>()
const reported = new WeakSet<object>()

export interface UndoOptions { key: string, limit?: number, track?: string[], coalesce?: string[], coalesceMs?: number, resetOn?: string[] }

const actionOf = (a: string) => a.split('|')[0].trim()

// SYG226: report through the diagnostics core when it is enabled (dev); nothing in production
const check = (model: any, o: UndoOptions, component?: any, skip?: any) => {
  const known = new Set(Object.keys(model || {}).map(actionOf))
  for (const a of [...(o.track || []), ...(o.resetOn || []), ...(o.coalesce || [])]) {
    const i = a.indexOf('.'), m = i > 0 && skip?.[a.slice(0, i)]?.model
    // a behavior's action (G-477: one it doesn't have is reported)
    if (known.has(a) || m && a.slice(i + 1) in m) continue
    try {
      (globalThis as any).__SYGNAL_DIAGNOSTICS__?.report('SYG226', {
        severity: 'warn', component, data: {action: a},
        message: `undo ${o.track?.includes(a) ? 'track' : o.resetOn?.includes(a) ? 'resetOn' : 'coalesce'} names '${a}', which has no model entry`,
        fix: `Use the name of a model entry, or add '${a}' to the model`,
      })
    } catch (e) { queueMicrotask(() => { throw e }) }
  }
}

// a history without the pending gesture base
const settled = (h: any) => { const {base: _, ...o} = h; return o }
// the same value (a gesture step that put everything back: a cancel): arrays and plain objects
// compare their entries by identity (G-509), anything else is itself
const plain = (x: any) => Array.isArray(x) ? 1 : x && typeof x == 'object' && Object.getPrototypeOf(x) === Object.prototype ? 2 : 0
const same = (a: any, b: any) => {
  const k = a !== b && plain(a) && plain(a) == plain(b) && Object.keys(a)
  return a === b || !!k && k.length == Object.keys(b).length && k.every(i => i in b && a[i] === b[i])
}

const wrap = (model: any, o: UndoOptions, hk: string, ns: string, S = 'STATE', g: any = {}): any => {
  const {key, limit = 100, track, coalesce, coalesceMs = coalesce ? 500 : 0, resetOn = []} = o
  const out: any = {}
  const hist = (s: any) => s?.[hk] || {past: [], future: []}
  // 3-H G-447: a gesture's actions (`g`: another behavior's actions, 1 a step, 2 the one that
  // completes it, its `undoStep`). A step's change isn't recorded: `base` keeps [the value before
  // the gesture's first step, the value after its last]; the completing action records that
  // first value as one entry. A gesture that ends without it (cancelled) records nothing. The
  // pre-action state comes from the handler's props (`state`): as the host entry after the
  // behavior's (undo before it in `uses`), the reducer gets the behavior's result. `all`: the
  // gesture behavior's actions (G-477: `track` / `coalesce` naming any of them cover its steps)
  const gw = (f: any, [kind, all]: any, name: string) => {
    const has = (l?: string[]) => !!l && all.some((x: string) => l.includes(x))
    // G-507: drops join only when `coalesce` names the gesture (two separate drags are two steps)
    const tracked = !track || has(track), joins = coalesceMs > 0 && has(coalesce), reset = resetOn.includes(name)
    return (s: any, ...x: any[]) => {
      const r0 = f ? f(s, ...x) : s, r = isAbort(r0) ? s : r0, pre = x[2]?.state || s, none = f ? r0 : ABORT
      if (!r || typeof r != 'object' || !pre) return none
      const h = hist(r), b = h.base
      // G-477: resetOn names this gesture action
      if (reset) return h.past.length || h.future.length || b ? {...r, [hk]: {...settled(h), past: [], future: []}} : none
      // G-506: an untracked gesture is an untracked change: nothing recorded, nothing pending
      if (!tracked) return none
      // the base holds while the value is the one the gesture's last step left (G-475: else it
      // was changed outside the gesture, e.g. restored, and the base is stale)
      const on = b && b[1] === pre[key] && b
      if (kind == 1) {
        if (r[key] === pre[key]) return b && !on ? {...r, [hk]: settled(h)} : none
        const b0 = on ? on[0] : pre[key]
        // back where the gesture started (Escape, an item moved back): nothing pending (G-479)
        return {...r, [hk]: same(b0, r[key]) ? settled(h) : {...h, base: [b0, r[key]]}}
      }
      if (!b) return none
      if (!on || b[0] === r[key]) return {...r, [hk]: settled(h)}
      const at = Date.now(), prev = last.get(h.past)
      const join = joins && prev && prev[0] == name && at - prev[1] < coalesceMs && h.past.length
      const nh = {...settled(h), past: join ? h.past : [...h.past, b[0]].slice(-limit), future: []}
      last.set(nh.past, [name, at])
      return {...r, [hk]: nh}
    }
  }
  // G-473: a pending gesture's base, recorded before another change: the value from before the
  // gesture stays reachable (its steps join that change's entry)
  const before = (h: any, v: any) => { const b = h.base; return b && b[1] === v && b[0] !== v ? [b[0]] : null }
  for (const a in g) if (!(a in model)) out[a] = {[S]: gw(null, g[a], a)}
  for (const a in model) {
    const e = model[a], [name, sink] = a.split('|').map(x => x.trim())
    if (g[a]) {
      const f = typeof e == 'function' ? e : e?.[S]
      out[a] = typeof e == 'function' ? gw(e, g[a], a) : {...e, [S]: gw(typeof f == 'function' ? f : null, g[a], a)}
      continue
    }
    const reset = resetOn.includes(name), joins = coalesceMs > 0 && (!coalesce || coalesce.includes(name))
    const f0 = sink ? (sink == S ? e : null) : typeof e == 'function' ? e : e?.[S]
    // a constant STATE value isn't a reducer: the entry is left alone (G-214)
    if (f0 != null && typeof f0 != 'function') { out[a] = e; continue }
    const f = f0
    // an entry without a STATE reducer is left alone, except a resetOn object entry (gets one)
    if (!(f || reset && !sink) || !(reset || (track ? track.includes(name) : !BUILT_IN.test(name)))) { out[a] = e; continue }
    const w = (s: any, ...x: any[]) => {
      const r = f ? f(s, ...x) : s, h = hist(s)
      if (!r || typeof r != 'object' || isAbort(r)) return r
      if (reset) return h.past.length || h.future.length || h.base ? {...r, [hk]: {...settled(h), past: [], future: []}} : r
      if (r === s || r[key] === s[key]) return r
      const at = Date.now(), prev = last.get(h.past), b0 = before(h, s[key])
      const join = !b0 && joins && prev && prev[0] == name && at - prev[1] < coalesceMs && h.past.length
      const nh = {...settled(h), past: join ? h.past : [...h.past, b0 ? b0[0] : s[key]].slice(-limit), future: []}
      last.set(nh.past, [name, at])
      return {...r, [hk]: nh}
    }
    out[a] = sink || typeof e == 'function' ? w : {...e, [S]: w}
  }
  // mid-gesture, the value from before the gesture stands in for the current one: UNDO goes back
  // to it (G-473: the drag so far is the step undone), REDO records it (G-508: the drag so far
  // joins the redone step, as with a recorded action; at most `limit`)
  const step = (u: boolean) => (s: any) => {
    const h = hist(s), b = before(h, s[key]), {past, future} = h
    if (!(u ? b || past.length : future.length)) return ABORT
    return {...s, [key]: u ? b ? b[0] : past[past.length - 1] : future[0], [hk]: {...settled(h),
      past: u ? b ? past : past.slice(0, -1) : [...past, b ? b[0] : s[key]].slice(-limit),
      future: u ? [s[key], ...future] : future.slice(1)}}
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
  add('UNDO', step(true))
  add('REDO', step(false))
  return out
}

/**
 * Wraps a model's STATE reducers so `state[key]` gets undo / redo (GS-8): `state.history =
 * { past, future }`, plus UNDO and REDO entries for the intent to trigger. Options: `key` (the
 * state key to snapshot), `limit` (100), `track` (only these actions), `coalesceMs` (join rapid
 * changes by one action), `coalesce` (only these actions join; default window 500 ms), `resetOn`
 * (actions that clear the history). Returns a new model.
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
    const u = c.view?.uses, g: any = {}
    if (!reported.has(b)) reported.add(b), check(c.model, options, c, u)
    // the gestures of the host's other behaviors (sortable's drag: one step per drop), in either `uses` order
    for (const n in u) {
      const s = u[n]?.undoStep, all = Object.keys(u[n]?.model || {}).map(a => n + '.' + a)
      if (s) for (const a in u[n].model) g[n + '.' + a] = [s.includes(a) ? 2 : 1, all]
    }
    c.model = wrap(c.model || {}, options, k, k + '.', c.stateSourceName, g)
    merge(c, k)
  }
  return b
}
