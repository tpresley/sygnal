---
title: Drag and Drop
description: Sortable lists with pointer, touch and keyboard, and cross-component HTML5 drag and drop
---

Sygnal has two tools for drag and drop:

- **`sortable`**, a [behavior](/guide/behaviors/) that reorders a list in the component's state by mouse, pen, touch **and keyboard**, with screen-reader announcements. Use it for reordering: task lists, playlists, kanban columns (moves between lists included).
- **`makeDragDriver()`**, a driver for native HTML5 drag and drop at the document level. Use it when the browser's drag-and-drop model is the point: dropping files from the desktop, dragging between components that don't share a host, arbitrary drop zones, or native drag images. HTML5 drag and drop has no keyboard or touch support of its own, so give those users another way (a menu, buttons).

## Sortable lists

`sortable({ from, item, handle })` reorders `state[from]`. The items are usually a Collection; each item's element carries its id in `data-id`, and the handle is a button inside it:

```jsx
import { Collection, sortable } from 'sygnal'

function Task({ state, context }) {
  const { dragging, over, after, helpId } = context.sort
  const id = String(state.id)
  const cls = ['task', dragging === id && 'dragging', over === id && dragging !== id && (after ? 'drop-after' : 'drop-before')]
  return (
    <li className={cls.filter(Boolean).join(' ')} data-id={state.id}>
      <button type="button" className="grip" aria-label={`Reorder ${state.title}`}
        aria-describedby={helpId} aria-pressed={String(dragging === id)}>⠿</button>
      <span className="title">{state.title}</span>
    </li>
  )
}

function TaskList({ state }) {
  return (
    <section>
      <p id={state.sort.helpId} hidden>
        Press Space or Enter to pick up a task, the arrow keys to move it, Space or Enter to drop it, and Escape to cancel.
      </p>
      <ul className="tasks"><Collection of={Task} from="tasks" /></ul>
      <p className="announcer" role="status" aria-live="assertive">{state.sort.message}</p>
    </section>
  )
}

TaskList.initialState = {
  tasks: [{ id: 1, title: 'Write spec' }, { id: 2, title: 'Build it' }, { id: 3, title: 'Ship' }],
}
TaskList.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
TaskList.context = { sort: (state) => state.sort }
TaskList.model = {
  // one completed move: save the order
  'sort.DROPPED': { HTTP: (state, move) => ({ url: '/api/tasks/order', method: 'PUT', json: { ids: state.tasks.map((t) => t.id), move } }) },
}
```

```css
.grip { touch-action: none; user-select: none; cursor: grab; }
.task.dragging { opacity: 0.5; }
.task.drop-before { box-shadow: 0 -2px 0 royalblue; }
.task.drop-after { box-shadow: 0 2px 0 royalblue; }
```

The behavior listens on the host's root element, so it hears the presses and keys that bubble out of the Collection items (which are isolated components): nothing is wired per item. The items read the drag state through [context](/guide/context/).

### Options

