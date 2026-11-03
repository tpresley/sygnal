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
 * rest to its own slice. The predicates (`valid`, `when`, `dirty`, a function `label`) get the same
 * view and the host's state: `(step, state)` (the outlet registers the steps' initialStates). Its
 * `visit` defaults are written into its slice on each entry (scratch), and again when the host
 * starts (MOUNT: a host mounted again shows the step anew). A step's own slice survives Back.
 *
 * The flow key: `key(state)`. Only a change from one key to another makes the draft and every step
 * slice anew; a key born mid-flow (null / undefined to a value) is adopted: the flow is kept (with
 * a `draft` function, the draft's top-level fields still at their start, `initial`, refilled from
 * draft(state)); no
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
 * the slice and the host state), else the first step's route. `url.from(hostState)` (default
 * state.route) maps the host's route to the step route; an attempted navigation is mapped with it
 * too, given the host state with `route` set to the attempted route.
 *
 * Leave guard: while the current step's `dirty` (else the wizard's) is true, the host holds
 * { block: '<key>.LEAVE' }. A navigation inside the flow (url: a step route for the flow's key or
 * none, or any key while the flow has none yet) is made at once and the block re-armed; another is held in
 * `leaving` and the `confirm` dialog opened (showModal). DISCARD runs the current step's `discard`
 * (else the wizard's; `(slice, hostState) => slice`; default: start over) and makes the held
 * navigation; STAY (or the dialog's close) drops it. A move, a route, a new key or a reset that
 * drops a held leave closes the dialog (browser back/forward isn't stopped by a modal).
 *
 * Linear reachability: a step is reachable when every step before it that isn't skipped is valid.
 */
import xs from './xstreamCompat'
import {defineBehavior, was} from './behaviors'
import {ABORT} from '../shared'

const plainObj = (d: any) => !!d && typeof d == 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(d))
// a click's step name: the data-step of the clicked `goto` element (or one inside it); else the data as is
const nameOf = (d: any, sel: any): any => {
  if (!d || typeof d != 'object') return d
  const el = (sel && d.target?.closest?.(String(sel))) || d.ownerTarget || d.target
  return el?.getAttribute?.('data-step') ?? el?.dataset?.step
}
const BUILT_IN = Symbol.for('sygnal.builtIn')
const DERIVED = ['steps', 'stepper', 'index', 'count', 'first', 'last', 'canBack', 'canNext', 'outcome', 'dialog']
// derived fields compared by value (arrays and plain objects, a few levels), so an unchanged result
// writes nothing (a dialog copy function returning a new object each time doesn't re-sync)
const same = (a: any, b: any, d = 0): boolean => Object.is(a, b) || d < 4 && !!a && !!b && typeof a == 'object' && typeof b == 'object'
  && Array.isArray(a) == Array.isArray(b) && Object.keys(a).length == Object.keys(b).length
  && Object.keys(a).every(f => same(a[f], b[f], d + 1))

export const wizard = (o: any = {}): any => {
  const {steps: defs = {}, draft: dr = {}, key: keyOf, dirty, discard, finish, url, router: R = 'ROUTER', draftKey: DK = 'draft',
    resetTo, groups = {}, dialog, next: nextSel, back: backSel, reset: resetSel, goto: gotoSel, confirm, leave: leaveSel, stay: staySel} = o
  const names = Object.keys(defs), out = (n: any) => !!defs[n]?.outcome
  // the steps of the stepper (outcome steps aren't: a final screen after the flow, such as Created)
  const regular = names.filter(n => !out(n)), first = regular[0] ?? names[0]
  // the steps' components and their initialStates, registered by the outlet (comps: for their PARENT
  // messages; subs: each running intent's subscriber for a component registered later)
  const inits: any = {}, comps = new Set<any>(), subs = new Set<(c: any) => void>(), regs = new Set<() => void>()
  const guarded = !!dirty || names.some(n => defs[n].dirty)
  const draftOf = (h: any) => typeof dr == 'function' ? dr(h) : dr
  // what a step and its predicates see: its initialState, its own slice, the draft
  const viewOf = (w: any, n: string) => ({...inits[n], ...w.local?.[n], [DK]: w.draft})
  const on = (w: any, n: string, h: any) => !defs[n]?.when || !!defs[n].when(viewOf(w, n), h)
  const ok = (w: any, n: string, h: any) => !defs[n]?.valid || !!defs[n].valid(viewOf(w, n), h)
  // the stepper's step names not skipped, in order
  const live = (w: any, h: any) => regular.filter(n => on(w, n, h))
  const reachable = (w: any, n: string, h: any) => {
    for (const m of live(w, h)) { if (m == n) return true; if (!ok(w, m, h)) return false }
    return false
  }
  // where a route to step n that isn't reachable goes (a deep link, a step's navigation): the first
  // step before it that isn't valid (as GOV.UK and React Hook Form wizards send you back to the first
  // incomplete step); for a step skipped by `when`, the last step before it that isn't skipped.
  // Never past n
  const backTo = (w: any, n: string, h: any) => {
    const l = live(w, h)
    let t = n
    if (!l.includes(n)) {
      t = l[0] ?? first
      for (const m of regular) { if (m == n) break; if (l.includes(m)) t = m }
    }
    for (const m of l) if (m == t || !ok(w, m, h)) return m
    return t
  }
  const labelOf = (lb: any, w: any, n: string, h: any) => typeof lb == 'function' ? lb(viewOf(w, n), h) : lb
  const derive = (w: any, h: any) => {
    const l = live(w, h), i = l.indexOf(w.step), o = out(w.step)
    const steps = regular.map(n => {
      const skipped = !l.includes(n), current = n == w.step, valid = ok(w, n, h), visited = w.visited.includes(n), r = !skipped && reachable(w, n, h)
      return {name: n, label: labelOf(defs[n].label, w, n, h) ?? n, index: l.indexOf(n), current, valid, visited, reachable: r, skipped,
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
      if (!x) { stepper.push(at[g] = {...e, name: g, steps: [e.name], step: e.name, label: labelOf(groups[g]?.label, w, e.name, h) ?? e.label}); continue }
      x.steps.push(e.name)
      // the member that applies (the current one first) gives the entry its state
      if (e.current || x.skipped && !e.skipped) Object.assign(x, {...e, name: g, steps: x.steps, step: e.name, label: labelOf(groups[g]?.label, w, e.name, h) ?? e.label})
    }
    const dg = defs[w.step]?.dialog ?? dialog
    return {
      steps, stepper,
      index: i, count: l.length, first: l[0] == w.step, last: l[l.length - 1] == w.step, canBack: !o && i > 0,
      canNext: !o && ok(w, w.step, h) && (i < l.length - 1 || !!finish),
      outcome: o ? w.step : null,
      dialog: (typeof dg == 'function' ? dg(viewOf(w, w.step), h) : dg) ?? null,
    }
  }
  // the slice with its derived fields for host state h (the same object when they didn't change)
  const fin = (w: any, h: any) => {
    if (!w || typeof w != 'object') return w
    const d: any = derive(w, h)
    return DERIVED.every(f => same(w[f], d[f])) ? w : {...w, ...d}
  }
  // step n's slices with its visit defaults written into its own (the same object when they are there)
  const scratch = (w: any, n: string, h: any) => {
    const v = defs[n]?.visit, l = w.local || {}, x = typeof v == 'function' ? v(viewOf(w, n), h) : v
    return x && Object.keys(x).some(f => !Object.is(l[n]?.[f], x[f])) ? {...l, [n]: {...l[n], ...x}} : l
  }
  // an entry: a new visit, the step's visit defaults written into its slice
  const enter = (w: any, n: string, h: any) =>
    ({...w, step: n, visit: (w.visit || 0) + 1, visited: w.visited.includes(n) ? w.visited : [...w.visited, n], local: scratch(w, n, h), leaving: null})
  // the flow anew for key k (the draft from the host state; `d`: a draft given to RESET)
  // (url: at the step the route names when it is reachable, unless `top`: a reset)
  const fresh = (w: any, h: any, k: any, d?: any, top?: boolean) => {
    const dd = d ?? draftOf(h), n = {...w, key: k, draft: dd, initial: dd, local: {}, visited: [], leaving: null}
    const at = url && !top && routeStep(h)
    return enter(n, at && reachable(n, at, h) ? at : first, h)
  }
  // url: the step the route names (null when it is another route)
  const routeOf = (h: any) => (url.from ? url.from(h) : h?.route)
  const routeStep = (h: any) => {
    const r = routeOf(h)
    return r?.name == url.route && names.includes(r.params?.[url.param]) ? r.params[url.param] : null
  }
  const go = (w: any, n: string, replace?: boolean) =>
    ({to: url.route, params: {[url.param]: n}, ...url.key && w.key != null && {query: {[url.key]: w.key}}, ...replace && {replace: true}})
  // a step to move to from w (null: none)
  // (an outcome step is reached by GOTO from any step; from it, only another outcome step)
  const target = (w: any, a: string, d: any, h: any) => {
    const l = live(w, h), i = l.indexOf(w.step), n = a == 'GOTO' && nameOf(plainObj(d) ? d.step : d, gotoSel)
    if (out(w.step)) return n && out(n) && n != w.step ? n : null
    if (a == 'NEXT') return ok(w, w.step, h) ? l[i + 1] ?? null : null
    if (a == 'BACK') return i > 0 ? l[i - 1] : null
    return n != w.step && names.includes(n) && (out(n) || reachable(w, n, h)) ? n : null
  }
  // a key adopted mid-flow (none to a value): the flow kept, and (a `draft` function) the draft's
  // top-level fields the user hasn't changed from their start (`initial`) refilled from draft(state),
  // e.g. a field the new route now fills
  const adopt = (w: any, k: any, h: any) => {
    const r = {...w, key: k}
    if (typeof dr != 'function') return r
    const nd = dr(h), i = w.initial || {}, d = {...w.draft}, ni = {...i}
    if (!nd || typeof nd != 'object' || !w.draft || typeof w.draft != 'object') return r
    for (const f in nd) if (Object.is(w.draft[f], i[f])) d[f] = ni[f] = nd[f]
    return {...r, draft: d, initial: ni}
  }
  // the host state before the action (STATE gets it as props.state, outputs as props.previousState)
  const pre = (p: any) => p?.previousState || p?.state
  const close = confirm ? {ELEMENT: () => ({close: confirm})} : {}
  // a move (or a route, a new key, a reset) that dropped a held leave closes its dialog (Sift bug 4:
  // browser back/forward isn't stopped by a modal)
  const shut = confirm ? {ELEMENT: (w: any, _d: any, _n: any, p: any, _o: any, k: string) => was(w, p, k)?.leaving && !w?.leaving ? {close: confirm} : ABORT} : {}
  // a move: a new step in state, or (url) a ROUTER command and no state change
  const move = (a: string) => ({
    ...shut,
    STATE: (w: any, d: any, _n: any, p: any) => { const n = !url && target(w, a, d, p?.state); return n ? fin(enter(w, n, p?.state), p?.state) : ABORT },
    ...url && {[R]: (w: any, d: any, _n: any, p: any, _o: any, k: string) => {
      const s = was(w, p, k), n = target(s, a, d, pre(p))
      return n ? go(s, n) : ABORT
    }},
  })
  // the finish action, with the draft (from the last step's NEXT, or a step's FINISH)
  const done = (w: any, next: any) => finish && next(finish, w.draft)
  // the host state with slice k replaced by w and its derived fields
  // (the same host state when nothing changed)
  const put = (h: any, k: string, w: any) => {
    const r = fin(w, w === h[k] ? h : {...h, [k]: w})
    return r === h[k] ? h : {...h, [k]: r}
  }

  const model: any = {
    // the flow starts, or the flow key changed: only a key from another key makes the flow anew; a
    // key born mid-flow (none to a value) is adopted; none (null: a step route without it, undefined:
    // not mine) keeps the flow and its key
    KEY: {HOST: (h: any, k: any, _n: any, _p: any, _o: any, key: string) => {
      const w = h[key]
      if (!w.visit) return put(h, key, fresh(w, h, k ?? null))
      if (k == null || Object.is(w.key, k)) return h
      return put(h, key, w.key == null ? adopt(w, k, h) : fresh(w, h, k))
    }, ...shut},
    // the host started (Sift bug 2: a host mounted again with the same key and step): the current
    // step's visit defaults again, as its new instance's scratch; and (pass 2 bug B) the derived
    // fields of a slice the host didn't make (seeded by a parent, persisted), before the first render
    MOUNT: {HOST: (h: any, _d: any, _n: any, _p: any, _o: any, k: string) => {
      const w = h[k], l = w.visit ? scratch(w, w.step, h) : w.local
      return put(h, k, l === w.local ? w : {...w, local: l})
    }},
    // the host's state changed (a step's write, the host's own data): the derived fields again
    // (dispatched only when they would change: the intent filters; ABORT when they didn't)
    SYNC: {HOST: (h: any, _d: any, _n: any, _p: any, _o: any, k: string) => { const r = put(h, k, h[k]); return r === h ? ABORT : r }},
    NEXT: {
      ...move('NEXT'),
      // the last step: the finish action, with the draft
      EFFECT: (w: any, _d: any, next: any, p: any, _o: any, k: string) => {
        const s = was(w, p, k), h = pre(p), l = live(s, h)
        if (l[l.length - 1] == s.step && ok(s, s.step, h)) done(s, next)
      },
    },
    BACK: move('BACK'),
    // GOTO: a step name (or a click on `goto`); a step's { step, key }: the flow anew for that key at
    // that step (adopted, the flow kept, while it has no key yet) (a second record from inside the flow; url: navigated, past the leave guard). An
    // outcome step, or a new key, is entered in state at once (url: and navigated); another step in
    // url mode follows the route
    GOTO: {
      ...shut,
      HOST: (h: any, d: any, _n: any, _p: any, _o: any, k: string) => {
        const w = h[k]
        if (plainObj(d) && 'key' in d) {
          // (as for a key the route names: adopted when the flow has none yet, or the same key)
          const keep = w.key == null || Object.is(w.key, d.key)
          const f = keep ? (w.key == null && d.key != null ? adopt(w, d.key, h) : w) : fresh(w, h, d.key ?? null, undefined, true), n = names.includes(d.step) ? d.step : f.step
          return put(h, k, n == f.step && !keep ? f : enter(f, n, h))
        }
        const n = target(w, 'GOTO', d, h)
        return n && (!url || out(n)) ? put(h, k, enter(w, n, h)) : h
      },
      ...url && {[R]: (w: any, d: any, _n: any, p: any, _o: any, k: string) => {
        const s = was(w, p, k)
        if (plainObj(d) && 'key' in d) return {...go({key: d.key}, names.includes(d.step) ? d.step : first), force: true}
        const n = target(s, 'GOTO', d, pre(p))
        return n ? go(s, n) : ABORT
      }},
    },
    FINISH: {EFFECT: (w: any, _d: any, next: any, p: any, _o: any, k: string) => done(was(w, p, k), next)},
    RESET: {
      ...shut,
      HOST: (h: any, d: any, _n: any, _p: any, _o: any, k: string) => put(h, k, fresh(h[k], h, h[k].key, plainObj(d) ? d : undefined, true)),
      // url: to `resetTo`, else back to the first step's route (the state is already at the first step)
      ...(url || resetTo) && {[R]: (w: any, _d: any, _n: any, p: any, _o: any, k: string) => resetTo
        // (from the slice being reset: the flow's data decides where its start over goes)
        ? (typeof resetTo == 'function' ? resetTo(was(w, p, k), pre(p)) : resetTo)
        : routeStep(p?.state) != first ? go(w, first) : ABORT},
    },
  }
  if (url) model.ROUTE = {
    ...shut,
    // a route to a step: entered when reachable (redirected in ROUTER otherwise)
    // (from an outcome step a route back into the steps is replaced with the outcome's; an outcome
    // step is entered by GOTO, so a route to one that isn't current goes to the first incomplete step)
    STATE: (w: any, n: any, _x: any, p: any) => !n || n == w.step || !w.visit || out(w.step) || out(n) || !reachable(w, n, p?.state) ? ABORT : fin(enter(w, n, p?.state), p?.state),
    [R]: (w: any, n: any, _x: any, p: any, _o: any, k: string) => {
      const s = was(w, p, k), h = pre(p), l = live(s, h)
      if (!n || !s.visit || n == s.step) return ABORT
      if (out(s.step)) return go(s, s.step, true)
      return out(n) || !reachable(s, n, h) ? go(s, backTo(s, out(n) ? l[l.length - 1] ?? first : n, h), true) : ABORT
    },
  }
  // the current step's dirty / discard, else the wizard's
  const dirtyIn = (w: any, h: any) => {
    const f = defs[w.step]?.dirty || dirty
    return !!f?.(viewOf(w, w.step), h, w.step)
  }
  if (guarded) Object.assign(model, {
    GUARD: {[R]: (_w: any, d: any, _n: any, _p: any, _o: any, k: string) => ({block: d ? k + '.LEAVE' : false})},
    // the router's attempt { to, route, proceed }: inside the flow, made (the block kept); else held
    LEAVE: {
      STATE: (w: any, a: any, _n: any, p: any) => inFlow(w, a?.route, p?.state) ? ABORT : {...w, leaving: a?.proceed ?? null},
      [R]: (w: any, a: any, _n: any, p: any, _o: any, k: string) => inFlow(was(w, p, k), a?.route, pre(p)) ? {...a.proceed, block: k + '.LEAVE'} : ABORT,
      ...confirm && {ELEMENT: (w: any, a: any, _n: any, p: any, _o: any, k: string) => inFlow(was(w, p, k), a?.route, pre(p)) ? ABORT : {showModal: confirm}},
    },
    DISCARD: {
      HOST: (h: any, _d: any, _n: any, _p: any, _o: any, k: string) => {
        const w = h[k], sd = defs[w.step]?.discard
        // a step's discard: (its view, the host state) => its state (the draft key in it: the draft)
        if (sd) {
          const {[DK]: d, ...own} = sd(viewOf(w, w.step), h) || {}
          return put(h, k, {...w, local: {...w.local, [w.step]: own}, ...d !== undefined && {draft: d}, leaving: null})
        }
        const r = discard ? discard(w, h) : fresh(w, h, w.key, undefined, true)
        return put(h, k, {...r, leaving: null})
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
  const inFlow = (w: any, r: any, h: any) => {
    if (!url || !r) return false
    const m = url.from ? url.from({...h, route: r}) : r, q = m?.query?.[url.key]
    return m?.name == url.route && names.includes(m.params?.[url.param])
      && (!url.key || w.key == null || q == null || q == w.key)
  }

  // the start slice, with derived fields for a render before any action (SSR); predicates that need
  // the host's state get none here
  const init: any = {step: first, key: null, visit: 0, visited: [], draft: typeof dr == 'function' ? {} : dr, initial: typeof dr == 'function' ? {} : dr, local: {}, leaving: null}
  try { Object.assign(init, derive(init, {})) }
  catch (_) { Object.assign(init, {steps: [], stepper: [], index: 0, count: regular.length, first: true, last: regular.length < 2, canBack: false, canNext: false, outcome: null, dialog: null}) }

  const b = defineBehavior({
    initialState: init,
    triggers: {NEXT: 'next', BACK: 'back', RESET: 'reset', GOTO: 'goto', DISCARD: 'leave', STAY: 'stay'},
    intent: ({DOM, CHILD}: any, _o: any, k: string, host: any) => {
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
        KEY: host.watch((h: any) => keyOf ? keyOf(h) : null, {immediate: true}),
        MOUNT: xs.of(0),
        // (and when the outlet registers a step component: its initialState joins the predicates' view;
        // a task later, as it happens while the host renders)
        SYNC: xs.merge(host.stream.filter((h: any) => !!h?.[k]?.visit && fin(h[k], h) !== h[k]), xs.create({
          start(l: any) { const f = () => l.next(0); regs.add(f); (this as any).stop = () => regs.delete(f) },
          stop() { (this as any).stop?.() },
        })),
        ...url && {ROUTE: host.watch((h: any) => routeStep(h), {immediate: true})},
        ...guarded && {GUARD: host.watch((h: any) => !!(h?.[k]?.visit && dirtyIn(h[k], h)), {immediate: true})},
        NEXT: or(nextSel, 'NEXT'),
        BACK: or(backSel, 'BACK'),
        RESET: or(resetSel, 'RESET', (m: any) => m.draft),
        GOTO: or(gotoSel, 'GOTO', (m: any) => 'key' in m ? {step: m.step, key: m.key} : m.step),
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
    for (const a of ['SYNC', 'MOUNT']) for (const f of Object.values(c.model[k + '.' + a] || {})) if (typeof f == 'function') (f as any)[BUILT_IN] = true
  }
  // for the outlet (src/extra/outlet.ts): the flow key the host state names, the draft's key in a
  // step's state, the slice's derived fields again (a step's write through the outlet's lens), and
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
