---
title: Popover
description: Menus, pickers and panels on the native Popover API, with their open state in state
---

`popover()` is a [behavior](/guide/behaviors/) for an element with the HTML `popover` attribute. The browser shows it in the top layer, above everything else, and a button with `popovertarget` opens and closes it with no code at all. The browser also closes it when the user clicks outside or presses Escape (light dismiss), sets `aria-expanded` on the button and returns the focus to it. The behavior keeps `open` in state and lets the model open and close the popover.

```jsx live
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
| `trigger` | | A button whose clicks open and close the popover through the model (`TOGGLE`), as Radix's `Popover.Trigger`; see [A trigger button](#a-trigger-button) |
| `close` | | A button inside: its clicks close the popover |
| `id` | the key in `uses` | The prefix of the ids `popoverAttrs` makes |
| `open` | | Open at the start. Given at all, even `open: false`, it makes the popover controlled (see [Controlled dismissal](#controlled-dismissal)) |

## A trigger button

A `popovertarget` button needs no option. To open and close the popover through the model instead, as Radix's `Popover.Trigger` does, name the button in `trigger` and spread `popoverAttrs` on both elements:

```jsx live
import { popover, popoverAttrs } from 'sygnal/ui'

function Share({ state, uid }) {
  const a = popoverAttrs(state.share, uid)
  return (
    <div>
      <button className="share-button" {...a.trigger}>Share</button>
      <div className="share" {...a.popover} popover="auto" aria-label="Share">
        <button>Copy link</button>
        <button>Email</button>
      </div>
      <p>{state.share.open ? 'Sharing…' : ''}</p>
    </div>
  )
}

Share.uses = { share: popover({ popover: '.share', trigger: '.share-button' }) }
```

- A click on the trigger dispatches `share.TOGGLE` with the value to go to, `true` or `false`. The behavior reads it from the state at the press, because a press on the trigger light-dismisses an `auto` popover before the click comes: a plain flip would open it again.
- `popoverAttrs(state.share, uid)` gives the trigger `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls` and `data-state`, and the popover its `id` and `data-state`.
- A press on the trigger isn't outside a [controlled](#controlled-dismissal) popover.

## State and actions

`state.filters` is `{ id, open }` (`id`: the prefix of `popoverAttrs`' ids), and `open` is the source of truth: a reducer that writes it shows or hides the popover, and the popover's `toggle` event writes it back, whatever opened or closed it.

| Action | Data | |
|---|---|---|
| `filters.OPEN` | | Sets `open: true` and shows the popover (`showPopover`) |
| `filters.CLOSE` | | Sets `open: false` and hides it (`hidePopover`) |
| `filters.TOGGLE` | none, or `true` / `false` | Flips `open` (with data: sets it) and shows or hides it: the `trigger` |
| `filters.TOGGLED` | `true` / `false` | The `toggle` event (a `popovertarget` button, a light dismiss, Escape): sets `open` |
| `filters.DISMISS` | the event | Controlled only: Escape, a press outside, the focus moving outside (the `keydown`, `pointerdown` or `focusin` event): sets `open: false` and hides it |
| `filters.SYNC` | `false` | The popover left the page while open (a page change, a conditional render): sets `open: false`, as no `toggle` event comes |

| `filters.APPLY` | `true` / `false` | `open` changed outside these actions (your reducer wrote it): the popover is shown or hidden to match |

The commands check the popover itself (`:popover-open`): `OPEN` then `CLOSE` in one go leaves it closed, and `showPopover()` is never called on an open popover.

The popover works inside a [`<Portal>`](/advanced/portals/) too.

## Controlled dismissal

Without the `open` option the browser light-dismisses an `auto` popover, and the `toggle` event tells the state afterwards. A host entry for `filters.TOGGLED` that keeps `open: true` shows it again, but the browser has already hidden it, so it can disappear for a frame.

To decide before anything is hidden, pass the `open` option, even `open: false`. The popover is then controlled, as Radix's `open` / `onOpenChange` is:

- It is a `manual` popover (the behavior sets `popover="manual"` before it shows it), so the browser never dismisses it.
- The behavior dismisses it itself, as Radix's `DismissableLayer` does: Escape, a press outside and the focus moving outside arrive as `filters.DISMISS`, with the event as the data. One interaction is one `DISMISS`: a press outside that also moves the focus outside reports the `pointerdown`. A press on its `trigger` or its own `popovertarget` button isn't outside.
- Its `popovertarget` buttons and `commandfor` commands go through the model too: the behavior prevents the browser's own toggle and dispatches `TOGGLE`, `OPEN` or `CLOSE` (from `popovertargetaction`).

A host entry that keeps `open: true` keeps it shown, with no frame where it is hidden:

```jsx
Filters.uses = { filters: popover({ popover: '.filters', close: '.filters-done', open: false }) }
Filters.model = {
  // pinned: Escape and a click elsewhere leave it open
  'filters.DISMISS': (state, event, next, { previousState }) => (state.pinned ? previousState : state),
}
```

Controlled popovers and [dialogs](/ui/dialog/#controlled-dismissal) stack as layers. Escape dismisses the top layer only (not while an `auto` popover inside it is open, which the browser closes first), and an Escape that an element inside handled (`preventDefault()`) dismisses nothing. A press on a parent layer outside a child dismisses the child only, and a press outside both dismisses both. A layer opened in another one counts as inside it, also when it renders through a `<Portal>`. Under a modal dialog, presses can't reach the page, so the layers under it aren't dismissed by them.

The [Menu](/ui/menu/), [Select](/ui/select/) and [Combobox](/ui/combobox/) parts are layers too. One open inside a controlled popover or dialog is the top layer: Escape and a press outside it close it first, and a press in it (in its list as well) isn't outside the popover. The next Escape closes the popover, and a press outside both closes both.

A modal dialog that isn't rendered inside the popover moves the focus out of it when it opens, so it dismisses the popover, as in Radix. Keep the popover open by rendering the dialog inside it, or with a `DISMISS` entry that refuses while the dialog is open.

Open it from somewhere else, for example a keyboard shortcut, with an intent action of the same name: `'filters.OPEN': DOM.keydown('document').filter((e) => e.key === 'f' && e.altKey)`.

## `auto` or `manual`

- `popover="auto"` (or just `popover`): light dismiss, and opening one closes the other `auto` popovers that aren't its ancestors. Menus, pickers and filter panels.
- `popover="manual"`: only your code and its `popovertarget` button close it. Use it for something that stays open, such as a [tooltip](/ui/tooltip/) or [toasts](/ui/toaster/). A [controlled](#controlled-dismissal) popover is a manual one with the dismissal done by the behavior.

A popover inside a modal [dialog](/ui/dialog/) works: it opens above the dialog, the first Escape closes the popover and the second the dialog (controlled or not).

## Accessibility

- Name the popover (`aria-label` or `aria-labelledby`) when it is a region of controls, as above.
- `popovertarget` gives the button `aria-expanded` and links it to the popover for assistive technology. The browser returns the focus to the button when the popover closes with the focus inside it.
- For a menu with arrow-key navigation, use a menu part, not a bare popover.

## Styling

Browsers center a popover in the viewport by default. To place it next to its button, use [CSS anchor positioning](/ui/tooltip/#positioning):

```css live
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
