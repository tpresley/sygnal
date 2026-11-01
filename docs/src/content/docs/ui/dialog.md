---
title: Dialog
description: A modal dialog on the native <dialog> element, with its open state and return value in state
---

`dialog()` is a [behavior](/guide/behaviors/) for a native `<dialog>`. It opens the dialog with `showModal()`, so the browser does the hard parts: it traps the focus inside the dialog, makes the rest of the page inert, closes it on Escape and returns the focus when it closes. The behavior keeps `open` and `returnValue` in state, and `open` drives the dialog: a reducer that writes it opens or closes it.

```jsx live
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
| `dialog` | (required) | The `<dialog>` element: a selector or a [control](/guide/controls/). It must match only this behavior's dialog: a selector that also matches a dialog nested in it (`dialog`, a shared class) gets that dialog's events too |
| `trigger` | | Its clicks open the dialog |
| `close` | | Its clicks close the dialog, with the return value `''` |
| `modal` | `true` | `false` opens it with `show()`: not modal, the page stays usable |
| `cancelable` | `true` | `false`: Escape doesn't close it. `CANCEL` still runs on each Escape, and the state stays open |
| `open` | | Open at the start. Given at all, even `open: false`, it makes the dialog controlled: the browser never dismisses it, the behavior does (see [Controlled dismissal](#controlled-dismissal)) |
| `returnFocus` | `true` | When the dialog closes and the focus was lost, focus the element that opened it (the clicked trigger, when several match `trigger`), else the trigger. A selector names another element; `false` leaves the focus to the browser |

The browser returns the focus to the element that had it before the dialog opened. Safari doesn't focus a button when it is clicked, so after a mouse click the focus would go back to the page itself; `returnFocus` focuses the trigger instead. It does nothing when the browser already moved the focus somewhere. It works for a dialog the host renders only while it is open, too.

## State and actions

`state.profile` is `{ open, returnValue }`; `open` drives the dialog (see [Controlled open](#controlled-open)).

| Action | Data | |
|---|---|---|
| `profile.OPEN` | | Sets `open: true` and opens the dialog: the trigger, a `commandfor` button with `command="show-modal"` |
| `profile.CLOSE` | the return value | Sets `open: false` with that return value and closes it: the `close` button, a `method="dialog"` form's submit (the submit button's `value`), a `commandfor` button with `command="close"` |
| `profile.CANCEL` | the event | Escape, a light dismiss (`closedby="any"`; controlled: a press or a focus outside), or `command="request-close"`: sets `open: false` with the return value `''`, unless `cancelable: false` |
| `profile.CLOSED` | the return value | The dialog's `close` event: sets `open: false` and `returnValue` when it closed some other way |
| `profile.TOGGLED` | `true` / `false` | The dialog's `toggle` event: a dialog opened without the model (`showModal()` called elsewhere) sets `open: true` |
| `profile.SYNC` | `false`, or `true` when `showModal()` threw | The dialog left the page while open (a page change, a conditional render), or OPEN's `showModal()` threw (a disconnected dialog, a popover open on it): sets `open: false`, as no close event comes (your `close` listeners don't run for a dialog that never opened) |

| `profile.APPLY` | `true` / `false` | `open` changed outside these actions (your reducer wrote it): the dialog is opened or closed to match |

The commands check the dialog itself before they act: `showModal()` only on a closed dialog, `close()` only on an open one.

## Controlled open

`state.profile.open` is the source of truth, as Radix's controlled `open` is. Write it in any reducer and the dialog opens or closes to match:

```jsx
Profile.model = {
  EDIT_FROM_LINK: (state) => ({ ...state, profile: { ...state.profile, open: true } }),
}
```

Everything that would close the dialog arrives as an action first: Escape and a light dismiss as `CANCEL`, the close button, a `method="dialog"` form and `commandfor` as `CLOSE`. The behavior prevents the browser's own close and sets `open: false`; a host entry for the same action runs after it and decides. To keep the dialog open, return the state from before the action, as Radix's `onOpenChange(false)` does when you ignore it:

```jsx
Profile.model = {
  // unsaved changes: Escape and the form don't close it
  'profile.CANCEL': (state, event, next, { previousState }) => (state.dirty ? previousState : state),
  'profile.CLOSE': (state, returnValue, next, { previousState }) => (state.dirty && returnValue !== 'discard' ? previousState : state),
}
```

The dialog never closes in between, so the focus stays where it was. For Escape the behavior gives a modal dialog `closedby="none"` while it is open (unless you set `closedby` yourself) and reads the key, so a second Escape can't close it behind the state's back. A close the browser makes on its own (your own code calling `close()`) arrives as `CLOSED`; a host entry that keeps `open: true` there opens the dialog again.

### Controlled dismissal

Pass the `open` option, even `open: false`, and the browser never dismisses the dialog: it keeps `closedby="none"` while it is open, also when you set `closedby`, and the behavior dismisses it itself, as Radix's `DismissableLayer` does. Your `closedby` says on what, and each one arrives as `CANCEL` with its event as the data:

| `closedby` | Dismissed by |
|---|---|
| (none) | Escape for a modal dialog, nothing for a non-modal one |
| `"closerequest"` | Escape |
| `"any"` | Escape, a press outside the dialog (on its backdrop), the focus moving out of it |
| `"none"` | nothing |

A refused `CANCEL` leaves the dialog open with no close in between, whatever dismissed it. Without the `open` option a light dismiss (`closedby="any"`) is the browser's `cancel` event, which the behavior prevents; a browser may refuse to let a cancel be prevented without a user gesture since the last one (the CloseWatcher rule), and then the dialog closes and opens again.

Dialogs and [controlled popovers](/ui/popover/#controlled-dismissal) stack as layers. Escape dismisses the top layer only, so a controlled popover open in a dialog closes first and the next Escape closes the dialog. A press on the dialog outside the popover dismisses the popover only, and a press outside both dismisses both, each through its own action. A layer opened in another one counts as inside it, also when it renders through a `<Portal>`.

The dialog works inside a [`<Portal>`](/advanced/portals/) too: the behavior finds its element, its events and its commands in the portal's content. The top layer already draws a modal dialog above the page, so a portal is rarely needed.

React to a close in your own model with an entry for the namespaced action. It runs after the behavior's, on the full state:

```jsx
Profile.model = {
  'profile.CLOSED': (state, returnValue) => (returnValue === 'saved' ? { ...state, savedName: state.name } : state),
}
```

Open the dialog from another button by listing it in the option, `trigger: '.edit-profile, .avatar'`, from a model entry with `next('profile.OPEN')`, or by writing `open: true`. An intent action of the same name, `'profile.OPEN': DOM.click('.avatar')`, replaces the `trigger` option's clicks instead of adding to them ([SYG118](/reference/errors/#syg118)). (A `{ showModal: '.profile' }` command to `ELEMENT` opens it too, but skips what `OPEN` adds: the `returnFocus` opener, the `closedby` that routes Escape to `CANCEL`, and clearing the last close's return value.)

## Accessibility

- Name the dialog: `aria-labelledby` pointing at its heading, as above, or `aria-label`.
- Put a close button inside. Escape closes a modal dialog, but not everyone has a keyboard.
- The dialog element has `role="dialog"`; a modal one is also `aria-modal` to assistive technology.
- A form inside the dialog with `method="dialog"` closes it on submit, with the submit button's `value` as the return value (the `CLOSE` action's data). Enter in a field submits with the form's first submit button, so put the confirming button first and make Cancel `type="button"` (the `close` option), or Enter cancels. `OPEN` clears the element's old return value, so an Escape after an earlier `'ok'` reads as `''` in every browser.

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

With `dom: 'real'`, the commands run on the jsdom elements; focus trapping and the backdrop need a real browser. A reducer that writes `open` is applied by `APPLY`, which compares the state with the element: test it with `dom: 'real'` (renderComponent fakes jsdom's missing dialog methods) or in a browser; on the mock DOM, check `t.state`.
