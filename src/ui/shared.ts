/*
 * PLAN-5 2-U: helpers the sygnal/ui parts share. Everything from the core comes through
 * '../index', which the 'sygnal/ui' build turns into the external 'sygnal' (one core per app).
 */
import {sampleCombine} from '../index'

/** `v` as a quoted CSS string, for an attribute selector (`.tab[data-value="a b"]`) */
export const lit = (v: any): string => '"' + String(v).replace(/["\\]/g, '\\$&') + '"'

/**
 * The ids of one part's elements: `uid('<slice id>-<kind>-<value>')`. The slice id is the part's
 * key in `uses` (keyed() below) unless an `id` option names it; uid() makes it unique per
 * component instance. Whitespace is not allowed in an id (aria-controls is a list of ids).
 */
export const idsOf = (s: any, uid: any, fallback: string) => (kind: string, v?: any): string => {
  const n = `${s?.id ?? fallback}-${kind}${v == null ? '' : '-' + v}`.replace(/\s+/g, '_')
  return uid ? uid(n) : n
}

/**
 * Writes the `uses` key into the slice's `id` (the prefix of the ids the attribute helpers make)
 * when no `id` option set it. Runs after the behavior's own merge, on the copy of the host's
 * initialState (or the sub-component default) that merge made.
 */
export const keyed = (b: any): any => {
  const merge = b.merge
  b.merge = (c: any, k: string) => {
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
