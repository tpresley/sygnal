---
title: Parent-Child Communication
description: Communicating between parent and child components
---

While [context](/guide/context/) sends values *down* the tree and the EVENTS driver broadcasts globally, the PARENT/CHILD mechanism provides **direct one-level-up communication** from a child component to its immediate parent.

## Sending Data Up (PARENT Sink)

A child emits values to its parent by adding a `PARENT` entry in model:

```jsx
function TaskCard({ state }) {
  return (
    <div className="task-card">
      <span>{state.title}</span>
      <button className="delete">×</button>
    </div>
  )
}

TaskCard.intent = ({ DOM }) => ({
  DELETE: DOM.select('.delete').events('click')
})

TaskCard.model = {
  DELETE: {
    PARENT: (state) => ({ taskId: state.id })
  }
}
```

The value returned by the `PARENT` reducer is delivered to the parent's `CHILD` source. `CHILD.select(TaskCard)` emits exactly that value (here `{ taskId }`), with nothing wrapped around it.

## Receiving Data from Children (CHILD Source)

The parent listens using `CHILD.select()` in its intent, passing a **reference to the child component function**:

```jsx
import { Collection } from 'sygnal'
import TaskCard from './TaskCard.jsx'

function LaneComponent({ state }) {
  return (
    <div className="lane">
      <Collection of={TaskCard} from="tasks" />
    </div>
  )
}

LaneComponent.intent = ({ CHILD }) => ({
  DELETE_TASK: CHILD.select(TaskCard).map(e => e.taskId),
})

LaneComponent.model = {
  DELETE_TASK: (state, taskId) => ({
    ...state,
    tasks: state.tasks.filter(t => t.id !== taskId)
  })
}
```

## Why Pass the Component Reference?

`CHILD.select(TaskCard)` matches by **function identity** — the same import you already use to render the component. This is the preferred approach because:

- **Minification-safe.** Production bundlers mangle function names (`TaskCard` becomes `a`), which breaks string-based matching. Reference matching is unaffected.
- **Refactoring-friendly.** Rename the function and all imports update together. No separate strings to keep in sync.
- **Zero configuration.** No build plugins, no manual `componentName` properties, no bundler settings.

With TypeScript, the stream's type is inferred from the child's `PARENT` sink (see [TypeScript](/integration/typescript/#typed-child-events)).

Pass the component function: 6.0 removed selecting by a name string (see [Migrating to 6.0](/guide/migrating-to-6/#child-select-name)).

## When a Child Sends More Than One Kind of Message

If the child sends several kinds of values up, include a discriminating field and split them in the parent:

```jsx
TaskCard.model = {
  DELETE: { PARENT: (state) => ({ kind: 'delete', taskId: state.id }) },
  PIN:    { PARENT: (state) => ({ kind: 'pin', taskId: state.id }) },
}

LaneComponent.intent = ({ CHILD }) => ({
  DELETE_TASK: CHILD.select(TaskCard).filter(e => e.kind === 'delete').map(e => e.taskId),
  PIN_TASK:    CHILD.select(TaskCard).filter(e => e.kind === 'pin').map(e => e.taskId),
})
```

## Why Not Select the Child's Button Directly?

A parent's `DOM` source only sees elements its own view renders. `DOM.select('.delete')` in `LaneComponent` never fires for buttons inside `TaskCard`, because each child is isolated; Sygnal reports that as [SYG104](/reference/errors/#syg104). Handle the DOM event in the child and send the result up with `PARENT`.

## Recipe: Extract a Component Without Changing the Markup

A common refactor: a view renders the same widget twice inline, and you want one reusable component, with the rendered HTML and the behaviour unchanged. The parent keeps the state; the child gets what it shows as **props** and reports the user's choice with **`PARENT`**; the parent hears it with **`CHILD.select(Child)`**.

**1. Pin the current markup first.** Before touching the component, write a test that snapshots `t.html()` and run it once, so the snapshot records the old HTML:

```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

let t
afterEach(() => t?.dispose())

it('keeps the markup and behaviour', async () => {
  t = renderComponent(App, { strict: true })
  await t.ready()
  expect(t.html()).toMatchSnapshot('initial')       // first run writes it; later runs compare
  t.simulateEvent('.food .star[data-value="3"]', 'click')
  await t.next(s => s.food === 3)
  expect(t.html()).toMatchSnapshot('after a click')
  expect(t.html()).toContain('Food: 3/5')
  t.expectNoDiagnostics()
})
```

(Or paste the current `t.html()` string into `toMatchInlineSnapshot()`. With `CI` set, Vitest doesn't write new snapshots; run `npx vitest run -u` once on the unchanged code.)

**2. Move the markup into the child.** The child renders the exact elements the parent rendered (a component adds no wrapper element), reads its inputs from props, and sends the result up. It needs no `initialState` and doesn't know the parent's state shape:

```jsx
// StarRating.jsx
const STARS = [1, 2, 3, 4, 5]

function StarRating({ name, label, value }) {
  return (
    <div className={`rating ${name}`}>
      <span className="label">{label}</span>
      {STARS.map((n) => (
        <button className={n <= value ? 'star filled' : 'star'} data-value={String(n)}>★</button>
      ))}
    </div>
  )
}

StarRating.intent = ({ DOM }) => ({
  PICK: DOM.click('.star').data('value', Number),
})

StarRating.model = {
  PICK: { PARENT: (state, value, next, props) => ({ name: props.name, value }) },  // props: the 4th argument
}

export default StarRating
```

**3. Render the child and listen to it in the parent.** The parent's old DOM selectors for the widget (`.food .star`) must go: they can't see the child's elements ([SYG104](/reference/errors/#syg104)).

```jsx
// App.jsx
import StarRating from './StarRating.jsx'

function App({ state }) {
  const show = (value) => (value ? `${value}/5` : 'not rated')
  return (
    <div className="app">
      <p className="summary">Food: {show(state.food)} · Service: {show(state.service)}</p>
      <StarRating name="food" label="Food" value={state.food} />
      <StarRating name="service" label="Service" value={state.service} />
    </div>
  )
}

App.initialState = { food: 0, service: 0 }
App.intent = ({ CHILD }) => ({ RATE: CHILD.select(StarRating) })   // both instances; `name` tells them apart
App.model = { RATE: (state, { name, value }) => ({ ...state, [name]: value }) }

export default App
```

**4. Run the same test.** It must pass without updating the snapshot (`vitest -u` would hide a markup change). A failure diff shows exactly which element or attribute moved.

## Works with Collections

When a child component is rendered via `<Collection>`, all items share the same component function. `CHILD.select(TaskCard)` matches events from every TaskCard instance in the collection — include an id in the payload (like `taskId` above) to tell them apart.

`PARENT` only goes one level up. For components further apart, use the [`EVENTS` bus](/guide/drivers/#the-event-bus-events-driver); for data flowing down, use [context](/guide/context/).
