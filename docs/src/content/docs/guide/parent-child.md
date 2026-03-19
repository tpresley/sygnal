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
    PARENT: (state) => ({ type: 'DELETE', taskId: state.id })
  }
}
```

The value returned by the `PARENT` reducer is wrapped automatically by the framework as `{ name, component, value }` and delivered to the parent's `CHILD` source.

## Receiving Data from Children (CHILD Source)

The parent listens using `CHILD.select()` in its intent, passing a **reference to the child component function**:

```jsx
import TaskCard from './TaskCard.jsx'

function LaneComponent({ state }) {
  return (
    <div className="lane">
      <Collection of={TaskCard} from="tasks" />
    </div>
  )
}

LaneComponent.intent = ({ DOM, CHILD }) => ({
  DELETE_TASK: CHILD.select(TaskCard)
    .filter(e => e.type === 'DELETE')
    .map(e => e.taskId),
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

String-based matching (`CHILD.select('TaskCard')`) is still supported for backward compatibility but is **not recommended** for production builds, since minification will silently break it.

> **Tip:** If you can't import the child (e.g., dynamically resolved components), you can set a static `componentName` property on the function as a fallback: `TaskCard.componentName = 'TaskCard'`. This string survives minification.

## Works with Collections

When a child component is rendered via `<Collection>`, all items share the same component function. `CHILD.select(TaskCard)` matches events from every TaskCard instance in the collection — filter by the event's data payload to distinguish between them.
