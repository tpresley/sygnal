---
title: "Refs"
description: "Direct DOM element access"
---

Access DOM elements declaratively using `createRef()`:

```jsx
import { createRef } from 'sygnal'

const boxRef = createRef()

function MeasuredBox({ state }) {
  return (
    <div ref={boxRef}>
      Width: {state.width}px, Height: {state.height}px
    </div>
  )
}

MeasuredBox.intent = ({ DOM }) => ({
  MEASURE: DOM.select('.measure-btn').events('click'),
})

MeasuredBox.model = {
  MEASURE: (state) => ({
    ...state,
    width: boxRef.current?.offsetWidth ?? 0,
    height: boxRef.current?.offsetHeight ?? 0,
  }),
}
```

`createRef()` returns `{ current: null }`. The `ref` prop automatically sets `.current` to the DOM element on mount and `null` on unmount.

## Callback Refs

Pass a function instead of a ref object:

```jsx
<div ref={(el) => { /* el is the DOM element, or null on unmount */ }} />
```

## Stream Refs

`createRef$()` returns a stream-based ref that emits the element on mount:

```jsx
import { createRef$ } from 'sygnal'
const myRef$ = createRef$()

MyComponent.intent = () => ({
  ELEMENT: myRef$,
})
```
