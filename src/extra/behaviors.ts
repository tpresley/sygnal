/*
 * PLAN-4 GS-1: reusable behaviors.
 *
 *   const pager = defineBehavior({ initialState, intent: (sources, options) => ..., model, calculated })
 *   TaskList.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }
 *
 * A behavior runs on state[key] (a lens). Its actions are '<key>.<ACTION>' (D109). Each value a
 * factory returns carries its own `merge(component, key)`; the core only loops over `uses` and
 * calls it (D114), so an app that never imports this module pays nothing.
 *
 * Merge rules (applied to the component instance, never to its statics):
 * - initialState: state[key] = the behavior's initialState, with the options that name one of its
 *   keys (pageSize) overriding it, plus its calculated fields. On a sub-component host (a
 *   Collection item, a child with a `state` prop) the slice isn't written into initialState
 *   (that would replace the parent's slice, SYG405): state[key] reads as that default until the
 *   first write (the core's `_idle` defaults, as for resources).
 * - calculated: fields of the slice, stored on it (state.pager.offset), recomputed after every
 *   behavior reducer and after any host STATE reducer that changes state[key].
 * - model: each entry gets the slice (STATE returns the new slice; ABORT and the slice itself
 *   mean no change, GS-4), `next('ACTION')` names the behavior's own actions. A host entry for
 *   the same action ('pager.NEXT') runs after the behavior's: a host STATE reducer gets the full
 *   state with the behavior's update applied (its ABORT keeps that update), a host EFFECT runs
 *   after the behavior's, and a host value sink (EVENTS, PARENT, a driver) replaces the
 *   behavior's value for that sink.
 * - intent: gets the host's sources (DOM is the host's isolated DOM source; CHILD, EVENTS and
 *   drivers as they are) with STATE lensed to the slice, plus the options. A host intent action
 *   with the same namespaced name overrides the behavior's trigger.
 * - `instance._behaviorActions` maps each behavior-owned action to its key (t.actions, 2-C).
 *   A host intent action of the same name makes it host-owned (removed from the map).
 * - renderComponent marks the streams it adds for simulateAction (`__sygnalTestActions`); they
 *   are merged with a behavior trigger of the same name instead of overriding it.
 * - D197 (PLAN-5): every model handler gets `(slice, data, next, props, options, key)`: the
 *   use's options and its key in `uses` (so a driver request can name a reply action
 *   `key + '.LOADED'`); the intent gets `(sources, options, key)`.
 * - D197: `HOST: (state, data, next, props, options, key) => state` in a model entry is a STATE
 *   reducer on the host's whole state (sortable reorders the host's array); ABORT or the same
 *   state is no change; the slice's calculated fields are recomputed when it changed.
 * - D197: `timers: (slice, options, key) => ({ name: spec })` declares timers (makeTimerDriver)
 *   for the host: named '<key>.<name>', a spec's action / frame naming one of the behavior's
 *   actions is namespaced as next() does. They join the host's own `timers` static through an
 *   accessor on the component function (installed once; the host's own value is kept as is and
 *   can still be assigned), which reads the host's current `uses`.
 * - Limitations: a host intent must return an object (not one stream).
 */
import xs from './xstreamCompat'
import {isAbort} from '../shared'
// a model entry as { sink: fn }: a constant is sent as is, `true` sends the action's data, an
// EFFECT constant does nothing (as the core treats them)
const sinksOf = (e: any, S: string): any => {
  const o: any = typeof e == 'function' ? {[S]: e} : {...e}
  for (const s in o) {
    const v = o[s]
    if (typeof v != 'function') o[s] = s == 'EFFECT' ? () => {} : v === true || v === undefined ? (_: any, d: any) => d : () => v
  }
  return o
}

const calcOf = (calcs: any) => (r: any) => {
  if (r && typeof r == 'object') for (const f in calcs) r = {...r, [f]: calcs[f](r)}
  return r
}

// the hosts whose `timers` static is an accessor (D197); the accessor's getter: the host's own
// timers plus each behavior's (from the host's current `uses`)
const timed = new WeakSet<any>()
const addTimers = (v: any): void => {
  if (timed.has(v)) return
  timed.add(v)
  let own = v.timers
  const all = (st: any) => {
    const o: any = {}, f = own
    if (typeof f == 'function') Object.assign(o, f(st))
    else if (f && typeof f == 'object') for (const r in f) o[r] = f[r](st)
    const u = v.uses
    for (const k in u) {
      const b = u[k], t = b?.timers?.(st?.[k] ?? b.state, b.options, k), rn = (a: any) => a in (b.model || {}) ? k + '.' + a : a
      for (const n in t) {
        const x = t[n]
        o[k + '.' + n] = x && {...x, ...(x.action && {action: rn(x.action)}), ...(x.frame && {frame: rn(x.frame)})}
      }
    }
    return o
  }
  Object.defineProperty(v, 'timers', {configurable: true, enumerable: true, get: () => all, set: (x: any) => { own = x }})
}

