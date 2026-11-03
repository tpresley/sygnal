/*
 * The `wizard` behavior: a multi-step flow (research: dev-plans/research/wizard). Spike.
 *
 *   const flow = wizard({
 *     steps: { source: { label: 'Source', valid: (s) => !!s.draft.source }, review: { visit: { busy: false } } },
 *     draft: (state) => ({ source: null }), key: (state) => state.route.query.session,
 *     next: '.next', back: '.back', reset: '.start-over', goto: '.wizard-step',
 *     dirty: (w) => w.draft.source != null, confirm: '.leave-dialog', leave: '.leave', stay: '.stay',
 *     url: { route: 'newFilterStep', param: 'step', key: 'session' }, finish: 'CREATE',
 *   })
 *   NewFilter.uses = { wizard: flow }
 *   <Outlet of={{ source: Source, review: Review }} from="wizard" />   // src/extra/outlet.ts
 *
 * Slice (state.wizard): step, key (the flow key the state belongs to), visit (counts entries: the
 * outlet's identity; 0 until the flow starts), visited, draft (shared by the steps), local (each
 * step's own slice, by name), leaving (a navigation held while the leave confirm is open).
 * Calculated: steps ({ name, label, index, status, current, valid, visited, reachable, skipped };
 * status current | done | visited | upcoming | blocked | skipped), index, count, first, last,
 * canBack, canNext.
 *
 * What a step sees (the outlet's lens): its own slice local[name] over its component's
 * initialState, with `draft` the flow's draft; writes of `draft` go to the draft, the rest to its
 * own slice. Its `visit` defaults are written into its slice on each entry (scratch), and again
 * when the host starts (MOUNT: a host mounted again shows the step anew). A step's own
 * slice survives Back; the flow key changing, or a reset, makes the draft and every slice anew.
 *
 * Moves: NEXT (the next step not skipped, when the current one is valid; on the last step, the
 * `finish` host action with the draft), BACK, GOTO (a name, or a click on `goto` with data-step:
 * only a reachable step), RESET (start over; a plain object is the new draft). With `url`, a move
 * is a ROUTER command and the step follows the route (ROUTE); a route to a step that isn't
 * reachable is replaced with the furthest reachable one. `url.from(hostState)` (default
 * state.route) maps the host's route to the step route; an attempted navigation is mapped with it
 * too, given the host state with `route` set to the attempted route.
 *
 * Leave guard: while `dirty(slice, step)`, the host holds { block: '<key>.LEAVE' }. A navigation
 * inside the flow (url: the same route and flow key) is made at once and the block re-armed;
 * another is held in `leaving` and the `confirm` dialog opened (showModal). DISCARD runs
 * `discard(slice, hostState)` (default: start over) and makes the held navigation; STAY (or the
 * dialog's close) drops it. A move, a route, a new key or a reset that drops a held leave closes
 * the dialog (browser back/forward isn't stopped by a modal).
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

export const wizard = (o: any = {}): any => {
  const {steps: defs = {}, draft: dr = {}, key: keyOf, dirty, discard, finish, url, router: R = 'ROUTER',
    next: nextSel, back: backSel, reset: resetSel, goto: gotoSel, confirm, leave: leaveSel, stay: staySel} = o
  const names = Object.keys(defs), first = names[0]
  const draftOf = (h: any) => typeof dr == 'function' ? dr(h) : dr
  // what a step's predicates see: its own slice and the draft (the outlet adds its initialState)
  const viewOf = (w: any, n: string) => ({...w.local?.[n], draft: w.draft})
  const on = (w: any, n: string) => !defs[n]?.when || !!defs[n].when(viewOf(w, n))
  const ok = (w: any, n: string) => !defs[n]?.valid || !!defs[n].valid(viewOf(w, n))
  // the step names not skipped, in order
  const live = (w: any) => names.filter(n => on(w, n))
  const reachable = (w: any, n: string) => {
    for (const m of live(w)) { if (m == n) return true; if (!ok(w, m)) return false }
    return false
  }
  // the furthest reachable step (a deep link to a step that isn't reachable yet)
  const furthest = (w: any) => {
    let r = first
    for (const m of live(w)) { r = m; if (!ok(w, m)) break }
    return r
  }
  // step n's slices with its visit defaults written into its own (the same object when they are there)
  const scratch = (w: any, n: string) => {
    const v = defs[n]?.visit, l = w.local || {}, x = typeof v == 'function' ? v(viewOf(w, n)) : v
    return x && Object.keys(x).some(f => !Object.is(l[n]?.[f], x[f])) ? {...l, [n]: {...l[n], ...x}} : l
  }
  // an entry: a new visit, the step's visit defaults written into its slice
  const enter = (w: any, n: string) =>
    ({...w, step: n, visit: (w.visit || 0) + 1, visited: w.visited.includes(n) ? w.visited : [...w.visited, n], local: scratch(w, n), leaving: null})
  // the flow anew for key k (the draft from the host state; `d`: a draft given to RESET)
  // (url: at the step the route names when it is reachable, unless `top`: a reset)
  const fresh = (w: any, h: any, k: any, d?: any, top?: boolean) => {
    const n = {...w, key: k, draft: d ?? draftOf(h), local: {}, visited: [], leaving: null}
    const at = url && !top && routeStep(h)
    return enter(n, at && reachable(n, at) ? at : first)
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
  const target = (w: any, a: string, d?: any) => {
    const l = live(w), i = l.indexOf(w.step)
    if (a == 'NEXT') return ok(w, w.step) ? l[i + 1] ?? null : null
    if (a == 'BACK') return i > 0 ? l[i - 1] : null
    const n = nameOf(d, gotoSel)
    return n != w.step && names.includes(n) && reachable(w, n) ? n : null
  }
  // a move: a new step in state, or (url) a ROUTER command and no state change
  const move = (a: string) => ({
    ...shut,
    STATE: (w: any, d: any) => { const n = !url && target(w, a, d); return n ? enter(w, n) : ABORT },
    ...url && {[R]: (w: any, d: any, _n: any, p: any, _o: any, k: string) => {
      const s = was(w, p, k), n = target(s, a, d)
      return n ? go(s, n) : ABORT
    }},
  })
  const close = confirm ? {ELEMENT: () => ({close: confirm})} : {}
  // a move (or a route, a new key, a reset) that dropped a held leave closes its dialog (Sift bug 4:
  // browser back/forward isn't stopped by a modal)
  const shut = confirm ? {ELEMENT: (w: any, _d: any, _n: any, p: any, _o: any, k: string) => was(w, p, k)?.leaving && !w?.leaving ? {close: confirm} : ABORT} : {}

  const model: any = {
    // the flow starts, or the flow key changed: the flow anew (the same key: no change)
    KEY: {HOST: (h: any, k: any, _n: any, _p: any, _o: any, key: string) => {
      const w = h[key]
      return w.visit && Object.is(w.key, k) ? h : {...h, [key]: fresh(w, h, k)}
    }, ...shut},
    // the host started (Sift bug 2: a host mounted again with the same key and step): the current
    // step's visit defaults again, as its new instance's scratch
    MOUNT: (w: any) => {
      const l = w.visit ? scratch(w, w.step) : w.local
      return l === w.local ? ABORT : {...w, local: l}
    },
    NEXT: {
      ...move('NEXT'),
      // the last step: the finish action, with the draft
      EFFECT: (w: any, _d: any, next: any, p: any, _o: any, k: string) => {
        const s = was(w, p, k), l = live(s)
        if (finish && l[l.length - 1] == s.step && ok(s, s.step)) next(finish, s.draft)
      },
    },
    BACK: move('BACK'),
    GOTO: move('GOTO'),
    RESET: {
      ...shut,
      HOST: (h: any, d: any, _n: any, _p: any, _o: any, k: string) => ({...h, [k]: fresh(h[k], h, h[k].key, plainObj(d) ? d : undefined, true)}),
      // url: back to the first step's route (the state is already at the first step)
      ...url && {[R]: (w: any, _d: any, _n: any, p: any) => routeStep(p?.state) != first ? go(w, first) : ABORT},
    },
  }
  if (url) model.ROUTE = (w: any, n: any) => {
    // a route to a step: entered when reachable (redirected in ROUTER otherwise)
    if (!n || n == w.step || !w.visit) return ABORT
    return reachable(w, n) ? enter(w, n) : ABORT
  }
  if (url) model.ROUTE = {
    ...shut,
    STATE: model.ROUTE,
    [R]: (w: any, n: any, _x: any, p: any, _o: any, k: string) => {
      const s = was(w, p, k)
      return n && s.visit && n != s.step && !reachable(s, n) ? go(s, furthest(s), true) : ABORT
    },
  }
  if (dirty) Object.assign(model, {
    GUARD: {[R]: (_w: any, d: any, _n: any, _p: any, _o: any, k: string) => ({block: d ? k + '.LEAVE' : false})},
    // the router's attempt { to, route, proceed }: inside the flow, made (the block kept); else held
    LEAVE: {
      STATE: (w: any, a: any, _n: any, p: any) => inFlow(w, a?.route, p?.state) ? ABORT : {...w, leaving: a?.proceed ?? null},
      [R]: (w: any, a: any, _n: any, p: any, _o: any, k: string) => inFlow(was(w, p, k), a?.route, pre(p)) ? {...a.proceed, block: k + '.LEAVE'} : ABORT,
      ...confirm && {ELEMENT: (w: any, a: any, _n: any, p: any, _o: any, k: string) => inFlow(was(w, p, k), a?.route, pre(p)) ? ABORT : {showModal: confirm}},
    },
    DISCARD: {
      HOST: (h: any, _d: any, _n: any, _p: any, _o: any, k: string) => {
        const w = h[k], r = discard ? discard(w, h) : fresh(w, h, w.key, undefined, true)
        return {...h, [k]: {...r, leaving: null}}
      },
      [R]: (w: any, _d: any, _n: any, p: any, _o: any, k: string) => {
        const l = was(w, p, k).leaving
        return l ? {...l, block: false} : ABORT
      },
      ...close,
    },
    STAY: {STATE: (w: any) => w.leaving ? {...w, leaving: null} : ABORT, ...close},
  })
  // an attempted route inside the flow: one naming a step (Sift bug 5: through `url.from`, given the
  // host state with that route) for the flow's key
  const inFlow = (w: any, r: any, h: any) => {
    if (!url || !r) return false
    const m = url.from ? url.from({...h, route: r}) : r
    return m?.name == url.route && names.includes(m.params?.[url.param]) && (!url.key || m.query?.[url.key] == (w.key ?? undefined))
  }
  // the host state before the action (STATE gets it as props.state, outputs as props.previousState)
  const pre = (p: any) => p?.previousState || p?.state

  const b = defineBehavior({
    initialState: {step: first, key: null, visit: 0, visited: [], draft: typeof dr == 'function' ? {} : dr, local: {}, leaving: null},
    triggers: {NEXT: 'next', BACK: 'back', RESET: 'reset', GOTO: 'goto', DISCARD: 'leave', STAY: 'stay'},
    intent: ({DOM}: any, _o: any, k: string, host: any) => ({
      KEY: host.watch((h: any) => keyOf ? keyOf(h) ?? null : null, {immediate: true}),
      MOUNT: xs.of(0),
      ...url && {ROUTE: host.watch((h: any) => routeStep(h), {immediate: true})},
      ...dirty && {GUARD: host.watch((h: any) => !!(h?.[k]?.visit && dirty(h[k], h[k].step)), {immediate: true})},
      ...nextSel && {NEXT: DOM.click(nextSel)},
      ...backSel && {BACK: DOM.click(backSel)},
      ...resetSel && {RESET: DOM.click(resetSel)},
      ...gotoSel && {GOTO: DOM.click(gotoSel)},
      ...dirty && leaveSel && {DISCARD: DOM.click(leaveSel)},
      // the stay button, or the confirm dialog closed (Escape; after DISCARD / STAY: no change then)
      ...dirty && (staySel || confirm) && {STAY: xs.merge(...[staySel && DOM.click(staySel), confirm && DOM.select(confirm).events('close')].filter(Boolean))},
    }),
    model,
    calculated: {
      steps: (w: any) => {
        const l = live(w)
        return names.map(n => {
          const skipped = !l.includes(n), current = n == w.step, valid = ok(w, n), visited = w.visited.includes(n), r = !skipped && reachable(w, n)
          return {name: n, label: defs[n].label ?? n, index: l.indexOf(n), current, valid, visited, reachable: r, skipped,
            status: skipped ? 'skipped' : current ? 'current' : !r ? 'blocked' : visited ? (valid ? 'done' : 'visited') : 'upcoming'}
        })
      },
      index: (w: any) => live(w).indexOf(w.step),
      count: (w: any) => live(w).length,
      first: (w: any) => live(w)[0] == w.step,
      last: (w: any) => { const l = live(w); return l[l.length - 1] == w.step },
      canBack: (w: any) => live(w).indexOf(w.step) > 0,
      canNext: (w: any) => { const l = live(w); return ok(w, w.step) && (l.indexOf(w.step) < l.length - 1 || !!finish) },
    },
  // (`draft` and `key` name slice fields: not options that set their start values)
  })((({draft: _d, key: _k, ...x}) => x)(o))
  b.options = o
  // for the outlet (src/extra/outlet.ts): the flow key the host state names, and the slice's
  // calculated fields computed again (a step's write through the outlet's lens)
  const calcs = b.calculated
  b.$wizard = {keyOf, calc: (w: any) => { for (const f in calcs) w = {...w, [f]: calcs[f](w)}; return w }}
  return b
}
