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
    <div>
      <div ref={boxRef}>
        Width: {state.width}px, Height: {state.height}px
      </div>
      <button className="measure-btn">Measure</button>
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

`createRef$()` returns a ref whose `.stream` emits the element on mount (and `null` on unmount). Pass the ref itself to the `ref` prop and use its `.stream` in intent:

```jsx
import { createRef$ } from 'sygnal'
const myRef$ = createRef$()

function MyComponent({ state }) {
  return <canvas ref={myRef$} />
}

MyComponent.intent = () => ({
  CANVAS_READY: myRef$.stream,
})
```
