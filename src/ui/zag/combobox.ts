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
 * It is a widget field (extra/field.ts): the form behavior and processForm read its value; a form
 * reset puts the first value back (ZS-4).
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
import {NAMING, field, placed, arr, collectionOf, named, norm, options, valueOut} from './shared'

const shown = (all: any[], f: any, q: string) => {
  if (f === false || !q) return all
  const l = q.toLowerCase()
  return all.filter((i) => (typeof f == 'function' ? f(i, q) : String(i.label).toLowerCase().includes(l)))
}

// the filter text: what the user typed; '' when the list closes
const setText = (x: any, q: string) => { if (x.q !== q) x.q = q, x.refresh() }

// Round 2 (React Aria's allowsCustomValue): with `allowCustomValue` (single), the typed text is
// committed when the focus leaves the combobox, or on Enter with no active option: text that is an
// item's label picks that item, other text is the value itself (a value no item has), '' is no
// value. It is reported with value-change like a pick; the input keeps showing it (`shows`).
const commit = (x: any, blur?: any) => {
  if (!x.custom || x.multiple || !x.t) return
  const a = x.api(), q = a.inputValue, it = x.items.find((i: any) => i.label === q)
  x.t = 0
  // leaving closes the list (Zag closes it on a pointer or focus outside, not on every blur)
  blur && a.open && a.setOpen(false)
  a.setValue(it ? [it.value] : q ? [q] : [])
}

// G-411: forms get the value, not the label the input shows: the visible input has no name; one
// hidden input per value (a single combobox: one, '' when empty) carries `name`.
// G-435 / G-468: a single combobox with `allowCustomValue` submits the typed text while the user
// is typing (`x.t`: set by input-change, cleared by a selection, a commit, a value change or a new
// controlled value that isn't empty: G-494): the value of an item whose label the text is, else
// the text itself; otherwise the value. So `selectionBehavior` 'preserve' / 'clear', items
// relabelled after a pick and a `defaultValue` before the items load all submit the value.
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

// ZS-3: the input shows the value's label (with allowCustomValue, a value no item has: its text)
// while nothing is typed and the list is closed. Zag writes it only when the value changes: not
// when the items arrive after the value (async loading) or relabel it, and it writes the picked
// label even when a controlled value refuses the pick ('' for a custom value). Single,
// selectionBehavior 'replace' (the default) only; checked after each render and each of Zag's
// own writes, once the app's flush has run (an accepted pick's value arrives then)
const shows = (a: any, x: any) =>
  a.value.map((v: string) => x.items.find((i: any) => i.value === v)?.label ?? (x.custom ? v : '')).filter((l: string) => l).join(', ')
const sync = (api: any, p: any, x: any) => {
  const off = (a: any) => x.multiple || x.t || a.open || (p.selectionBehavior ?? 'replace') != 'replace' || a.inputValue === shows(a, x)
  api && off(api) || x.sq || (x.sq = 1, queueMicrotask(() => { x.sq = 0; const a = x.el.isConnected && x.api(); a && !off(a) && a.setInputValue(shows(a, x)) }))
}

// ZS-4: a form reset puts the first value back (as Zag's Select does: the controlled value's
// first, or defaultValue: value-change reports it) and the input shows its label; after the
// browser's own reset, which empties the visible input
const onReset = (x: any, input: any) => (e: any) => e.defaultPrevented || setTimeout(() => {
  if (!input.isConnected) return
  const c = x.machine.service.context
  c.set('value', c.initial('value') || [])
  x.t = 0
  setText(x, '')
  const a = x.api(), text = x.multiple ? '' : shows({value: c.initial('value') || []}, x)
  a.setInputValue(text)
  input.value = text
})

// Round 2 (F-2): a multiple combobox's values as chips before the input (chips={false}: none),
// each with a remove button (Zag's clearValue(value)); Backspace in the empty input removes the
// last one, the `remove` command one by value. The buttons are out of the tab order (the input
// keeps the focus, as in React Aria's and most comboboxes) and named by `removeLabel`.
const labelOf = (x: any, v: string) => x.items.find((i: any) => i.value === v)?.label ?? v
const remove = (x: any, v?: any) => {
  const a = x.api(), p = x.p
  if (p.disabled || p.readOnly || !a.value.length) return
  a.clearValue(v ?? a.value[a.value.length - 1])
}
const chips = (api: any, p: any, x: any) => {
  if (!x.multiple || p.chips === false || !api.value.length) return null
  const say = p.removeLabel ?? ((l: string) => 'Remove ' + l), off = !!(p.disabled || p.readOnly)
  return h('div', {attrs: {'data-scope': 'combobox', 'data-part': 'item-chips', role: 'list', 'aria-label': p.chipsLabel ?? (p.label != null ? String(p.label) : 'Selected')}},
    api.value.map((v: string) => {
      const l = labelOf(x, v)
      return h('span', {key: v, attrs: {'data-scope': 'combobox', 'data-part': 'item-chip', 'data-value': v, role: 'listitem', 'data-disabled': off ? '' : undefined}},
        h('span', {attrs: {'data-scope': 'combobox', 'data-part': 'item-chip-text'}}, l),
        h('button', {
          attrs: {type: 'button', tabindex: '-1', 'data-scope': 'combobox', 'data-part': 'item-chip-remove', 'aria-label': typeof say == 'function' ? say(l) : say + ' ' + l},
          props: {disabled: off},
          // the input keeps the focus
          on: {mousedown: (e: any) => e.preventDefault(), click: () => remove(x, v)},
        }, '×'))
    }))
}
// visually hidden, in the accessibility tree (the empty row's status region)
const SR = {position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', border: '0', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap'}

