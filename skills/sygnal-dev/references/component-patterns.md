# Sygnal Component Patterns

Complete, copy-paste code patterns for all Sygnal features. Every pattern follows framework rules: pure views, complete state returns, driver-based side effects, no event handlers in JSX. Uses DOM shorthands and event stream helpers throughout.

## Table of Contents

1. [Minimal Component](#1-minimal-component)
2. [Interactive Component (Counter)](#2-interactive-component-counter)
3. [Two-Way Input Binding](#3-two-way-input-binding)
4. [Multi-Property State](#4-multi-property-state)
5. [Child Components with State Mapping](#5-child-components-with-state-mapping)
6. [State Lenses](#6-state-lenses)
7. [Collections (Lists)](#7-collections-lists)
8. [Switchable Views (Routing)](#8-switchable-views-routing)
9. [Form Handling with processForm()](#9-form-handling-with-processform)
10. [Context (Shared Values)](#10-context-shared-values)
11. [Calculated Fields](#11-calculated-fields)
12. [Peer Components](#12-peer-components)
13. [Chaining Actions with next()](#13-chaining-actions-with-next)
14. [Aborting Actions](#14-aborting-actions)
15. [Multi-Driver Actions](#15-multi-driver-actions)
16. [EFFECT Sink](#16-effect-sink)
17. [Model Shorthand](#17-model-shorthand)
18. [Event Bus Communication](#18-event-bus-communication)
19. [Parent-Child Communication](#19-parent-child-communication)
20. [Commands (Parent to Child)](#20-commands-parent-to-child)
21. [Custom Drivers with driverFromAsync()](#21-custom-drivers-with-driverfromasync)
22. [Custom Driver from Scratch](#22-custom-driver-from-scratch)
23. [BOOTSTRAP Action (On Mount)](#23-bootstrap-action-on-mount)
24. [Disposal Hooks](#24-disposal-hooks)
25. [Global DOM Events](#25-global-dom-events)
26. [Stream Operations in Intent](#26-stream-operations-in-intent)
27. [CSS Classes Utility](#27-css-classes-utility)
28. [Transitions](#28-transitions)
29. [Portals](#29-portals)
30. [Slots](#30-slots)
31. [Error Boundaries](#31-error-boundaries)
32. [Refs](#32-refs)
33. [Lazy Loading & Suspense](#33-lazy-loading--suspense)
34. [TypeScript Component](#34-typescript-component)
35. [TypeScript with exactState()](#35-typescript-with-exactstate)
36. [Full SPA Scaffold](#36-full-spa-scaffold)
37. [Astro Integration](#37-astro-integration)
38. [Vike Integration (SSR)](#38-vike-integration-ssr)

---

## 1. Minimal Component

```jsx
function HelloWorld() {
  return <div>Hello World</div>
}

export default HelloWorld
```

## 2. Interactive Component (Counter)

```jsx
function Counter({ state }) {
  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button className="increment">+</button>
      <button className="decrement">-</button>
    </div>
  )
}

Counter.initialState = { count: 0 }

Counter.intent = ({ DOM }) => ({
  INCREMENT: DOM.click('.increment'),
  DECREMENT: DOM.click('.decrement'),
})

Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  DECREMENT: (state) => ({ ...state, count: state.count - 1 }),
}

export default Counter
```

## 3. Two-Way Input Binding

```jsx
function Greeter({ state }) {
  return (
    <div>
      <h1>Hello {state.name}!</h1>
      <input className="name-input" value={state.name} />
    </div>
  )
}

Greeter.initialState = { name: 'World' }

Greeter.intent = ({ DOM }) => ({
  CHANGE_NAME: DOM.input('.name-input').value(),
})

Greeter.model = {
  CHANGE_NAME: (state, name) => ({ ...state, name }),
}

export default Greeter
```

## 4. Multi-Property State

Always spread existing state when updating a subset of properties:

```jsx
function UserCard({ state }) {
  return (
    <div>
      <h2>{state.name}</h2>
      <p>Age: {state.age}</p>
      <p>Score: {state.score}</p>
      <button className="birthday">Have Birthday</button>
      <button className="add-point">Add Point</button>
    </div>
  )
}

UserCard.initialState = { name: 'Alice', age: 25, score: 0 }

UserCard.intent = ({ DOM }) => ({
  BIRTHDAY: DOM.click('.birthday'),
  ADD_POINT: DOM.click('.add-point'),
})

UserCard.model = {
  BIRTHDAY: (state) => ({ ...state, age: state.age + 1 }),
  ADD_POINT: (state) => ({ ...state, score: state.score + 1 }),
}

export default UserCard
```

## 5. Child Components with State Mapping

```jsx
// UserProfile.jsx
function UserProfile({ state }) {
  return (
    <div>
      <h2>{state.name}</h2>
      <p>{state.email}</p>
    </div>
  )
}

export default UserProfile
```

```jsx
// RootComponent.jsx
import UserProfile from './components/UserProfile.jsx'

function RootComponent({ state }) {
  return (
    <div>
      <h1>App</h1>
      {/* UserProfile sees state.user as its root state */}
      <UserProfile state="user" />
    </div>
  )
}

RootComponent.initialState = {
  user: { name: 'Alice', email: 'alice@example.com' },
  settings: { theme: 'light' },
}

export default RootComponent
```

## 6. State Lenses

For custom parent-child state mapping:

```jsx
const userLens = {
  get: (parentState) => ({
    name: parentState.userName,
    email: parentState.userEmail,
  }),
  set: (parentState, childState) => ({
    ...parentState,
    userName: childState.name,
    userEmail: childState.email,
  }),
}

function RootComponent({ state }) {
  return (
    <div>
      <UserForm state={userLens} />
    </div>
  )
}
```

## 7. Collections (Lists)

```jsx
// TodoItem.jsx
import { classes } from 'sygnal'

function TodoItem({ state }) {
  return (
    <li className={classes({ done: state.done })}>
      <span>{state.text}</span>
      <button className="toggle">Toggle</button>
      <button className="remove">Remove</button>
    </li>
  )
}

TodoItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.click('.toggle'),
  REMOVE: DOM.click('.remove'),
})

TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  // Returning undefined removes the item from the collection
  REMOVE: () => undefined,
}

export default TodoItem
```

```jsx
// TodoList.jsx
import { Collection } from 'sygnal'
import TodoItem from './TodoItem.jsx'

function TodoList({ state }) {
  return (
    <div>
      <h1>Todos ({state.items.length})</h1>
      <Collection of={TodoItem} from="items" className="todo-list" />
    </div>
  )
}

TodoList.initialState = {
  items: [
    { id: 1, text: 'Learn Sygnal', done: false },
    { id: 2, text: 'Build something', done: false },
  ],
}

export default TodoList
```

### Collection with Filtering and Sorting

```jsx
<Collection
  of={TodoItem}
  from="items"
  filter={item => !item.done}
  sort="text"
  className="todo-list"
/>
```

## 8. Switchable Views (Routing)

```jsx
import { xs, Switchable } from 'sygnal'
import HomePage from './pages/HomePage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'

function RootComponent({ state }) {
  return (
    <div>
      <nav>
        <button className="nav-home">Home</button>
        <button className="nav-settings">Settings</button>
        <button className="nav-profile">Profile</button>
      </nav>
      <main>
        <Switchable
          of={{ home: HomePage, settings: SettingsPage, profile: ProfilePage }}
          current={state.route}
        />
      </main>
    </div>
  )
}

RootComponent.initialState = {
  route: 'home',
}

RootComponent.intent = ({ DOM }) => ({
  SET_ROUTE: xs.merge(
    DOM.click('.nav-home').mapTo('home'),
    DOM.click('.nav-settings').mapTo('settings'),
    DOM.click('.nav-profile').mapTo('profile'),
  ),
})

RootComponent.model = {
  SET_ROUTE: (state, route) => ({ ...state, route }),
}

export default RootComponent
```

## 9. Form Handling with processForm()

```jsx
import { processForm } from 'sygnal'

function ContactForm({ state }) {
  return (
    <form className="contact-form">
      <input name="name" value={state.name} />
      <input name="email" value={state.email} />
      <textarea name="message">{state.message}</textarea>
      <button type="submit">Send</button>
      {state.submitted && <p>Sent!</p>}
    </form>
  )
}

ContactForm.initialState = {
  name: '',
  email: '',
  message: '',
  submitted: false,
}

ContactForm.intent = ({ DOM }) => ({
  UPDATE_FIELDS: processForm(DOM.select('.contact-form'), { events: 'input' }),
  SUBMIT: processForm(DOM.select('.contact-form'), { events: 'submit' }),
})

ContactForm.model = {
  UPDATE_FIELDS: (state, data) => ({
    ...state,
    name: data.name,
    email: data.email,
    message: data.message,
  }),
  SUBMIT: (state) => ({ ...state, submitted: true }),
}

export default ContactForm
```

## 10. Context (Shared Values)

Context passes values to all descendants regardless of depth:

```jsx
// RootComponent.jsx
function RootComponent({ state }) {
  return (
    <div className={state.theme === 'dark' ? 'dark-mode' : ''}>
      <DeepChild state="childData" />
    </div>
  )
}

RootComponent.initialState = {
  theme: 'dark',
  currentUser: { name: 'Alice' },
  childData: { value: 42 },
}

RootComponent.context = {
  theme: (state) => state.theme,
  currentUser: (state) => state.currentUser,
}

export default RootComponent
```

```jsx
// DeepChild.jsx — can access context from any ancestor
function DeepChild({ state, context }) {
  return (
    <div>
      <p>Theme: {context.theme}</p>
      <p>User: {context.currentUser.name}</p>
      <p>Value: {state.value}</p>
    </div>
  )
}

export default DeepChild
```

## 11. Calculated Fields

Derived values computed from state, available in both view and reducers:

```jsx
function Cart({ state }) {
  return (
    <div>
      <p>Items: {state.itemCount}</p>
      <p>Total: ${state.total.toFixed(2)}</p>
      <p>Avg: ${state.averagePrice.toFixed(2)}</p>
    </div>
  )
}

Cart.initialState = {
  items: [
    { name: 'Widget', price: 9.99 },
    { name: 'Gadget', price: 24.99 },
  ],
}

Cart.calculated = {
  // Simple form — function of entire state
  itemCount: (state) => state.items.length,
  total: (state) => state.items.reduce((sum, item) => sum + item.price, 0),
  // With dependency tracking — only recalculates when deps change
  averagePrice: [['items'], (state) => {
    if (state.items.length === 0) return 0
    return state.items.reduce((sum, item) => sum + item.price, 0) / state.items.length
  }],
}

export default Cart
```

## 12. Peer Components

Peers are siblings that share the same sources — useful for splitting complex UIs:

```jsx
import Sidebar from './Sidebar.jsx'
import Toolbar from './Toolbar.jsx'

function Dashboard({ state, Sidebar, Toolbar }) {
  return (
    <div className="dashboard">
      {Toolbar}
      <div className="layout">
        {Sidebar}
        <main>{state.content}</main>
      </div>
    </div>
  )
}

Dashboard.peers = {
  Sidebar: Sidebar,
  Toolbar: Toolbar,
}

export default Dashboard
```

## 13. Chaining Actions with next()

```jsx
MyComponent.model = {
  SAVE: (state, data, next) => {
    next('VALIDATE', data)
    next('NOTIFY', 'Save started', 2000) // 2-second delay
    return { ...state, saving: true }
  },
  VALIDATE: (state, data) => ({ ...state, validated: true }),
  NOTIFY: {
    LOG: (state, data) => data,
  },
}
```

## 14. Aborting Actions

Return `ABORT` to cancel a state update:

```jsx
import { ABORT } from 'sygnal'

GameBoard.model = {
  MOVE: (state, direction) => {
    if (state.locked || state.gameOver) return ABORT
    return { ...state, position: calculateNewPosition(state.position, direction) }
  },
}
```

## 15. Multi-Driver Actions

Send commands to multiple drivers from a single action:

```jsx
MyComponent.model = {
  SAVE_ITEM: {
    STATE: (state, data) => ({ ...state, saving: true }),
    LOG: (state, data) => `Saving item: ${data.name}`,
    EVENTS: (state, data) => ({ type: 'item-saved', data }),
    API: (state, data) => ({ endpoint: 'items', method: 'POST', body: data }),
  },
}
```

### Passthrough with `true`

```jsx
MyComponent.model = {
  LOG_SOMETHING: {
    LOG: true, // intent data goes directly to LOG
  },
}
```

## 16. EFFECT Sink

Run side effects without state changes — no ABORT workarounds needed:

```jsx
import { createCommand } from 'sygnal'

const playerCmd = createCommand()

App.model = {
  // Simple effect — no state change
  SEND_COMMAND: {
    EFFECT: () => playerCmd.send('play'),
  },

  // Effect with conditional routing via next()
  ROUTE: {
    EFFECT: (state, data, next) => {
      if (state.mode === 'a') next('DO_A', data)
      else next('DO_B', data)
    },
  },

  // Effect combined with state update
  SAVE_AND_LOG: {
    STATE: (state) => ({ ...state, saved: true }),
    EFFECT: () => console.log('Saved!'),
  },
}
```

## 17. Model Shorthand

Compact syntax for single-driver model entries using `'ACTION | DRIVER'`:

```jsx
App.model = {
  'SEND_CMD | EFFECT': () => playerCmd.send('play'),
  'NOTIFY | EVENTS': (state) => ({ type: 'alert', data: state.message }),
  'DELETE | PARENT': (state) => ({ type: 'DELETE', id: state.id }),
}
```

This is equivalent to:

```jsx
App.model = {
  SEND_CMD: { EFFECT: () => playerCmd.send('play') },
  NOTIFY: { EVENTS: (state) => ({ type: 'alert', data: state.message }) },
  DELETE: { PARENT: (state) => ({ type: 'DELETE', id: state.id }) },
}
```

## 18. Event Bus Communication

Cross-component communication via the EVENTS driver (global, not isolated):

```jsx
// Publisher component
Publisher.intent = ({ DOM }) => ({
  NOTIFY: DOM.click('.notify-btn'),
})

Publisher.model = {
  NOTIFY: {
    EVENTS: (state) => ({ type: 'user-action', data: { action: 'clicked' } }),
  },
}

// Subscriber component (anywhere in the tree)
Subscriber.intent = ({ EVENTS }) => ({
  HANDLE_EVENT: EVENTS.select('user-action'),
})

Subscriber.model = {
  HANDLE_EVENT: (state, data) => ({ ...state, lastAction: data.action }),
}
```

## 19. Parent-Child Communication

Structured message passing from child to parent (one level up):

```jsx
// Child emits via PARENT sink
TaskCard.intent = ({ DOM }) => ({
  SELECT: DOM.click('.delete-btn'),
})

TaskCard.model = {
  SELECT: {
    PARENT: (state) => ({ type: 'SELECT', taskId: state.id }),
  },
}

// Parent receives via CHILD source (use component reference — minification-safe)
Lane.intent = ({ CHILD }) => ({
  TASK_SELECTED: CHILD.select(TaskCard).filter(e => e.type === 'SELECT'),
})

Lane.model = {
  TASK_SELECTED: (state, data) => ({
    ...state,
    selected: data.taskId,
  }),
}
```

## 20. Commands (Parent to Child)

Send imperative commands from parent to child:

```jsx
import { createCommand } from 'sygnal'

// Parent creates and passes command
const playerCmd = createCommand()

function Parent({ state }) {
  return (
    <div>
      <button className="play-btn">Play</button>
      <VideoPlayer commands={playerCmd} state="player" />
    </div>
  )
}

Parent.intent = ({ DOM }) => ({
  PLAY: DOM.click('.play-btn'),
})

Parent.model = {
  PLAY: {
    EFFECT: () => playerCmd.send('play'),
  },
}

// Child receives via commands$ source
VideoPlayer.intent = ({ commands$ }) => ({
  START_PLAYBACK: commands$.select('play'),
})

VideoPlayer.model = {
  START_PLAYBACK: (state) => ({ ...state, playing: true }),
}
```

## 21. Custom Drivers with driverFromAsync()

```jsx
import { run, driverFromAsync } from 'sygnal'

const apiDriver = driverFromAsync(
  async (url, options = {}) => {
    const response = await fetch(url, options)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  },
  {
    selector: 'endpoint',
    args: (cmd) => [cmd.url, cmd.options],
    return: 'data',
  }
)

run(RootComponent, { API: apiDriver })
```

```jsx
// Use in components
MyComponent.intent = ({ DOM, API }) => ({
  FETCH_USERS: DOM.click('.load-btn'),
  USERS_LOADED: API.select('users'),
})

MyComponent.model = {
  FETCH_USERS: {
    STATE: (state) => ({ ...state, loading: true }),
    API: () => ({ endpoint: 'users', url: '/api/users' }),
  },
  USERS_LOADED: (state, response) => ({
    ...state,
    loading: false,
    users: response.data,
  }),
}
```

## 22. Custom Driver from Scratch

```jsx
import { xs } from 'sygnal'

function localStorageDriver(sink$) {
  sink$.addListener({
    next: (command) => {
      if (command.action === 'set') {
        localStorage.setItem(command.key, JSON.stringify(command.value))
      } else if (command.action === 'remove') {
        localStorage.removeItem(command.key)
      }
    },
  })

  return {
    select: (key) => {
      return xs.create({
        start: (listener) => {
          const stored = localStorage.getItem(key)
          if (stored) {
            try { listener.next(JSON.parse(stored)) }
            catch { listener.next(stored) }
          }
        },
        stop: () => {},
      })
    },
  }
}

// Register: run(RootComponent, { STORAGE: localStorageDriver })
```

## 23. BOOTSTRAP Action (On Mount)

Runs once when the component is instantiated:

```jsx
MyComponent.model = {
  BOOTSTRAP: {
    EFFECT:  (state, data, next) => next('LOAD_DATA'),
  },
  LOAD_DATA: {
    STATE: (state) => ({ ...state, loading: true }),
    API: () => ({ endpoint: 'init', url: '/api/init' }),
  },
}
```

Other built-in actions:
- `INITIALIZE` — fires when the component receives its first state
- `HYDRATE` — fires on first state during HMR

## 24. Disposal Hooks

Cleanup on component unmount:

```jsx
MyComponent.intent = ({ DOM, dispose$ }) => ({
  CLICK: DOM.click('.btn'),
  CLEANUP: dispose$,
})

MyComponent.model = {
  CLICK: (state) => ({ ...state, clicked: true }),
  CLEANUP: {
    WEBSOCKET: () => ({ type: 'close' }),
    LOG: () => 'Component unmounted',
  },
}
```

## 25. Global DOM Events

Listen to events outside the component's isolated DOM scope:

```jsx
MyComponent.intent = ({ DOM }) => ({
  KEY_PRESS: DOM.select('document').events('keydown').map(e => e.key),
  RESIZE: DOM.select('document').events('resize').map(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  })),
  // CSS-filtered document events
  OUTSIDE_CLICK: DOM.select('document').select('.modal-overlay').events('click'),
})
```

## 26. Stream Operations in Intent

Common patterns for transforming streams:

```jsx
import { xs, debounce, throttle, delay, dropRepeats, sampleCombine } from 'sygnal'

MyComponent.intent = ({ DOM, STATE }) => {
  const click$ = DOM.click('.btn')
  const input$ = DOM.input('.search').value()

  return {
    // Debounce rapid input (wait 300ms of inactivity)
    SEARCH: input$.compose(debounce(300)),

    // Throttle scroll events to once per 200ms
    SCROLL: DOM.select('.container').events('scroll').compose(throttle(200)),

    // Merge multiple sources into one action
    NAVIGATE: xs.merge(
      DOM.click('.link-a').mapTo('pageA'),
      DOM.click('.link-b').mapTo('pageB'),
    ),

    // Map to a constant value
    RESET: DOM.click('.reset-btn').mapTo(null),

    // Filter by key using .key() helper
    ENTER_KEY: DOM.keydown('.input').key(k => k === 'Enter'),

    // Drop consecutive duplicates
    UNIQUE_INPUT: input$.compose(dropRepeats()),

    // Combine click with latest state
    CLICK_WITH_STATE: click$.compose(sampleCombine(STATE.stream)),

    // Delay emissions
    DELAYED: click$.compose(delay(500)),

    // Extract checkbox checked state
    TOGGLED: DOM.change('.checkbox').checked(),

    // Extract data attribute
    ITEM_CLICKED: DOM.click('.item').data('id', v => Number(v)),
  }
}
```

## 27. CSS Classes Utility

```jsx
import { classes } from 'sygnal'

function NavItem({ state }) {
  const className = classes(
    'nav-item',
    { active: state.isActive, disabled: state.isDisabled },
    state.variant && `nav-item-${state.variant}`,
  )

  return <li className={className}>{state.label}</li>
}
```

Accepts strings, arrays, and objects with boolean values.

## 28. Transitions

CSS-based enter/leave animations:

```jsx
import { Transition } from 'sygnal'

function Notification({ state }) {
  return (
    <Transition name="fade" duration={300}>
      {state.visible && <div className="notification">{state.message}</div>}
    </Transition>
  )
}
```

CSS classes applied automatically:
- `.fade-enter-from` → `.fade-enter-to` (with `.fade-enter-active`)
- `.fade-leave-from` → `.fade-leave-to` (with `.fade-leave-active`)

```css
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from { opacity: 0; }
.fade-enter-to   { opacity: 1; }
.fade-leave-from { opacity: 1; }
.fade-leave-to   { opacity: 0; }
```

### Transition in Collections (TodoMVC style)

```jsx
import { Transition, classes } from 'sygnal'

function TodoItem({ state }) {
  return (
    <Transition name="todo" duration={300}>
      <li className={classes({ completed: state.completed })}>
        <div className="view">
          <input className="toggle" type="checkbox" checked={!!state.completed} />
          <label>{state.title}</label>
          <button className="destroy" />
        </div>
      </li>
    </Transition>
  )
}
```

## 29. Portals

Render children into a different DOM container:

```jsx
import { Portal } from 'sygnal'

function App({ state }) {
  return (
    <div>
      <h1>Main content</h1>
      {state.showModal && (
        <Portal target="#modal-root">
          <div className="modal-overlay">
            <div className="modal">{state.modalContent}</div>
          </div>
        </Portal>
      )}
    </div>
  )
}
```

Note: If Portal content is outside the component's DOM scope use `DOM.select('document').events().filter()` for portal events.

## 30. Slots

Pass named content regions to child components:

```jsx
import { Slot } from 'sygnal'

// Parent passes slots
function App({ state }) {
  return (
    <Card state="card">
      <Slot name="header"><h2>Card Title</h2></Slot>
      <Slot name="actions"><button className="save">Save</button></Slot>
      <p>Default body content</p>
    </Card>
  )
}

// Child receives via slots prop
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

## 31. Error Boundaries

Catch and recover from rendering errors:

```jsx
function BrokenComponent({ state }) {
  return <div>{state.data.nested.value}</div>
}

BrokenComponent.onError = (error, { componentName }) => (
  <div className="error-fallback">
    Something went wrong in {componentName}
  </div>
)
```

Without `.onError`, components render an empty `<div data-sygnal-error>` and log to console.

## 32. Refs

Access DOM elements declaratively:

```jsx
import { createRef } from 'sygnal'

function AutoFocusInput({ state }) {
  const inputRef = createRef()
  return <input ref={inputRef} value={state.value} />
  // inputRef.current is the DOM element after mount
}
```

## 33. Lazy Loading & Suspense

Code-split components with loading boundaries:

```jsx
import { lazy, Suspense } from 'sygnal'

const HeavyChart = lazy(() => import('./HeavyChart.jsx'))

function Dashboard({ state }) {
  return (
    <div>
      <h1>Dashboard</h1>
      <Suspense fallback={<div className="loading">Loading chart...</div>}>
        <HeavyChart state="chartData" />
      </Suspense>
    </div>
  )
}
```

### Explicit READY control

```jsx
SlowComponent.model = {
  DATA_LOADED: {
    STATE: (state, data) => ({ ...state, data, loaded: true }),
    READY: () => true,  // signals parent Suspense that component is ready
  },
}
```

## 34. TypeScript Component

```tsx
import type { RootComponent } from 'sygnal'

type AppState = {
  count: number
  name: string
  items: string[]
}

type AppActions = {
  INCREMENT: null
  SET_NAME: string
  ADD_ITEM: string
}

const App: RootComponent<AppState, {}, AppActions> = ({ state }) => {
  return (
    <div>
      <h1>{state.name}: {state.count}</h1>
      <button className="increment">+</button>
      <input className="name-input" value={state.name} />
    </div>
  )
}

App.initialState = { count: 0, name: 'Counter', items: [] }

App.intent = ({ DOM }) => ({
  INCREMENT: DOM.click('.increment'),
  SET_NAME: DOM.input('.name-input').value(),
})

App.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  SET_NAME: (state, name) => ({ ...state, name }),
}

export default App
```

### Typed Child Component

```tsx
import type { Component } from 'sygnal'

type ItemState = { id: number; text: string; done: boolean }
type ItemProps = { showDelete: boolean }
type ItemActions = { TOGGLE: null; DELETE: null }

const Item: Component<ItemState, ItemProps, {}, ItemActions> = ({ state, showDelete }) => {
  return (
    <div className={state.done ? 'done' : ''}>
      <span>{state.text}</span>
      <button className="toggle">Toggle</button>
      {showDelete && <button className="delete">Delete</button>}
    </div>
  )
}

Item.intent = ({ DOM }) => ({
  TOGGLE: DOM.click('.toggle'),
  DELETE: DOM.click('.delete'),
})

Item.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
}

export default Item
```

## 35. TypeScript with exactState()

Enforce exact state shape — no extra properties allowed:

```tsx
import { exactState } from 'sygnal'

type GameState = {
  score: number
  lives: number
  level: number
  gameOver: boolean
}

const asGameState = exactState<GameState>()

Game.model = {
  SCORE_POINT: (state) => asGameState({
    ...state,
    score: state.score + 10,
    // TypeScript error if you add an unknown property here
  }),
  LOSE_LIFE: (state) => {
    if (state.lives <= 1) {
      return asGameState({ ...state, lives: 0, gameOver: true })
    }
    return asGameState({ ...state, lives: state.lives - 1 })
  },
}
```

## 36. Full SPA Scaffold

### vite.config.js

```javascript
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
})
```

### src/main.js

```javascript
import { run, driverFromAsync } from 'sygnal'
import App from './App.jsx'
import './style.css'

const apiDriver = driverFromAsync(
  async (url) => {
    const res = await fetch(url)
    return res.json()
  },
  { selector: 'endpoint', args: 'url', return: 'data' }
)

run(App, { API: apiDriver })
```

### src/App.jsx

```jsx
import { xs, Switchable, processForm } from 'sygnal'
import HomePage from './pages/HomePage.jsx'
import FormPage from './pages/FormPage.jsx'

function App({ state }) {
  return (
    <div className="app">
      <nav>
        <button className="nav-home">Home</button>
        <button className="nav-form">Form</button>
      </nav>
      {state.loading && <div className="loader">Loading...</div>}
      <Switchable
        of={{ home: HomePage, form: FormPage }}
        current={state.route}
      />
    </div>
  )
}

App.initialState = {
  route: 'home',
  loading: false,
  items: [],
}

App.intent = ({ DOM, API }) => ({
  SET_ROUTE: xs.merge(
    DOM.click('.nav-home').mapTo('home'),
    DOM.click('.nav-form').mapTo('form'),
  ),
  ITEMS_LOADED: API.select('items'),
})

App.model = {
  BOOTSTRAP: (state, data, next) => {
    next('LOAD_ITEMS')
    return state
  },
  SET_ROUTE: (state, route) => ({ ...state, route }),
  LOAD_ITEMS: {
    STATE: (state) => ({ ...state, loading: true }),
    API: () => ({ endpoint: 'items', url: '/api/items' }),
  },
  ITEMS_LOADED: (state, response) => ({
    ...state,
    loading: false,
    items: response.data,
  }),
}

export default App
```

## 37. Astro Integration

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
// src/pages/index.astro
import Counter from '../components/Counter.jsx'
---

<html>
  <body>
    <h1>My Astro + Sygnal Page</h1>
    <Counter client:load />
  </body>
</html>
```

Supported client directives: `client:load`, `client:visible`, `client:idle`.

## 38. Vike Integration (SSR)

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

```jsx
// pages/index/+Page.jsx
function Page({ state }) {
  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button className="increment">+</button>
    </div>
  )
}

Page.initialState = { count: 0 }

Page.intent = ({ DOM }) => ({
  INCREMENT: DOM.click('.increment'),
})

Page.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
}

export default Page
```

Pages are standard Sygnal components in `pages/*/+Page.jsx`. Supports `+Layout.jsx`, `+Head.jsx`, `+data.js`, and SPA mode via `ssr: false` in page config.
