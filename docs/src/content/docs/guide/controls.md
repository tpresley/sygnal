---
title: Controls
description: controls() links a view's elements to its intent, element commands, behaviors and tests by identifier, an alternative to class selectors
---

:::note[An alternative form]
Controls are fully supported, but they are an [alternative form](/advanced/alternative-forms/#controls-instead-of-class-selectors): class selectors (`<button className="add">` with `DOM.click('.add')`) stay the canonical way to name an element, and the rest of the documentation uses them. No strict rule flags either form. Use controls where naming elements by identifier helps you; you can mix both in one app, and in one component.
:::

A **control** is an element token: you declare it with `controls()`, render it as a JSX tag, and pass the same identifier wherever Sygnal takes a selector. The view and the intent name the element with one identifier instead of repeating a class string:

```jsx
// AddTodo.jsx
import { ABORT, controls } from 'sygnal'

export const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })

export function AddTodo({ state }) {
  return (
    <form>
      <label>New todo <Draft value={state.draft} /></label>
      <Add type="button">Add</Add>
      <ul>{state.todos.map((todo) => <li>{todo}</li>)}</ul>
    </form>
  )
}

AddTodo.initialState = { draft: '', todos: [] }

AddTodo.intent = ({ DOM }) => ({
  DRAFT: DOM.input(Draft).value(),
  ADD: DOM.click(Add),
})

AddTodo.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state) => (state.draft ? { ...state, todos: [...state.todos, state.draft], draft: '' } : ABORT),
}
```

`<Add type="button">Add</Add>` renders `<button type="button" data-control="Add">Add</button>`: the element named in the spec, every prop passed through, plus a `data-control` attribute holding the key. That attribute is all a control adds. `DOM.click(Add)` listens to `[data-control="Add"]`.

The controls are exported here only for the component's [tests](#in-tests). See [Pitfalls](#pitfalls) for what not to do with them.

## What a control is

- **An element, not a component.** A control has no state, no intent, no isolation scope and no wrapper element. It renders in the scope of the component whose view uses it, as a plain `<button>` would. Giving it `.intent`, `.model` or `.initialState` is [SYG125](#diagnostics).
- **Named by its key.** `controls({ Add: 'button' })` gives a control named `Add`, rendered with `data-control="Add"`. The HTML is the same on the server and in the browser, so server rendering and hydration need nothing special.
- **Unique in a file.** Two `controls()` calls in one file can't use the same key ([SYG128](#diagnostics)).
- **Its own selector.** `String(Add)` is `[data-control="Add"]`, so a control also works inside a template-string selector: `` DOM.click(`li:nth-child(2) ${Add}`) ``.

`controls()` takes an object of keys and specs. A spec is an element name (`'input'`, `'button'`, `'dialog'`, a custom element such as `'wa-rating'`) or a [spec object](#widget-controls-for-library-authors).

## In intent

Every `DOM` shorthand and `DOM.select()` take a control where they take a selector, and the enriched helpers work as usual:

```jsx
Search.intent = ({ DOM }) => ({
  QUERY: DOM.input(Query).value(),
  CLEAR: DOM.click(Clear),
  // a control on a page-wide source: clicks on the Close button, wherever it is rendered
  CLOSE: DOM.select('document').select(Close).events('click'),
})
```

`DOM.select('document').select(Close)` listens on the whole page, filtered to the control, as `.select('.close')` would.

## In tests

`renderComponent`'s `simulateEvent`, `query` and `queryAll` take a control too. A test can import the component's controls (here, from `AddTodo.jsx` above):

```jsx
// AddTodo.test.jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { AddTodo, Draft, Add } from './AddTodo.jsx'

it('adds the typed todo', async () => {
  const t = renderComponent(AddTodo, { dom: 'real' })
  await t.ready()
  t.simulateEvent(Draft, 'input', { value: 'milk' })
  await t.next(s => s.draft === 'milk')
  t.simulateEvent(Add, 'click')
  await t.next(s => s.todos.length === 1)
  expect(t.query(Draft).value).toBe('')
  expect(t.queryAll('li').map(li => li.textContent)).toEqual(['milk'])
  t.dispose()
})
```

Without importing it, use its selector: `t.simulateEvent('[data-control="Add"]', 'click')`.

## In Collections

Isolation works as it does for selectors: a control in a [Collection](/guide/collections/) item matches only that item's element, so every item can use the same controls:

```jsx
// TodoList.jsx
import { Collection, controls } from 'sygnal'

export const { Done, Remove } = controls({ Done: 'input', Remove: 'button' })

function TodoItem({ state }) {
  return (
    <li data-id={state.id}>
      <label><Done type="checkbox" checked={state.done} /> {state.title}</label>
      <Remove>Remove</Remove>
    </li>
  )
}

TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.click(Done), REMOVE: DOM.click(Remove) })
TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  REMOVE: () => undefined,
}

export function TodoList() {
  return (
    <ul>
      <Collection of={TodoItem} from="todos" />
    </ul>
  )
}

TodoList.initialState = {
  todos: [{ id: 1, title: 'Milk', done: false }, { id: 2, title: 'Eggs', done: false }, { id: 3, title: 'Bread', done: false }],
}
```

In a test, `within` picks the item: `simulateEvent` targets the control inside the first element that matches `within` (a selector or a control):

```jsx
const t = renderComponent(TodoList, { dom: 'real' })
await t.ready()
t.simulateEvent(Done, 'click', { within: '[data-id="2"]' })
await t.next(s => s.todos[1].done)
t.simulateEvent(Remove, 'click', { within: '[data-id="3"]' })
await t.next(s => s.todos.length === 2)
```

A parent that listens to a control its child or Collection item renders never receives the event, as with a selector: that's [SYG104](#diagnostics).

## Behavior options and element commands

A [behavior](/guide/behaviors/)'s options and an [element command](/guide/element-commands/)'s target take a control where they take a selector:

```jsx
// Pages.jsx
import { controls, pager } from 'sygnal'

const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })

export function Pages({ state }) {
  const { page, pages, hasPrev, hasNext } = state.pager
  return (
    <nav>
      <Older disabled={!hasPrev}>Older</Older>
      <span className="page">Page {page + 1} of {pages}</span>
      <Newer disabled={!hasNext}>Newer</Newer>
    </nav>
  )
}

Pages.initialState = {}
Pages.uses = { pager: pager({ pageSize: 10, total: 35, next: Newer, prev: Older }) }
```

```jsx
// EmailForm.jsx
import { ABORT, controls } from 'sygnal'

const { Email, Save } = controls({ Email: 'input', Save: 'button' })

export function EmailForm({ state }) {
  return (
    <form>
      <label>Email <Email type="email" value={state.email} /></label>
      <Save type="button">Save</Save>
    </form>
  )
}

EmailForm.initialState = { email: '' }
EmailForm.intent = ({ DOM }) => ({ EMAIL: DOM.input(Email).value(), SAVE: DOM.click(Save) })
EmailForm.model = {
  EMAIL: (state, email) => ({ ...state, email }),
  // an address without @: put the cursor back in the field
  SAVE: { ELEMENT: (state) => (state.email.includes('@') ? ABORT : { focus: Email }) },
}
```

The element command runs [as with a selector](/guide/element-commands/#which-element), on the control's element in the sending instance's own view. `t.commands('ELEMENT')` records the control itself, so a test that imports it compares with it: `expect(t.commands('ELEMENT')).toEqual([{ focus: Email }])`.

## TypeScript

A control is typed from its spec: `controls({ Draft: 'input' })` gives `Draft` the props of an `<input>`, `DOM.input(Draft)` is a stream of events whose `target` is an `HTMLInputElement` (and `.value()` a `Stream<string>`), and `t.query(Draft)` returns an `HTMLInputElement | null`:

```tsx
import { controls } from 'sygnal'
import type { Component, RenderResult } from 'sygnal'

const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })

type State = { draft: string }

export const NewTodo: Component<State> = ({ state }) => (
  <div>
    <label>New todo <Draft value={state.draft} placeholder="Milk" /></label>
    <Add type="button">Add</Add>
  </div>
)

// @ts-expect-error: `valeu` is not an <input> prop
export const typo = <Draft valeu="x" />

export const draftOf = (t: RenderResult<State>): string => t.query(Draft)?.value ?? ''
```

Passing a component where a control or selector is expected (`DOM.click(NewTodo)`) is a type error, and [SYG124](#diagnostics) at runtime. The types are `Control`, `ControlSpec` and `ControlSpecObject`, exported from `'sygnal'`.

## Widget controls, for library authors

A spec can be an object instead of an element name. This is the contract a widget library builds on: `controls({ Rating: stars })` gives a control that renders whatever the spec's `vnode()` returns, stamped with `data-control`, and that every API above accepts, whatever the spec.

```jsx
// stars.js
export const stars = {
  kind: 'widget',
  vnode: ({ value = 0, max = 5, ...props }, children, h) =>
    h('span', { ...props, role: 'img', 'aria-label': `${value} of ${max} stars` }, '★'.repeat(value) + '☆'.repeat(max - value)),
  commands: {
    flash: (element, { ms = 300 }) => {
      element.classList.add('flash')
      setTimeout(() => element.classList.remove('flash'), ms)
    },
  },
}
```

```jsx
// Review.jsx
import { controls } from 'sygnal'
import { stars } from './stars.js'

const { Rating, More } = controls({ Rating: stars, More: 'button' })

export function Review({ state }) {
  return (
    <div>
      <Rating value={state.rating} />
      <More disabled={state.rating === 5}>Add a star</More>
    </div>
  )
}

Review.initialState = { rating: 3 }
Review.intent = ({ DOM }) => ({ MORE: DOM.click(More) })
Review.model = {
  MORE: {
    STATE: (state) => ({ ...state, rating: Math.min(state.rating + 1, 5) }),
    ELEMENT: { flash: Rating, ms: 300 },
  },
}
```

- **`kind`**: a free-form name (`'widget'`), shown by `inspect()` and in diagnostics.
- **`vnode(props, children, h)`** returns the one element the control renders. Build it with the `h` argument, which is Sygnal's own `createElement` (`h(tag, props, ...children)`, the same as JSX). Don't import `createElement` into a widget: under the automatic JSX runtime that would bundle a second copy. Returning anything but one element vnode (a component, a fragment, text) is [SYG125](#diagnostics). The control stamps `data-control` on the vnode, keeps its hooks, and copies the `key` prop onto it when it has none.
- **`commands`** (optional): element commands of the widget's own. `ELEMENT: { flash: Rating, ms: 300 }` calls `stars.commands.flash(element, { ms: 300 })` with the control's rendered element. A spec command is looked up before the element's own method of the same name, so a widget can, for example, define `focus` to focus an input inside it. A selector target has no spec, so only the element's methods apply to it. For TypeScript, add the command names to `ElementCommandRegistry` ([element commands](/guide/element-commands/)).
- **Props type**: a typed spec (`ControlSpecObject<P>`) gives the control the props `P`, through its phantom `__props` field.

## Diagnostics

| Code | When |
|---|---|
| [SYG104](/reference/errors/#syg104) (warning) | The intent listens to a control that only a child component or Collection item renders, so the event never reaches it. `sygnal-check` matches controls by identifier |
| [SYG110](/reference/errors/#syg110) (warning) | The intent listens to a control the view never renders (`sygnal-check`) |
| [SYG124](/reference/errors/#syg124) (error) | A component is passed where a control or selector is expected (`DOM.click(TodoItem)`). Listen in the child and send a `PARENT` action ([`CHILD.select`](/guide/parent-child/)), or have the parent render its own control around the child |
| [SYG125](/reference/errors/#syg125) (error) | A control is given `.intent`, `.model` or `.initialState` (controls are elements, not components), or a spec object's `vnode()` returns something other than one element |
| [SYG126](/reference/errors/#syg126) (info) | A control is rendered but nothing listens to it: no intent, behavior option or element command names it (`sygnal-check`) |
| [SYG128](/reference/errors/#syg128) (error) | Two `controls()` calls in one file use the same key (`sygnal-check`) |

The [accessibility checks](/guide/accessibility/) look at a control's element: `controls({ Card: 'div' })` listened to for clicks is [SYG701](/reference/errors/#syg701), so declare it as `'button'`.

## Converting selectors: `sygnal-check --fix --controls`

`sygnal-check --fix --controls` converts class selectors into controls. It is opt-in: plain `--fix` never touches selectors.

```bash
npx sygnal-check src --fix --controls          # convert; keep a class where something else uses it
npx sygnal-check src --fix --keep-classes      # convert, and keep every converted class
```

A selector such as `DOM.click('.reset')` is converted when its class is on exactly one element of the component's own view, as a static `className`, and nowhere else (no other element, dynamic class, child view or other selector in the project could produce or use it). The fixer adds the control (the class in PascalCase) to the file's `controls({ … })` call, or adds one, replaces the tag and the intent's selector, and imports `controls`. For example, this counter:

```jsx
import { ABORT } from 'sygnal'

export function Counter({ state }) {
  return (
    <div>
      <p>{state.count}</p>
      <button className="increment">+1</button>
      <button className="reset" disabled={state.count === 0}>Reset</button>
    </div>
  )
}

Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INCREMENT: DOM.click('.increment'), RESET: DOM.click('.reset') })
Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  RESET: (state) => (state.count === 0 ? ABORT : { ...state, count: 0 }),
}
```

becomes:

```jsx
import { ABORT, controls } from 'sygnal'

const { Increment, Reset } = controls({ Increment: 'button', Reset: 'button' })

export function Counter({ state }) {
  return (
    <div>
      <p>{state.count}</p>
      <Increment>+1</Increment>
      <Reset disabled={state.count === 0}>Reset</Reset>
    </div>
  )
}

Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INCREMENT: DOM.click(Increment), RESET: DOM.click(Reset) })
Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  RESET: (state) => (state.count === 0 ? ABORT : { ...state, count: 0 }),
}
```

The class stays on its element when a stylesheet (CSS, SCSS, Less or HTML) in the project mentions it, when a string in another source file does (a test's `simulateEvent('.reset', 'click')`), or with `--keep-classes`. An element whose rendered markup a test asserts (`toContain('<button class="reset">')`) is left alone, since the control adds an attribute. Running the fixer again changes nothing. Review the diff: it rewrites the files in place.

## Pitfalls

**A control's name is not its text.** The key names the element for your code; it isn't rendered. Write the visible label (or an accessible name) as you would for a plain element:

```jsx
// Not <Pin>📌</Pin>: the key isn't rendered, so that button's only text is the emoji
<Pin aria-pressed={String(state.pinned)}>📌 Pin</Pin>
```

**Keep controls private to the component that renders them.** A control belongs to one component's view and intent. Don't export controls from one component for a sibling to listen to: the sibling's `DOM` never sees the other component's elements (isolation), so its listener never fires. To react in another component, send an action up (`PARENT`) or across (`EVENTS`). Two uses of a control outside its component are fine:

- a component passes its own control to a [behavior](#behavior-options-and-element-commands) it uses (`pager({ next: Newer })`);
- the component's own tests import it, as [above](#in-tests).
