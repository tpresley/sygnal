---
title: TypeScript
description: Type-safe Sygnal components
---

Sygnal ships with full TypeScript type definitions. Use the `Component` and `RootComponent` types for type safety:

```tsx
import type { Component, RootComponent } from 'sygnal'

// Define your types
type AppState = {
  count: number
  name: string
}

type AppActions = {
  INCREMENT: null
  SET_NAME: string
}

// Type the component
const App: RootComponent<AppState, {}, AppActions> = ({ state }) => {
  return (
    <div>
      <h1>{state.name}: {state.count}</h1>
    </div>
  )
}

App.initialState = { count: 0, name: 'Counter' }

App.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.btn').events('click'),
  SET_NAME: DOM.input('.input').value()
})

App.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  SET_NAME: (state, data) => ({ ...state, name: data })
}

export default App
```

## Component Type Parameters

```typescript
Component<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>
```

| Parameter | Description |
|-----------|-------------|
| `STATE` | Shape of the component's state |
| `PROPS` | Shape of props received from parent |
| `DRIVERS` | Custom driver type specifications |
| `ACTIONS` | Map of action names to their data types |
| `CALCULATED` | Shape of calculated field values |
| `CONTEXT` | Shape of context values |
| `SINK_RETURNS` | Return types for non-state sinks |

## Typed Tiles Example (from 2048)

```tsx
import type { Component } from 'sygnal'

type Tile = {
  id: number
  row: number
  column: number
  value: number
  new?: boolean
  deleted?: boolean
}

type TileActions = {
  DELETE: null
}

const TILE: Component<Tile, any, any, TileActions> = (_props, state) => {
  return (
    <div className="tile" id={`tile-${state.id}`}>
      {state.value}
    </div>
  )
}
```

## exactState() Helper

Use `exactState()` to enforce that state updates match your type exactly (no extra properties):

```tsx
import { exactState } from 'sygnal'
import type { AppState } from './types'

const asAppState = exactState<AppState>()

App.model = {
  UPDATE: (state) => asAppState({ ...state, count: state.count + 1 })
  // TypeScript error if you add properties not in AppState
}
```
