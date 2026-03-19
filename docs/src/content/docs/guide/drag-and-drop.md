---
title: Drag and Drop
description: Cross-component drag and drop interactions
---

Sygnal provides a dedicated drag-and-drop driver that handles HTML5 drag events at the document level, bypassing Cycle.js component isolation. This means drag interactions work seamlessly across deeply nested, isolated components.

## Setup

Create the driver with `makeDragDriver()` and pass it to `run()`:

```javascript
import { run, makeDragDriver } from 'sygnal'
import RootComponent from './RootComponent.jsx'

run(RootComponent, { DND: makeDragDriver() })
```

## Registering Drag Categories

Register drag categories from your model, typically in `BOOTSTRAP`. Each category describes a set of draggable elements and/or drop zones identified by CSS selectors:

```jsx
RootComponent.model = {
  BOOTSTRAP: {
    DND: () => ({
      configs: [
        { category: 'task', draggable: '.task-card' },
        { category: 'lane', dropZone: '.lane-drop-zone', accepts: 'task' },
      ],
    }),
  },
}
```

### Registration Properties

| Property | Type | Description |
|----------|------|-------------|
| `category` | `string` | Required. Name for this group of drag elements |
| `draggable` | `string` | CSS selector for elements that can be dragged |
| `dropZone` | `string` | CSS selector for elements that accept drops |
| `accepts` | `string` | Only accept drops from this dragging category. Omit to accept any |
| `dragImage` | `string` | CSS selector for a custom drag preview. Resolved via `.closest()` from the draggable element |

A single category can have both `draggable` and `dropZone` — for example, sortable lists where items are both dragged and dropped onto:

```javascript
{ category: 'lane-sort', draggable: '.lane-drag-handle',
                          dropZone:  '.lane-header',
                          accepts:   'lane-sort',
                          dragImage: '.lane' }
```

## Listening to Drag Events

Use the `DND` source in intent. It supports the same shorthand pattern as the DOM source:

```jsx
RootComponent.intent = ({ DND, EVENTS }) => ({
  // Shorthand (preferred)
  DRAG_START: DND.dragstart('task'),
  DROP:       DND.drop('lane'),
  DRAG_END:   DND.dragend('task'),

  // Longhand (equivalent)
  DRAG_START: DND.select('task').events('dragstart'),
  DROP:       DND.select('lane').events('drop'),
  DRAG_END:   DND.select('task').events('dragend'),
})
```

### Event Payloads

| Event | Payload | Description |
|-------|---------|-------------|
| `dragstart` | `{ element, dataset }` | The dragged element and its `data-*` attributes |
| `dragend` | `null` | Fires when the drag ends (drop or cancel) |
| `drop` | `{ dropZone, insertBefore }` | The drop zone element, and the sibling element at the cursor position (for ordering) |
| `dragover` | `null` | Fires continuously while dragging over a valid drop zone. `preventDefault()` is called automatically |

## Handling Drops

The `drop` event provides the drop zone element and an `insertBefore` reference for ordering. Use `dataset` attributes on your elements to identify items:

```jsx
// In the view, put identifying data on elements
<div className="task-card" data={{ taskId: state.id }}>
  {state.title}
</div>

// In the model, use the drop payload to move items
RootComponent.model = {
  DROP: (state, { dropZone, insertBefore }) => {
    const toLaneId = dropZone.dataset.laneId
    const insertBeforeTaskId = insertBefore?.dataset.taskId ?? null
    // ... move the task to the target lane at the correct position
  },
}
```

## Visual Feedback with Context

Use context to communicate drag state down to child components for styling:

```jsx
RootComponent.context = {
  draggingTaskId: state => state.dragging?.taskId ?? null,
}

// In a child component's view
function TaskCard({ state, context }) {
  const isDragging = context.draggingTaskId === state.id
  return (
    <div className={'task-card' + (isDragging ? ' dragging' : '')} data={{ taskId: state.id }}>
      {state.title}
    </div>
  )
}
```

## Complete Example

See the [Kanban board example](../examples/kanban/) for a full working implementation with task drag-and-drop between lanes, lane reordering with custom drag images, and visual drag feedback.
