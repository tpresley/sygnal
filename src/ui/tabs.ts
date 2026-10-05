/*
 * PLAN-5 2-U (S-4): Tabs, a behavior that wires the host's own markup (WAI-ARIA APG tabs).
 *
 *   Settings.uses = { tabs: tabs({ tab: '.tab', selected: 'general' }) }
 *   const a = tabsAttrs(state.tabs, uid)
 *   <div {...a.list} aria-label="Settings">
 *     <button className="tab" {...a.tab('general')}>General</button> …
 *   </div>
 *   <section {...a.panel('general')}>…</section> …
 *
 * The host renders the tabs and panels; `tabsAttrs` gives each its attributes from the slice:
 * roles, ids (from `uid`, so every instance has its own), aria-selected / aria-controls /
 * aria-labelledby, the roving tabindex, `hidden` on the other panels, and the hooks
 * `data-value` / `data-state` ('active' | 'inactive'). A click on a tab selects it; the arrow
 * keys move the focus between the tabs (and select, unless `activation: 'manual'`), Home / End
 * go to the first / last; disabled tabs are skipped.
 *
 * Options: `tab` (required: the tabs' selector), `selected` (the start; none: the first tab
 * rendered), `orientation` ('horizontal' | 'vertical': which arrow keys), `activation`
 * ('automatic' | 'manual'), `loop` (true), `id` (the ids' prefix; default: the key in `uses`).
 * State: { id, selected, orientation }. Actions: SELECT (a value, or a click), MOVE (a value:
 * focus it, and select it unless manual).
 */
import {ABORT, defineBehavior} from '../index'
import {idsOf, keyNav, keyed, lit} from './shared'

const base = /*#__PURE__*/ defineBehavior({
  initialState: {id: null as null | string, selected: null as null | string, orientation: 'horizontal'},
  intent: ({DOM}: any, {tab, orientation, loop}: any) => {
    const v = orientation == 'vertical'
    return {
      SELECT: DOM.click(tab).data('value'),
      MOVE: keyNav(DOM, tab, [v ? 'ArrowDown' : 'ArrowRight'], [v ? 'ArrowUp' : 'ArrowLeft'], loop),
    }
  },
  model: {
    SELECT: (s: any, v: any) => (v == null || String(v) === s.selected ? ABORT : {...s, selected: String(v)}),
    MOVE: {
      STATE: (s: any, v: string, _n: any, _p: any, o: any) => (o.activation == 'manual' || v === s.selected ? ABORT : {...s, selected: v}),
      ELEMENT: (_s: any, v: string, _n: any, _p: any, o: any) => ({focus: o.tab + '[data-value=' + lit(v) + ']'}),
    },
  },
})

/** Tabs as a behavior over the host's markup: `uses = { tabs: tabs({ tab: '.tab', selected: 'general' }) }`; render with `tabsAttrs`. */
export const tabs = (options: any = {}): any =>
  keyed(base({...options, ...(options.selected != null && {selected: String(options.selected)})}))

/**
 * The attributes of a tab set, from its slice: `list` (the tablist), `tab(value)` and
 * `panel(value)`. Spread them on the host's elements: `<button className="tab" {...a.tab('general')}>`.
 */
export const tabsAttrs = (s: any, uid: any): any => {
  const id = idsOf(s, uid, 'tabs'), state = (b: boolean) => (b ? 'active' : 'inactive')
  let first: any
  // no selection yet: the first tab (or panel) rendered is the selected one
  const on = (v: any) => {
    v = String(v)
    if (s?.selected != null) return v === String(s.selected)
    first ??= v
    return v === first
  }
  return {
    list: {role: 'tablist', 'aria-orientation': s?.orientation || 'horizontal'},
    tab: (v: any) => {
      const b = on(v)
      return {type: 'button', id: id('tab', v), role: 'tab', 'aria-selected': b, 'aria-controls': id('panel', v), tabindex: b ? '0' : '-1', 'data-value': String(v), 'data-state': state(b)}
    },
    panel: (v: any) => {
      const b = on(v)
      return {id: id('panel', v), role: 'tabpanel', 'aria-labelledby': id('tab', v), tabindex: '0', hidden: !b, 'data-state': state(b)}
    },
  }
}
