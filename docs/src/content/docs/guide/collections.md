---
title: Collections
description: Rendering lists of components
---

The `<Collection>` component renders a list of components from an array on your state. It handles dynamic addition, removal, reordering, filtering, and sorting automatically.

```jsx
import { Collection } from 'sygnal'
import TodoItem from './TodoItem.jsx'

function TodoList({ state }) {
  return (
    <ul className="todo-list">
      <Collection of={TodoItem} from="items" />
    </ul>
  )
}

TodoList.initialState = {
  items: [
    { id: 1, text: 'Learn Sygnal', done: false },
    { id: 2, text: 'Build something', done: false }
  ]
}
```

Each item in the `items` array becomes the state for one `TodoItem` instance. If a `TodoItem` updates its state, the corresponding array entry is updated. If a `TodoItem` sets its state to `undefined`, it is removed from the array.

`from` must name an array field of the parent's state, and the field should be initialized (`items: []`). If it is missing or not an array, the Collection renders nothing and Sygnal reports [SYG401](/reference/errors/#syg401). With TypeScript, `from` can be [type-checked](/integration/typescript/#collection-from) against the parent's state.

## Collection Props

| Prop | Type | Description |
|------|------|-------------|
| `of` | Component | The component to render for each item |
| `from` | String or Lens | The state property (or lens) containing the array |
| `filter` | Function | Filter function — only items returning `true` are shown |
| `sort` | String, Object, Array, or Function | Sort items — see [Sorting](#sorting) below |
| `viewTransitionName` | String | A prefix such as `"card"`: each item with an `id` gets `view-transition-name: card-<id>`, so a reorder or a move animates in a [View Transition](/guide/view-transitions/#collection-items) |

## Filtering

```jsx
<Collection
  of={TodoItem}
  from="items"
  filter={item => !item.done}
/>
```

## Sorting

The `sort` prop accepts several formats for controlling sort order.

### Sort by property name (ascending)

```jsx
<Collection of={TodoItem} from="items" sort="text" />
```

### Sort by property name with direction

Use an object with the property name as key and `"asc"` or `"desc"` as value:

```jsx
<Collection of={TodoItem} from="items" sort={{ text: "desc" }} />
```

You can also use `1` (ascending) or `-1` (descending):

```jsx
<Collection of={TodoItem} from="items" sort={{ priority: -1 }} />
```

### Sort primitive arrays

For arrays of strings or numbers (not objects), pass `"asc"` or `"desc"` directly:

```jsx
<Collection of={TagItem} from="tags" sort="asc" />
```

### Multi-field sort

Pass an array to sort by multiple fields. Each entry can be a string (ascending), object (with direction), or function:

```jsx
<Collection of={TodoItem} from="items" sort={[
  { priority: "desc" },
  "text"
]} />
```

### Custom sort function

```jsx
<Collection of={TodoItem} from="items" sort={(a, b) => a.createdAt - b.createdAt} />
```

## Item Keys and Identity

Collections use the `id` property of each item as its key. If items don't have an `id`, the array index is used, so give items a stable, unique `id` whenever the list can change.

An item component instance belongs to its key, not its position:

- **Reordering** the array (sort, reverse, move) re-renders the list in the new order, and every item keeps its instance, so any local state (an open editor, a draft) moves with it.
- **Adding** an item creates one new instance; the others are untouched.
- **Removing** an item disposes only that instance.

Keys are scoped to their Collection: two Collections in the same parent can contain items with the same ids without their DOM events or state crossing over.

## Self-Removal

An item can remove itself from the collection by returning `undefined` from a STATE reducer:

```jsx
TodoItem.model = {
  DELETE: () => undefined,   // removes this item from the array
}
```

When the entry also sends to another sink, the object form keeps the removal as its `STATE` entry. Without `STATE: () => undefined` the item announces its removal but stays in the array:

```jsx
TodoItem.model = {
  DELETE: {
    STATE:  () => undefined,                        // still removes the item
    EVENTS: event('TODO_DELETED', (state) => state.id),
  },
}
```

This is the one place where returning `undefined` is intended. (In a root component, a reducer that returns `undefined` is a bug: [SYG202](/reference/errors/#syg202).) The parent can also remove items itself, by filtering the array in its own reducer, for example when it receives a `PARENT` event from the item (see [Parent-Child Communication](/guide/parent-child/)).

## Disposal

When an item is removed, its component is disposed: its `DISPOSE` action fires and its subscriptions are cleaned up. Disposal is recursive, so every component inside the item goes too, including nested Collections (removing a lane from a board disposes all the cards in that lane). See [Disposal Hooks](/advanced/disposal/).

## Where the Items Render

A Collection has no element of its own: its items render directly into the parent element, next to any siblings. Wrap it in the element the list needs, so `<li>` items sit in a real `<ul>`:

```jsx
<ul className="todo-list">
  <li className="todo-header">Today</li>
  <Collection of={TodoItem} from="items" />
</ul>
```

Two Collections can share a parent, and items keep their DOM elements (and the focus) when the array is reordered. An empty Collection renders nothing.

Before 6.0 the items were wrapped in a `<div>`, and `className` (and `style`, `class`, `data-*`, ...) on `<Collection>` styled that `<div>`. Those props are now reported as [SYG612](/reference/errors/#syg612) in development and by `sygnal-check`, and are ignored: put them on your own wrapping element. `id`, `role`, `title` and `aria-*` are passed to each item as props, like any other prop, and are not reported: to label the list, put them on the wrapping element (`<ul role="list" aria-label="Tasks">`). A [`<Transition>`](/advanced/transitions/#around-a-collection) around a Collection applies to each item. See [Migrating to 6.0](/guide/migrating-to-6/#collection-wrapper).

Inside a Collection item, selectors in the item's own intent see only that item's elements. A parent can't select elements inside its items ([SYG104](/reference/errors/#syg104)).

## Big Lists: Collection or Mapped Rows

Each Collection item is a full component, with its own intent, model, state lens and isolation. That is what you want when rows have behaviour: editing in place, their own buttons, their own requests. It also costs something per row, at creation and on every update.

For a big list that is mostly read (a report, a log, search results), map the rows in one component instead:

```jsx
function Report({ state }) {
  return (
    <table>
      <tbody>
        {state.rows.map(row => (
          <tr key={row.id}>
            <td>{row.name}</td>
            <td>{row.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

In the performance baseline (1,000 rows; `benchmarks/RESULTS.md` in the repository, [on GitHub](https://github.com/tpresley/sygnal/blob/main/benchmarks/RESULTS.md) after the 6.0 release), creating the rows this way took about a third of the time of a Collection, and updating one row a little more than half. Rows that need a little interaction can still be mapped: put a `data-id` on the row's button and read it in the parent's intent (`DOM.click('.row-delete').map(e => e.target.dataset.id)`). Switch to a Collection when rows get state or behaviour of their own.

For thousands of rows, use [`<VirtualCollection>`](/guide/virtual-collections/): the same props, but only the rows in view (plus a few) have components and elements, so creating 10,000 rows costs about what 500 cost in a Collection.
