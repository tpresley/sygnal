---
name: sygnal-dev
description: >
  Create, build, refactor, and debug web applications using the Sygnal framework.
  Sygnal is a functional reactive framework built on Cycle.js that uses
  Model-View-Intent architecture with pure components, monolithic state,
  and driver-based side effects. Use this skill when scaffolding new Sygnal
  projects, creating components, adding features, wiring drivers, managing state,
  building with Collections and Switchable views, or debugging component behavior.
---

# Sygnal Dev

Create and maintain Sygnal applications with pure components, state-driven rendering, and driver-based side effects.

## Framework Overview

Sygnal is a functional reactive framework built on Cycle.js. Components are pure functions with static properties that define behavior using the Model-View-Intent (MVI) pattern:

- **View** (the function) — Renders UI from state. No side effects.
- **Intent** (`.intent`) — Declares WHEN actions happen by observing driver sources.
- **Model** (`.model`) — Declares WHAT happens by defining reducers for each action.
- **Drivers** handle all side effects (DOM, state, network, storage, etc.).

## Workflow

### Creating a New Application

1. **Scaffold the project** — Use the Vite plugin: `sygnal/vite`. Or scaffold with `npm create sygnal-app`.
2. **Design the state** — Define the complete application state shape on `RootComponent.initialState`.
3. **Build components** — Write view functions, then add `.intent` and `.model` as needed.
4. **Wire drivers** — Add custom drivers for any side effects beyond DOM and state.
5. **Validate** — Ensure all components are pure, all state updates use spread, and all side effects go through drivers.

### Adding Features to an Existing Application

1. **Read the existing state shape** and component hierarchy.
2. **Extend state** — Add new fields to `initialState` or relevant component state.
3. **Add intent actions** — Define when new behaviors trigger.
4. **Add model handlers** — Define what happens for each new action.
5. **Update the view** — Render new state in the component function.

### Debugging

1. **Check intent** — Ensure stream triggers only on expected source events.
2. **Check model** — Ensure reducers return complete state (spread!) and update only intended branches.
3. **Check isolation** — Parent components CANNOT see DOM events on child component elements. Handle events within the component's own scope, communicate upward via EVENTS or PARENT.
4. **Check side effects** — No fetch calls, DOM manipulation, or storage access in views or reducers.

## Project Scaffolding

### File Structure

```
my-app/
  index.html
  package.json
  vite.config.js          # or vite.config.ts
  src/
    main.js               # App entry point
    App.jsx               # Root component
    components/           # Child components
    drivers/              # Custom drivers
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
    "sygnal": "^5.1.1"
  },
  "devDependencies": {
    "vite": "^6.4.1"
  }
}
```

### vite.config.js

Use the Sygnal Vite plugin — it configures JSX and HMR automatically:

```javascript
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
})
```

### index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Sygnal App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.js"></script>
  </body>
</html>
```

### src/main.js

```javascript
import { run } from 'sygnal'
import App from './App.jsx'
import './style.css'

run(App)
```

## Component Patterns

Load `references/component-patterns.md` for complete component code patterns including basic components, state management, intent/model wiring, collections, switchable views, form handling, custom drivers, context, calculated fields, transitions, portals, error boundaries, commands, refs, disposal hooks, and TypeScript usage.

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
  CLICKED: DOM.click('.my-button'),
})

// WRONG — never do this in Sygnal
<button onClick={handleClick}>Click</button>
```

### Never Mutate State

Always return new objects/arrays from reducers. Never modify the state parameter directly.

### Action Names Match Between Intent and Model

Every action name in `.intent` must have a corresponding entry in `.model`, and vice versa (except built-in actions like BOOTSTRAP, INITIALIZE, HYDRATE).

### Custom CSS Selectors for DOM.select()

Use className-based selectors for DOM.select(). The selector is isolated to the current component — no need for overly specific selectors.

### Drivers for All Side Effects

Network calls, storage, clipboard, timers, and any other side effects must go through drivers, never directly in component code.

### Isolation Boundary

Each Collection item has total isolation. A parent component CANNOT see DOM events on child component elements via `DOM.select()`. Handle events within the sub-component's own scope, then communicate upward via EVENTS (global) or PARENT (one level up).

## DOM Driver Shorthands

Prefer shorthands over `DOM.select().events()`:

```javascript
DOM.click('.btn')           // click events
DOM.input('.field')         // input events
DOM.change('.select')       // change events
DOM.keydown('.input')       // keydown events
DOM.keyup('.input')         // keyup events
DOM.dblclick('.item')       // dblclick events
DOM.submit('.form')         // submit events
```

### Event Stream Helpers

Extract values from event streams with chainable helpers:

```javascript
DOM.input('.text-field').value()              // e.target.value as string
DOM.change('.checkbox').checked()             // e.target.checked as boolean
DOM.keydown('.input').key()                   // e.key as string
DOM.click('.btn').data('id')                  // e.target.dataset.id
DOM.click('.btn').target()                    // e.target

// With transform functions:
DOM.input('.text-field').value(v => v.trim())
DOM.keydown('.input').key(k => k === 'Enter')
DOM.click('.btn').data('id', v => Number(v))
```

