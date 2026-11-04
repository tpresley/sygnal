/*
 * The `wizard` behavior: a multi-step flow (research: dev-plans/research/wizard). Spike.
 *
 *   const flow = wizard({
 *     steps: { source: { label: 'Source', valid: (s) => !!s.draft.source }, review: { visit: { busy: false } } },
 *     draft: (state) => ({ source: null }), key: (state) => state.route.query.session,
 *     next: '.next', back: '.back', reset: '.start-over', goto: '.wizard-step',
 *     dirty: (step) => step.draft.source != null, confirm: '.leave-dialog', leave: '.leave', stay: '.stay',
 *     url: { route: 'newFilterStep', param: 'step', key: 'session' }, finish: 'CREATE',
 *   })
 *   NewFilter.uses = { wizard: flow }
 *   <Outlet of={{ source: Source, review: Review }} from="wizard" />   // src/extra/outlet.ts
 *
 * Slice (state.wizard): step, key (the flow key the state belongs to), visit (counts entries: the
 * outlet's identity is step + visit; 0 until the flow starts), visited, draft (shared by the
 * steps), initial (the draft the flow started with), local (each step's own slice, by name), leaving (a navigation held while the leave
 * confirm is open). Derived (written when a change of the slice or of the host's state changes
 * them: SYNC, a built-in action dispatched only then):
 * steps ({ name, label, index, status, current, valid, visited, reachable, skipped }; status
 * current | done | visited | upcoming | blocked | skipped), index, count, first, last, canBack,
 * canNext.
 *
 * What a step sees (the outlet's lens): its own slice local[name] over its component's
 * initialState, with the draft under `draftKey` ('draft'); writes of that key go to the draft, the
 * rest to its own slice. The predicates (`valid`, `when`, a function `label` / `dialog` / `visit`,
 * a step's `discard`) get the same view and the bag: `(step, bag)`; `dirty` gets `(step, stepName,
 * bag)` (the outlet registers the steps' initialStates). 7.2: the bag is the one the host's view
 * gets, `{ ...props, state, context, uid }` with `state` the host's whole state (no children /
 * slots). Where the wizard reads it (see `bagOf` below) it is complete, except: the intent's
 * watches (the key, the leave guard, the derived fields' sync, the route) have the host's props
 * and state but no context or uid; the read-time normalizer and the start slice have only
 * `state`. Its
 * `visit` defaults are written into its slice on each entry (scratch), and again when the host
 * starts (MOUNT: a host mounted again shows the step anew). A step's own slice survives Back.
 *
 * The flow key: `key(state, bag)`. Only a change from one key to another makes the draft and every step
 * slice anew; a key born mid-flow (null / undefined to a value) is adopted: the flow is kept (with
 * a `draft` function, the draft's top-level fields still at their start, `initial`, refilled from
 * draft(state, bag)); no
 * key (null: a step route without it; undefined: "not mine", another route of the host) keeps the
 * flow and its key. Start over is RESET.
 *
 * Moves: NEXT (the next step not skipped, when the current one is valid; on the last step, the
 * `finish` host action with the draft), BACK, GOTO (a name, or a click on `goto` with data-step:
 * only a reachable step), RESET (start over; a plain object is the new draft), FINISH (the
 * `finish` action). A step sends them as a PARENT message: `{ wizard: 'NEXT' }`, `{ wizard:
 * 'GOTO', step }`, `{ wizard: 'RESET', draft? }`, `{ wizard: 'FINISH' }`. With `url`, a move is a
 * ROUTER command and the step follows the route (ROUTE); a route to a step that isn't reachable is
 * replaced with the first incomplete step before it (backTo); RESET goes to `resetTo` (a command, or a function of
 * the slice and the bag), else the first step's route. `url.from(hostState, bag)` (default
 * state.route) maps the host's route to the step route; an attempted navigation is mapped with it
 * too, given the host state with `route` set to the attempted route.
 *
 * Leave guard: while the current step's `dirty` (else the wizard's) is true, the host holds
 * { block: '<key>.LEAVE' }. A navigation inside the flow (url: a step route for the flow's key or
 * none, or any key while the flow has none yet) is made at once and the block re-armed; another is held in
 * `leaving` and the `confirm` dialog opened (showModal). DISCARD runs the current step's `discard`
 * (else the wizard's; `(slice, bag) => slice`; default: start over) and makes the held
 * navigation; STAY (or the dialog's close) drops it. A move, a route, a new key or a reset that
 * drops a held leave closes the dialog (browser back/forward isn't stopped by a modal).
 *
 * Linear reachability: a step is reachable when every step before it that isn't skipped is valid.
 */