const mergeBehavior = (c: any, k: string, b: any): void => {
  const S = c.stateSourceName, calcs = b.calculated, calc = calcOf(calcs), model = c.model = {...c.model}, slice = b.state
  const owned = c._behaviorActions ||= {}, ns = (a: string) => k + '.' + a, opts = b.options
  if (b.timers && c.view) addTimers(c.view)
  if (c.isSubComponent && !c.isolatedState) c._idle = {...c._idle, [k]: slice}
  else c.initialState = {...(typeof c.initialState == 'object' ? c.initialState : {}), [k]: slice}

  // the slice's calculated fields stay fresh when a host reducer changes state[key]
  const fresh = (f: any) => (st: any, ...x: any[]) => {
    const r = f(st, ...x)
    return r && typeof r == 'object' && st && r[k] !== st[k] ? {...r, [k]: calc(r[k])} : r
  }
  if (calcs) for (const a in model) {
    const e = model[a]
    if (typeof e == 'function') { if (!a.includes('|') || a.split('|')[1].trim() == S) model[a] = fresh(e) }
    else if (e?.[S]) model[a] = {...e, [S]: fresh(e[S])}
  }

  for (const a in b.model) {
    const e = sinksOf(b.model[a], S), m: any = {}, host = model[ns(a)]
    for (const s in e) {
      // HOST: a STATE reducer on the host's whole state (D197)
      const whole = s == 'HOST'
      m[whole ? S : s] = (st: any, d: any, next: any, p: any) => {
        const r = e[s](whole ? st : st?.[k], d, next && ((t: string, ...y: any[]) => next(t in b.model ? ns(t) : t, ...y)), p, opts, k)
        return whole ? (isAbort(r) || r === st || !r || r[k] === st?.[k] ? r : {...r, [k]: calc(r[k])})
          : s != S || isAbort(r) ? r : r === st[k] ? st : {...st, [k]: calc(r)}
      }
    }
    if (host) {
      const hs = sinksOf(host, S)
      for (const s in hs) {
        const bf = m[s], hf = hs[s]
        m[s] = !bf ? hf
          : s == S ? (st: any, ...x: any[]) => {
              const r = bf(st, ...x), q = hf(isAbort(r) ? st : r, ...x)
              return isAbort(q) ? r : q
            }
          : s == 'EFFECT' ? (...x: any[]) => { bf(...x); hf(...x) }
          : hf
      }
    }
    model[ns(a)] = m
    owned[ns(a)] = k
  }

  // one combined intent per instance: the behaviors' actions, then the host's own (which win)
  if (!c._uses) {
    const own = c.intent, list: any[] = c._uses = []
    c.intent = (so: any) => {
      const o: any = {}
      for (const [k, b, slice] of list) {
        const st = so[S], i = b.intent?.({...so, [S]: st?.select({get: (s: any) => s?.[k] ?? slice})}, b.options, k)
        for (const a in i) o[k + '.' + a] = i[a], owned[k + '.' + a] = k
      }
      const h = own?.(so), test = h?.__sygnalTestActions || []
      // renderComponent adds a stream for each static model action (simulateAction): merged in, not an override
      for (const a in h) test.includes(a) && o[a] ? o[a] = xs.merge(o[a], h[a]) : (delete owned[a], o[a] = h[a])
      return o
    }
  }
  c._uses.push([k, b, slice])
}

/**
 * defineBehavior({ initialState, intent?, model?, calculated?, timers? }) returns a factory; call
 * it with the options for one use (`pager({ pageSize: 10, next: Newer })`) in a component's `uses`.
 */
export const defineBehavior = (def: any) => (options: any = {}): any => {
  const init = {...def.initialState}, b: any = {...def, options}
  for (const o in options) if (o in init) init[o] = options[o]
  // the slice a host starts with: initialState, the options naming its keys, its calculated fields
  b.state = calcOf(def.calculated)(init)
  b.merge = (c: any, k: string) => mergeBehavior(c, k, b)
  return b
}
