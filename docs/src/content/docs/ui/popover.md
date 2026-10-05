---
title: Popover
description: Menus, pickers and panels on the native Popover API, with their open state in state
---

`popover()` is a [behavior](/guide/behaviors/) for an element with the HTML `popover` attribute. The browser shows it in the top layer, above everything else, and a button with `popovertarget` opens and closes it with no code at all. The browser also closes it when the user clicks outside or presses Escape (light dismiss), sets `aria-expanded` on the button and returns the focus to it. The behavior keeps `open` in state and lets the model open and close the popover.

```jsx
import { popover } from 'sygnal/ui'

function Filters({ state, uid }) {
  return (
    <div>
      <button className="filters-button" popovertarget={uid('filters')}>Filters</button>
      <div className="filters" id={uid('filters')} popover="auto" aria-label="Filters">
        <label><input type="checkbox" className="only-open" checked={state.onlyOpen} /> Only open tasks</label>
        <button className="filters-done">Done</button>
      </div>
      <p>{state.filters.open ? 'Choosing filters…' : ''}</p>
    </div>
  )
}

Filters.initialState = { onlyOpen: false }
Filters.uses = { filters: popover({ popover: '.filters', close: '.filters-done' }) }
Filters.intent = ({ DOM }) => ({ ONLY_OPEN: DOM.change('.only-open').checked() })
Filters.model = { ONLY_OPEN: (state, onlyOpen) => ({ ...state, onlyOpen }) }
```

`popovertarget` takes the popover's `id`; `uid()` keeps it unique when the component is rendered more than once.

## Options

| Option | | |
|---|---|---|
| `popover` | (required) | The popover element: a selector or a [control](/guide/controls/) |
| `close` | | A button inside: its clicks close the popover |

There is no `trigger` option: open it with a `popovertarget` button. A button that toggled an `auto` popover through the model would open it again right after closing it, because the press outside the popover light-dismisses it first; the browser exempts `popovertarget` buttons from that.

## State and actions

`state.filters` is `{ open }`. It follows the popover's `toggle` event, whatever opened or closed it.

| Action | Data | |
|---|---|---|
| `filters.OPEN` | | Shows the popover (`showPopover`) |
| `filters.CLOSE` | | Hides it (`hidePopover`) |
| `filters.TOGGLE` | | Toggles it (`togglePopover`) |
| `filters.TOGGLED` | `true` / `false` | The `toggle` event: sets `open` |
| `filters.SYNC` | `false` | The popover left the page while open (a page change, a conditional render): sets `open: false`, as no `toggle` event comes |

`OPEN` and `CLOSE` check the popover itself (`:popover-open`), not `state.filters.open`, which follows the `toggle` event a moment later: `OPEN` then `CLOSE` in one go leaves it closed, and `showPopover()` is never called on an open popover.

Open it from somewhere else, for example a keyboard shortcut, with an intent action of the same name: `'filters.OPEN': DOM.keydown('document').filter((e) => e.key === 'f' && e.altKey)`.

## `auto` or `manual`

- `popover="auto"` (or just `popover`): light dismiss, and opening one closes the other `auto` popovers that aren't its ancestors. Menus, pickers and filter panels.
- `popover="manual"`: only your code and its `popovertarget` button close it. Use it for something that stays open, such as a [tooltip](/ui/tooltip/) or [toasts](/ui/toaster/).

A popover inside a modal [dialog](/ui/dialog/) works: it opens above the dialog, the first Escape closes the popover and the second the dialog.

## Accessibility

- Name the popover (`aria-label` or `aria-labelledby`) when it is a region of controls, as above.
- `popovertarget` gives the button `aria-expanded` and links it to the popover for assistive technology. The browser returns the focus to the button when the popover closes with the focus inside it.
- For a menu with arrow-key navigation, use a menu part, not a bare popover.

## Styling

Browsers center a popover in the viewport by default. To place it next to its button, use [CSS anchor positioning](/ui/tooltip/#positioning):

```css
.filters-button { anchor-name: --filters; }
.filters { position-anchor: --filters; position-area: bottom span-right; margin: 4px 0 0; inset: auto; }
.filters:popover-open { animation: fade-in 120ms ease-out; }
```

For a component rendered more than once, give each instance its own anchor name, from `uid()` in a `style` prop, as the tooltip does.

## Testing

The mock DOM doesn't open popovers, so simulate the `toggle` event as the browser sends it:

```jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import Filters from './Filters.jsx'

it('follows the popover and closes it from the Done button', async () => {
  const t = renderComponent(Filters)
  await t.ready()
  t.simulateEvent('.filters', 'toggle', { newState: 'open', oldState: 'closed' })
  await t.next((s) => s.filters.open)

  t.simulateEvent('.filters-done', 'click')
  await t.settle()
  expect(t.commands('ELEMENT')).toEqual([{ hidePopover: '.filters' }])
  expect(t.actions.map((a) => a.type)).toEqual(['INITIALIZE', 'filters.TOGGLED', 'filters.CLOSE'])
  t.dispose()
})
```
