---
title: "Slots"
description: "Named content regions for composable layouts"
---

Pass multiple named content regions from parent to child — headers, footers, sidebars, action bars — instead of a single flat `children` array.

```jsx
import { Slot } from 'sygnal'

function App({ state }) {
  return (
    <Card state="card">
      <Slot name="header"><h2>Card Title</h2></Slot>
      <Slot name="actions">
        <button className="save">Save</button>
        <button className="cancel">Cancel</button>
      </Slot>
      <p>This is the default content.</p>
    </Card>
  )
}
```

The child component receives a `slots` object in its view parameters, with each named slot as an array of VNodes:

```jsx
function Card({ state, slots }) {
  return (
    <div className="card">
      <header>{...(slots.header || [])}</header>
      <main>{...(slots.default || [])}</main>
      <footer>{...(slots.actions || [])}</footer>
    </div>
  )
}
```

## Default Slot

Unnamed children (those not wrapped in a `<Slot>`) are placed in `slots.default`. A `<Slot>` without a `name` prop also contributes to the default slot.

The `children` parameter continues to work exactly as before — it contains the same elements as `slots.default`. Components that don't use `<Slot>` tags see no change in behavior.

## Multiple Children per Slot

A single `<Slot>` can contain any number of children:

```jsx
<Slot name="actions">
  <button>Save</button>
  <button>Cancel</button>
  <button>Delete</button>
</Slot>
```

All three buttons will be available in `slots.actions`.

## Reactive Updates

Slot content is reactive. When parent state changes, the slot content re-renders automatically:

```jsx
function App({ state }) {
  return (
    <Display state="d">
      <Slot name="header">
        <span>{state.title}</span>
      </Slot>
    </Display>
  )
}
```

When `state.title` changes, the content in `slots.header` updates accordingly.

## Empty Slots

Always guard against missing slots with a fallback:

```jsx
function Card({ state, slots }) {
  return (
    <div className="card">
      {slots.header
        ? <header>{...slots.header}</header>
        : <header>Default Header</header>
      }
      <main>{...(slots.default || [])}</main>
    </div>
  )
}
```

When a component receives no children at all, `slots` is an empty object `{}` and `children` is an empty array.
