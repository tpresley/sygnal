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
 * A pick is a field `input` event and leaving the combobox a `focusout` (ZS-1, ZS-5: the form
 * behavior, processForm); a form reset puts the first value back (ZS-4).
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
import {NAMING, announce, leaving, placed, arr, collectionOf, named, norm, options, valueOut} from './shared'

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
// change or a new controlled value that isn't empty: G-494); then the value of an item whose label the text is, else the
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

// ZS-3: the input shows the value's label while nothing is typed and the list is closed. Zag
// writes it only when the value changes: not when the items arrive after the value (async
// loading) or relabel it, and it writes the picked label even when a controlled value refuses the
// pick. Single, selectionBehavior 'replace' (the default) only; checked again once the app's flush
// has run (an accepted pick's value arrives then)
const label = (api: any) => api.collection.stringifyMany(api.value)
const sync = (api: any, p: any, x: any) => {
  const off = (a: any) => x.multiple || x.t || a.open || (p.selectionBehavior ?? 'replace') != 'replace' || a.inputValue === label(a)
  off(api) || queueMicrotask(() => { const a = x.el.isConnected && x.api(); a && !off(a) && a.syncSelectedItems() })
}

// ZS-4: a form reset puts the initial value back (as Zag's Select does: the controlled value's
// first, or defaultValue) and the input shows its label; after the browser's own reset, which
// empties the visible input
const onReset = (x: any, input: any) => (e: any) => e.defaultPrevented || setTimeout(() => {
  if (!input.isConnected) return
  const c = x.machine.service.context, v = c.initial('value') || []
  c.set('value', v)
  x.t = 0
  setText(x, '')
  const a = x.api(), text = x.multiple ? '' : a.collection.stringifyMany(v)
  a.setInputValue(text)
  input.value = text
})

export const Combobox: any = /*#__PURE__*/ fromZag(combobox, (api: any, p: any, x: any) => {
  const input = named(api.getInputProps(), p, 1)
  delete input.attrs.name
  delete input.attrs.form
  sync(api, p, x)
  // ZS-4: the reset listener on the input's form (its ancestor, or the `form` attribute's)
  const hook = {
    insert: (v: any) => {
      const f = x.form = p.form != null ? v.elm.ownerDocument.getElementById(p.form) : v.elm.closest('form')
      f?.addEventListener('reset', x.reset = onReset(x, v.elm))
    },
    destroy: () => x.form?.removeEventListener('reset', x.reset),
  }
  return h('div', leaving(api.getRootProps(), x, p),
    p.label != null && h('label', api.getLabelProps(), p.label),
    h('div', api.getControlProps(),
      h('input', {...input, placeholder: p.placeholder, hook}),
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
    // G-468: a new controlled value ends the typing. G-494: not an empty one (an app that clears
    // its value on input-change: the typed text is still what is submitted)
    const v = arr(value), k = v && JSON.stringify(v)
    if (k !== x.v) x.v = k, v?.length && (x.t = 0)
    return {
      ...placed(p, x),
      collection: collectionOf(combobox, shown(x.items, filter, x.q || '')),
      value: v,
      defaultValue: arr(defaultValue),
      // typing only (not the label a selection writes): the filter text, and input-change
      // G-414: the app's own callbacks (p.onInputValueChange / p.onOpenChange) run first
      onInputValueChange: (d: any) => { p.onInputValueChange?.(d); if (d.reason == 'input-change') x.t = 1, setText(x, d.inputValue), x.dispatch('input-change', d.inputValue) },
      onSelect: (d: any) => { x.t = 0; p.onSelect?.(d) },
      // ZS-1: the pick as a form field's input event (the form behavior, processForm)
      onValueChange: (d: any) => { x.t = 0; p.onValueChange?.(d); announce(x, p, d.value) },
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
