---
title: Dialog
description: A modal dialog on the native <dialog> element, with its open state and return value in state
---

`dialog()` is a [behavior](/guide/behaviors/) for a native `<dialog>`. It opens the dialog with `showModal()`, so the browser does the hard parts: it traps the focus inside the dialog, makes the rest of the page inert, closes it on Escape and returns the focus when it closes. The behavior keeps `open` and `returnValue` in state, whichever way the dialog closed.

```jsx
import { dialog } from 'sygnal/ui'

function Profile({ state, uid }) {
  return (
    <div>
      <button className="edit-profile">Edit profile</button>
      <dialog className="profile" aria-labelledby={uid('title')}>
        <h2 id={uid('title')}>Edit profile</h2>
        <label>Name <input className="name" value={state.name} /></label>
        <button className="save">Save</button>
        <button className="cancel">Cancel</button>
      </dialog>
      <p>{state.profile.returnValue === 'saved' ? 'Profile saved' : ''}</p>
    </div>
  )
}

Profile.initialState = { name: '' }
Profile.uses = { profile: dialog({ dialog: '.profile', trigger: '.edit-profile', close: '.cancel' }) }
Profile.intent = ({ DOM }) => ({
  NAME: DOM.input('.name').value(),
  SAVE: DOM.click('.save'),
})
Profile.model = {
  NAME: (state, name) => ({ ...state, name }),
  SAVE: { ELEMENT: { close: '.profile', returnValue: 'saved' } },
}
```

A click on `.edit-profile` opens the dialog and a click on `.cancel` closes it. Save closes it from the model with a return value, through the built-in [`ELEMENT` sink](/guide/element-commands/).

## Options

| Option | Default | |
|---|---|---|
| `dialog` | (required) | The `<dialog>` element: a selector or a [control](/guide/controls/) |
| `trigger` | | Its clicks open the dialog |
| `close` | | Its clicks close the dialog, with the return value `''` |
| `modal` | `true` | `false` opens it with `show()`: not modal, the page stays usable |
| `cancelable` | `true` | `false` keeps Escape from closing it: the `cancel` event is prevented, and opening it sets `closedby="none"` (Chromium closes a dialog on a second Escape otherwise). In a browser without `closedby`, a second Escape can still close it; the `CLOSED` action tells you |
| `returnFocus` | `true` | When the dialog closes and the focus was lost, focus the element that opened it (the clicked trigger, when several match `trigger`), else the trigger. A selector names another element; `false` leaves the focus to the browser |

The browser returns the focus to the element that had it before the dialog opened. Safari doesn't focus a button when it is clicked, so after a mouse click the focus would go back to the page itself; `returnFocus` focuses the trigger instead. It does nothing when the browser already moved the focus somewhere.

## State and actions

`state.profile` is `{ open, returnValue }`.

| Action | Data | |
|---|---|---|
| `profile.OPEN` | | Opens the dialog (no change when it is open) |
| `profile.CLOSE` | the return value | Closes it with that return value |
| `profile.CLOSED` | the return value | The dialog closed, whichever way: sets `open: false` and `returnValue` |
| `profile.TOGGLED` | `true` / `false` | The dialog's `toggle` event: a dialog opened without the model (for example with `commandfor`) sets `open: true` |
| `profile.CANCEL` | the event | Escape was pressed (the dialog closes next, unless `cancelable: false`) |
| `profile.SYNC` | `false` | The dialog left the page while open (a page change, a conditional render): sets `open: false`, as no close event comes |

`OPEN` and `CLOSE` check the dialog itself before they act: `showModal()` only on a closed dialog, `close()` only on an open one. A dialog removed while open opens again when it is back.

React to a close in your own model with an entry for the namespaced action. It runs after the behavior's, on the full state:

```jsx
Profile.model = {
  'profile.CLOSED': (state, returnValue) => (returnValue === 'saved' ? { ...state, savedName: state.name } : state),
}
```

Open the dialog from another place with an intent action of the same name, `'profile.OPEN': DOM.click('.avatar')`, or from a model entry that sends `{ showModal: '.profile' }` to `ELEMENT`.

## Accessibility

- Name the dialog: `aria-labelledby` pointing at its heading, as above, or `aria-label`.
- Put a close button inside. Escape closes a modal dialog, but not everyone has a keyboard.
- The dialog element has `role="dialog"`; a modal one is also `aria-modal` to assistive technology.
- A form inside the dialog with `method="dialog"` closes it on submit, with the submit button's `value` as the return value; `CLOSED` sees it.

## Styling

```css
.profile { border: none; border-radius: 8px; padding: 1.5rem; }
.profile::backdrop { background: rgb(0 0 0 / 0.4); }
.profile[open] { animation: fade-in 150ms ease-out; }
```

## Testing

The mock DOM records the `showModal` and `close` commands without running them, so simulate the dialog's `close` event as the browser sends it:

```jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import Profile from './Profile.jsx'

it('opens the dialog and keeps the return value', async () => {
  const t = renderComponent(Profile)
  await t.ready()
  t.simulateEvent('.edit-profile', 'click')
  await t.next((s) => s.profile.open)
  expect(t.commands('ELEMENT')).toEqual([{ showModal: '.profile' }])

  t.simulateEvent('.save', 'click')
  await t.settle()
  expect(t.commands('ELEMENT').at(-1)).toEqual({ close: '.profile', returnValue: 'saved' })

  t.simulateEvent('.profile', 'close', { target: { returnValue: 'saved' } })
  await t.next((s) => !s.profile.open)
  expect(t.state.profile.returnValue).toBe('saved')
  expect(t.actions.map((a) => [a.type, a.cause])).toEqual([
    ['INITIALIZE', 'built-in'],
    ['profile.OPEN', 'behavior'],
    ['SAVE', 'intent'],
    ['profile.CLOSED', 'behavior'],
  ])
  t.dispose()
})
```

With `dom: 'real'`, the commands run on the jsdom elements; focus trapping and the backdrop need a real browser.
