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
 * - Limitations: a behavior's reply actions (`ok: 'LOADED'` on a driver request) arrive under
 *   the name it gives, not namespaced; a host intent must return an object (not one stream).
 */
import xs from './xstreamCompat'

const isAbort = (v: any): boolean => typeof v == 'symbol' && v.description == 'sygnal.ABORT'
const sinksOf = (e: any, S: string): any => typeof e == 'function' ? {[S]: e} : {...e}

const calcOf = (calcs: any) => (r: any) => {
  if (r && typeof r == 'object') for (const f in calcs) r = {...r, [f]: calcs[f](r)}
  return r
}

const mergeBehavior = (c: any, k: string, b: any): void => {
  const S = c.stateSourceName, calcs = b.calculated, calc = calcOf(calcs), model = c.model = {...c.model}, slice = b.state
  const owned = c._behaviorActions ||= {}, ns = (a: string) => k + '.' + a
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
    for (const s in e) m[s] = (st: any, d: any, next: any, ...x: any[]) => {
      const r = e[s](st?.[k], d, next && ((t: string, ...y: any[]) => next(t in b.model ? ns(t) : t, ...y)), ...x)
      return s != S || isAbort(r) ? r : r === st[k] ? st : {...st, [k]: calc(r)}
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
        const st = so[S], i = b.intent?.({...so, [S]: st && Object.assign(st.select({get: (s: any) => s?.[k] ?? slice}), {_end: st._end})}, b.options)
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
 * defineBehavior({ initialState, intent?, model?, calculated? }) returns a factory; call it with
 * the options for one use (`pager({ pageSize: 10, next: Newer })`) in a component's `uses`.
 */
export const defineBehavior = (def: any) => (options: any = {}): any => {
  const init = {...def.initialState}, b: any = {...def, options}
  for (const o in options) if (o in init) init[o] = options[o]
  // the slice a host starts with: initialState, the options naming its keys, its calculated fields
  b.state = calcOf(def.calculated)(init)
  b.merge = (c: any, k: string) => mergeBehavior(c, k, b)
  return b
}
