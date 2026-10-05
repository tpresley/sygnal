---
title: Combobox
description: An accessible autocomplete input (WAI-ARIA combobox) from sygnal/ui/combobox, built on the Zag.js combobox machine
---

`Combobox` is a text input with a list of suggestions that narrows as the user types, following the [WAI-ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/). Keyboard handling and the active option come from [Zag.js](https://zagjs.com)'s combobox machine, rendered with [`fromZag`](/guide/adapters/#zag-machines-fromzag). It is a [widget](/guide/widgets/) tag.

```jsx
import { Combobox } from 'sygnal/ui/combobox'

const CITIES = ['Amsterdam', 'Berlin', 'Lisbon', 'London', 'Paris', 'Prague']

function Trip({ state }) {
  return (
    <div className="trip">
      <Combobox className="city" label="City" items={CITIES} value={state.city} placeholder="Type a city" />
      <p>{state.city ? `Going to ${state.city}` : ''}</p>
    </div>
  )
}

Trip.initialState = { city: null }
Trip.intent = ({ DOM }) => ({
  CITY: DOM.select('.city').events('value-change').detail(),
})
Trip.model = {
  CITY: (state, city) => ({ ...state, city }),
}
```

Typing `lo` leaves London in the list; Down and Enter pick it, the input shows "London", and `value-change` sends `'London'`.

Install Zag's packages first: `npm install @zag-js/vanilla@~1.45.0 @zag-js/combobox@~1.45.0` (see [Menu](/ui/menu/#install)).

## Filtering

By default the list shows the items whose label contains the text, ignoring case. The filter text resets when the list closes, so the next open shows every item.

- `filter={(item, text) => item.label.toLowerCase().startsWith(text.toLowerCase())}` replaces the test.
- `filter={false}` turns it off: the app passes the items to show, from the `input-change` event. Use it for server-side search (with [`makeFetchDriver`](/guide/http/)):

```jsx
import { Combobox } from 'sygnal/ui/combobox'

function Search({ state }) {
  return <Combobox className="user" label="User" items={state.matches} filter={false} placeholder="Search users" />
}

Search.initialState = { matches: [] }
Search.intent = ({ DOM }) => ({
  QUERY: DOM.select('.user').events('input-change').detail(),
})
Search.model = {
  QUERY: { HTTP: (state, q) => ({ url: '/api/users', query: { q }, ok: 'MATCHES', error: 'FAILED', latest: true }) },
  MATCHES: (state, users) => ({ ...state, matches: users.map((u) => ({ value: u.id, label: u.name })) }),
  FAILED: (state) => ({ ...state, matches: [] }),
}
```

## Props

| Prop | | |
|---|---|---|
| `label` | | The visible label, linked to the input (its accessible name). Give every combobox one |
| `aria-label`, `aria-labelledby`, `aria-describedby` | | Name or describe the input when there is no visible `label` (or in addition to it); they go on the input, not the host |
| `items` | (required) | Strings, or `{ value, label, disabled }` objects |
| `value` | | Controlled: the value (an array with `multiple`); `null` for none |
| `defaultValue` | | The start value when `value` is left out |
| `placeholder` | | The input's placeholder |
| `filter` | contains | A function `(item, text) => boolean`, or `false` |
| `allowCustomValue` | `false` | Keep text that matches no item when the input loses focus. With `name` (single), the form submits the selected item's value, or, when the user typed since the last selection, the typed text (text equal to an item's label submits the item's value) |
| `openOnClick` | `false` | Open the list when the input is clicked |
| `inputBehavior` | `'none'` | `'autohighlight'` highlights the first match; `'autocomplete'` also completes the text |
| `selectionBehavior` | `'replace'` | What the input shows after a pick: `'replace'` (the label), `'clear'`, or `'preserve'` (the typed text). With `multiple`: `'clear'` |
| `closeOnSelect` | `true` | With `multiple`: `false` |
| `loopFocus` | `true` | The arrow keys wrap |
| `name` | | The form field: hidden inputs submit the value (one per value with `multiple`), not the label the input shows. `form` (a form's id) goes on those hidden inputs |
| `multiple`, `form`, `disabled`, `readOnly`, `required`, `invalid`, `positioning`, `open` | | As in Zag's combobox |

## Events and commands

| Event | Detail |
|---|---|
| `value-change` | The value (with `multiple`: the array); `null` when cleared |
| `input-change` | The text the user typed (not the label a pick writes) |
| `open-change` | `true` / `false` |

Commands for `ELEMENT`: `open`, `close`, `clear`, and `focus` (the input).

## Keyboard

| Key | |
|---|---|
| Typing | Filters the list and opens it |
| Down / Up | Open the list; move the active option (`aria-activedescendant`, the focus stays in the input) |
| Enter | Pick the active option |
| Escape | Close the list |
| Home / End | Move the caret in the input |

## Styling

Zag's data attributes: `[data-scope="combobox"]` with `[data-part="root"]`, `"label"`, `"control"`, `"input"`, `"trigger"`, `"positioner"`, `"content"`, `"item"`, `"item-text"` and `"item-indicator"`; `data-state`, `data-highlighted` and `data-disabled` as for [Select](/ui/select/#styling).

## Positioning

The listbox renders inside the widget's host, next to the input, and Zag positions it with `position: absolute` (the `--x` / `--y` variables on the positioner). Inside a container that clips its content (`overflow: hidden` or `auto`: a card, a scrolling panel, a table cell), the open listbox is cut off at the container's edge. Pass `positioning={{ strategy: 'fixed' }}` there: the positioner is then placed relative to the viewport and escapes the clipping (it still follows the input when the page scrolls; an ancestor with a `transform`, `filter` or `contain` still clips it). Other options go in the same object: `positioning={{ placement: 'bottom-end', gutter: 4, strategy: 'fixed' }}`.

## Testing

```jsx
import { it } from 'vitest'
import { renderComponent } from 'sygnal'
import Trip from './Trip.jsx'

it('keeps the picked city', async () => {
  const t = renderComponent(Trip)
  await t.ready()
  t.widget('.city').dispatch('value-change', 'Paris')
  await t.next((state) => state.city === 'Paris')
  t.dispose()
})
```

Typing and filtering need a DOM: see [Menu](/ui/menu/#testing).

## Size

Gzipped, in a small app: Combobox adds **34 KB** (mostly Zag's combobox machine, its positioning and `@zag-js/vanilla`). With Menu and Select, the three add 47 KB together.
