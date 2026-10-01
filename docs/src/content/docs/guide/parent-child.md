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

Selecting by name string still works for older code, but breaks under minification; see [Alternative Forms](/advanced/alternative-forms/#childselect-with-a-string).

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

## Works with Collections

When a child component is rendered via `<Collection>`, all items share the same component function. `CHILD.select(TaskCard)` matches events from every TaskCard instance in the collection — include an id in the payload (like `taskId` above) to tell them apart.

`PARENT` only goes one level up. For components further apart, use the [`EVENTS` bus](/guide/drivers/#the-event-bus-events-driver); for data flowing down, use [context](/guide/context/).
