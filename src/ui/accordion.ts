/*
 * PLAN-5 2-U (S-4): Accordion, a behavior that wires the host's own markup (WAI-ARIA APG
 * accordion).
 *
 *   Faq.uses = { faq: accordion({ trigger: '.faq-trigger' }) }
 *   const a = accordionAttrs(state.faq, uid)
 *   <h3><button className="faq-trigger" {...a.trigger('ship')}>Shipping</button></h3>
 *   <div {...a.panel('ship')}>…</div>
 *
 * `accordionAttrs` gives the triggers aria-expanded / aria-controls (and aria-disabled on the one
 * open panel when it can't be collapsed), the panels role="region" / aria-labelledby / hidden,
 * ids from `uid`, and the hooks `data-value` / `data-state` ('open' | 'closed'). A click on a
 * trigger toggles its panel; Up / Down / Home / End move the focus between the triggers.
 *
 * Options: `trigger` (required), `multiple` (false: opening one closes the others),
 * `collapsible` (true; false: the last open panel stays open), `expanded` (the start: a value or
 * an array), `loop` (true), `id` (the ids' prefix; default: the key in `uses`).
 * State: { id, expanded: string[], collapsible }. Actions: TOGGLE, EXPAND, COLLAPSE (a value, or
 * a click), MOVE (a value: focus that trigger).
 */
import {ABORT, defineBehavior} from '../index'
import {idsOf, keyNav, keyed, lit} from './shared'

const expand = (s: any, v: any, o: any) => {
  v = String(v)
  return s.expanded.includes(v) ? ABORT : {...s, expanded: o.multiple ? [...s.expanded, v] : [v]}
}
const collapse = (s: any, v: any) => {
  v = String(v)
  return !s.expanded.includes(v) || (s.collapsible === false && s.expanded.length == 1) ? ABORT
    : {...s, expanded: s.expanded.filter((x: string) => x !== v)}
}

const base = /*#__PURE__*/ defineBehavior({
  initialState: {id: null as null | string, expanded: [] as string[], collapsible: true},
  intent: ({DOM}: any, {trigger, loop}: any) => ({
    TOGGLE: DOM.click(trigger).data('value'),
    MOVE: keyNav(DOM, trigger, ['ArrowDown'], ['ArrowUp'], loop),
  }),
  model: {
    TOGGLE: (s: any, v: any, _n: any, _p: any, o: any) => (v == null ? ABORT : s.expanded.includes(String(v)) ? collapse(s, v) : expand(s, v, o)),
    EXPAND: (s: any, v: any, _n: any, _p: any, o: any) => (v == null ? ABORT : expand(s, v, o)),
    COLLAPSE: (s: any, v: any) => (v == null ? ABORT : collapse(s, v)),
    MOVE: {ELEMENT: (_s: any, v: string, _n: any, _p: any, o: any) => ({focus: o.trigger + '[data-value=' + lit(v) + ']'})},
  },
})

/** An accordion as a behavior over the host's markup: `uses = { faq: accordion({ trigger: '.faq-trigger' }) }`; render with `accordionAttrs`. */
export const accordion = (options: any = {}): any =>
  keyed(base({...options, ...(options.expanded != null && {expanded: ([] as any[]).concat(options.expanded).map(String)})}))

/** The attributes of an accordion, from its slice: `trigger(value)` and `panel(value)`. */
export const accordionAttrs = (s: any, uid: any): any => {
  const id = idsOf(s, uid, 'accordion'), ex: string[] = s?.expanded || []
  const on = (v: any) => ex.includes(String(v)), state = (v: any) => (on(v) ? 'open' : 'closed')
  const only = s?.collapsible === false && ex.length == 1
  return {
    trigger: (v: any) => ({
      type: 'button', id: id('trigger', v), 'aria-expanded': on(v), 'aria-controls': id('panel', v),
      'aria-disabled': only && on(v) ? true : undefined, 'data-value': String(v), 'data-state': state(v),
    }),
    panel: (v: any) => ({id: id('panel', v), role: 'region', 'aria-labelledby': id('trigger', v), hidden: !on(v), 'data-state': state(v)}),
  }
}