## Built-in Actions

Define in `.model` to handle these — they fire automatically:

| Action | When | Typical Use |
|--------|------|-------------|
| `BOOTSTRAP` | Once on component instantiation | Initialize data, trigger first load |
| `INITIALIZE` | When component receives first state | One-time setup based on initial state |
| `HYDRATE` | On first state during HMR | Restore after hot reload |
| `DISPOSE` | When component is about to unmount | Cleanup timers, close connections, notify parent |

## EFFECT Sink

Run side effects without state changes:

```javascript
App.model = {
  SEND_COMMAND: {
    EFFECT: () => playerCmd.send('play'),
  },
  ROUTE: {
    EFFECT: (state, data, next) => {
      if (state.mode === 'a') next('DO_A', data)
      else next('DO_B', data)
    },
  },
}
```

## Model Shorthand Syntax

Compact syntax for single-driver model entries using `'ACTION | DRIVER'`:

```javascript
App.model = {
  'SEND_CMD | EFFECT': () => playerCmd.send('play'),
  'NOTIFY | EVENTS': (state) => ({ type: 'alert', data: state.message }),
  'SELECT | PARENT': (state) => ({ type: 'SELECT', id: state.id }),
}
```

## Default Drivers

Every Sygnal app automatically includes these drivers (no setup needed):

| Driver | Source Usage | Sink Usage |
|--------|-------------|------------|
| `DOM` | `DOM.click('.css')` or `DOM.select('.css').events('event')` | Handled automatically by view return |
| `STATE` | `STATE.stream` (Observable of state) | Reducer functions from model |
| `EVENTS` | `EVENTS.select('eventType')` | `{ type: 'eventType', data: payload }` |
| `LOG` | None (sink-only) | Any value — logged to console |
| `CHILD` | `CHILD.select(ChildComponent)` | Via PARENT sink in child model |

Additional pseudo-sources available in intent:
- `dispose$` — Stream that emits once on component unmount (advanced — prefer the `DISPOSE` model action)
- `commands$` — Stream of commands from parent (via `createCommand()`)
- `props$` — Stream of props from parent
- `children$` — Stream of children from parent

## Available Imports from Sygnal

```javascript
// Core
import { run, ABORT } from 'sygnal'

// Built-in components
import { Collection, Switchable, Transition, Portal, Suspense, Slot } from 'sygnal'

// Utilities
import { processForm, processDrag, classes, exactState, driverFromAsync, makeDragDriver } from 'sygnal'
import { lazy, createRef, createRef$, createCommand, renderToString } from 'sygnal'

// Testing
import { renderComponent } from 'sygnal'

// Streams
import { xs, debounce, throttle, delay, dropRepeats, sampleCombine } from 'sygnal'

// DOM helpers (when not using JSX)
import { h } from 'sygnal'

// Types (TypeScript)
import type { RootComponent, Component, RootComponent, Lens, Stream, MemoryStream } from 'sygnal'

// JSX pragma (auto-injected by the automatic JSX transform, do NOT manually import in .jsx files)
// Configured via jsxImportSource: 'sygnal' in vite.config.js or via the Vite plugin
import { jsx, jsxs, Fragment } from 'sygnal/jsx-runtime'
```

## Default Conventions

Use these unless the user specifies otherwise:

- **File naming**: PascalCase for components (`UserProfile.jsx`), camelCase for drivers and utilities (`apiDriver.js`)
- **Action names**: ALL_CAPS with underscores (`LOAD_USERS`, `SET_ROUTE`, `FORM_SUBMITTED`)
- **Stream variable naming**: Trailing `$` suffix (`click$`, `user$`, `formData$`)
- **State design**: Flat where possible, nested objects for logical groupings
- **Component state mapping**: Use `state="propertyName"` for simple cases, lenses only when necessary
- **Routing**: Use `state.route` with `<Switchable>` for page transitions
- **Forms**: Use `processForm()` for form handling
- **CSS classes**: Use the `classes()` utility for conditional class names
- **Imports**: Import from `'sygnal'` for all framework functions and types
- **DOM event shorthands**: Prefer `DOM.click('.btn')` over `DOM.select('.btn').events('click')`
- **Value extraction**: Use `.value()`, `.checked()`, `.key()`, `.data()`, `.target()` on event streams

## Framework Integrations

### Astro

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

export default defineConfig({
  integrations: [sygnal()],
})
```

```astro
---
import Counter from '../components/Counter.jsx'
---
<Counter client:load />
```

### Vike (SSR)

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
import vike from 'vike/plugin'

export default defineConfig({
  plugins: [sygnal({ disableHmr: true }), vike()],
})
```

```javascript
// pages/+config.js
import vikeSygnal from 'sygnal/config'
export default { extends: [vikeSygnal] }
```

Pages are standard Sygnal components in `pages/*/+Page.jsx`.

## References

- Load `references/component-patterns.md` for complete code patterns covering all Sygnal features with copy-paste examples.
