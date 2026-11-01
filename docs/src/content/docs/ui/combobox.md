---
title: Combobox
description: An accessible autocomplete input (WAI-ARIA combobox) from sygnal/ui/combobox, built on the Zag.js combobox machine
---

`Combobox` is a text input with a list of suggestions that narrows as the user types, following the [WAI-ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/). Keyboard handling and the active option come from [Zag.js](https://zagjs.com)'s combobox machine, rendered with [`fromZag`](/guide/adapters/#zag-machines-fromzag). It is a [widget](/guide/widgets/) tag.

```jsx live
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
- `filter={false}` turns it off: the app passes the items to show, from the `input-change` event. Use it for server-side search (with [`makeFetchDriver`](/guide/http/)). In this demo, a stand-in server searches a few names:

```js live-server
const names = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Barbara Liskov', 'Donald Knuth']
const users = names.map((name, i) => ({ id: String(i + 1), name }))

export default {
  'GET /api/users': ({ query }) => {
    const q = (query.q ?? '').toLowerCase()
    return { json: users.filter((u) => u.name.toLowerCase().includes(q)), delayMs: 400 }
  },
}
```

```jsx live live-height=240 title="Search.jsx"
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

## Custom values

With `allowCustomValue`, the user can enter text that is no item, as React Aria's ComboBox `allowsCustomValue` does. The text is committed when the focus leaves the combobox (Tab, a click elsewhere), or on Enter with no active option:

- text equal to an item's label picks that item;
- other text becomes the value itself, reported with `value-change` like a pick, and the input keeps showing it;
- an empty input clears the value (`null`).

The controlled `value` and the [`form` behavior](/guide/forms/) get the committed text. A model that refuses it (`ABORT`) puts the input back to the state's value. While the user is still typing, a native form submission sends the typed text.

```jsx live live-height=240
import { Combobox } from 'sygnal/ui/combobox'

const COLORS = ['Red', 'Green', 'Blue']

function Paint({ state }) {
  return (
    <div className="paint">
      <Combobox className="color" label="Color" items={COLORS} value={state.color} allowCustomValue placeholder="A color, or your own" />
      <p>{state.color ? `Color: ${state.color}` : ''}</p>
    </div>
  )
}

Paint.initialState = { color: null }
Paint.intent = ({ DOM }) => ({
  COLOR: DOM.select('.color').events('value-change').detail(),
})
Paint.model = {
  COLOR: (state, color) => ({ ...state, color }),
}
```

## Several values (chips)

With `multiple`, each value is a chip before the input, with a remove button (`[data-part="item-chip-remove"]`, named "Remove Paris"). The chips work like React Aria's TagGroup:

- They are a grid (`[data-part="item-chips"]`, `role="grid"`, named by the label) of rows (`[data-part="item-chip"]`, `role="row"`, named by the item's label), described by "Press Delete to remove." (`removeHint`).
- They are one tab stop: the chip focused last, else the first. The remove buttons are out of the tab order (a click on one keeps the focus where it is).
- ArrowLeft at the start of the input focuses the last chip. ArrowLeft / ArrowRight move between the chips (swapped with `dir="rtl"`), ArrowRight past the last returns to the input, Home / End go to the first / last chip.
- Delete or Backspace on a chip removes it and focuses the next chip (else the previous, else the input). Backspace in the empty input removes the last chip.
- A removal is announced in a polite `role="status"` region: "Paris removed" (`removedMessage={(label) => …}` localizes it, `false` turns it off). It is announced once the value is gone: a model that refuses the removal announces nothing. An addition is not announced: the option's selection already is (React Aria announces added tags only while the focus is in the group, which a pick in the list never is).

The model can remove one with the `remove` command: `ELEMENT: (state, value) => ({ remove: '.tags', value })`.

```jsx live live-height=260
import { Combobox } from 'sygnal/ui/combobox'

const CITIES = ['Amsterdam', 'Berlin', 'Lisbon', 'London', 'Paris', 'Prague']

function Trip({ state }) {
  return (
    <div className="trip">
      <Combobox className="stops" label="Stops" items={CITIES} multiple value={state.stops} empty="No such city" placeholder="Add a city" />
      <p>{state.stops.length ? state.stops.join(' → ') : 'No stops yet'}</p>
    </div>
  )
}

Trip.initialState = { stops: ['Lisbon', 'Paris'] }
Trip.intent = ({ DOM }) => ({
  STOPS: DOM.select('.stops').events('value-change').detail(),
})
Trip.model = {
  STOPS: (state, stops) => ({ ...state, stops }),
}
```

```css live
.stops [data-part='control'] { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; border: 1px solid #ccc; border-radius: 6px; padding: 4px; }
.stops [data-part='item-chips'] { display: flex; flex-wrap: wrap; gap: 4px; }
.stops [data-part='item-chip'] { display: inline-flex; gap: 4px; align-items: center; background: rgb(99 102 241 / 0.15); border-radius: 999px; padding: 0 4px 0 8px; }
.stops [data-part='item-chip']:focus-visible { outline: 2px solid rgb(99 102 241); outline-offset: 1px; }
.stops [data-part='item-chip-remove'] { border: 0; background: none; cursor: pointer; padding: 0 4px; }
.stops [data-part='input'] { flex: 1; min-width: 6rem; border: 0; outline: none; }
.stops [data-part='content'], .stops [data-part='empty'] { background: Canvas; border: 1px solid #ddd; padding: 4px 8px; }
.stops [data-part='item'][data-highlighted] { background: rgb(99 102 241 / 0.25); }
```

`chips={false}` renders no chips, for a list of your own (keep the values in state and set `value` from its remove buttons).

## No results

`empty="No results"` shows a row (`[data-part="empty"]`, after the listbox) while the list is open with no items, and puts the same text in a `role="status"` region, so a screen reader announces it. Without `empty`, an open list with no items is just an empty box. The demo above has one: type a city that isn't there.

## Props

| Prop | | |
|---|---|---|
| `label` | | The visible label, linked to the input (its accessible name). Give every combobox one |
| `aria-label`, `aria-labelledby`, `aria-describedby` | | Name or describe the input when there is no visible `label` (or in addition to it); they go on the input, not the host |
| `items` | (required) | Strings, or `{ value, label, disabled }` objects, or groups of them (`{ group, items }`, as for [Select](/ui/select/#groups)): filtering keeps the groups that still have items |
| `value` | | Controlled: the value (an array with `multiple`); `null` for none. While nothing is typed, the input shows its label: also when the items arrive after the value, and when the model refuses a pick (the input goes back to the state's value) |
| `defaultValue` | | The start value when `value` is left out |
| `placeholder` | | The input's placeholder |
| `filter` | contains | A function `(item, text) => boolean`, or `false` |
| `allowCustomValue` | `false` | The typed text can be the value: see [Custom values](#custom-values) |
| `openOnClick` | `false` | Open the list when the input is clicked |
| `inputBehavior` | `'none'` | `'autohighlight'` highlights the first match; `'autocomplete'` also completes the text |
| `selectionBehavior` | `'replace'` | What the input shows after a pick: `'replace'` (the label), `'clear'`, or `'preserve'` (the typed text). With `multiple`: `'clear'` |
| `closeOnSelect` | `true` | With `multiple`: `false` |
| `loopFocus` | `true` | The arrow keys wrap |
| `name` | | The form field: the [`form` behavior](/guide/forms/) reads its value (`value={state.form.values.city}`) and touched state ([form fields](/guide/widgets/#form-fields)); hidden inputs submit the value natively (one per value with `multiple`), not the label the input shows. `form` (a form's id) goes on those hidden inputs. A form reset puts the first value back |
| `multiple` | `false` | Several values, shown as [chips](#several-values-chips) before the input |
| `chips` | `true` | With `multiple`: `false` renders no chips (render the values yourself) |
| `removeLabel` | `'Remove'` | A chip's remove button's name: a prefix (`'Remove'` → "Remove Paris") or `(label) => name` |
| `removedMessage` | `'Paris removed'` | `(label) => text`: what the status region says when a chip is removed; `false`: nothing |
| `removeHint` | `'Press Delete to remove.'` | The chips' description; `false`: none |
| `chipsLabel` | the `label` | The chips grid's name |
| `empty` | | Shown while the list is open with no items: [No results](#no-results) |
| `positioning` | `{ strategy: 'fixed' }` | Zag's positioning options ([Positioning](#positioning)) |
| `form`, `disabled`, `readOnly`, `required`, `invalid`, `open` | | As in Zag's combobox |

## Events and commands

| Event | Detail |
|---|---|
| `value-change` | The value (with `multiple`: the array); `null` when cleared |
| `input-change` | The text the user typed (not the label a pick writes) |
| `open-change` | `true` / `false` |

Commands for `ELEMENT`: `open`, `close`, `clear`, `focus` (the input), and `remove` (`{ remove: '.tags', value }`: one value of a `multiple` combobox; without `value`, the last).

## Keyboard

| Key | |
|---|---|
| Typing | Filters the list and opens it |
| Down / Up | Open the list; move the active option (`aria-activedescendant`, the focus stays in the input) |
| Enter | Pick the active option |
| Escape | Close the list |
| Home / End | Move the caret in the input |
| Backspace | In the empty input of a `multiple` combobox: remove the last chip |
| Left (Right with `dir="rtl"`) | At the start of the input of a `multiple` combobox: focus the last chip |
| On a chip: Left / Right | The previous / next chip; Right on the last: the input |
| On a chip: Home / End | The first / last chip |
| On a chip: Delete, Backspace | Remove it; focus the next chip (else the previous, else the input) |
| Tab, a click elsewhere | Close; with `allowCustomValue`, commit the typed text |

Inside a [controlled popover](/ui/popover/#controlled-dismissal) or [dialog](/ui/dialog/#controlled-dismissal), the open list is the top layer: Escape and a press outside close it first, a press in it isn't outside the popover or dialog, and the next Escape closes that one.

## Styling

Zag's data attributes: `[data-scope="combobox"]` with `[data-part="root"]`, `"label"`, `"control"`, `"input"`, `"trigger"`, `"positioner"`, `"content"`, `"item"`, `"item-text"`, `"item-indicator"`, `"item-group"`, `"item-group-label"`, and `"item-chips"`, `"item-chip"`, `"item-chip-cell"`, `"item-chip-text"`, `"item-chip-remove"`, `"empty"`, `"status"`; `data-state`, `data-highlighted` and `data-disabled` as for [Select](/ui/select/#styling).

```css live
.city { max-width: 16rem; }
.city [data-part='content'] { background: Canvas; border: 1px solid #ddd; }
.city [data-part='item'][data-highlighted] { background: rgb(99 102 241 / 0.25); }
```

## Positioning

The list renders inside the widget's host, next to its input, and Zag places it with `position: fixed` by default (as Radix's Popper does; the `--x` / `--y` variables on the positioner). So a container that clips its content (`overflow: hidden` or `auto`: a card, a scrolling panel, a table cell, a `<dialog>`) doesn't cut it off, and it still follows the input when the page scrolls. The caveat: an ancestor with a `transform`, `filter`, `perspective` or `contain` becomes the containing block of a fixed element, so inside one (an animated drawer, a scaled canvas) the list is placed and clipped relative to that ancestor. There, or to keep the list in the document flow, pass `positioning={{ strategy: 'absolute' }}`. Other options go in the same object and merge over the default: `positioning={{ placement: 'bottom-end', gutter: 4 }}`.

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
