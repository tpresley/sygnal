---
title: Element Commands
description: Focus, scroll, open dialogs and popovers from the model with the built-in ELEMENT sink
---

Some things the browser does are not state you render: which element has the focus, where the page is scrolled to, whether a `<dialog>` is open as a modal, whether a popover is showing. You change them by calling a method on the element (`input.focus()`, `dialog.showModal()`). In Sygnal, a model entry asks for that call with an **element command** on the built-in `ELEMENT` sink:

```jsx
Signup.model = {
  SUBMIT: {
    STATE: (state) => ({ ...state, errors: validate(state) }),
    ELEMENT: (state) => (validate(state).email ? { focus: Email } : ABORT),
  },
  OPEN_HELP: { ELEMENT: { showModal: HelpDialog } },
}
```

`ELEMENT` is built in: there is no driver to register, and it works in every component. The examples on this page name their targets with controls (`const { Email } = controls({ Email: 'input' })`, rendered as `<Email />`); see [what a control is](/guide/behaviors/#using-a-behavior). A CSS selector works as a target too: `{ focus: '.email' }`.

## The command object

A command is an object whose **first key is the method** and whose value is the target. The other keys are the method's options:

```jsx
Form.model = {
  EDIT_EMAIL:   { ELEMENT: { focus: Email } },                          // email.focus({})
  QUIET_FOCUS:  { ELEMENT: { focus: Email, preventScroll: true } },     // email.focus({ preventScroll: true })
  SHOW_LAST:    { ELEMENT: { scrollIntoView: Row, block: 'nearest' } }, // row.scrollIntoView({ block: 'nearest' })
  CLOSE_HELP:   { ELEMENT: { close: HelpDialog, returnValue: 'done' } }, // helpDialog.close('done')
}
```

The documented methods:

| Method | Options | Element |
|---|---|---|
| `focus` | `preventScroll`, `focusVisible` | any focusable element |
| `blur` | | any element |
| `select` | | `<input>`, `<textarea>`: selects the text |
| `click` | | any element (a programmatic click, e.g. to open a file input's picker) |
| `scrollIntoView` | `block`, `inline`, `behavior` | any element |
| `showModal` | | `<dialog>` |
| `show` | | `<dialog>` (non-modal) |
| `close` | `returnValue` (passed as the argument) | `<dialog>` |
| `showPopover` | | an element with a `popover` attribute |
| `hidePopover` | | an element with a `popover` attribute |
| `togglePopover` | `force` | an element with a `popover` attribute |

The options are passed to the method as one object, except for `close`, which gets `returnValue` as its argument. A popover is an element rendered with `attrs: { popover: 'auto' }` (or `'manual'`); its `toggle` event reaches intent as `DOM.toggle(Tip)`, with `newState` `'open'` or `'closed'`.

The value of the `ELEMENT` entry is a command, or a reducer that returns one: `(state, data) => command`. Return `ABORT` to send nothing. An **array** sends several commands, in order:

```jsx
Search.model = {
  // put the cursor in the search box and select what is in it
  EDIT_QUERY: { ELEMENT: [{ focus: Query }, { select: Query }] },
}
```

Sygnal runs any method the element has, so other methods work too (`{ play: Video }`, `{ showPicker: DateInput }`, `{ requestSubmit: CheckoutForm }`). The eleven above are the ones the types know; for TypeScript, add others to the `ElementCommandRegistry` interface:

```ts
// sygnal-commands.d.ts
import 'sygnal'

declare module 'sygnal' {
  interface ElementCommandRegistry { play: {}; showPicker: {} }
}
```

Methods that change the DOM Sygnal renders (`remove`, `append`, `setAttribute` and the like) are reported as [SYG641](/reference/errors/#syg641): the next render would undo them or trip over them. Change the state instead.

## Which element

The target is looked up in the view of the **component instance that sent the command**, the same scope its intent's `DOM` has. An element inside a child component is isolated from its parent, and each item of a [Collection](/guide/collections/) reaches only its own elements. To focus or scroll something a child renders, send the command from the child's own model. If more than one element matches, the first one gets the command.

## When it runs

A command runs once the render that its action may cause is on the page, so it reaches an element that the same action renders (the error message under a field, a new row, a dialog that a state flag adds):

- after the action, the command waits for the next patch of the DOM at which its target exists, and runs right after it;
- if the action changes nothing that renders, it runs at the first check, 16 ms later;
- while the target is missing, it keeps checking every 16 ms for about 1 s, then gives up ([SYG640](/reference/errors/#syg640) in development);
- the pending commands of a component that is removed are dropped.

During server rendering (`renderToString`) nothing runs: there are no elements to call.

## Recipes

### Focus the first invalid field

After a failed submit, move the focus to the first field with an error. The `ELEMENT` entry runs after the errors have rendered, so it can focus a field the same action marked invalid:

```jsx
import { controls, ABORT } from 'sygnal'

const { Name, Email, Submit } = controls({ Name: 'input', Email: 'input', Submit: 'button' })

const validate = ({ name, email }) => ({
  ...(name.trim() ? {} : { name: 'Enter your name' }),
  ...(email.includes('@') ? {} : { email: 'Enter an email address' }),
})

export function Signup({ state }) {
  return (
    <form>
      <label>Name <Name value={state.name} /></label>
      {state.errors.name && <p className="error">{state.errors.name}</p>}
      <label>Email <Email type="email" value={state.email} /></label>
      {state.errors.email && <p className="error">{state.errors.email}</p>}
      <Submit type="button">Sign up</Submit>
    </form>
  )
}

Signup.initialState = { name: '', email: '', errors: {} }

Signup.intent = ({ DOM }) => ({
  NAME: DOM.input(Name).value(),
  EMAIL: DOM.input(Email).value(),
  SUBMIT: DOM.click(Submit),
})

Signup.model = {
  NAME: (state, name) => ({ ...state, name }),
  EMAIL: (state, email) => ({ ...state, email }),
  SUBMIT: {
    STATE: (state) => ({ ...state, errors: validate(state) }),
    // runs after the errors have rendered; the first invalid field gets the focus
    ELEMENT: (state) => {
      const errors = validate(state)
      if (errors.name) return { focus: Name }
      if (errors.email) return { focus: Email }
      return ABORT
    },
  },
}
```

### A native dialog

`showModal` opens a `<dialog>` as a modal: the browser traps the focus inside it, dims the page and closes it on Escape. Its `close` event tells the component that it closed, whichever way it did:

```jsx
import { controls } from 'sygnal'

const { HelpDialog, OpenHelp, CloseHelp } = controls({
  HelpDialog: 'dialog',
  OpenHelp: 'button',
  CloseHelp: 'button',
})

export function Help({ state }) {
  return (
    <div>
      <OpenHelp>Keyboard shortcuts</OpenHelp>
      <HelpDialog>
        <h2>Keyboard shortcuts</h2>
        <p>Press N for a new card.</p>
        <CloseHelp>Close</CloseHelp>
      </HelpDialog>
      <p className="status">{state.status}</p>
    </div>
  )
}

Help.initialState = { status: 'Help is closed' }

Help.intent = ({ DOM }) => ({
  OPEN_HELP: DOM.click(OpenHelp),
  CLOSE_HELP: DOM.click(CloseHelp),
  // close doesn't bubble; Sygnal listens on the dialog itself (Escape closes it too)
  HELP_CLOSED: DOM.close(HelpDialog),
})

Help.model = {
  OPEN_HELP: {
    STATE: (state) => ({ ...state, status: 'Help is open' }),
    ELEMENT: { showModal: HelpDialog },
  },
  CLOSE_HELP: { ELEMENT: { close: HelpDialog, returnValue: 'done' } },
  HELP_CLOSED: (state) => ({ ...state, status: 'Help is closed' }),
}
```

The dialog's open state belongs to the browser here: the component keeps only a status it shows. `DOM.close(HelpDialog).map(e => e.target.returnValue)` gives the `returnValue` the dialog was closed with.

### Scroll a new row into view

A Collection item reaches only its own elements, so a new row scrolls itself into view, from its `BOOTSTRAP` (which runs once, when the item is created):

```jsx
import { ABORT, Collection, controls } from 'sygnal'

const { Row, AddTask } = controls({ Row: 'li', AddTask: 'button' })

function TaskRow({ state }) {
  return <Row>{state.text}</Row>
}

TaskRow.model = {
  // only rows added by ADD scroll; the ones there at the start don't
  BOOTSTRAP: { ELEMENT: (state) => (state.added ? { scrollIntoView: Row, block: 'nearest' } : ABORT) },
}

export function TaskList() {
  return (
    <div>
      <AddTask>Add a task</AddTask>
      <ul>
        <Collection of={TaskRow} from="tasks" />
      </ul>
    </div>
  )
}

TaskList.initialState = { tasks: [{ id: 1, text: 'Water the plants' }] }

TaskList.intent = ({ DOM }) => ({ ADD: DOM.click(AddTask) })

TaskList.model = {
  ADD: (state) => {
    const id = state.tasks.length + 1
    return { ...state, tasks: [...state.tasks, { id, text: `Task ${id}`, added: true }] }
  },
}
```

## Commands of a widget

For widget authors: a control made from a spec object (`controls({ DueDate: datePicker })`, where `datePicker` is `{ kind, vnode(props, children, h), commands }`) can declare commands of its own. Element commands look the method up in the spec's `commands` first, so `ELEMENT: { open: DueDate, at: 3 }` calls `datePicker.commands.open(element, { at: 3 })` with the control's rendered element. A spec command overrides an element method of the same name (a `focus` command can focus an input inside the widget), and the element's own method runs only when the spec has no command by that name. A selector target (`'.due-date'`) has no spec, so only the element's methods apply. Add the command names to `ElementCommandRegistry` for TypeScript.

## Testing

[`renderComponent`](/integration/testing/) records every command the rendered tree sends. `t.commands('ELEMENT')` lists them in order, one entry per command (arrays flattened), as sent. With the mock DOM (the default) they are only recorded; with `dom: 'real'` they also run, so the test can check the focus or the dialog:

```jsx
// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { Signup } from './Signup.jsx'

let t
afterEach(() => t?.dispose())

it('asks for the focus on the first invalid field', async () => {
  t = renderComponent(Signup)
  await t.ready()
  t.simulateEvent('[data-control="Submit"]', 'click')
  await t.next(s => !!s.errors.name)
  await t.settle()
  const [command] = t.commands('ELEMENT')
  expect(String(command.focus)).toBe('[data-control="Name"]')
})

it('moves the focus there (real DOM)', async () => {
  t = renderComponent(Signup, { dom: 'real' })
  await t.ready()
  t.simulateEvent('[data-control="Submit"]', 'click')
  await t.next(s => !!s.errors.name)
  await t.settle()
  expect(document.activeElement).toBe(t.query('[data-control="Name"]'))
})
```

- A control's string form is its selector, so `String(command.focus)` names the control. When the test file imports the control itself, compare the commands directly: `expect(t.commands('ELEMENT')).toEqual([{ focus: Name }])`.
- jsdom has no `showModal`, `show`, `close`, popover methods or `scrollIntoView`. With `dom: 'real'`, `renderComponent` adds stand-ins: a dialog's `open` flips and `close` fires its `close` event, a popover's `toggle` event fires, and `scrollIntoView` does nothing. Check real scrolling and focus trapping in a browser.
- The mock DOM reports SYG640 and SYG641 too, so `t.expectNoDiagnostics()` catches a command that missed its target.

## Diagnostics

| Code | When |
|---|---|
| [SYG640](/reference/errors/#syg640) (warning) | Nothing in the sending instance's view matched the target within about 1 s, or the command has no target. `sygnal-check` reports a literal command whose control or class the view never renders |
| [SYG641](/reference/errors/#syg641) (error) | Neither a spec command nor an element method of that name exists (a typo such as `fokus`, `showModal` on a `<div>`), the value isn't a command object, or the method changes the DOM Sygnal renders. `sygnal-check` reports a misspelled documented method or spec command |

Both come from the development checks (`sygnal/diagnostics`, loaded by the Vite plugin in dev) and from `sygnal-check`. In production a command that can't run does nothing.
