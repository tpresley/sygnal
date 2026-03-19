---
title: Collections
description: Rendering lists of components
---

The `<collection>` element renders a list of components from an array on your state. It handles dynamic addition, removal, filtering, and sorting automatically.

```jsx
function TodoList({ state }) {
  return (
    <div>
      <collection of={TodoItem} from="items" />
    </div>
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

## Collection Props

| Prop | Type | Description |
|------|------|-------------|
| `of` | Component | The component to render for each item |
| `from` | String or Lens | The state property (or lens) containing the array |
| `filter` | Function | Filter function — only items returning `true` are shown |
| `sort` | String or Function | Sort by a property name, or provide a custom sort function |
| `className` | String | CSS class for the wrapping container |

## Filtering and Sorting

```jsx
<collection
  of={TodoItem}
  from="items"
  filter={item => !item.done}
  sort="text"
/>
```

## Item Keys

Collections automatically use the `id` property of each item for efficient rendering. If items don't have an `id`, the array index is used.

## Self-Removal

An item can remove itself from the collection by returning `undefined` from a reducer:

```jsx
TodoItem.model = {
  DELETE: () => undefined  // removes this item from the array
}
```

## Using `Collection` (capitalized)

You can also import and use the capitalized `Collection` component:

```jsx
import { Collection } from 'sygnal'

function TodoList({ state }) {
  return (
    <div>
      <Collection of={TodoItem} from="items" className="todo-list" />
    </div>
  )
}
```
