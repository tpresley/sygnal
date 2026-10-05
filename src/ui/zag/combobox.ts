/*
 * PLAN-5 2-Z (U-1): Combobox, a Zag combobox machine (WAI-ARIA editable combobox with a listbox
 * popup) as a widget tag.
 *
 *   <Combobox className="city" label="City" items={CITIES} value={state.city} placeholder="Type a city" />
 *   intent: CITY: DOM.select('.city').events('value-change').detail()   // 'Paris'
 *
 * Renders a label, the input (role="combobox", aria-autocomplete="list", aria-activedescendant
 * on the highlighted option), a trigger button, and the listbox in a positioner. The items are
 * filtered as the user types: by default the labels that contain the text (case-insensitive);
 * `filter={(item, text) => boolean}` replaces the test, `filter={false}` leaves it to the app (it
 * passes the `items` to show, from `input-change`). The filter text resets when the list closes.
 * Keyboard is Zag's: ArrowDown / ArrowUp open and move, Enter selects, Escape closes, Home / End
 * in the input move the caret. Styling hooks: `data-scope="combobox"` + `data-part` (root, label,
 * control, input, trigger, positioner, content, item, item-text, item-indicator), `data-state`,
 * `data-highlighted`.
 *
 * Forms (G-411): with `name`, hidden inputs submit the value (one per value when `multiple`);
 * the visible input, which shows the label, has no name. `form` goes on the hidden inputs (G-434).
 * With `allowCustomValue` (single), the selected value is submitted unless the user typed since
 * the last selection; then the typed text (an item's exact label submits that item's value; G-435,
 * G-468).
 *
 * Props: `label`, `items` (strings or { value, label?, disabled? }), `value` (controlled: a
 * string, an array when `multiple`, null for none), `defaultValue`, `placeholder`, `filter`, and
 * Zag's combobox props (`multiple`, `name`, `form`, `disabled`, `readOnly`, `required`,
 * `invalid`, `allowCustomValue`, `openOnClick`, `inputBehavior`, `selectionBehavior`,
 * `closeOnSelect`, `loopFocus`, `positioning`, `open`, `id`). Events: `value-change` (the value,
 * or the values when multiple), `input-change` (the text the user typed), `open-change` (boolean).
 * Commands: `open`, `close`, `clear`, `focus` (the input).
 */
import * as combobox from '@zag-js/combobox'
import {fromZag} from '../../zag'
import {createElement as h} from '../../index'
import {NAMING, arr, collectionOf, named, norm, options, valueOut} from './shared'

const shown = (all: any[], f: any, q: string) => {
  if (f === false || !q) return all
  const l = q.toLowerCase()
  return all.filter((i) => (typeof f == 'function' ? f(i, q) : String(i.label).toLowerCase().includes(l)))
}

// the filter text: what the user typed; '' when the list closes
const setText = (x: any, q: string) => { if (x.q !== q) x.q = q, x.refresh() }

// G-411: forms get the value, not the label the input shows: the visible input has no name; one
// hidden input per value (a single combobox: one, '' when empty) carries `name`.
// G-435 / G-468: a single combobox with `allowCustomValue` submits the selected value unless the
// user typed since the last selection (`x.t`: set by input-change, cleared by a selection, a value
// change or a new controlled value); then the value of an item whose label the text is, else the
// text itself. So `selectionBehavior` 'preserve' / 'clear', items relabelled after a pick and a
// `defaultValue` before the items load all submit the value.
const submitted = (api: any, x: any): string => {
  const v = api.value[0] ?? ''
  if (!x.custom || !x.t) return v
  const q = api.inputValue
  return x.items.find((i: any) => i.label === q)?.value ?? q
}
const hidden = (api: any, p: any, x: any) => {
  if (p.name == null) return null
  const vs = x.multiple ? api.value : [submitted(api, x)]
  // G-434: `form` as an attribute (HTMLInputElement.form is a read-only property)
  const attrs = p.form == null ? undefined : {form: p.form}
  return vs.map((value: string, i: number) => h('input', {key: 'h' + i, type: 'hidden', name: p.name, attrs, disabled: !!p.disabled, value}))
}

export const Combobox: any = /*#__PURE__*/ fromZag(combobox, (api: any, p: any, x: any) => {
  const input = named(api.getInputProps(), p, 1)
  delete input.attrs.name
  delete input.attrs.form
  return h('div', api.getRootProps(),
    p.label != null && h('label', api.getLabelProps(), p.label),
    h('div', api.getControlProps(),
      h('input', {...input, placeholder: p.placeholder}),
      h('button', api.getTriggerProps(), '▾')),
    h('div', api.getPositionerProps(), h('div', named(api.getContentProps(), p), options(h, api))),
    hidden(api, p, x))
}, {
  name: 'Combobox',
  $own: 1,
  ownProps: [...NAMING, 'name'],
  props: ({items, label, placeholder, value, defaultValue, filter, 'aria-label': _l, 'aria-labelledby': _b, 'aria-describedby': _d, ...p}: any, x: any) => {
    x.multiple = !!p.multiple
    x.custom = !!p.allowCustomValue
    x.items = norm(items)
    // G-468: a new controlled value ends the typing
    const v = arr(value), k = v && JSON.stringify(v)
    if (k !== x.v) x.v = k, x.t = 0
    return {
      ...p,
      collection: collectionOf(combobox, shown(x.items, filter, x.q || '')),
      value: v,
      defaultValue: arr(defaultValue),
      // typing only (not the label a selection writes): the filter text, and input-change
      // G-414: the app's own callbacks (p.onInputValueChange / p.onOpenChange) run first
      onInputValueChange: (d: any) => { p.onInputValueChange?.(d); if (d.reason == 'input-change') x.t = 1, setText(x, d.inputValue), x.dispatch('input-change', d.inputValue) },
      onSelect: (d: any) => { x.t = 0; p.onSelect?.(d) },
      onValueChange: (d: any) => { x.t = 0; p.onValueChange?.(d) },
      onOpenChange: (d: any) => { p.onOpenChange?.(d); d.open || setText(x, '') },
    }
  },
  events: {
    'value-change': ['onValueChange', valueOut],
    'input-change': null,
    'open-change': ['onOpenChange', (d: any) => d.open],
  },
  commands: {
    open: (api: any) => api.setOpen(true),
    close: (api: any) => api.setOpen(false),
    clear: (api: any) => api.clearValue(),
    focus: (api: any) => api.focus(),
  },
  fallback: (p: any, hh: any) => hh('div', null, p.label != null && hh('label', null, p.label), hh('input', {placeholder: p.placeholder, disabled: true})),
})
