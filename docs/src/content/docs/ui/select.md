---
title: Select
description: An accessible custom select (WAI-ARIA select-only combobox) from sygnal/ui/select, built on the Zag.js select machine
---

`Select` is a custom select: a button that shows the chosen option and opens a listbox, following the [WAI-ARIA select-only combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/). Keyboard, focus and typeahead come from [Zag.js](https://zagjs.com)'s select machine, rendered with [`fromZag`](/guide/adapters/#zag-machines-fromzag). It is a [widget](/guide/widgets/) tag.

A native `<select>` is smaller and works everywhere; use `Select` when the options need custom styling, or several values with checkmarks.

```jsx live live-height=230
import { Select } from 'sygnal/ui/select'

const SIZES = [
  { value: 's', label: 'Small' },
  { value: 'm', label: 'Medium' },
  { value: 'l', label: 'Large', disabled: true },
]

function Order({ state }) {
  return (
    <form className="order">
      <Select className="size" label="Size" items={SIZES} value={state.size} placeholder="Pick a size" name="size" />
      <p>{state.size ? `Size: ${state.size}` : 'No size yet'}</p>
    </form>
  )
}

Order.initialState = { size: null }
Order.intent = ({ DOM }) => ({
  SIZE: DOM.select('.size').events('value-change').detail(),
})
Order.model = {
  SIZE: (state, size) => ({ ...state, size }),
}
```

The value is controlled: the select shows `state.size`, and `value-change` reports the user's choice. Leave `value` out (or use `defaultValue`) to let the select keep its own value.

Install Zag's packages first: `npm install @zag-js/vanilla@~1.45.0 @zag-js/select@~1.45.0` (see [Menu](/ui/menu/#install)).

## Props

| Prop | | |
|---|---|---|
| `label` | | The visible label, linked to the trigger (its accessible name). Give every select one |
| `aria-label`, `aria-labelledby`, `aria-describedby` | | Name or describe the trigger when there is no visible `label` (or in addition to it); they go on the trigger, not the host |
| `items` | (required) | Strings, or `{ value, label, disabled }` objects. Values are strings |
| `value` | | Controlled: the value (an array with `multiple`); `null` for none |
| `defaultValue` | | The start value when `value` is left out |
| `placeholder` | | Shown while nothing is selected |
| `multiple` | `false` | Several values; the list stays open while picking |
| `name`, `form` | | The form field: a hidden native `<select>` carries the value in `FormData` |
| `disabled`, `readOnly`, `required`, `invalid` | | |
| `deselectable` | `false` | A click on the selected option clears it |
| `closeOnSelect` | `true` | With `multiple`: `false` |
| `loopFocus` | `false` | |
| `positioning` | | Zag's positioning options: `{ placement: 'bottom-start', sameWidth: true }` |
| `open` | | Controlled open state; follow `open-change` |

## Events and commands

| Event | Detail |
|---|---|
| `value-change` | The value (with `multiple`: the array of values); `null` when cleared |
| `open-change` | `true` / `false` |

Commands for `ELEMENT`: `open`, `close`, `clear`, and `focus` (the trigger): `CLEAR_SIZE: { ELEMENT: { clear: '.size' } }`.

## Keyboard

| Key | |
|---|---|
| Enter, Space, Down, Up | On the trigger: open the list |
| A letter | On the trigger: select the next option starting with it; in the list: move to it |
| Down / Up, Home / End | Move in the list; disabled options are skipped |
| Enter | Select the highlighted option and close; the focus returns to the trigger |
| Escape, Tab | Close |

## Styling

Zag's data attributes: `[data-scope="select"]` with `[data-part="root"]`, `"label"`, `"control"`, `"trigger"`, `"value-text"`, `"indicator"`, `"positioner"`, `"content"`, `"item"`, `"item-text"` and `"item-indicator"`. The trigger and content have `data-state`, options `data-highlighted`, `data-state="checked"` and `data-disabled`, and the value text `data-placeholder-shown` while empty. The item indicator (`✓`) is `hidden` on unselected options.

```css live
.size [data-part='trigger'] { min-width: 10rem; display: flex; justify-content: space-between; }
.size [data-part='content'] { background: Canvas; border: 1px solid #ddd; }
.size [data-part='item'] { padding: 4px 8px; }
.size [data-part='item'][data-highlighted] { background: rgb(99 102 241 / 0.25); }
.size [data-part='item'][data-disabled] { opacity: 0.5; }
```

## Positioning

The listbox renders inside the widget's host, next to the trigger, and Zag positions it with `position: absolute` (the `--x` / `--y` variables on the positioner). Inside a container that clips its content (`overflow: hidden` or `auto`: a card, a scrolling panel, a table cell), the open listbox is cut off at the container's edge. Pass `positioning={{ strategy: 'fixed' }}` there: the positioner is then placed relative to the viewport and escapes the clipping (it still follows the trigger when the page scrolls; an ancestor with a `transform`, `filter` or `contain` still clips it). Other options go in the same object: `positioning={{ placement: 'bottom-end', gutter: 4, strategy: 'fixed' }}`.

## Testing

```jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import Order from './Order.jsx'

it('keeps the chosen size', async () => {
  const t = renderComponent(Order)
  await t.ready()
  t.widget('.size').dispatch('value-change', 'm')
  await t.next((state) => state.size === 'm')
  expect(t.widget('.size').props.value).toBe('m')
  t.dispose()
})
```

For keyboard tests, see [Menu](/ui/menu/#testing).

## Size

Gzipped, in a small app: Select adds **33 KB** (mostly Zag's select machine, its positioning and `@zag-js/vanilla`). With Menu and Combobox, the three add 47 KB together.
