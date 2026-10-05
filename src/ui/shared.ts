/*
 * PLAN-5 2-U: helpers the sygnal/ui parts share. Everything from the core comes through
 * '../index', which the 'sygnal/ui' build turns into the external 'sygnal' (one core per app).
 */
import {sampleCombine} from '../index'

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
 * `__sel` is the selector renderComponent's `t.commands('ELEMENT')` logs in its place
 */
export const on = (sel: any, m: string, run: (el: any, o: any) => void): any => ({toString: () => '' + sel, __sel: sel, spec: {commands: {[m]: run}}})

/**
 * G-400: SYNC's trigger for a dialog / popover behavior: `false` when its element left the page
 * while the state says open (removed while open: no close / toggle event comes), and on the
 * first look when the state says open but the element isn't (a host made again on a state that
 * was open)
 */
export const gone = (DOM: any, STATE: any, sel: any, isOpen: (el: any) => boolean): any => {
  let first = true
  return DOM.select(sel).elements().compose(sampleCombine(STATE.stream)).filter(([e, s]: any) => {
    const f = first
    first = false
    return !!s?.open && (!e?.length || (f && !isOpen(e[0])))
  }).mapTo(false)
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
