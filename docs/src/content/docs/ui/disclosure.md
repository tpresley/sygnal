---
title: Disclosure
description: A button that shows and hides a section, with ARIA attributes from disclosureAttrs
---

`disclosure()` is a [behavior](/guide/behaviors/) for a button that shows and hides one section of content, following the [WAI-ARIA disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/). `disclosureAttrs()` gives the button `aria-expanded` and `aria-controls`, and the section its `id` and `hidden`.

```jsx
import { disclosure, disclosureAttrs } from 'sygnal/ui'

function Order({ state, uid }) {
  const a = disclosureAttrs(state.details, uid)
  return (
    <article className="order">
      <h2>Order {state.number}</h2>
      <button className="details-toggle" {...a.trigger}>{state.details.open ? 'Hide details' : 'Show details'}</button>
      <div className="details" {...a.panel}>
        <p>Shipped to {state.address}</p>
      </div>
    </article>
  )
}

Order.initialState = { number: 1042, address: '1 Main St' }
Order.uses = { details: disclosure({ trigger: '.details-toggle' }) }
```

For a plain show-and-hide section with no state in the model, the native `<details>` and `<summary>` elements need no code at all. Use the behavior when the model needs to know or set whether the section is open.

## Options

| Option | Default | |
|---|---|---|
| `trigger` | (required) | The button: a selector or a [control](/guide/controls/) |
| `open` | `false` | Open at the start |
| `id` | the key in `uses` | The prefix of the ids |

## State, actions and attributes

`state.details` is `{ id, open }`. Actions: `details.TOGGLE` (a click on the button), `details.OPEN` and `details.CLOSE` (no change when it already is).

`disclosureAttrs(state.details, uid)` returns `trigger` (`aria-expanded`, `aria-controls`, `type="button"`, `data-state`) and `panel` (`id`, `hidden` unless open, `data-state`: `open` / `closed`).

## Testing

```jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import Order from './Order.jsx'

it('shows and hides the details', async () => {
  const t = renderComponent(Order)
  await t.ready()
  expect(t.query('.details').hidden).toBe(true)
  t.simulateEvent('.details-toggle', 'click')
  await t.next((s) => s.details.open)
  expect(t.query('.details-toggle').getAttribute('aria-expanded')).toBe('true')
  expect(t.query('.details').hidden).toBe(false)
  expect(t.actions.map((a) => a.type)).toEqual(['INITIALIZE', 'details.TOGGLE'])
  t.dispose()
})
```