import xs from './xstreamCompat'
import {defineBehavior, was} from './behaviors'
import {ABORT, readBag} from '../shared'
import {dropRepeats} from './xstreamExtras'
import {objIsEqual} from '../cycle/state/objIsEqual'

const plainObj = (d: any) => !!d && typeof d == 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(d))
// a click's step name: the data-step of the clicked `goto` element (or one inside it); else the data as is
const nameOf = (d: any, sel: any): any => {
  if (!d || typeof d != 'object') return d
  const el = (sel && d.target?.closest?.(String(sel))) || d.ownerTarget || d.target
  return el?.getAttribute?.('data-step') ?? el?.dataset?.step
}
const BUILT_IN = Symbol.for('sygnal.builtIn')
// a slice a host of this page session mounted (restart: 'entry'); a symbol: JSON (persist, recordings) drops it
const SEEN = Symbol('sygnal.wizard.seen')
const DERIVED = ['steps', 'stepper', 'index', 'count', 'first', 'last', 'canBack', 'canNext', 'outcome', 'dialog']
// derived fields compared by value (arrays and plain objects, a few levels), so an unchanged result
// writes nothing (a dialog copy function returning a new object each time doesn't re-sync)
const same = (a: any, b: any, d = 0): boolean => Object.is(a, b) || d < 4 && !!a && !!b && typeof a == 'object' && typeof b == 'object'
  && Array.isArray(a) == Array.isArray(b) && Object.keys(a).length == Object.keys(b).length
  && Object.keys(a).every(f => same(a[f], b[f], d + 1))

