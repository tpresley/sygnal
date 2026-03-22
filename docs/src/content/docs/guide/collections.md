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
| `sort` | String, Object, Array, or Function | Sort items — see [Sorting](#sorting) below |
| `className` | String | CSS class for the wrapping container |

## Filtering

```jsx
<collection
  of={TodoItem}
  from="items"
  filter={item => !item.done}
/>
```

## Sorting

The `sort` prop accepts several formats for controlling sort order.

### Sort by property name (ascending)

```jsx
<collection of={TodoItem} from="items" sort="text" />
```

### Sort by property name with direction

Use an object with the property name as key and `"asc"` or `"desc"` as value:

```jsx
<collection of={TodoItem} from="items" sort={{ text: "desc" }} />
```

You can also use `1` (ascending) or `-1` (descending):

```jsx
<collection of={TodoItem} from="items" sort={{ priority: -1 }} />
```

### Sort primitive arrays

For arrays of strings or numbers (not objects), pass `"asc"` or `"desc"` directly:

```jsx
<collection of={TagItem} from="tags" sort="asc" />
```

### Multi-field sort

Pass an array to sort by multiple fields. Each entry can be a string (ascending), object (with direction), or function:

```jsx
<collection of={TodoItem} from="items" sort={[
  { priority: "desc" },
  "text"
]} />
```

### Custom sort function

```jsx
<collection of={TodoItem} from="items" sort={(a, b) => a.createdAt - b.createdAt} />
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