| Option | Default | |
|---|---|---|
| `from` | (required) | The host state key of the list. An array of keys (`['todo', 'done']`) allows moves between lists; see [Several lists](#several-lists) |
| `item` | `'[data-id]'` | Selector of each item's element |
| `handle` | the item | Selector of the part that starts a drag and takes keyboard focus. Without one, the whole item does, and presses on buttons, links and fields inside it are left to them |
| `attr` | `'data-id'` | The item element's attribute that holds its id |
| `idField` | `'id'` | The id field of the list's entries (ids compare as strings) |
| `axis` | `'y'` | `'y'`: ArrowUp / ArrowDown move, ArrowLeft / ArrowRight change lists; `'x'`: the other way round |
| `threshold` | `4` | Pixels a pointer moves before a drag starts (a shorter press is a click) |
| `label` | title, name, label or id | `(entry) => string`: the item's name in announcements |
| `messages` | English | `{ lift, move, drop, cancel, stay }`, each `(label, position, count, extra) => string`. `extra`: for `lift`, true on a keyboard lift; for `move`, `drop` and `stay`, the list key when the item changed lists. `stay`: Escape after something else changed the list, so the item stays where it is |

### State and actions

`state.sort` (the key you chose in `uses`):

| Field | |
|---|---|
| `dragging` | The id (a string) of the item being moved, or `null` |
| `over`, `after` | Pointer drags: the id under the pointer, and whether the item lands after it (`true`) or before it |
| `list` | Pointer drags: the list the item would land in (several lists) |
| `mode` | `'pointer'`, `'keyboard'` or `null` |
| `message` | The announcement to render in a live region: picked up, moved, dropped, cancelled |
| `helpId` | A [`uid()`](/guide/forms/#labels-and-ids-uid) id for the instructions element, unique to this host (two lists on a page get two ids); `null` until the first focus, press or key inside the host |

`helpId` is set when the host is first used, not when it starts, so nothing is written into the state of a host that is never touched (a Collection item's state is its parent's data). A handle has its description by the time it is focused. The server renders no `helpId`, and neither does the client's first render, so hydration matches.

`sort.DROPPED` fires once per completed move with `{ id, list, index, fromList, fromIndex }`: after a pointer drop, or a keyboard drop away from where the item started. The list in the state is already in its new order. Add a host entry for it to save the order. The other actions (`sort.PRESS`, `MOVE`, `UP`, `CANCEL`, `KEY`, `INIT`, `HELP`, `END`) are the behavior's own.

### Keyboard

| Key | |
|---|---|
| Space or Enter on a handle | Pick the item up (and announce the instructions) |
| ArrowUp / ArrowDown (`axis: 'x'`: ArrowLeft / ArrowRight) | Move it one place; the list reorders as you go |
| ArrowLeft / ArrowRight (`axis: 'x'`: ArrowUp / ArrowDown) | Move it to the previous / next list, at the same position |
| Home / End | Move it to the start / end |
| Space or Enter | Drop it |
| Escape | Put it back where it started (unless something else changed the list meanwhile: see below) |
| Tab | Drop it where it is; focus moves on |

Focus stays on the moved item's handle after each step (an [`ELEMENT` command](/guide/element-commands/) through [`focusWithin`](/guide/element-commands/#focusing-inside-children-focuswithin), since the keyed Collection may move the focused element). If focus moves to another element while an item is lifted (a click elsewhere, a screen reader's own navigation) or a pointer is pressed anywhere, the item is dropped where it is, as Tab does; a press on a handle then starts a pointer drag at once. Losing focus to nothing (switching windows) keeps the item lifted. A held Space or Enter (the key's auto-repeat) doesn't drop and lift again.

If the host is removed while an item is lifted (a route change, a parent hiding it), the drag is cancelled the same way, and no `sort.DROPPED` fires, so state that outlives the host (a parent's) isn't left half-moved. A pointer drag in progress is dropped too (the list hasn't changed yet).

Cancelling (Escape, the host removed or made again) puts the list back only when nothing else has changed it since the last arrow key: the lists are then exactly the arrays the drag made, and the ones it lifted the item from come back as they were. When anything else changed them in the meantime (an entry edited, added or removed, the list replaced by new data, an undo or redo, another action reordering it, another tab's copy), the item stays where it is and the drag just ends: the behavior doesn't guess where the item belongs in a list that changed under it. Escape then announces that the item stays (`messages.stay`).

### Pointer and touch

A press on a handle followed by a move past `threshold` starts a drag. While it moves, `over` and `after` say where the item would land, for a drop indicator; the list itself changes on release (a release over nothing, or outside the list, cancels). Escape cancels a pointer drag too. Mouse, pen and touch work the same way (Pointer Events, with document listeners only while a press is active).

For touch, give the handle `touch-action: none`, or the browser scrolls the page instead (and cancels the drag). While a pointer is pressed the behavior blocks text selection and the browser's own drag of an image or link inside the item (`dragstart`); `user-select: none` on the handle also keeps a long press from selecting its text.

### Several lists

With `from: ['todo', 'done']`, items move between the lists. Mark each list's container with `data-list` and its key, so a pointer drop on an empty list lands in it:

```jsx
import { Collection, sortable } from 'sygnal'

function Card({ state }) {
  return (
    <li className="card" data-id={state.id}>
      <button type="button" className="grip" aria-label={`Move ${state.title}`}>⠿</button> {state.title}
    </li>
  )
}

function Board({ state }) {
  return (
    <div className="board">
      <ul className="lane" data-list="todo" aria-label="To do"><Collection of={Card} from="todo" /></ul>
      <ul className="lane" data-list="done" aria-label="Done"><Collection of={Card} from="done" /></ul>
      <p role="status" aria-live="assertive">{state.sort.message}</p>
    </div>
  )
}

Board.initialState = { todo: [{ id: 'a', title: 'Draft' }, { id: 'b', title: 'Review' }], done: [] }
Board.uses = { sort: sortable({ from: ['todo', 'done'], item: '.card', handle: '.grip' }) }
```

`sort.DROPPED`'s `fromList` and `list` say where the item came from and went. Over an item of the other list, the pointer's half of it decides: the upper half (the left half with `axis: 'x'`) lands before it, the lower half after it, so the end of a list is reached over its last item. Within the item's own list it lands before the hovered item when moving up and after it when moving down.

### Accessibility

- Make the handle a `<button type="button">` with a name (``aria-label={`Reorder ${title}`}``), or, without a handle, give the item `tabIndex={0}` and an `aria-label`.
- Point the handles' `aria-describedby` at an instructions element with `id={state.sort.helpId}` (pass `helpId` to the items through context).
- Render `state.sort.message` in a live region (`role="status"` / `aria-live`): it is how screen-reader users hear where the item is.
- `sygnal-check` reports a handle that can't take focus or has no name, and a host without a live region ([SYG724](/reference/errors/#syg724)).

### Nested sortables

A sortable inside a sortable's item (sorted lanes, each with sorted cards) works: a press or key belongs to the innermost sortable whose items contain it, and a host's own root element is never one of its items. A host's items are the item elements below its root that aren't inside another of them, so the ids may repeat between the levels (lane `1` holding card `1`): the item under the pointer, the one a key is on and the handle that gets focus are always the host's own. Give each level its own handle.

### Filtered and sorted lists

`sortable` moves entries of the array in the state: the arrow keys swap the item with its neighbour in the array, the positions it announces count the array, and a pointer drop lands next to the entry it is dropped on. Render the list in that order. Under a Collection's `sort`, a move changes nothing you can see (the Collection sorts it back); under a `filter`, a keyboard step can pass entries that are hidden, and the positions count them. For a list that can be reordered, sort the array itself (once, for a starting order) instead of the Collection, and hide the handles while a filter hides entries. In development, [SYG435](/reference/errors/#syg435) warns when a list's items are shown in another order than the array's, or with entries hidden between them.

### Undo and persist

With the [`undo`](/advanced/undo/) behavior on the same host, a drag is one undo step: `uses = { sort: sortable({ from: 'tasks' }), history: undo({ key: 'tasks' }) }` records the order from before the drag when the item is dropped, and a cancelled drag records nothing. The live keyboard moves aren't steps of their own, and the order of the two in `uses` doesn't matter.

An action during a drag that changes the list too (an item added) is recorded with the drag so far, so the order from before the drag stays reachable; undo during a drag steps back over the drag so far, and redo during a drag records the order from before it (never a half-moved one). A drag cancelled after something else changed the list leaves the item where it is; if the order then differs from the one before the drag, that is one step, and nothing stays pending. With `track` naming none of `sort`'s actions, drags aren't recorded at all. `coalesceMs` joins quick drops only when `coalesce` names one of `sort`'s actions (`coalesce: ['sort.DROPPED']`).

With several lists, record them together, so an undo after a move between lists puts both back:

```jsx
import { sortable, undo } from 'sygnal'

Board.uses = {
  sort: sortable({ from: ['todo', 'done'], item: '.card', handle: '.grip' }),
  history: undo({ key: ['todo', 'done'] }),
}
```

[`persist()`](/guide/persistence/) never saves or restores the root component's `state.sort` (it is UI state). A sortable on a sub-component or a Collection item keeps its slice in the data around it (`state.lanes[0].sort`), so a root `persist()` saves it with that data. Drag state that comes back this way, from another tab, or into a host made again (HMR) doesn't resume a drag: it is reset when the host starts or at the next press or key. Restored or synced drag state leaves the data as it is (only the drag that moved the item, in this page, knows its own lists: another tab's drag never moves anything here); a drag of this page (a host made again, a second host of the same slice) is cancelled by the rules above, so its lists come back when nothing else changed them.

### Testing

Keyboard moves are plain key events on the handle:

```jsx
import { renderComponent } from 'sygnal'
import TaskList from './TaskList.jsx'

it('moves a task down with the keyboard', async () => {
  const t = renderComponent(TaskList)
  await t.ready()
  const key = (id, key) => t.simulateEvent('.grip', 'keydown', { key, within: `.task[data-id="${id}"]` })
  key(2, ' ')
  key(2, 'ArrowDown')
  key(2, 'Enter')
  await t.next((s) => s.sort.dragging === null)
  expect(t.state.tasks.map((task) => task.id)).toEqual([1, 3, 2])
  expect(t.actions.find((a) => a.type === 'sort.DROPPED').data).toMatchObject({ id: '2', index: 2, fromIndex: 1 })
})
```

`t.commands('ELEMENT')` lists the focus commands; with `dom: 'real'` they run, and `document.activeElement` is the moved item's handle. Pointer drags are best tested in a real browser: a `pointerdown` on a handle, then `pointermove` / `pointerup` with `clientX` / `clientY` (the behavior finds the item under the pointer with `document.elementFromPoint`).

### Diagnostics

With `sygnal/diagnostics` loaded (the Vite plugin loads it in development): [SYG145](/reference/errors/#syg145) an item element without the id attribute, [SYG146](/reference/errors/#syg146) an `item` or `handle` selector that matches nothing at the first interaction, [SYG147](/reference/errors/#syg147) a `from` key that isn't an array in the host's state, [SYG435](/reference/errors/#syg435) a list shown in another order than its array's (a Collection's `sort` or `filter`). `sygnal-check` knows `sortable`'s options (a typo is [SYG127](/reference/errors/#syg127)) and reports [SYG724](/reference/errors/#syg724).

## HTML5 drag and drop: makeDragDriver

The drag-and-drop driver handles native HTML5 drag events at the document level, bypassing component isolation, so drag interactions work across deeply nested, isolated components. Reach for it for files dropped from the desktop, drags between components that don't share a host, or native drag images; for reordering a list, `sortable` above also covers touch and keyboard.

### Setup

Create the driver with `makeDragDriver()` and pass it to `run()`:

```javascript
import { run, makeDragDriver } from 'sygnal'
import RootComponent from './RootComponent.jsx'

run(RootComponent, { DND: makeDragDriver() })
```

### Registering Drag Categories

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

#### Registration Properties

| Property | Type | Description |
|----------|------|-------------|
| `category` | `string` | Required. Name for this group of drag elements |
| `draggable` | `string` | CSS selector for elements that can be dragged |
| `dropZone` | `string` | CSS selector for elements that accept drops |
| `accepts` | `string` | Only accept drops from this dragging category. Omit to accept any |
| `dragImage` | `string` | CSS selector for a custom drag preview. Resolved via `.closest()` from the draggable element |

A single category can have both `draggable` and `dropZone` — for example, sortable lists where items are both dragged and dropped onto:

```javascript
const laneSort = {
  category:  'lane-sort',
  draggable: '.lane-drag-handle',
  dropZone:  '.lane-header',
  accepts:   'lane-sort',
  dragImage: '.lane',
}
```

### Listening to Drag Events

Use the `DND` source in intent. It supports the same shorthand pattern as the DOM source:

```jsx
RootComponent.intent = ({ DND }) => ({
  DRAG_START: DND.dragstart('task'),   // = DND.select('task').events('dragstart')
  DROP:       DND.drop('lane'),        // = DND.select('lane').events('drop')
  DRAG_END:   DND.dragend('task'),     // = DND.select('task').events('dragend')
})
```

#### Event Payloads

| Event | Payload | Description |
|-------|---------|-------------|
| `dragstart` | `{ element, dataset }` | The dragged element and its `data-*` attributes |
| `dragend` | `null` | Fires when the drag ends (drop or cancel) |
| `drop` | `{ dropZone, insertBefore }` | The drop zone element, and the sibling element at the cursor position (for ordering) |
| `dragover` | `null` | Fires continuously while dragging over a valid drop zone. `preventDefault()` is called automatically |

### Handling Drops

The `drop` event provides the drop zone element and an `insertBefore` reference for ordering. Use `dataset` attributes on your elements to identify items:

```jsx
// In the view, put identifying data on elements
<div className="task-card" data={{ taskId: state.id }}>
  {state.title}
</div>

// In the model, use the drop payload to move items
RootComponent.model = {
  DROP: (state, { dropZone, insertBefore }) => {
    if (!state.dragging) return ABORT
    const toLaneId = dropZone.dataset.laneId
    const insertBeforeTaskId = insertBefore?.dataset.taskId ?? null
    // moveTask: your own helper that returns the new lanes array
    const lanes = moveTask(state.lanes, state.dragging.taskId, toLaneId, insertBeforeTaskId)
    return { ...state, lanes, dragging: null }
  },
}
```

### Visual Feedback with Context

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

### Complete Example

See the [Kanban board example](https://github.com/tpresley/sygnal/tree/main/examples/kanban) for a full working implementation with task drag-and-drop between lanes, lane reordering with custom drag images, and visual drag feedback.