export const wizard = (o: any = {}): any => {
  const {steps: defs = {}, draft: dr = {}, key: keyOf, dirty, discard, finish, url, router: R = 'ROUTER', draftKey: DK = 'draft',
    resetTo, groups = {}, dialog, next: nextSel, back: backSel, reset: resetSel, goto: gotoSel, confirm, leave: leaveSel, stay: staySel,
    restart = 'outcome'} = o
  const names = Object.keys(defs), out = (n: any) => !!defs[n]?.outcome
  // the steps of the stepper (outcome steps aren't: a final screen after the flow, such as Created)
  const regular = names.filter(n => !out(n)), first = regular[0] ?? names[0]
  // the steps' components and their initialStates, registered by the outlet (comps: for their PARENT
  // messages; subs: each running intent's subscriber for a component registered later)
  const inits: any = {}, comps = new Set<any>(), subs = new Set<(c: any) => void>(), regs = new Set<() => void>()
  const guarded = !!dirty || names.some(n => defs[n].dirty)
  // B: the bag (7.2), B.state the host's state; from a handler's props (complete), else bagOf
  const draftOf = (B: any) => typeof dr == 'function' ? dr(B.state, B) : dr
  // what a step and its predicates see: its initialState, its own slice, the draft
  const viewOf = (w: any, n: string) => ({...inits[n], ...w.local?.[n], [DK]: w.draft})
  const on = (w: any, n: string, B: any) => !defs[n]?.when || !!defs[n].when(viewOf(w, n), B)
  const ok = (w: any, n: string, B: any) => !defs[n]?.valid || !!defs[n].valid(viewOf(w, n), B)
  // the stepper's step names not skipped, in order
  const live = (w: any, B: any) => regular.filter(n => on(w, n, B))
  const reachable = (w: any, n: string, B: any) => {
    for (const m of live(w, B)) { if (m == n) return true; if (!ok(w, m, B)) return false }
    return false
  }
  // where a route to step n that isn't reachable goes (a deep link, a step's navigation): the first
  // step before it that isn't valid (as GOV.UK and React Hook Form wizards send you back to the first
  // incomplete step); for a step skipped by `when`, the last step before it that isn't skipped.
  // Never past n
  const backTo = (w: any, n: string, B: any) => {
    const l = live(w, B)
    let t = n
    if (!l.includes(n)) {
      t = l[0] ?? first
      for (const m of regular) { if (m == n) break; if (l.includes(m)) t = m }
    }
    for (const m of l) if (m == t || !ok(w, m, B)) return m
    return t
  }
  const labelOf = (lb: any, w: any, n: string, B: any) => typeof lb == 'function' ? lb(viewOf(w, n), B) : lb
  const derive = (w: any, B: any) => {
    const l = live(w, B), i = l.indexOf(w.step), o = out(w.step)
    const steps = regular.map(n => {
      const skipped = !l.includes(n), current = n == w.step, valid = ok(w, n, B), visited = w.visited.includes(n), r = !skipped && reachable(w, n, B)
      return {name: n, label: labelOf(defs[n].label, w, n, B) ?? n, index: l.indexOf(n), current, valid, visited, reachable: r, skipped,
        // on an outcome step every step that applies is done
        status: skipped ? 'skipped' : o ? 'done' : current ? 'current' : !r ? 'blocked' : visited ? (valid ? 'done' : 'visited') : 'upcoming'}
    })
    // the stepper: one entry per group (alternative steps sharing a slot: the one that applies, else
    // its first) or per step outside any group, in order
    const stepper: any[] = [], at: any = {}
    for (const e of steps) {
      const g = defs[e.name].group
      if (g == null) { stepper.push({...e, steps: [e.name], step: e.name}); continue }
      const x = at[g]
      if (!x) { stepper.push(at[g] = {...e, name: g, steps: [e.name], step: e.name, label: labelOf(groups[g]?.label, w, e.name, B) ?? e.label}); continue }
      x.steps.push(e.name)
      // the member that applies (the current one first) gives the entry its state
      if (e.current || x.skipped && !e.skipped) Object.assign(x, {...e, name: g, steps: x.steps, step: e.name, label: labelOf(groups[g]?.label, w, e.name, B) ?? e.label})
    }
    const dg = defs[w.step]?.dialog ?? dialog
    return {
      steps, stepper,
      index: i, count: l.length, first: l[0] == w.step, last: l[l.length - 1] == w.step, canBack: !o && i > 0,
      canNext: !o && ok(w, w.step, B) && (i < l.length - 1 || !!finish),
      outcome: o ? w.step : null,
      dialog: (typeof dg == 'function' ? dg(viewOf(w, w.step), B) : dg) ?? null,
    }
  }
  // the slice with its derived fields for the bag B (the same object when they didn't change)
  const fin = (w: any, B: any) => {
    if (!w || typeof w != 'object') return w
    const d: any = derive(w, B)
    return DERIVED.every(f => same(w[f], d[f])) ? w : {...w, ...d}
  }
  // step n's slices with its visit defaults written into its own (the same object when they are there)
  const scratch = (w: any, n: string, B: any) => {
    const v = defs[n]?.visit, l = w.local || {}, x = typeof v == 'function' ? v(viewOf(w, n), B) : v
    return x && Object.keys(x).some(f => !Object.is(l[n]?.[f], x[f])) ? {...l, [n]: {...l[n], ...x}} : l
  }
  // an entry: a new visit, the step's visit defaults written into its slice
  const enter = (w: any, n: string, B: any) =>
    ({...w, step: n, visit: (w.visit || 0) + 1, visited: w.visited.includes(n) ? w.visited : [...w.visited, n], local: scratch(w, n, B), leaving: null})
  // the flow anew for key k (the draft from the host state; `d`: a draft given to RESET)
  // (url: at the step the route names when it is reachable, unless `top`: a reset)
  // (`to`: the step to enter, straight: a GOTO with a new key doesn't pass through step one)
  const fresh = (w: any, B: any, k: any, d?: any, top?: boolean, to?: string) => {
    const dd = d ?? draftOf(B), n = {...w, key: k, draft: dd, initial: dd, local: {}, visited: [], leaving: null, reseed: null}
    const at = url && !top && routeStep(B)
    return enter(n, to ?? (at && reachable(n, at, B) ? at : first), B)
  }
  // url: a route's identity (name, params, query), to tell when the wizard's own navigation landed
  const sig = (r: any) => JSON.stringify(r ? [r.name, r.params, r.query] : null)
  // url: the step the route names (null when it is another route)
  const routeOf = (B: any) => (url.from ? url.from(B.state, B) : B.state?.route)
  const routeStep = (B: any) => {
    const r = routeOf(B)
    return r?.name == url.route && names.includes(r.params?.[url.param]) ? r.params[url.param] : null
  }
  const go = (w: any, n: string, replace?: boolean) =>
    ({to: url.route, params: {[url.param]: n}, ...url.key && w.key != null && {query: {[url.key]: w.key}}, ...replace && {replace: true}})
  // a step to move to from w (null: none)
  // (an outcome step is reached by GOTO from any step; from it, only another outcome step)
  const target = (w: any, a: string, d: any, B: any) => {
    const l = live(w, B), i = l.indexOf(w.step), n = a == 'GOTO' && nameOf(plainObj(d) ? d.step : d, gotoSel)
    if (out(w.step)) return n && out(n) && n != w.step ? n : null
    if (a == 'NEXT') return ok(w, w.step, B) ? l[i + 1] ?? null : null
    if (a == 'BACK') return i > 0 ? l[i - 1] : null
    return n != w.step && names.includes(n) && (out(n) || reachable(w, n, B)) ? n : null
  }
  // a key adopted mid-flow (none to a value): the flow kept, and (a `draft` function) the draft's
  // top-level fields the user hasn't changed from their start (`initial`) refilled from draft(state),
  // e.g. a field the new route now fills
  const adopt = (w: any, k: any, B: any) => refill({...w, key: k}, B)
  // the draft's top-level fields still at their start (`initial`) from draft(state) (a draft function)
  const refill = (w: any, B: any) => {
    if (typeof dr != 'function') return w
    const nd = dr(B.state, B), i = w.initial || {}, d = {...w.draft}, ni = {...i}
    if (!nd || typeof nd != 'object' || !w.draft || typeof w.draft != 'object') return w
    for (const f in nd) if (Object.is(w.draft[f], i[f])) d[f] = ni[f] = nd[f]
    return {...w, draft: d, initial: ni}
  }
  // the host state before the action (STATE gets it as props.state, outputs as props.previousState)
  const pre = (p: any) => p?.previousState || p?.state
  // the bag of a handler (its props p) for host state h (default: the one before the action)
  const bag = (p: any, h = pre(p)) => readBag(p, h, 'wizard')
  const close = confirm ? {ELEMENT: () => ({close: confirm})} : {}
  // a move (or a route, a new key, a reset) that dropped a held leave closes its dialog (Sift bug 4:
  // browser back/forward isn't stopped by a modal)
  const shut = confirm ? {ELEMENT: (w: any, _d: any, _n: any, p: any, _o: any, k: string) => was(w, p, k)?.leaving && !w?.leaving ? {close: confirm} : ABORT} : {}
  // a move: a new step in state, or (url) a ROUTER command and no state change
  const move = (a: string) => ({
    ...shut,
    STATE: (w: any, d: any, _n: any, p: any) => { const B = bag(p, p?.state), n = !url && target(w, a, d, B); return n ? fin(enter(w, n, B), B) : ABORT },
    ...url && {[R]: (w: any, d: any, _n: any, p: any, _o: any, k: string) => {
      const s = was(w, p, k), n = target(s, a, d, bag(p))
      return n ? go(s, n) : ABORT
    }},
  })
  // the finish action, with the draft (from the last step's NEXT, or a step's FINISH)
  const done = (w: any, next: any) => finish && next(finish, w.draft)
  // the host state (B.state) with slice k replaced by w and its derived fields
  // (the same host state when nothing changed)
  const put = (B: any, k: string, w: any) => {
    const h = B.state, r = fin(w, w === h[k] ? B : readBag(B, {...h, [k]: w}, 'wizard'))
    return r === h[k] ? h : {...h, [k]: r}
  }

  const model: any = {
    // the flow starts, or the flow key changed: only a key from another key makes the flow anew; a
    // key born mid-flow (none to a value) is adopted; none (null: a step route without it, undefined:
    // not mine) keeps the flow and its key
    KEY: {HOST: (h: any, k: any, _n: any, p: any, _o: any, key: string) => {
      const w = h[key], B = bag(p, h)
      if (!w.visit) return put(B, key, fresh(w, B, k ?? null))
      if (k == null || Object.is(w.key, k)) return h
      return put(B, key, w.key == null ? adopt(w, k, B) : fresh(w, B, k))
    }, ...shut},
    // the host started (Sift bug 2: a host mounted again with the same key and step): the current
    // step's visit defaults again, as its new instance's scratch; and (pass 2 bug B) the derived
    // fields of a slice the host didn't make (seeded by a parent, persisted), before the first render
    // `restart` (an entry starts a new flow; before the route is seen, so it doesn't redirect):
    // 'outcome', a host mounted on an outcome step that the route doesn't name (url; without url:
    // mounted again); 'entry', also a host mounted again in this page session (SEEN: a marker
    // persist and recordings drop, so a reload resumes), unless the router reached the route by
    // Back / Forward (ROUTER.navigation() 'traverse')
    MOUNT: {HOST: (h: any, via: any, _n: any, p: any, _o: any, k: string) => {
      const w = h[k], B = bag(p, h), again = !!w[SEEN]
      if (w.visit && ((out(w.step) && (url ? routeStep(B) != w.step : again)) || (restart == 'entry' && again && via != 'traverse')))
        return put(B, k, {...fresh(w, B, keyOf ? keyOf(B.state, B) ?? null : null), [SEEN]: true})
      const l = w.visit ? scratch(w, w.step, B) : w.local
      return put(B, k, l === w.local && again ? w : {...w, local: l, [SEEN]: true})
    }},
    // url: the wizard's own navigation (Start over, a GOTO with a new key) landed: the draft's
    // untouched fields from draft(state) on the route entered, not the one left (unless the message
    // gave the draft: reseed.refill false), and the step's visit defaults again on that route
    RESEED: {HOST: (h: any, _d: any, _n: any, p: any, _o: any, k: string) => {
      const w = h[k], B = bag(p, h)
      if (w.reseed == null) return h
      const f = w.reseed.refill ? refill(w, B) : w
      return put(B, k, {...f, local: scratch(f, f.step, B), reseed: null})
    }},
    // the host's state changed (a step's write, the host's own data): the derived fields again
    // (dispatched only when they would change: the intent filters; ABORT when they didn't)
    SYNC: {HOST: (h: any, _d: any, _n: any, p: any, _o: any, k: string) => { const r = put(bag(p, h), k, h[k]); return r === h ? ABORT : r }},
    NEXT: {
      ...move('NEXT'),
      // the last step: the finish action, with the draft
      EFFECT: (w: any, _d: any, next: any, p: any, _o: any, k: string) => {
        const s = was(w, p, k), B = bag(p), l = live(s, B)
        if (l[l.length - 1] == s.step && ok(s, s.step, B)) done(s, next)
      },
    },
    BACK: move('BACK'),
    // GOTO: a step name (or a click on `goto`); a step's { step, key }: the flow anew for that key at
    // that step (adopted, the flow kept, while it has no key yet) (a second record from inside the flow; url: navigated, past the leave guard). An
    // outcome step, or a new key, is entered in state at once (url: and navigated); another step in
    // url mode follows the route
    GOTO: {
      ...shut,
      HOST: (h: any, d: any, _n: any, p: any, _o: any, k: string) => {
        const w = h[k], B = bag(p, h)
        if (plainObj(d) && 'key' in d) {
          // (as for a key the route names: adopted when the flow has none yet, or the same key; else
          // the flow anew, at that step straight; `draft` seeds it, else (url) draft(state) is taken
          // once the route it navigates to has landed, RESEED)
          const keep = w.key == null || Object.is(w.key, d.key), n = names.includes(d.step) ? d.step : first
          let f = keep ? (w.key == null && d.key != null ? adopt(w, d.key, B) : w) : fresh(w, B, d.key ?? null, d.draft, true, n)
          if (keep && plainObj(d.draft)) f = {...f, draft: {...f.draft, ...d.draft}, initial: {...f.initial, ...d.draft}}
          if (url) f = {...f, reseed: {at: sig(routeOf(B)), refill: !plainObj(d.draft)}}
          return put(B, k, keep && n != f.step ? enter(f, n, B) : f)
        }
        const n = target(w, 'GOTO', d, B)
        return n && (!url || out(n)) ? put(B, k, enter(w, n, B)) : h
      },
      ...url && {[R]: (w: any, d: any, _n: any, p: any, _o: any, k: string) => {
        const s = was(w, p, k)
        // a fresh query: the message's `query` and the key, as a step's own navigation (N5)
        if (plainObj(d) && 'key' in d)
          return {to: url.route, params: {[url.param]: names.includes(d.step) ? d.step : first}, query: {...d.query, ...url.key && d.key != null && {[url.key]: d.key}}, force: true}
        const n = target(s, 'GOTO', d, bag(p))
        return n ? go(s, n) : ABORT
      }},
    },
    FINISH: {EFFECT: (w: any, _d: any, next: any, p: any, _o: any, k: string) => done(was(w, p, k), next)},
    RESET: {
      ...shut,
      // (url: when it navigates (resetTo, or to the first step's route), the flow anew with no key
      // (the route it lands on names one, or none) and the draft taken from that route once landed)
      HOST: (h: any, d: any, _n: any, p: any, _o: any, k: string) => {
        const B = bag(p, h), nav = url && (!!resetTo || routeStep(B) != first), f = fresh(h[k], B, nav ? null : h[k].key, plainObj(d) ? d : undefined, true)
        return put(B, k, nav ? {...f, reseed: {at: sig(routeOf(B)), refill: !plainObj(d)}} : f)
      },
      // url: to `resetTo`, else back to the first step's route (the state is already at the first step)
      ...(url || resetTo) && {[R]: (w: any, _d: any, _n: any, p: any, _o: any, k: string) => resetTo
        // (from the slice being reset: the flow's data decides where its start over goes)
        ? (typeof resetTo == 'function' ? resetTo(was(w, p, k), bag(p)) : resetTo)
        : routeStep(bag(p, p?.state)) != first ? go(w, first) : ABORT},
    },
  }
  if (url) model.ROUTE = {
    ...shut,
    // a route to a step: entered when reachable (redirected in ROUTER otherwise)
    // (from an outcome step a route back into the steps is replaced with the outcome's; an outcome
    // step is entered by GOTO, so a route to one that isn't current goes to the first incomplete step)
    STATE: (w: any, n: any, _x: any, p: any) => {
      const B = bag(p, p?.state)
      return !n || n == w.step || !w.visit || out(w.step) || out(n) || !reachable(w, n, B) ? ABORT : fin(enter(w, n, B), B)
    },
    [R]: (w: any, n: any, _x: any, p: any, _o: any, k: string) => {
      const s = was(w, p, k), B = bag(p), l = live(s, B)
      if (!n || !s.visit || n == s.step) return ABORT
      if (out(s.step)) return go(s, s.step, true)
      return out(n) || !reachable(s, n, B) ? go(s, backTo(s, out(n) ? l[l.length - 1] ?? first : n, B), true) : ABORT
    },
  }
  // the current step's dirty / discard, else the wizard's
  const dirtyIn = (w: any, B: any) => {
    const f = defs[w.step]?.dirty || dirty
    return !!f?.(viewOf(w, w.step), w.step, B)
  }
  if (guarded) Object.assign(model, {
    GUARD: {[R]: (_w: any, d: any, _n: any, _p: any, _o: any, k: string) => ({block: d ? k + '.LEAVE' : false})},
    // the router's attempt { to, route, proceed }: inside the flow, made (the block kept); else held
    LEAVE: {
      STATE: (w: any, a: any, _n: any, p: any) => inFlow(w, a?.route, bag(p, p?.state)) ? ABORT : {...w, leaving: a?.proceed ?? null},
      [R]: (w: any, a: any, _n: any, p: any, _o: any, k: string) => inFlow(was(w, p, k), a?.route, bag(p)) ? {...a.proceed, block: k + '.LEAVE'} : ABORT,
      ...confirm && {ELEMENT: (w: any, a: any, _n: any, p: any, _o: any, k: string) => inFlow(was(w, p, k), a?.route, bag(p)) ? ABORT : {showModal: confirm}},
    },
    DISCARD: {
      HOST: (h: any, _d: any, _n: any, p: any, _o: any, k: string) => {
        const w = h[k], B = bag(p, h), sd = defs[w.step]?.discard
        // a step's discard: (its view, the bag) => its state (the draft key in it: the draft)
        if (sd) {
          const {[DK]: d, ...own} = sd(viewOf(w, w.step), B) || {}
          return put(B, k, {...w, local: {...w.local, [w.step]: own}, ...d !== undefined && {draft: d}, leaving: null})
        }
        const r = discard ? discard(w, B) : fresh(w, B, w.key, undefined, true)
        return put(B, k, {...r, leaving: null})
      },
      [R]: (w: any, _d: any, _n: any, p: any, _o: any, k: string) => {
        const l = was(w, p, k).leaving
        return l ? {...l, block: false} : ABORT
      },
      ...close,
    },
    STAY: {STATE: (w: any) => w.leaving ? {...w, leaving: null} : ABORT, ...close},
  })
  // an attempted route inside the flow: one naming a step (through `url.from`, given the host state
  // with that route) for the flow's key, for no key (a step route without it), or for any key while
  // the flow has none yet (a key born mid-flow: a step that created the record moves on)
  const inFlow = (w: any, r: any, B: any) => {
    if (!url || !r) return false
    const h = {...B.state, route: r}, m = url.from ? url.from(h, readBag(B, h, 'wizard')) : r, q = m?.query?.[url.key]
    return m?.name == url.route && names.includes(m.params?.[url.param])
      && (!url.key || w.key == null || q == null || q == w.key)
  }

  // the start slice, with derived fields for a render before any action (SSR); predicates that need
  // the host's state get none here (the bag: { state: {} })
  const init: any = {step: first, key: null, visit: 0, visited: [], draft: typeof dr == 'function' ? {} : dr, initial: typeof dr == 'function' ? {} : dr, local: {}, leaving: null, reseed: null}
  try { Object.assign(init, derive(init, {state: {}})) }
  catch (_) { Object.assign(init, {steps: [], stepper: [], index: 0, count: regular.length, first: true, last: regular.length < 2, canBack: false, canNext: false, outcome: null, dialog: null}) }

  const b = defineBehavior({
    initialState: init,
    triggers: {NEXT: 'next', BACK: 'back', RESET: 'reset', GOTO: 'goto', DISCARD: 'leave', STAY: 'stay'},
    intent: ({DOM, CHILD, props$, ...S}: any, _o: any, k: string, host: any) => {
      // what the intent watches gets the bag of the host's state and (a sub-component host) its
      // props, again when either changes; no context or uid here (the handlers' bags have them)
      const B$ = props$ ? xs.combine(host.stream, props$).map(([h, p]: any) => readBag(p, h, 'wizard')) : host.stream.map((h: any) => readBag(null, h, 'wizard'))
      const watch = (f: (B: any) => any) => B$.map(f).compose(dropRepeats(objIsEqual))
      // the steps' PARENT messages ({ wizard: 'NEXT' | 'BACK' | 'GOTO' | 'RESET' | 'FINISH', step?, draft? }),
      // from every step component the outlet registered (now or later)
      const msg$ = xs.create({
        start(l: any) {
          const ls: any[] = [], sub = (c: any) => {
            const s = CHILD?.select(c), x = {next: (v: any) => v && typeof v == 'object' && v.wizard && l.next(v), error: () => {}, complete: () => {}}
            s && (s.addListener(x), ls.push([s, x]))
          }
          comps.forEach(sub)
          subs.add(sub)
          ;(this as any).stop = () => { subs.delete(sub); for (const [s, x] of ls) s.removeListener(x) }
        },
        stop() { (this as any).stop?.() },
      })
      const from = (t: string, f: (m: any) => any = () => 0) => msg$.filter((m: any) => m.wizard == t).map(f)
      const or = (sel: any, t: string, f?: any) => sel ? xs.merge(DOM.click(sel), from(t, f)) : from(t, f)
      return {
        KEY: watch((B: any) => keyOf ? keyOf(B.state, B) : null),
        // (with how the router reached this route: 'entry' restarts on a link or a command, not on Back / Forward)
        MOUNT: xs.of(S[R]?.navigation?.() ?? null),
        // (and when the outlet registers a step component: its initialState joins the predicates' view;
        // a task later, as it happens while the host renders)
        SYNC: xs.merge(B$.filter((B: any) => !!B.state?.[k]?.visit && fin(B.state[k], B) !== B.state[k]), xs.create({
          start(l: any) { const f = () => l.next(0); regs.add(f); (this as any).stop = () => regs.delete(f) },
          stop() { (this as any).stop?.() },
        })),
        ...url && {ROUTE: watch(routeStep),
          RESEED: B$.filter((B: any) => B.state?.[k]?.reseed != null && sig(routeOf(B)) !== B.state[k].reseed.at)},
        ...guarded && {GUARD: watch((B: any) => !!(B.state?.[k]?.visit && dirtyIn(B.state[k], B)))},
        NEXT: or(nextSel, 'NEXT'),
        BACK: or(backSel, 'BACK'),
        RESET: or(resetSel, 'RESET', (m: any) => m.draft),
        GOTO: or(gotoSel, 'GOTO', ({wizard: _w, ...m}: any) => 'key' in m ? m : m.step),
        FINISH: from('FINISH'),
        ...guarded && leaveSel && {DISCARD: DOM.click(leaveSel)},
        // the stay button, or the confirm dialog closed (Escape; after DISCARD / STAY: no change then)
        ...guarded && (staySel || confirm) && {STAY: xs.merge(...[staySel && DOM.click(staySel), confirm && DOM.select(confirm).events('close')].filter(Boolean))},
      }
    },
    model,
  // (`draft`, `key` and `steps` name slice fields: not options that set their start values)
  })((({draft: _d, key: _k, steps: _s, ...x}) => x)(o))
  b.options = o
  // SYNC and MOUNT are the wizard's own bookkeeping: built-in actions (Symbol.for('sygnal.builtIn')
  // on their handlers, as sygnal/yjs's), so the dev action log and DevTools leave them out
  const merge = b.merge
  b.merge = (c: any, k: string) => {
    merge(c, k)
    // the core's read-time hook (`_read`): a slice without its derived fields (seeded by a parent,
    // persisted) gets them wherever the state is read, the host's first view call included
    // (it belongs to the state cell, which hosts with different props can share: the bag has the state only)
    c._read = {...c._read, [k]: (w: any, h: any) => w && typeof w == 'object' && !('steps' in w) ? fin(w, {state: h}) : w}
    for (const a of ['SYNC', 'MOUNT', 'RESEED']) for (const f of Object.values(c.model[k + '.' + a] || {})) if (typeof f == 'function') (f as any)[BUILT_IN] = true
  }
  // for the outlet (src/extra/outlet.ts): the flow key the host state names (keyOf(state, bag)), the
  // draft's key in a step's state, the slice's derived fields again (calc(slice, bag): a step's write
  // through the outlet's lens), and
  // `step(name, Component)`: a step component the outlet renders (its initialState for the
  // predicates; its PARENT messages)
  b.$wizard = {keyOf, draftKey: DK, calc: fin, step: (n: string, c: any) => {
    if (typeof c != 'function') return
    const i = c.initialState && typeof c.initialState == 'object' ? c.initialState : undefined
    if (inits[n] !== i) inits[n] = i, i && queueMicrotask(() => regs.forEach(f => f()))
    if (!comps.has(c)) comps.add(c), subs.forEach(f => f(c))
  }}
  return b
}
