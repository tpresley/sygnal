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

## ABORT

A special constant that, when returned from a state reducer, cancels the state update for that action.

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
