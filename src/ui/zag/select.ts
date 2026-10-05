/*
 * PLAN-5 2-Z (U-1): Select, a Zag select machine (WAI-ARIA select-only combobox + listbox) as a
 * widget tag.
 *
 *   <Select className="size" label="Size" items={['S', 'M', 'L']} value={state.size} placeholder="Pick a size" name="size" />
 *   intent: SIZE: DOM.select('.size').events('value-change').detail()   // 'M' (multiple: ['M', 'L'])
 *
 * Renders a label, a trigger button (role="combobox", named by the label) showing the selected
 * label or the placeholder, the listbox (items role="option", aria-selected, a ✓ indicator Zag
 * hides when unselected) in a positioner, and a hidden native <select> for forms (`name`).
 * Keyboard and typeahead are Zag's. Styling hooks: `data-scope="select"` + `data-part` (root,
 * label, control, trigger, value-text, indicator, positioner, content, item, item-text,
 * item-indicator), `data-state`, `data-highlighted`, `data-placeholder-shown`.
 *
 * Props: `label`, `items` (strings or { value, label?, disabled? }), `value` (controlled: a
 * string, or an array when `multiple`; null for none), `defaultValue`, `placeholder`, and Zag's
 * select props (`multiple`, `name`, `form`, `disabled`, `required`, `readOnly`, `invalid`,
 * `deselectable`, `closeOnSelect`, `loopFocus`, `positioning`, `open`, `id`). Events:
 * `value-change` (the value, or the values when multiple), `open-change` (boolean).
 * Commands: `open`, `close`, `clear`, `focus` (the trigger).
 */
import * as select from '@zag-js/select'
import {fromZag} from '../../zag'
import {createElement as h} from '../../index'
import {NAMING, arr, collectionOf, named, norm, options, valueOut} from './shared'

export const Select: any = /*#__PURE__*/ fromZag(select, (api: any, p: any, x: any) => {
  const hidden = api.getHiddenSelectProps(), v = api.value
  // multiple: the options' selected props carry the value (a select's value prop is one string)
  if (x.multiple) delete hidden.props.value
  if (p.label == null) delete hidden.attrs['aria-labelledby']
  return h('div', api.getRootProps(),
    p.label != null && h('label', api.getLabelProps(), p.label),
    h('div', api.getControlProps(),
      h('button', named(api.getTriggerProps(), p, 1),
        h('span', api.getValueTextProps(), api.valueAsString || p.placeholder || ''),
        h('span', api.getIndicatorProps(), '▾'))),
    h('div', api.getPositionerProps(), h('div', named(api.getContentProps(), p), options(h, api))),
    h('select', hidden,
      h('option', {value: ''}),
      x.items.map((i: any) => h('option', {key: i.value, value: i.value, selected: v.includes(i.value)}, i.label))))
}, {
  name: 'Select',
  $own: 1,
  ownProps: [...NAMING, 'name'],
  props: ({items, label, placeholder, value, defaultValue, 'aria-label': _l, 'aria-labelledby': _b, 'aria-describedby': _d, ...p}: any, x: any) => {
    x.items = norm(items)
    x.multiple = !!p.multiple
    return {...p, collection: collectionOf(select, x.items), value: arr(value), defaultValue: arr(defaultValue)}
  },
  events: {'value-change': ['onValueChange', valueOut], 'open-change': ['onOpenChange', (d: any) => d.open]},
  commands: {open: (api: any) => api.setOpen(true), close: (api: any) => api.setOpen(false), clear: (api: any) => api.clearValue(), focus: (api: any) => api.focus()},
  fallback: (p: any, hh: any) => hh('div', null, p.label != null && hh('label', null, p.label), hh('button', {type: 'button', disabled: true}, p.placeholder || '')),
})
