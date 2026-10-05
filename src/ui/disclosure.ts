/*
 * PLAN-5 2-U (S-4): Disclosure, a button that shows and hides a panel (WAI-ARIA APG disclosure).
 *
 *   Card.uses = { more: disclosure({ trigger: '.more-toggle' }) }
 *   const a = disclosureAttrs(state.more, uid)
 *   <button className="more-toggle" {...a.trigger}>Details</button>
 *   <div {...a.panel}>…</div>
 *
 * Options: `trigger` (required), `open` (the start, false), `id` (the ids' prefix; default: the
 * key in `uses`). State: { id, open }. Actions: TOGGLE (a click), OPEN, CLOSE.
 */
import {ABORT, defineBehavior} from '../index'
import {idsOf, keyed} from './shared'

const base = /*#__PURE__*/ defineBehavior({
  initialState: {id: null as null | string, open: false},
  intent: ({DOM}: any, {trigger}: any) => ({TOGGLE: DOM.click(trigger)}),
  model: {
    TOGGLE: (s: any) => ({...s, open: !s.open}),
    OPEN: (s: any) => (s.open ? ABORT : {...s, open: true}),
    CLOSE: (s: any) => (s.open ? {...s, open: false} : ABORT),
  },
})

/** A disclosure as a behavior over the host's markup: `uses = { more: disclosure({ trigger: '.more-toggle' }) }`; render with `disclosureAttrs`. */
export const disclosure = (options: any = {}): any => keyed(base(options))

/** The attributes of a disclosure, from its slice: `trigger` and `panel`. */
export const disclosureAttrs = (s: any, uid: any): any => {
  const id = idsOf(s, uid, 'disclosure'), open = !!s?.open, state = open ? 'open' : 'closed'
  return {
    trigger: {type: 'button', 'aria-expanded': open, 'aria-controls': id('panel'), 'data-state': state},
    panel: {id: id('panel'), hidden: !open, 'data-state': state},
  }
}
