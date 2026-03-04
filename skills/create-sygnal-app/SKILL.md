---
name: create-sygnal-app
description: >
  Create new web applications and components using the Sygnal framework.
  Sygnal is a functional reactive framework built on Cycle.js that uses
  Model-View-Intent architecture with pure components, monolithic state,
  and driver-based side effects. Use this skill when creating new Sygnal
  projects, scaffolding components, adding features to Sygnal apps,
  wiring drivers, managing state, or building with collections and switchable views.
---

# Create Sygnal App

Create complete, idiomatic Sygnal applications from scratch or add features to existing ones.

## Framework Overview

Sygnal is a functional reactive framework built on Cycle.js. Components are pure functions with static properties that define behavior using the Model-View-Intent (MVI) pattern:

- **View** (the function) — Renders UI from state. No side effects.
- **Intent** (`.intent`) — Declares WHEN actions happen by observing driver sources.
- **Model** (`.model`) — Declares WHAT happens by defining reducers for each action.
- **Drivers** handle all side effects (DOM, state, network, storage, etc.).

## Workflow

### Creating a New Application

1. **Scaffold the project** — Create project structure, install dependencies, configure bundler.
2. **Design the state** — Define the complete application state shape on `RootComponent.initialState`.
3. **Build components** — Write view functions, then add `.intent` and `.model` as needed.
4. **Wire drivers** — Add custom drivers for any side effects beyond DOM and state.
5. **Set up HMR** — Configure hot module replacement to preserve state during development.
6. **Validate** — Ensure all components are pure, all state updates use spread, and all side effects go through drivers.

### Adding Features to an Existing Application

1. **Read the existing state shape** and component hierarchy.
2. **Extend state** — Add new fields to `initialState` or relevant component state.
3. **Add intent actions** — Define when new behaviors trigger.
4. **Add model handlers** — Define what happens for each new action.
5. **Update the view** — Render new state in the component function.

## Project Scaffolding

### File Structure

```
my-app/
  index.html
  package.json
  vite.config.js
  src/
    main.js          # App entry point with run() and HMR
    RootComponent.jsx # Root component
    components/       # Child components
    drivers/          # Custom drivers
```

### index.html

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Sygnal App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

### package.json (essential fields)

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "sygnal": "^4.0.0"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

### vite.config.js

```javascript
import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'sygnal',
  }
})
```

### src/main.js (entry point with HMR)

```javascript
import { run } from 'sygnal'
import RootComponent from './RootComponent.jsx'

const { hmr, dispose } = run(RootComponent)

if (import.meta.hot) {
  import.meta.hot.accept('./RootComponent.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
```

### TypeScript Variant (src/main.ts)

```typescript
import { run } from 'sygnal'
import App from './App'

const { hmr } = run(App)

if (import.meta.hot) {
  import.meta.hot.accept('./App', (mod) => {
    hmr((mod as { default?: typeof App })?.default ?? App)
  })
}
```

## Component Patterns

Load `references/component-patterns.md` for complete component code patterns including basic components, state management, intent/model wiring, collections, switchable views, form handling, custom drivers, context, calculated fields, and TypeScript usage.

## Critical Rules

These rules MUST be followed in all generated Sygnal code.

### State Reducers Must Return Complete State

Reducers replace the entire state. Always spread the existing state:

```javascript
// CORRECT
INCREMENT: (state) => ({ ...state, count: state.count + 1 })

// WRONG — loses all other state properties
INCREMENT: (state) => ({ count: state.count + 1 })
```

The only exception is components whose state is a primitive or whose state only has one property.

### Views Must Be Pure

Never perform side effects in the view function. No fetch calls, no direct DOM manipulation, no localStorage access, no console.log. Use drivers for all side effects.

### No Event Handlers in JSX

Never use `onClick`, `onInput`, or any on-event attributes in JSX. All event handling goes through `.intent` using the DOM driver:

```javascript
// CORRECT
Component.intent = ({ DOM }) => ({
  CLICKED: DOM.select('.my-button').events('click')
})

// WRONG — never do this in Sygnal
<button onClick={handleClick}>Click</button>
```

### Never Mutate State

Always return new objects/arrays from reducers. Never modify the state parameter directly.

### Action Names Match Between Intent and Model

Every action name in `.intent` must have a corresponding entry in `.model`, and vice versa (except built-in actions like BOOTSTRAP and INITIALIZE).

### Custom CSS Selectors for DOM.select()

Use className-based selectors for DOM.select(). The selector is isolated to the current component — no need for overly specific selectors.

### Drivers for All Side Effects

Network calls, storage, clipboard, timers, and any other side effects must go through drivers, never directly in component code.

## Default Conventions

Use these unless the user specifies otherwise:

- **File naming**: PascalCase for components (`UserProfile.jsx`), camelCase for drivers and utilities (`apiDriver.js`)
- **Action names**: ALL_CAPS with underscores (`LOAD_USERS`, `SET_ROUTE`, `FORM_SUBMITTED`)
- **Stream variable naming**: Trailing `$` suffix (`click$`, `user$`, `formData$`)
- **State design**: Flat where possible, nested objects for logical groupings
- **Component state mapping**: Use `state="propertyName"` for simple cases, lenses only when necessary
- **Routing**: Use `state.route` with `<switchable>` for page transitions
- **Forms**: Use `processForm()` for form handling
- **CSS classes**: Use the `classes()` utility for conditional class names
- **Imports**: Import from `'sygnal'` for all framework functions and types

## Available Imports from Sygnal

```javascript
// Core
import { run, component, ABORT } from 'sygnal'

// Built-in components
import { collection, Collection, switchable, Switchable } from 'sygnal'

// Utilities
import { processForm, classes, exactState, driverFromAsync, enableHMR } from 'sygnal'

// Streams
import { xs, debounce, throttle, delay, dropRepeats, sampleCombine } from 'sygnal'

// DOM helpers (when not using JSX)
import { h } from 'sygnal'

// Types (TypeScript)
import type { Component, RootComponent, Lens, Stream, MemoryStream } from 'sygnal'

// JSX pragma (auto-injected by the automatic JSX transform, do NOT manually import in .jsx files)
// Configured via jsxImportSource: 'sygnal' in vite.config.js
import { jsx, jsxs, Fragment } from 'sygnal/jsx-runtime'
```

## Default Drivers

Every Sygnal app automatically includes these drivers (no setup needed):

| Driver | Source Usage | Sink Usage |
|--------|-------------|------------|
| `DOM` | `DOM.select('.css-selector').events('eventName')` | Handled automatically by view return |
| `STATE` | `STATE.stream` (Observable of state) | Reducer functions from model |
| `EVENTS` | `EVENTS.select('eventType')` | `{ type: 'eventType', data: payload }` |
| `LOG` | None (sink-only) | Any value — logged to console |

Additional pseudo-sources available in intent:
- `props$` — Stream of props from parent
- `children$` — Stream of children from parent
- `context$` — Stream of context values from ancestors
- `CHILD` — `CHILD.select('name')` for child component events

## Built-in Actions

These fire automatically — define them in `.model` to handle them:

| Action | When | Typical Use |
|--------|------|-------------|
| `BOOTSTRAP` | Once on component instantiation | Initialize data, trigger first load |
| `INITIALIZE` | When component receives first state | One-time setup based on initial state |
| `HYDRATE` | On first state during HMR | Restore after hot reload |

## References

- Load `references/component-patterns.md` for complete code patterns covering all Sygnal features with copy-paste examples.
