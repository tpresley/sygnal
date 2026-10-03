---
title: Utilities
description: Helper functions and constants
---

## classes()

Builds a CSS class string from mixed input types.

```typescript
function classes(...args: (string | string[] | Record<string, boolean>)[]): string
```

### Accepted Input Types

| Type | Behavior |
|------|----------|
| `string` | Split by spaces, validated, and appended |
| `string[]` | Each string validated and appended |
| `object` | Keys with truthy values are validated and appended. Values can be booleans or functions returning booleans. |

### Features

- Validates CSS class names (alphanumeric, hyphens, underscores)
- Deduplicates class names
- Throws on invalid class names

### Examples

```javascript
import { classes } from 'sygnal'

classes('btn', 'primary')
// → 'btn primary'

classes('btn', { active: true, disabled: false })
// → 'btn active'

classes(['card', 'shadow'], { highlighted: isHighlighted })
// → 'card shadow highlighted' (when isHighlighted is truthy)

classes({ visible: () => checkVisibility() })
// → 'visible' (when checkVisibility() returns truthy)
```

---

## exactState()

Creates a typed state assertion function for TypeScript. Ensures state objects match the expected type exactly, with no extra properties.

```typescript
function exactState<STATE>(): <ACTUAL extends STATE>(state: ExactShape<STATE, ACTUAL>) => STATE
```

### Example

```typescript
import { exactState } from 'sygnal'

type AppState = { count: number; name: string }
const asAppState = exactState<AppState>()

App.model = {
  UPDATE: (state) => asAppState({ count: 1, name: 'test' })
  // TypeScript error: asAppState({ count: 1, name: 'test', extra: true })
}
```

---

## enableHMR()

Alternative HMR setup function (wraps the manual `import.meta.hot` / `module.hot` pattern).

```typescript
function enableHMR(
  app: SygnalApp,
  hot: HotModuleAPI,
  loadComponent?: () => Promise<AnyComponentModule> | AnyComponentModule,
  acceptDependencies?: string | string[]
): SygnalApp
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `app` | `SygnalApp` | The return value from `run()` |
| `hot` | `HotModuleAPI` | `import.meta.hot` (Vite) or `module.hot` (Webpack) |
| `loadComponent` | `Function` | Optional function to load the updated component |
| `acceptDependencies` | `string \| string[]` | Module paths to watch for changes |

---

## set()

Builds a STATE reducer that merges a partial update into the state.

```typescript
function set<S>(partial: Partial<S> | ((state: S, data: any, next: Function, props: any) => Partial<S>)): Reducer
```

```javascript
import { set } from 'sygnal'

Panel.model = {
  OPEN:   set({ isOpen: true }),                   // static partial
  RENAME: set((state, title) => ({ title })),      // computed partial
}
```

---

## toggle()

Builds a STATE reducer that flips a boolean field.

```javascript
import { toggle } from 'sygnal'

Panel.model = {
  TOGGLE_HELP: toggle('showHelp'),
}
```

---

## isSelected()

Whether an id is in a [`selection`](/guide/behaviors/#selection) behavior's slice. Ids compare as strings, so `1` and `'1'` agree; a missing slice selects nothing.

```typescript
function isSelected(slice: { selected: string[] } | null | undefined, id: string | number): boolean
```

In a view: `checked={isSelected(state.sel, mail.id)}`. In a reducer: `state.mails.filter(mail => !isSelected(state.sel, mail.id))`.

---

## undoable()

Wraps a model so each change to `state[key]` is recorded, and adds `UNDO` and `REDO` actions. The [`undo` behavior](/advanced/undo/#the-undo-behavior) does the same through `uses`; see [Undo and Redo](/advanced/undo/#undoable) for both.

```typescript
function undoable(model: Model, options: { key: string; limit?: number; track?: string[]; coalesceMs?: number; resetOn?: string[] }): Model
```

The history is `state.history = { past, future }`. Options: `key` (required), `limit` (100), `track` (only these actions), `coalesceMs` (one step for quick changes by one action), `resetOn` (actions that clear the history).

---

## ABORT

A special constant that, when returned from a state reducer, cancels the state update for that action. Returned from a non-STATE sink reducer (`EVENTS`, `PARENT`, a custom driver), it sends nothing.

```typescript
const ABORT: unique symbol
```

### Example

```javascript
import { ABORT } from 'sygnal'

MyComponent.model = {
  MOVE: (state, data) => {
    if (state.locked) return ABORT  // No state change
    return { ...state, position: data }
  }
}
```
