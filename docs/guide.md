# Sygnal Guide

This guide covers all of Sygnal's features in depth. If you're new to Sygnal, start with the [Getting Started](./getting-started.md) guide first.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Components](#components)
- [View (The Component Function)](#view-the-component-function)
- [Intent](#intent)
- [Model](#model)
- [State Management](#state-management)
- [Observables](#observables)
- [Drivers](#drivers)
- [Collections](#collections)
- [Switchable Components](#switchable-components)
- [Context](#context)
- [Parent-Child Communication (PARENT / CHILD)](#parent-child-communication-parent--child)
- [Calculated Fields](#calculated-fields)
- [Peer Components](#peer-components)
- [Form Handling](#form-handling)
- [Focus Management](#focus-management)
- [Custom Drivers](#custom-drivers)
- [Drag and Drop](#drag-and-drop)
- [Error Boundaries](#error-boundaries)
- [Refs (DOM Access)](#refs-dom-access)
- [Portals](#portals)
- [Transitions](#transitions)
- [Lazy Loading](#lazy-loading)
- [Suspense](#suspense)
- [Disposal Hooks](#disposal-hooks)
- [Hot Module Replacement](#hot-module-replacement)
- [The classes() Utility](#the-classes-utility)
- [Debugging](#debugging)
- [TypeScript](#typescript)
- [Astro Integration](#astro-integration)
- [Bundler Configuration](#bundler-configuration)

---

## Architecture Overview

Sygnal is built on [Cycle.js](https://cycle.js.org/) and uses the **Model-View-Intent (MVI)** architecture. This pattern separates application logic into three concerns:

```
DOM Events ──→ Intent (WHEN) ──→ Model (WHAT) ──→ State ──→ View (HOW) ──→ DOM
                  ↑                                                          │
                  └──────────────────────────────────────────────────────────┘
```

- **Intent** — Determines *when* actions should happen by observing driver sources (DOM events, API responses, timers, etc.)
- **Model** — Determines *what* should happen by defining reducers that produce new state or commands for drivers
- **View** — Determines *how* things are displayed by rendering the current state as virtual DOM

All side effects (DOM updates, network calls, storage) are handled by **drivers**, keeping your component code 100% pure.

### Why This Matters

Pure components mean:
- No hidden mutations or surprise side effects
- Predictable, testable behavior
- Easy state restoration, undo/redo, and time-travel debugging
- Components can be safely re-created or hot-reloaded at any time

---

## Components

A Sygnal component is a function with optional static properties attached to it. At minimum, a component is just a function that returns JSX:

```jsx
function MyComponent() {
  return <div>Hello World</div>
}
```

To make a component interactive, attach `.initialState`, `.intent`, and `.model` properties:

```jsx
function Counter({ state }) {
  return <div>Count: {state.count}</div>
}

Counter.initialState = { count: 0 }

Counter.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.btn').events('click')
})

Counter.model = {
  INCREMENT: (state) => ({ count: state.count + 1 })
}
```

### Component Properties Summary

| Property | Type | Description |
|----------|------|-------------|
| `.initialState` | Object | The starting state for the component |
| `.intent` | Function | Maps driver sources to named action streams |
| `.model` | Object | Defines what happens for each action |
| `.calculated` | Object | Derived state fields computed from base state |
| `.context` | Object | Values passed down to all descendants |
| `.peers` | Object | Sibling components that share the same sources |
| `.components` | Object | Named child components |
| `.storeCalculatedInState` | Boolean | Whether calculated fields are stored in state (default: `true`) |
| `.debug` | Boolean | Enable debug logging for this component |
| `.DOMSourceName` | String | Custom name for the DOM driver (default: `'DOM'`) |
| `.stateSourceName` | String | Custom name for the state driver (default: `'STATE'`) |

---

## View (The Component Function)

The component function is the view. It receives a single object where props from the parent are spread at the top level alongside `state`, `children`, and `context`:

```jsx
function MyComponent({ state, className, children, context, ...peers }) {
  return (
    <div className={className}>
      <h1>{state.title}</h1>
      {children}
    </div>
  )
}
```

### View Parameters

| Parameter | Description |
|-----------|-------------|
| `state` | The current component state |
| `children` | Child elements passed between the component's opening and closing tags |
| `context` | Values from ancestor components' `.context` definitions |
| Named peers | Any peer components defined in `.peers` are available by name |
| Individual props | Props from the parent (e.g., `title`, `className`) are spread at the top level |

> Props are **not** nested under a `props` key. If a parent renders `<MyChild title="Hello" />`, the child destructures `title` directly: `function MyChild({ title, state }) { ... }`.

The view function must be **pure**: it should only use the values it receives to produce virtual DOM. Never perform side effects (API calls, direct DOM manipulation, etc.) inside the view.

### Using the Second Positional Argument

The view function also receives `state` as a second positional argument, which can be convenient:

```jsx
const MyComponent = (_props, state) => {
  return <div>{state.count}</div>
}
```

---

## Intent

The `.intent` property defines **when** actions should happen. It's a function that receives all available driver sources and returns an object mapping action names to Observable streams.

```jsx
MyComponent.intent = ({ DOM, STATE, EVENTS }) => {
  return {
    // Fire INCREMENT when the button is clicked
    INCREMENT: DOM.select('.increment-btn').events('click'),

    // Fire CHANGE_NAME when the input value changes, passing the new value
    CHANGE_NAME: DOM.input('.name-input').value(),

    // Fire SAVE on form submission
    SAVE: DOM.select('.save-form').events('submit')
  }
}
```

### Available Sources

By default, every Sygnal application provides these sources:

| Source | Description |
|--------|-------------|
| `DOM` | Observe DOM events. Use `.select(cssSelector).events(eventName)` |
| `STATE` | Access the state stream via `STATE.stream` |
| `EVENTS` | Custom event bus. Use `.select(eventType)` to listen |
| `LOG` | Log driver (sink-only — no source) |
| `props$` | Stream of props from the parent component |
| `children$` | Stream of children from the parent component |
| `context$` | Stream of context values from ancestors |
| `CHILD` | Access child component events. Use `.select(ComponentFn)` — see [Parent-Child Communication](#parent-child-communication-parent--child) |

### Key Points

- Action names can be any valid JavaScript property name. Convention is `ALL_CAPS`.
- Each action maps to exactly one Observable stream.
- If multiple events should trigger the same action, merge them with `xs.merge()`.
- **Never** attach event handlers in the view. All event handling goes through intent.
- The DOM source is isolated to the current component — selectors won't match elements in parent or sibling components.

### Event Shorthands

The DOM source provides shorthand methods for every event type. Instead of chaining `.select(selector).events(eventName)`, you can call `DOM.eventName(selector)` directly:

```jsx
MyComponent.intent = ({ DOM }) => ({
  // These are equivalent:
  CLICK:    DOM.select('.btn').events('click'),
  CLICK:    DOM.click('.btn'),

  // Works with any DOM event
  BLUR:     DOM.blur('.input'),
  DBLCLICK: DOM.dblclick('.title'),
  KEYDOWN:  DOM.keydown('.input'),
  INPUT:    DOM.input('.field'),
  SUBMIT:   DOM.submit('.form'),
})
```

The shorthand is powered by a JavaScript Proxy, so any valid DOM event name works — `DOM.mouseenter(sel)`, `DOM.touchstart(sel)`, `DOM.animationend(sel)`, etc.

The longhand `.select().events()` syntax is still fully supported and is needed when you want to chain additional stream operators directly off the DOM source selection.

### Accessing Global DOM Events

To listen for events outside your component's DOM (like keyboard events on `document`):

```jsx
MyComponent.intent = ({ DOM }) => ({
  KEY_PRESS: DOM.select('document').events('keydown').map(e => e.key)
})
```

### Event Value Extraction

DOM event streams have chainable convenience methods for extracting common values, eliminating verbose `.map(e => e.target.value)` patterns:

```jsx
MyComponent.intent = ({ DOM }) => ({
  // Instead of: DOM.input('.field').map(e => e.target.value)
  CHANGE_NAME: DOM.input('.field').value(),

  // Instead of: DOM.change('.checkbox').map(e => e.target.checked)
  TOGGLE: DOM.change('.checkbox').checked(),

  // Instead of: DOM.click('.item').map(e => e.target.dataset.id)
  SELECT: DOM.click('.item').data('id'),

  // Instead of: DOM.keydown('.input').map(e => e.key)
  KEY: DOM.keydown('.input').key(),

  // Instead of: DOM.click('.btn').map(e => e.target)
  ELEMENT: DOM.click('.btn').target(),
})
```

Each method optionally accepts a transform function:

```jsx
MyComponent.intent = ({ DOM }) => ({
  // Parse the value as a number
  SET_COUNT: DOM.input('.count-field').value(Number),

  // Parse JSON data attribute
  SELECT_ITEM: DOM.click('.item').data('item', JSON.parse),

  // Custom key filtering
  ENTER: DOM.keydown('.input').key(k => k === 'Enter' ? true : undefined),
})
```

| Method | Extracts | From |
|--------|----------|------|
| `.value(fn?)` | `e.target.value` | Input, textarea, select events |
| `.checked(fn?)` | `e.target.checked` | Checkbox change events |
| `.data(name, fn?)` | `e.target.dataset[name]` | Any element with `data-*` attributes |
| `.key(fn?)` | `e.key` | Keyboard events |
| `.target(fn?)` | `e.target` | Any event |

All methods return enriched streams, so they can be chained with standard stream operators:

```jsx
SEARCH: DOM.input('.search').value().compose(debounce(300)),
```

---

## Model

The `.model` property defines **what** happens for each action. It maps action names to reducers or driver commands.

### Simple State Reducers

The most common case is updating state. A function provided directly as an action value is treated as a state reducer:

```jsx
MyComponent.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  SET_NAME: (state, data) => ({ ...state, name: data })
}
```

Reducer arguments:
1. `state` — The current component state
2. `data` — The value emitted by the triggering stream in intent
3. `next` — A function to trigger other actions (see [Chaining Actions](#chaining-actions))
4. `extra` — An object containing `{ context, props, children }`

### Multi-Driver Actions

When an action needs to do more than just update state, use an object to specify multiple driver sinks:

```jsx
MyComponent.model = {
  SAVE: {
    STATE: (state, data) => ({ ...state, saved: true }),
    LOG: (state, data) => `Saved: ${JSON.stringify(data)}`,
    EVENTS: (state, data) => ({ type: 'saved', data })
  }
}
```

### Passthrough with `true`

Setting a driver sink to `true` passes the intent data through as-is:

```jsx
MyComponent.model = {
  LOG_DATA: {
    LOG: true  // passes whatever data came from intent directly to LOG
  }
}
```

### Chaining Actions with `next()`

The `next()` function (third argument to any reducer) lets you trigger other actions:

```jsx
MyComponent.model = {
  SUBMIT: (state, data, next) => {
    // Trigger VALIDATE after this action completes
    next('VALIDATE', data)
    return { ...state, submitting: true }
  },

  // next() with a delay (in milliseconds)
  START: (state, data, next) => {
    next('DELAYED_ACTION', null, 1000)  // fires after 1 second
    return state
  },

  VALIDATE: (state, data) => {
    // handle validation
    return { ...state, valid: true }
  }
}
```

You can call `next()` multiple times in a single reducer, and optionally add a delay as the third argument.

### Aborting an Action

Import `ABORT` from Sygnal and return it to cancel a state update:

```jsx
import { ABORT } from 'sygnal'

MyComponent.model = {
  MOVE: (state, data) => {
    if (state.locked) return ABORT  // skip this action entirely
    return { ...state, position: data }
  }
}
```

### Built-in Actions

Sygnal provides three built-in actions that fire automatically:

| Action | When It Fires |
|--------|---------------|
| `BOOTSTRAP` | Once when the component is first instantiated (similar to React's `useEffect(() => {}, [])`) |
| `INITIALIZE` | When the component receives its first state |
| `HYDRATE` | When the component receives its first state during HMR |

```jsx
MyComponent.model = {
  BOOTSTRAP: {
    LOG: () => 'Component mounted!',
    STATE: (state, data, next) => {
      next('LOAD_DATA')
      return state
    }
  },
  INITIALIZE: (state) => {
    // runs once when state is first available
    return state
  }
}
```

---

## State Management

### Monolithic State

Sygnal uses a single, monolithic state tree for the entire application. Every component shares this state, though each component typically works with just a slice of it.

Benefits:
- Trivial undo/redo — just restore a previous state snapshot
- Easy debugging — inspect the entire app state in one place
- No state synchronization bugs between components

### Setting Initial State

Set `.initialState` on your root component:

```jsx
RootComponent.initialState = {
  user: { name: 'Alice', age: 30 },
  items: [],
  settings: { theme: 'light' }
}
```

### State in Reducers

Reducers receive the current state and must return the **complete** new state. The return value replaces the state entirely — there is no automatic merging of partial updates:

```jsx
// If state is { count: 0, name: 'World' }
MyComponent.model = {
  // WRONG — this would lose the 'name' property!
  // INCREMENT: (state) => ({ count: state.count + 1 })

  // CORRECT — spread the existing state and override what changed
  INCREMENT: (state) => ({ ...state, count: state.count + 1 })
  // Result: { count: 1, name: 'World' }
}
```

### Passing State to Child Components

#### Property-Based (Simple)

Pass a state property name as a string:

```jsx
function RootComponent({ state }) {
  return (
    <div>
      {/* UserProfile sees state.user as its root state */}
      <UserProfile state="user" />

      {/* ItemList sees state.items as its root state */}
      <ItemList state="items" />
    </div>
  )
}

RootComponent.initialState = {
  user: { name: 'Alice' },
  items: [{ text: 'First' }]
}
```

If the child updates its state, the change flows back up to the correct property on the parent state.

If you specify a name that doesn't exist on the current state, it gets added when the child first updates.

#### Lens-Based (Advanced)

For more control over how state maps between parent and child, use a lens:

```jsx
const userLens = {
  get: (parentState) => ({
    name: parentState.userName,
    email: parentState.userEmail
  }),
  set: (parentState, childState) => ({
    ...parentState,
    userName: childState.name,
    userEmail: childState.email
  })
}

function RootComponent() {
  return <UserForm state={userLens} />
}
```

The `get` function extracts child state from parent state. The `set` function merges child state updates back into parent state.

> Use lenses sparingly. In most cases, property-based state passing is sufficient and much easier to debug.

#### Sub-Component Initial State (`isolatedState`)

By default, Sygnal throws an error if a sub-component has `.initialState` without declaring `.isolatedState = true`. This prevents a common bug where a child's initial state silently overwrites the parent's state slice:

```jsx
// This will throw:
function Widget({ state }) {
  return <div>Count: {state.count}</div>
}
Widget.initialState = { count: 0 }  // Error! No .isolatedState

// Fix: declare isolated state
Widget.initialState = { count: 0 }
Widget.isolatedState = true  // Explicitly opt in
```

When `isolatedState = true`, the child's `initialState` seeds the parent's state slice if it doesn't already exist.

---

## Observables

Sygnal uses [xstream](https://github.com/staltz/xstream) as its Observable library. Observables are like Promises that can emit multiple values over time.

```javascript
// Promise: resolves once
somePromise.then(value => console.log(value))

// Observable: emits many times
someObservable.map(value => console.log(value))
```

### Common Stream Operations

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

### Imported Stream Operators

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

### Creating Custom Streams

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

---

## Drivers

Drivers handle all side effects in a Sygnal application. They are the bridge between your pure component code and the outside world.

Every driver has two sides:
- **Source** — Provides data *to* your component (e.g., DOM events, API responses)
- **Sink** — Receives commands *from* your component (e.g., state updates, log messages)

### Default Drivers

Sygnal's `run()` function automatically includes these drivers:

| Driver | Source | Sink |
|--------|--------|------|
| `DOM` | `.select(css).events(event)` — Observe DOM events | Handled automatically by the view |
| `STATE` | `.stream` — The state Observable | Reducer functions from model |
| `EVENTS` | `.select(type)` — Custom event bus | Event objects `{ type, data }` |
| `CHILD` | `.select(ComponentFn)` — Events from child components | None |
| `PARENT` | None | Values sent to the parent component |
| `LOG` | None | Any value — logged to the console |

### Adding Custom Drivers

Pass additional drivers as the second argument to `run()`:

```javascript
import { run } from 'sygnal'
import RootComponent from './RootComponent.jsx'
import myCustomDriver from './drivers/myCustomDriver'

run(RootComponent, {
  CUSTOM: myCustomDriver
})
```

The driver is then available as both a source (in intent) and a sink (in model):

```jsx
MyComponent.intent = ({ DOM, CUSTOM }) => ({
  DATA_RECEIVED: CUSTOM.select('some-category')
})

MyComponent.model = {
  FETCH: {
    CUSTOM: (state) => ({ category: 'some-category', url: '/api/data' })
  }
}
```

### The Event Bus (EVENTS Driver)

The EVENTS driver provides a lightweight pub/sub system for cross-component communication:

```jsx
// Publishing events (in model)
Publisher.model = {
  NOTIFY: {
    EVENTS: (state) => ({ type: 'notification', data: { message: 'Hello!' } })
  }
}

// Subscribing to events (in intent)
Subscriber.intent = ({ EVENTS }) => ({
  HANDLE_NOTIFICATION: EVENTS.select('notification')
})
```

### The LOG Driver

The LOG driver sends values to the browser console:

```jsx
MyComponent.model = {
  SOME_ACTION: {
    STATE: (state) => ({ ...state, updated: true }),
    LOG: (state, data) => `Action triggered with: ${data}`
  }
}
```

---

## Collections

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

### Collection Props

| Prop | Type | Description |
|------|------|-------------|
| `of` | Component | The component to render for each item |
| `from` | String or Lens | The state property (or lens) containing the array |
| `filter` | Function | Filter function — only items returning `true` are shown |
| `sort` | String or Function | Sort by a property name, or provide a custom sort function |
| `className` | String | CSS class for the wrapping container |

### Filtering and Sorting

```jsx
<collection
  of={TodoItem}
  from="items"
  filter={item => !item.done}
  sort="text"
/>
```

### Item Keys

Collections automatically use the `id` property of each item for efficient rendering. If items don't have an `id`, the array index is used.

### Self-Removal

An item can remove itself from the collection by returning `undefined` from a reducer:

```jsx
TodoItem.model = {
  DELETE: () => undefined  // removes this item from the array
}
```

### Using `Collection` (capitalized)

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

---

## Switchable Components

The `<switchable>` element conditionally renders one of several components based on a state value. This is useful for tabs, views, or any UI that switches between different content.

```jsx
import { xs } from 'sygnal'

function TabContainer({ state }) {
  return (
    <div>
      <button className="tab-home">Home</button>
      <button className="tab-settings">Settings</button>
      <switchable
        of={{ home: HomePanel, settings: SettingsPanel }}
        current={state.activeTab}
      />
    </div>
  )
}

TabContainer.initialState = { activeTab: 'home' }

TabContainer.intent = ({ DOM }) => ({
  SET_TAB: xs.merge(
    DOM.select('.tab-home').events('click').mapTo('home'),
    DOM.select('.tab-settings').events('click').mapTo('settings')
  )
})

TabContainer.model = {
  SET_TAB: (state, data) => ({ ...state, activeTab: data })
}
```

### Switchable Props

| Prop | Type | Description |
|------|------|-------------|
| `of` | Object | Maps names to components: `{ name: Component }` |
| `current` | String | The name of the currently active component |
| `state` | String or Lens | Optional state slice for the switched components |

### How It Works

- Only the `current` component's DOM is rendered
- Non-DOM sinks (like EVENTS) from *all* components remain active
- Switching is efficient — components are pre-instantiated

### Using `Switchable` (capitalized)

```jsx
import { Switchable } from 'sygnal'

<Switchable of={{ home: HomePanel, settings: SettingsPanel }} current={state.activeTab} />
```

---

## Context

Context lets you pass values to all descendant components regardless of depth, without threading them through every intermediate component.

### Defining Context

Set `.context` on any component. Each key maps to a function that derives a value from state:

```jsx
RootComponent.context = {
  theme: (state) => state.settings.theme,
  currentUser: (state) => state.auth.user
}
```

### Using Context in the View

```jsx
function DeepChild({ state, context }) {
  return (
    <div className={context.theme === 'dark' ? 'dark-mode' : ''}>
      Welcome, {context.currentUser.name}
    </div>
  )
}
```

### Using Context in Reducers

Context is available on the fourth argument (`extra`) of any reducer:

```jsx
DeepChild.model = {
  SOME_ACTION: {
    LOG: (state, data, next, extra) => {
      return `Current theme: ${extra.context.theme}`
    }
  }
}
```

Context values are automatically recalculated when the source component's state changes.

---

## Parent-Child Communication (PARENT / CHILD)

While [context](#context) sends values *down* the tree and [EVENTS](#the-event-bus-events-driver) broadcasts globally, the PARENT/CHILD mechanism provides **direct one-level-up communication** from a child component to its immediate parent.

### Sending Data Up (PARENT Sink)

A child emits values to its parent by adding a `PARENT` entry in model:

```jsx
function TaskCard({ state }) {
  return (
    <div className="task-card">
      <span>{state.title}</span>
      <button className="delete">×</button>
    </div>
  )
}

TaskCard.intent = ({ DOM }) => ({
  DELETE: DOM.select('.delete').events('click')
})

TaskCard.model = {
  DELETE: {
    PARENT: (state) => ({ type: 'DELETE', taskId: state.id })
  }
}
```

The value returned by the `PARENT` reducer is wrapped automatically by the framework as `{ name, component, value }` and delivered to the parent's `CHILD` source.

### Receiving Data from Children (CHILD Source)

The parent listens using `CHILD.select()` in its intent, passing a **reference to the child component function**:

```jsx
import TaskCard from './TaskCard.jsx'

function LaneComponent({ state }) {
  return (
    <div className="lane">
      <Collection of={TaskCard} from="tasks" />
    </div>
  )
}

LaneComponent.intent = ({ DOM, CHILD }) => ({
  DELETE_TASK: CHILD.select(TaskCard)
    .filter(e => e.type === 'DELETE')
    .map(e => e.taskId),
})

LaneComponent.model = {
  DELETE_TASK: (state, taskId) => ({
    ...state,
    tasks: state.tasks.filter(t => t.id !== taskId)
  })
}
```

### Why Pass the Component Reference?

`CHILD.select(TaskCard)` matches by **function identity** — the same import you already use to render the component. This is the preferred approach because:

- **Minification-safe.** Production bundlers mangle function names (`TaskCard` becomes `a`), which breaks string-based matching. Reference matching is unaffected.
- **Refactoring-friendly.** Rename the function and all imports update together. No separate strings to keep in sync.
- **Zero configuration.** No build plugins, no manual `componentName` properties, no bundler settings.

String-based matching (`CHILD.select('TaskCard')`) is still supported for backward compatibility but is **not recommended** for production builds, since minification will silently break it.

> **Tip:** If you can't import the child (e.g., dynamically resolved components), you can set a static `componentName` property on the function as a fallback: `TaskCard.componentName = 'TaskCard'`. This string survives minification.

### Works with Collections

When a child component is rendered via `<Collection>`, all items share the same component function. `CHILD.select(TaskCard)` matches events from every TaskCard instance in the collection — filter by the event's data payload to distinguish between them.

---

## Calculated Fields

Calculated fields are derived values computed from the current state. They're added to the state object automatically and available in both the view and reducers.

### Defining Calculated Fields

Each calculated field is a function that receives the current state and returns the derived value:

```jsx
UserProfile.calculated = {
  fullName: (state) => `${state.firstName} ${state.lastName}`,
  isAdult: (state) => state.age >= 18,
  itemCount: (state) => state.items.length
}

function UserProfile({ state }) {
  return (
    <div>
      <h1>{state.fullName}</h1>
      <p>{state.isAdult ? 'Adult' : 'Minor'}</p>
      <p>Items: {state.itemCount}</p>
    </div>
  )
}
```

### Dependency Tracking

By default, calculated fields recalculate on every state change. To skip unnecessary recalculations, declare dependencies using the tuple form `[depsArray, fn]`:

```jsx
OrderSummary.calculated = {
  // Only recalculates when state.items changes
  subtotal: [['items'], (state) => state.items.reduce((sum, i) => sum + i.price, 0)],

  // Only recalculates when subtotal changes
  tax: [['subtotal'], (state) => state.subtotal * 0.08],

  // Only recalculates when subtotal or tax changes
  total: [['subtotal', 'tax'], (state) => state.subtotal + state.tax],

  // No deps — always recalculates (original behavior)
  label: (state) => `${state.items.length} items`,
}
```

Dependencies can reference both base state keys and other calculated field names. When a dependency names another calculated field, that field is guaranteed to be computed first.

An empty deps array `[[], fn]` means the field computes once and never recalculates — useful for constant derived values.

### Calculated Fields Depending on Other Calculated Fields

Calculated fields can depend on other calculated fields. The framework automatically determines the correct computation order using a topological sort at component creation time:

```jsx
Component.calculated = {
  doubled:    [['value'],     (state) => state.value * 2],
  quadrupled: [['doubled'],   (state) => state.doubled * 2],
  octupled:   [['quadrupled'], (state) => state.quadrupled * 2],
}
```

Circular dependencies are detected at component creation time and throw an error:

```jsx
// This throws: "Circular calculated dependency: a → b → a"
Component.calculated = {
  a: [['b'], (state) => state.b + 1],
  b: [['a'], (state) => state.a + 1],
}
```

### Controlling Storage

By default, calculated fields are stored in the actual state. To prevent this:

```jsx
UserProfile.storeCalculatedInState = false
```

When set to `false`, calculated fields are still available in the view and reducers but don't persist in the state tree. This is useful when calculated values are expensive or transient.

### Name Collision Warning

If a calculated field has the same name as a key in `initialState`, a warning is logged at component creation time. The calculated field will always overwrite the base state value, so the `initialState` entry is effectively dead.

---

## Peer Components

Peers are sibling components that share the same sources as your component. They're useful for breaking up complex UIs into manageable pieces while keeping them tightly coupled.

### Defining Peers

```jsx
Dashboard.peers = {
  Sidebar: SidebarComponent,
  Toolbar: ToolbarComponent
}
```

### Using Peers in the View

Peer component output is available by name in the view's destructured arguments:

```jsx
function Dashboard({ state, Sidebar, Toolbar }) {
  return (
    <div className="dashboard">
      {Toolbar}
      <div className="main-area">
        {Sidebar}
        <div className="content">{state.content}</div>
      </div>
    </div>
  )
}
```

---

## Form Handling

Sygnal provides `processForm()` to simplify working with HTML forms:

```jsx
import { processForm } from 'sygnal'

function ContactForm({ state }) {
  return (
    <form className="contact-form">
      <input name="name" value={state.name} />
      <input name="email" value={state.email} />
      <textarea name="message">{state.message}</textarea>
      <button type="submit">Send</button>
    </form>
  )
}

ContactForm.initialState = { name: '', email: '', message: '' }

ContactForm.intent = ({ DOM }) => ({
  // Listen only to submit events
  SUBMIT: processForm(DOM.select('.contact-form'), { events: 'submit' }),

  // Listen to all input changes (default: both 'input' and 'submit')
  FIELD_CHANGE: processForm(DOM.select('.contact-form'))
})

ContactForm.model = {
  FIELD_CHANGE: (state, data) => ({
    ...state,
    name: data.name,
    email: data.email,
    message: data.message
  }),
  SUBMIT: {
    STATE: (state, data) => ({ ...state, submitted: true }),
    LOG: (state, data) => data  // { name: '...', email: '...', message: '...', eventType: 'submit' }
  }
}
```

### processForm() Options

```javascript
processForm(domSource, options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `events` | String or Array | `['input', 'submit']` | Which form events to listen for |
| `preventDefault` | Boolean | `true` | Whether to call `preventDefault()` on events |

### Return Value

The stream emits an object with:
- All form field values keyed by their `name` attribute
- `event` — The raw DOM event
- `eventType` — The event type string (e.g., `'submit'`, `'input'`)

---

## Focus Management

Sygnal components are pure functions — they never touch real DOM elements. But web apps frequently need to focus an element programmatically, for example when an input appears for inline editing.

The `autoFocus` and `autoSelect` JSX props handle this declaratively. No imperative code in your view, no drivers, no hooks.

### autoFocus

Add `autoFocus={true}` to any element. When that element enters the DOM, it receives focus automatically:

```jsx
function SearchBar({ state }) {
  return (
    <div>
      {state.isOpen &&
        <input autoFocus={true} className="search-input" placeholder="Search..." />
      }
    </div>
  )
}
```

### autoSelect

Add `autoSelect={true}` alongside `autoFocus` to select all text in the element after focusing. This is ideal for edit-in-place patterns where the user typically wants to replace the existing value:

```jsx
function EditableTitle({ state }) {
  return (
    <div>
      {state.isEditing
        ? <input autoFocus={true} autoSelect={true} value={state.title} className="title-input" />
        : <h2 className="title">{state.title}</h2>
      }
    </div>
  )
}
```

When the user double-clicks to edit, the input appears focused with all text selected — ready to type a replacement.

### How It Works

These props are intercepted by the JSX pragma before they reach the DOM. Under the hood, a snabbdom `insert` hook calls `.focus()` (and optionally `.select()`) when the element is first inserted. The props are never passed to the actual DOM element.

If you also set a manual `hook={{ insert: fn }}` on the same element, both hooks run — yours first, then the focus behavior.

---

## Custom Drivers

### Writing a Driver from Scratch

A Cycle.js driver is a function that takes a sink stream and returns a source object:

```javascript
function myDriver(sink$) {
  // Listen to commands from the app
  sink$.addListener({
    next: (command) => {
      // Perform side effects here
      console.log('Received command:', command)
    }
  })

  // Return a source for the app to observe
  return {
    select: (type) => {
      // Return a filtered stream
    }
  }
}
```

### Using driverFromAsync()

For the common case of wrapping a Promise-returning function as a driver, use `driverFromAsync()`:

```javascript
import { driverFromAsync } from 'sygnal'

const apiDriver = driverFromAsync(
  async (url) => {
    const response = await fetch(url)
    return response.json()
  },
  {
    selector: 'endpoint',  // Property name for categorizing requests
    args: 'url',           // Property to extract as function arguments
    return: 'data',        // Property name for the return value
    pre: (incoming) => incoming,         // Pre-process incoming commands
    post: (result, incoming) => result   // Post-process results
  }
)

// Register the driver
run(RootComponent, { API: apiDriver })
```

#### driverFromAsync() Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `selector` | String | `'category'` | Property used to categorize/filter responses |
| `args` | String, Array, or Function | `'value'` | How to extract function arguments from incoming commands |
| `return` | String | `'value'` | Property name to wrap the return value in |
| `pre` | Function | Identity | Pre-process incoming sink values |
| `post` | Function | Identity | Post-process results before sending to source |

#### Using the Driver in Components

```jsx
// Intent — receive API responses
MyComponent.intent = ({ API }) => ({
  DATA_LOADED: API.select('users')  // Filter by the selector property
})

// Model — send API requests
MyComponent.model = {
  FETCH_USERS: {
    API: (state) => ({ endpoint: 'users', url: '/api/users' })
  },
  DATA_LOADED: (state, data) => ({ ...state, users: data.data })
}
```

---

## Drag and Drop

Sygnal provides a dedicated drag-and-drop driver that handles HTML5 drag events at the document level, bypassing Cycle.js component isolation. This means drag interactions work seamlessly across deeply nested, isolated components.

### Setup

Create the driver with `makeDragDriver()` and pass it to `run()`:

```javascript
import { run, makeDragDriver } from 'sygnal'
import RootComponent from './RootComponent.jsx'

run(RootComponent, { DND: makeDragDriver() })
```

### Registering Drag Categories

Register drag categories from your model, typically in `BOOTSTRAP`. Each category describes a set of draggable elements and/or drop zones identified by CSS selectors:

```jsx
RootComponent.model = {
  BOOTSTRAP: {
    DND: () => ({
      configs: [
        { category: 'task', draggable: '.task-card' },
        { category: 'lane', dropZone: '.lane-drop-zone', accepts: 'task' },
      ],
    }),
  },
}
```

#### Registration Properties

| Property | Type | Description |
|----------|------|-------------|
| `category` | `string` | Required. Name for this group of drag elements |
| `draggable` | `string` | CSS selector for elements that can be dragged |
| `dropZone` | `string` | CSS selector for elements that accept drops |
| `accepts` | `string` | Only accept drops from this dragging category. Omit to accept any |
| `dragImage` | `string` | CSS selector for a custom drag preview. Resolved via `.closest()` from the draggable element |

A single category can have both `draggable` and `dropZone` — for example, sortable lists where items are both dragged and dropped onto:

```javascript
{ category: 'lane-sort', draggable: '.lane-drag-handle',
                          dropZone:  '.lane-header',
                          accepts:   'lane-sort',
                          dragImage: '.lane' }
```

### Listening to Drag Events

Use the `DND` source in intent. It supports the same shorthand pattern as the DOM source:

```jsx
RootComponent.intent = ({ DND, EVENTS }) => ({
  // Shorthand (preferred)
  DRAG_START: DND.dragstart('task'),
  DROP:       DND.drop('lane'),
  DRAG_END:   DND.dragend('task'),

  // Longhand (equivalent)
  DRAG_START: DND.select('task').events('dragstart'),
  DROP:       DND.select('lane').events('drop'),
  DRAG_END:   DND.select('task').events('dragend'),
})
```

#### Event Payloads

| Event | Payload | Description |
|-------|---------|-------------|
| `dragstart` | `{ element, dataset }` | The dragged element and its `data-*` attributes |
| `dragend` | `null` | Fires when the drag ends (drop or cancel) |
| `drop` | `{ dropZone, insertBefore }` | The drop zone element, and the sibling element at the cursor position (for ordering) |
| `dragover` | `null` | Fires continuously while dragging over a valid drop zone. `preventDefault()` is called automatically |

### Handling Drops

The `drop` event provides the drop zone element and an `insertBefore` reference for ordering. Use `dataset` attributes on your elements to identify items:

```jsx
// In the view, put identifying data on elements
<div className="task-card" data={{ taskId: state.id }}>
  {state.title}
</div>

// In the model, use the drop payload to move items
RootComponent.model = {
  DROP: (state, { dropZone, insertBefore }) => {
    const toLaneId = dropZone.dataset.laneId
    const insertBeforeTaskId = insertBefore?.dataset.taskId ?? null
    // ... move the task to the target lane at the correct position
  },
}
```

### Visual Feedback with Context

Use context to communicate drag state down to child components for styling:

```jsx
RootComponent.context = {
  draggingTaskId: state => state.dragging?.taskId ?? null,
}

// In a child component's view
function TaskCard({ state, context }) {
  const isDragging = context.draggingTaskId === state.id
  return (
    <div className={'task-card' + (isDragging ? ' dragging' : '')} data={{ taskId: state.id }}>
      {state.title}
    </div>
  )
}
```

### Complete Example

See the [Kanban board example](../examples/kanban/) for a full working implementation with task drag-and-drop between lanes, lane reordering with custom drag images, and visual drag feedback.

---

## Error Boundaries

Catch and recover from errors in component rendering without crashing the entire application.

### The `onError` Static Property

```jsx
function BrokenComponent({ state }) {
  if (state.count > 5) throw new Error('Count too high!')
  return <div>Count: {state.count}</div>
}

BrokenComponent.onError = (error, { componentName }) => (
  <div className="error-fallback">
    <h3>Something went wrong in {componentName}</h3>
    <p>{error.message}</p>
  </div>
)
```

Error boundaries protect three code paths:
- **View errors** — The view function throws. Renders `onError` fallback or an empty `<div data-sygnal-error>`.
- **Reducer errors** — A model reducer throws. Returns the previous state unchanged (no state corruption).
- **Sub-component errors** — A child component fails to instantiate. Replaces with fallback VNode.

Without `onError`, errors are logged to `console.error` and a minimal placeholder is rendered.

---

## Refs (DOM Access)

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

### Callback Refs

Pass a function instead of a ref object:

```jsx
<div ref={(el) => { /* el is the DOM element, or null on unmount */ }} />
```

### Stream Refs

`createRef$()` returns a stream-based ref that emits the element on mount:

```jsx
import { createRef$ } from 'sygnal'
const myRef$ = createRef$()

MyComponent.intent = () => ({
  ELEMENT: myRef$,
})
```

---

## Portals

Render children into a DOM container outside the component's own tree. Essential for modals, tooltips, and dropdown menus that need to escape `overflow: hidden` or z-index stacking contexts.

```jsx
import { Portal } from 'sygnal'

function ModalExample({ state }) {
  return (
    <div>
      <button className="open-btn">Open Modal</button>
      {state.showModal && (
        <Portal target="#modal-root">
          <div className="modal-overlay">
            <div className="modal-content">
              <h2>Modal Title</h2>
              <button className="close-btn">Close</button>
            </div>
          </div>
        </Portal>
      )}
    </div>
  )
}
```

The `target` prop is a CSS selector for the destination container. Add a `<div id="modal-root"></div>` to your HTML.

### Event Handling in Portals

Portal content is rendered outside the component's DOM tree, so `DOM.select('.close-btn').events('click')` won't work for elements inside the portal. Use document-level event delegation:

```jsx
ModalExample.intent = ({ DOM }) => ({
  OPEN: DOM.select('.open-btn').events('click'),
  CLOSE: DOM.select('document').events('click')
    .filter(e => e.target && e.target.closest && !!e.target.closest('.close-btn')),
})
```

---

## Transitions

CSS-based enter/leave animations using snabbdom hooks:

```jsx
import { Transition } from 'sygnal'

function AnimatedList({ state }) {
  return (
    <div>
      <Transition enter="fade-in" leave="fade-out" duration={300}>
        {state.visible && <div className="content">Animated!</div>}
      </Transition>
    </div>
  )
}
```

The `enter` class is added when the element is inserted, and `leave` class is added before removal. The element is kept in the DOM for `duration` milliseconds during the leave transition.

---

## Lazy Loading

Code-split components that load on demand:

```jsx
import { lazy } from 'sygnal'

const HeavyChart = lazy(() => import('./HeavyChart.jsx'))

// Use like any other component
function Dashboard({ state }) {
  return (
    <div>
      <h1>Dashboard</h1>
      <HeavyChart />
    </div>
  )
}
```

While loading, a `<div data-sygnal-lazy="loading">` placeholder is rendered. Once the import resolves, the real component renders and receives all its static properties (intent, model, etc.).

---

## Suspense

Show fallback UI while child components signal they're not ready:

```jsx
import { Suspense } from 'sygnal'

<Suspense fallback={<div className="loading">Loading...</div>}>
  <SlowComponent />
</Suspense>
```

### The READY Sink

Components control Suspense visibility through the built-in `READY` sink:

- **Components without explicit READY model entries** automatically emit `READY: true` on instantiation — they're immediately ready.
- **Components with READY model entries** start as not-ready and must explicitly signal readiness:

```jsx
function DataLoader({ state }) {
  return <div>{state.data ? JSON.stringify(state.data) : 'Waiting...'}</div>
}

DataLoader.intent = ({ DOM }) => ({
  DATA_LOADED: /* stream from API driver */,
})

DataLoader.model = {
  DATA_LOADED: {
    STATE: (state, data) => ({ ...state, data }),
    READY: () => true,  // Signal ready to parent Suspense
  },
}
```

Suspense boundaries can be nested — inner `<Suspense>` catches its own not-ready children without triggering the outer boundary.

---

## Disposal Hooks

Run cleanup logic when components unmount — close WebSocket connections, clear timers, disconnect observers.

### The `dispose$` Source

Every component's intent function receives a `dispose$` stream that emits `true` once when the component is being removed from the DOM:

```jsx
function LiveFeed({ state }) {
  return <div>{state.messages.length} messages</div>
}

LiveFeed.intent = ({ DOM, dispose$ }) => ({
  NEW_MESSAGE: /* stream from WebSocket driver */,
  CLEANUP: dispose$,
})

LiveFeed.model = {
  NEW_MESSAGE: (state, msg) => ({
    ...state,
    messages: [...state.messages, msg],
  }),
  CLEANUP: {
    WEBSOCKET: () => ({ type: 'close' }),  // Send close command to driver
  },
}
```

Internal subscriptions (context, sub-component sinks) are automatically cleaned up on disposal. The `dispose$` stream is for user-defined cleanup like closing external connections.

### Collection Item Disposal

Collection items are automatically disposed when removed from the state array. Each item's `dispose$` fires independently.

---

## Hot Module Replacement

Sygnal has built-in HMR support that preserves application state across code changes.

### Vite Setup

```javascript
// src/main.js
import { run } from 'sygnal'
import RootComponent from './RootComponent.jsx'

const { hmr, dispose } = run(RootComponent)

if (import.meta.hot) {
  import.meta.hot.accept('./RootComponent.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
```

### Webpack Setup

```javascript
import { run } from 'sygnal'
import RootComponent from './RootComponent'

const { hmr, dispose } = run(RootComponent)

if (module.hot) {
  module.hot.accept('./RootComponent', hmr)
  module.hot.dispose(dispose)
}
```

### How It Works

1. When a file changes, the bundler triggers the `accept` callback
2. Sygnal captures the current application state
3. The old application instance is disposed
4. A new instance is created with the updated code
5. The captured state is restored into the new instance

State is preserved across reloads via `window.__SYGNAL_HMR_PERSISTED_STATE`.

### TypeScript HMR

For TypeScript projects, you may need to cast the module:

```typescript
import { run } from 'sygnal'
import App from './app'

const { hmr } = run(App)

if (import.meta.hot) {
  import.meta.hot.accept('./app', (mod) => {
    hmr((mod as { default?: typeof App })?.default ?? App)
  })
}
```

---

## The classes() Utility

The `classes()` function builds CSS class strings safely from multiple input types:

```jsx
import { classes } from 'sygnal'

// Strings
classes('btn', 'primary')
// → 'btn primary'

// Arrays
classes(['btn', 'primary'])
// → 'btn primary'

// Objects (only truthy values are included)
classes({ active: true, disabled: false, highlighted: isHighlighted })
// → 'active' (if isHighlighted is false)
// → 'active highlighted' (if isHighlighted is true)

// Mixed
classes('btn', { active: isActive }, ['extra-class'])
// → 'btn active extra-class' (when isActive is true)
```

Object values can be booleans or functions that return booleans:

```jsx
classes({ visible: () => someCondition() })
```

Class names are validated and deduplicated automatically.

---

## Debugging

### Per-Component Debug

Enable debug logging for a specific component:

```jsx
MyComponent.debug = true
```

### Global Debug

Set the environment variable:

```
SYGNAL_DEBUG=true
```

### Debug Output

When enabled, Sygnal logs:
- Component instantiation with a unique component number
- Action triggers and the data they carry
- State changes before and after reducers
- Driver interactions

Each log entry is prefixed with the component number and name (e.g., `3 | MyComponent`) for easy identification.

---

## TypeScript

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
  SET_NAME: DOM.select('.input').events('input').map(e => (e.target as HTMLInputElement).value)
})

App.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  SET_NAME: (state, data) => ({ ...state, name: data })
}

export default App
```

### Component Type Parameters

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

### Typed Tiles Example (from 2048)

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

### exactState() Helper

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

---

## Astro Integration

Sygnal includes a first-class Astro integration for using Sygnal components in Astro sites.

### Setup

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

export default defineConfig({
  integrations: [sygnal()]
})
```

### Usage

Use Sygnal components in `.astro` files with client directives for hydration:

```astro
---
import Counter from '../components/Counter.jsx'
---

<Counter client:load />
<Counter client:visible />
<Counter client:idle />
```

### How It Works

- The server renders an empty placeholder
- The client-side code hydrates Sygnal components using `run()`
- Props passed in the Astro template are injected into the component
- Previous instances are cleaned up before rehydration

---

## Bundler Configuration

### Vite

Sygnal supports the automatic JSX transform, which is the modern standard used by React, Preact, Solid, and others. The bundler automatically inserts the necessary imports — no manual injection needed.

```javascript
// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'sygnal',
  }
})
```

For TypeScript projects, also add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "sygnal"
  }
}
```

### Other Bundlers

For Webpack, Rollup, or other bundlers that support the automatic JSX transform, configure them with `sygnal` as the JSX import source. The general pattern is:

```javascript
// General pattern (varies by bundler)
{
  jsx: 'automatic',           // or equivalent setting
  jsxImportSource: 'sygnal',  // or equivalent setting
}
```

<details>
<summary>Classic JSX transform (legacy, still supported)</summary>

If your bundler does not support the automatic JSX transform, you can use the classic transform:

```javascript
// vite.config.js
export default defineConfig({
  esbuild: {
    jsxInject: `import { jsx, Fragment } from 'sygnal/jsx'`,
    jsxFactory: 'jsx',
    jsxFragment: 'Fragment'
  }
})
```

Note: With the classic transform, some minifiers may rename the `Fragment` function, causing JSX fragments to break. To fix this with Vite, install terser and add:

```javascript
build: {
  minify: 'terser',
  terserOptions: {
    mangle: {
      reserved: ['Fragment']
    }
  }
}
```

This is not an issue with the automatic transform.
</details>

### Using Without JSX

If you prefer not to use JSX, use the `h()` function from Sygnal (re-exported from `@cycle/dom`):

```javascript
import { h } from 'sygnal'

function MyComponent({ state }) {
  return h('div', [
    h('h1', `Hello ${state.name}`),
    h('button.increment', 'Click me')
  ])
}
```

---

## Further Reading

- **[Getting Started](./getting-started.md)** — Quick setup and first steps
- **[API Reference](./api-reference.md)** — Complete reference for all exports
- **[Cycle.js Documentation](https://cycle.js.org/)** — The framework Sygnal is built on
- **[xstream Documentation](https://github.com/staltz/xstream)** — The Observable library used by Sygnal
- **[Sygnal ToDoMVC](https://github.com/tpresley/sygnal-todomvc)** ([Live Demo](https://tpresley.github.io/sygnal-todomvc/))
- **[Sygnal 2048](https://github.com/tpresley/sygnal-2048)** ([Live Demo](https://tpresley.github.io/sygnal-2048/))
- **[Sygnal Calculator](https://github.com/tpresley/sygnal-calculator)** ([Live Demo](https://tpresley.github.io/sygnal-calculator/))
