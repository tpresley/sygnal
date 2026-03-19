---
title: Streams
description: Working with reactive streams and xstream
---

Sygnal uses [xstream](https://github.com/staltz/xstream) as its Observable library. Observables are like Promises that can emit multiple values over time.

```javascript
// Promise: resolves once
somePromise.then(value => console.log(value))

// Observable: emits many times
someObservable.map(value => console.log(value))
```

## Common Stream Operations

You'll mostly use these operations in your `.intent` functions:

```jsx
import { xs } from 'sygnal'

MyComponent.intent = ({ DOM }) => {
  const click$ = DOM.select('.btn').events('click')

  return {
    // .map() — Transform the emitted value
    CLICK_X: click$.map(e => e.clientX),

    // .mapTo() — Always emit the same value
    CLICKED: click$.mapTo(true),

    // .filter() — Only pass values that match a condition
    RIGHT_CLICK: click$.filter(e => e.button === 2),

    // xs.merge() — Combine multiple streams into one
    ANY_BUTTON: xs.merge(
      DOM.select('.btn-a').events('click').mapTo('a'),
      DOM.select('.btn-b').events('click').mapTo('b')
    ),

    // .startWith() — Emit an initial value immediately
    WITH_DEFAULT: click$.mapTo('clicked').startWith('waiting')
  }
}
```

## Imported Stream Operators

Sygnal re-exports commonly used xstream extra operators:

```javascript
import { xs, debounce, throttle, delay, dropRepeats, sampleCombine } from 'sygnal'

// Debounce rapid inputs (wait 300ms of inactivity)
const search$ = input$.compose(debounce(300))

// Throttle to at most once per 500ms
const scroll$ = scrollEvents$.compose(throttle(500))

// Delay emissions by 1000ms
const delayed$ = click$.compose(delay(1000))

// Drop consecutive duplicate values
const unique$ = values$.compose(dropRepeats())

// Combine latest value from another stream
const withState$ = click$.compose(sampleCombine(state$))
```

## Creating Custom Streams

```javascript
import { xs } from 'sygnal'

// Create a stream that emits on an interval
const timer$ = xs.periodic(1000)  // emits 0, 1, 2, ... every second

// Create a stream from a value
const value$ = xs.of('hello')

// Combine latest values from multiple streams
const combined$ = xs.combine(stream1$, stream2$)

// Create an empty stream (never emits)
const empty$ = xs.never()
```