export const Combobox: any = /*#__PURE__*/ fromZag(combobox, (api: any, p: any, x: any) => {
  const input = named(api.getInputProps(), p, 1)
  delete input.attrs.name
  delete input.attrs.form
  // Round 2: commit the typed text (allowCustomValue) when the focus leaves the combobox, or on
  // Enter with no active option (Zag's handlers first)
  const on = input.on, out = on.focusout, kd = on.keydown
  on.focusout = (e: any) => { out?.(e); x.el.contains(e.relatedTarget) || commit(x, 1) }
  on.keydown = (e: any) => {
    const none = x.api().highlightedValue == null, empty = e.target.value === ''
    kd?.(e)
    if (e.key == 'Enter' && none) commit(x)
    // F-2: Backspace in the empty input removes the last chip
    else if (e.key == 'Backspace' && empty && x.multiple && p.chips !== false) remove(x)
  }
  x.p = p
  sync(api, p, x)
  // ZS-4: the reset listener on the input's form (its ancestor, or the `form` attribute's)
  const hook = {
    insert: (v: any) => {
      const f = x.form = p.form != null ? v.elm.ownerDocument.getElementById(p.form) : v.elm.closest('form')
      f?.addEventListener('reset', x.reset = onReset(x, v.elm))
    },
    destroy: () => x.form?.removeEventListener('reset', x.reset),
  }
  // F-4: `empty` while the list is open with no items: a row after the listbox, and the status
  // region's text (announced)
  const none = api.open && !api.collection.items.length && p.empty != null
  return h('div', api.getRootProps(),
    p.label != null && h('label', api.getLabelProps(), p.label),
    h('div', api.getControlProps(),
      chips(api, p, x),
      h('input', {...input, placeholder: p.placeholder, hook}),
      h('button', api.getTriggerProps(), '▾')),
    h('div', api.getPositionerProps(),
      h('div', named(api.getContentProps(), p), options(h, api)),
      p.empty != null && h('div', {attrs: {'data-scope': 'combobox', 'data-part': 'empty', hidden: !none}}, p.empty)),
    p.empty != null && h('div', {attrs: {role: 'status', 'data-scope': 'combobox', 'data-part': 'status'}, style: SR}, none ? p.empty : ''),
    hidden(api, p, x))
}, {
  name: 'Combobox',
  $own: 1,
  field,
  ownProps: [...NAMING, 'name'],
  props: ({items, label, placeholder, value, defaultValue, filter, empty, chips: _c, removeLabel, chipsLabel, 'aria-label': _l, 'aria-labelledby': _b, 'aria-describedby': _d, ...p}: any, x: any) => {
    x.multiple = !!p.multiple
    x.custom = !!p.allowCustomValue
    x.items = norm(items)
    // G-468: a new controlled value ends the typing. G-494: not an empty one (an app that clears
    // its value on input-change: the typed text is still what is submitted)
    const v = arr(value), k = v && JSON.stringify(v)
    if (k !== x.v) x.v = k, v?.length && (x.t = 0)
    // the first value (ZS-4), whether controlled; a controlled custom value (Round 2)
    return {
      ...placed(p),
      collection: collectionOf(combobox, shown(x.items, filter, x.q || '')),
      value: v,
      defaultValue: arr(defaultValue),
      // typing only (not the label a selection writes): the filter text, and input-change
      // G-414: the app's own callbacks (p.onInputValueChange / p.onOpenChange) run first
      // ZS-3: Zag's own writes (a value change's label, outside a render) are checked too, once
      // they are in (after this callback)
      onInputValueChange: (d: any) => {
        p.onInputValueChange?.(d)
        if (d.reason == 'input-change') x.t = 1, setText(x, d.inputValue), x.dispatch('input-change', d.inputValue)
        else sync(0, x.p, x)
      },
      onSelect: (d: any) => { x.t = 0; p.onSelect?.(d) },
      onValueChange: (d: any) => { x.t = 0; p.onValueChange?.(d) },
      onOpenChange: (d: any) => { p.onOpenChange?.(d); d.open || (setText(x, ''), sync(0, x.p, x)) },
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
    // F-2: { remove: '.c', value } removes one value (without `value`: the last)
    remove: (_: any, o: any, x: any) => remove(x, o.value),
    focus: (api: any) => api.focus(),
  },
  fallback: (p: any, hh: any) => hh('div', null, p.label != null && hh('label', null, p.label), hh('input', {placeholder: p.placeholder, disabled: true})),
})
