/*
 * PLAN-5 2-U: helpers the sygnal/ui parts share. Everything from the core comes through
 * '../index', which the 'sygnal/ui' build turns into the external 'sygnal' (one core per app).
 */
import {sampleCombine, xs} from '../index'

/** `v` as a quoted CSS string, for an attribute selector (`.tab[data-value="a b"]`) */
export const lit = (v: any): string => '"' + String(v).replace(/["\\]/g, '\\$&') + '"'

/**
 * G-407: a part of an id: letters, digits and '-' as they are, anything else (whitespace, '_')
 * as `_<code>_` (as the core's uidPart), so two values never make the same id ('a b' / 'a_b')
 */
const part = (v: any): string => String(v).replace(/[^A-Za-z0-9-]/g, (c) => '_' + c.charCodeAt(0) + '_')

/**
 * The ids of one part's elements: `uid('<slice id>-<kind>-<value>')`. The slice id is the part's
 * key in `uses` (keyed() below) unless an `id` option names it; uid() makes it unique per
 * component instance. The slice id and the value are escaped (part()): no whitespace (aria-controls
 * is a list of ids) and no collisions.
 */
export const idsOf = (s: any, uid: any, fallback: string) => (kind: string, v?: any): string => {
  const n = `${part(s?.id ?? fallback)}-${kind}${v == null ? '' : '-' + part(v)}`
  return uid ? uid(n) : n
}

/**
 * an ELEMENT target whose `m` command runs `run(element, options)` (a D102 spec command). G-425:
 * `__sel` is the selector renderComponent's `t.commands('ELEMENT')` logs in its place. R2:
 * `optional`: no SYG640 when nothing matches (closing an element the host no longer renders)
 */
export const on = (sel: any, m: string, run: (el: any, o: any) => void, optional?: boolean): any => ({toString: () => '' + sel, __sel: sel, spec: {commands: {[m]: run}, optional}})

// ── ui-sweep R4: a part's elements in a <Portal> ─────────────────────
// A <Portal> patches its content into its target, outside the component's own DOM; its
// placeholder (in the component's DOM) names that content as `__portal` (core/markers/portal.ts).
// The component's own roots come from `DOM.elements()` (no select(): the dev selector checks
// don't see it); the mock DOM has none, and the parts then read their own DOM only.
const boxes = (roots: any): any[] => {
  const b: any[] = []
  for (const r of roots || []) for (const p of r.querySelectorAll?.('[data-sygnal-portal]') || []) p.__portal && b.push(p.__portal)
  return b
}
const real = (DOM: any) => typeof DOM.elements == 'function'

/** the elements `sel` matches: in the component's own DOM, else in the content of its portals */
export const find = (DOM: any, sel: any): any => {
  const own = DOM.select(sel).elements()
  return real(DOM) ? xs.combine(own, DOM.elements()).map(([o, rs]: any) => (o?.length ? o : boxes(rs).flatMap((b) => [...b.querySelectorAll('' + sel)]))) : own
}

/**
 * `type` events on `sel`'s elements (and, for a type that bubbles, from inside them), in the
 * component's own DOM and in its portals: there a capture listener on the document, with
 * `ownerTarget` set as the DOM driver sets it and `preventDefault` (true or a predicate) applied
 */
export const ev = (DOM: any, sel: any, type: string, o: any = {}, bubbles?: boolean): any => {
  const own = DOM.select(sel).events(type, o, bubbles)
  if (!real(DOM)) return own
  const pd = o.preventDefault
  return xs.merge(own, DOM.select('document').events(type, {useCapture: true}).compose(sampleCombine(DOM.elements())).map(([e, rs]: any) => {
    const t = e.target, m = e.bubbles ? t?.closest?.('' + sel) : t?.matches?.('' + sel) && t
    // not in its own DOM (the DOM driver delivers those), in one of its portals
    if (!m || rs.some((r: any) => r.contains(m)) || !boxes(rs).some((b) => b.contains(m))) return
    Object.defineProperty(e, 'ownerTarget', {value: m, configurable: true})
    if (pd === true || (typeof pd == 'function' && pd(e))) e.preventDefault()
    return e
  }).filter(Boolean))
}

/**
 * G-400: SYNC's trigger for a dialog / popover behavior: `false` when its element left the page
 * while the state says open (removed while open: no close / toggle event comes). R4: the element
 * may be in a portal (`els` from find()). R2: a host made again on a state that was open opens it
 * (APPLY), so the first look no longer closes the state.
 */
export const gone = (els: any, STATE: any): any => {
  // R2: only an element that was there (the first look may come before the first render)
  let had = false
  return els.compose(sampleCombine(STATE.stream)).filter(([e, s]: any) => {
    const left = had && !e?.length
    had = !!e?.length
    return left && !!s?.open
  }).mapTo(false)
}

/**
 * ui-sweep R2: APPLY's trigger: `state.open` is the source of truth (a controlled `open`, as
 * Radix's `open` / `onOpenChange`). When the slice's `open` changes, or its element is new (a
 * first render, a host rendered again), and the element still doesn't match once the commands of
 * that change have run (two microtasks after the next patch, or 20 ms when none comes), the
 * slice's value goes out: APPLY makes the element match. A host reducer that writes `open` opens
 * or closes the part this way; the behavior's own actions send their commands themselves, so
 * they match by then. A change of the element alone (a native close before its close event)
 * sends nothing.
 */
export const watch = (els: any, STATE: any, isOpen: (el: any) => boolean): any => {
  let cur: any, lastEl: any, lastOpen = false, due = 0, t: any, sub: any, q = 0
  const check = (l: any) => {
    clearTimeout(t)
    if (!due) return
    due = 0
    const [es, s] = cur, el = es?.[0], open = !!s?.open
    if (el && isOpen(el) !== open) l.next(open)
  }
  return xs.create({
    start: (l: any) => {
      sub = xs.combine(els, STATE.stream).subscribe({next: (x: any) => {
        const prev = cur
        cur = x
        const el = x[0]?.[0], open = !!x[1]?.open
        // (no timer while they match: a dialog that stays closed costs none)
        if ((el !== lastEl || open !== lastOpen) && el && isOpen(el) !== open) { due = 1; clearTimeout(t); t = setTimeout(() => check(l), 20) }
        lastEl = el
        lastOpen = open
        // a patch (the elements again): the change's commands run in a microtask after it
        if (due && prev && x[0] !== prev[0] && !q++) queueMicrotask(() => queueMicrotask(() => { q = 0; check(l) }))
      }})
    },
    stop: () => { sub?.unsubscribe(); clearTimeout(t) },
  })
}

/**
 * Writes the `uses` key into the slice's `id` (the prefix of the ids the attribute helpers make)
 * when no `id` option set it. Runs after the behavior's own merge, on the copy of the host's
 * initialState (or the sub-component default) that merge made. G-407: `id` is also a calculated
 * field, so a host reducer that replaces the slice without it gets it back (the ids stay).
 */
export const keyed = (b: any): any => {
  const merge = b.merge
  // G-423: renderToString gives a missing `id` the same key (extra/ssr.ts withUses)
  b.keyed = 1
  b.merge = (c: any, k: string) => {
    const id = b.options?.id ?? k
    b.calculated = {...b.calculated, id: (s: any) => s.id ?? id}
    merge(c, k)
    for (const f of ['initialState', '_idle']) {
      const o = c[f]
      if (o && o[k] && o[k].id == null) o[k] = {...o[k], id: k}
    }
  }
  return b
}

/**
 * ui-sweep: a focus a tooltip shows for: `:focus-visible` (the keyboard; a focus returned after a
 * keyboard close). Not a mouse click's (Chromium and Firefox focus a clicked button: the tip
 * stayed shown after the pointer left, until the focus moved). A focus event on an element
 * that doesn't have the focus (a test's simulated one), or without `matches` (the mock DOM), counts
 */
export const visible = (e: any): boolean => {
  try { const el = e.target; return el.getRootNode().activeElement !== el || el.matches(':focus-visible') } catch (_) { return true }
}

const mod = (e: any) => e.altKey || e.ctrlKey || e.metaKey

/**
 * Roving focus (WAI-ARIA APG): a keydown on one of `sel`'s elements becomes the `data-value` of
 * the element to move to: `next` / `prev` keys step through them in DOM order (wrapping unless
 * loop is false), Home / End go to the first / last. Disabled elements are skipped. The keys it
 * handles have their default prevented (no page scroll); every other key passes through.
 * Reads the elements of the host's own DOM (DOM.select(sel).elements()), so it needs a real
 * DOM: on renderComponent's mock DOM, simulate the action with a value instead.
 */
export const keyNav = (DOM: any, sel: any, next: string[], prev: string[], loop: any): any => {
  const keys = [...next, ...prev, 'Home', 'End'], s = DOM.select(sel)
  const ours = (e: any) => !mod(e) && keys.includes(e.key)
  return s.events('keydown', {preventDefault: ours})
    .compose(sampleCombine(s.elements()))
    .map(([e, els]: any) => {
      if (!ours(e)) return
      const list = [...(els || [])].filter((el: any) => !el.disabled), n = list.length, k = e.key
      const i = list.findIndex((el: any) => el.contains(e.target))
      const j = k == 'Home' ? 0 : k == 'End' ? n - 1 : i + (next.includes(k) ? 1 : -1)
      const to: any = loop === false ? list[j] : list[(j + n) % n]
      return to?.getAttribute('data-value')
    })
    .filter((v: any) => v != null)
}
