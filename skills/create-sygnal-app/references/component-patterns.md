# Sygnal Component Patterns

Complete, copy-paste code patterns for all Sygnal features. Every pattern follows framework rules: pure views, complete state returns, driver-based side effects, no event handlers in JSX.

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
16. [Event Bus Communication](#16-event-bus-communication)
17. [Custom Drivers with driverFromAsync()](#17-custom-drivers-with-driverfromasync)
18. [Custom Driver from Scratch](#18-custom-driver-from-scratch)
19. [BOOTSTRAP Action (On Mount)](#19-bootstrap-action-on-mount)
20. [Global DOM Events](#20-global-dom-events)
21. [Stream Operations in Intent](#21-stream-operations-in-intent)
22. [CSS Classes Utility](#22-css-classes-utility)
23. [TypeScript Component](#23-typescript-component)
24. [TypeScript with exactState()](#24-typescript-with-exactstate)
25. [Full SPA Scaffold](#25-full-spa-scaffold)
26. [Astro Integration](#26-astro-integration)

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
  INCREMENT: DOM.select('.increment').events('click'),
  DECREMENT: DOM.select('.decrement').events('click')
})

Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  DECREMENT: (state) => ({ ...state, count: state.count - 1 })
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
  CHANGE_NAME: DOM.select('.name-input').events('input').map(e => e.target.value)
})

Greeter.model = {
  CHANGE_NAME: (state, data) => ({ ...state, name: data })
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
  BIRTHDAY: DOM.select('.birthday').events('click'),
  ADD_POINT: DOM.select('.add-point').events('click')
})

UserCard.model = {
  // ALWAYS use ...state to preserve other properties
  BIRTHDAY: (state) => ({ ...state, age: state.age + 1 }),
  ADD_POINT: (state) => ({ ...state, score: state.score + 1 })
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
  settings: { theme: 'light' }
}

export default RootComponent
```

## 6. State Lenses

For custom parent-child state mapping:

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
function TodoItem({ state }) {
  return (
    <li className={state.done ? 'done' : ''}>
      <span>{state.text}</span>
      <button className="toggle">Toggle</button>
      <button className="remove">Remove</button>
    </li>
  )
}

TodoItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.select('.toggle').events('click'),
  REMOVE: DOM.select('.remove').events('click')
})

TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  // Returning undefined removes the item from the collection
  REMOVE: () => undefined
}

export default TodoItem
```

```jsx
// TodoList.jsx
import TodoItem from './TodoItem.jsx'

function TodoList({ state }) {
  return (
    <div>
      <h1>Todos ({state.items.length})</h1>
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

export default TodoList
```

### Collection with Filtering and Sorting

```jsx
<collection
  of={TodoItem}
  from="items"
  filter={item => !item.done}
  sort="text"
  className="todo-list"
/>
```

### Using Capitalized Collection

```jsx
import { Collection } from 'sygnal'

<Collection of={TodoItem} from="items" className="todo-list" />
```

## 8. Switchable Views (Routing)

```jsx
import { xs } from 'sygnal'
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
        <switchable
          of={{ home: HomePage, settings: SettingsPage, profile: ProfilePage }}
          current={state.route}
        />
      </main>
    </div>
  )
}

RootComponent.initialState = {
  route: 'home'
}

RootComponent.intent = ({ DOM }) => ({
  SET_ROUTE: xs.merge(
    DOM.select('.nav-home').events('click').mapTo('home'),
    DOM.select('.nav-settings').events('click').mapTo('settings'),
    DOM.select('.nav-profile').events('click').mapTo('profile')
  )
})

RootComponent.model = {
  SET_ROUTE: (state, route) => ({ ...state, route })
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
  submitted: false
}

ContactForm.intent = ({ DOM }) => ({
  UPDATE_FIELDS: processForm(DOM.select('.contact-form'), { events: 'input' }),
  SUBMIT: processForm(DOM.select('.contact-form'), { events: 'submit' })
})

ContactForm.model = {
  UPDATE_FIELDS: (state, data) => ({
    ...state,
    name: data.name,
    email: data.email,
    message: data.message
  }),
  SUBMIT: (state, data) => ({
    ...state,
    submitted: true
  })
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
  childData: { value: 42 }
}

// Context is defined as functions that derive values from state
RootComponent.context = {
  theme: (state) => state.theme,
  currentUser: (state) => state.currentUser
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

### Context in Reducers

```jsx
DeepChild.model = {
  SOME_ACTION: {
    LOG: (state, data, next, extra) => {
      return `Current user: ${extra.context.currentUser.name}`
    }
  }
}
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
    { name: 'Gadget', price: 24.99 }
  ]
}

Cart.calculated = {
  itemCount: (state) => state.items.length,
  total: (state) => state.items.reduce((sum, item) => sum + item.price, 0),
  averagePrice: (state) => {
    if (state.items.length === 0) return 0
    return state.items.reduce((sum, item) => sum + item.price, 0) / state.items.length
  }
}

export default Cart
```

To prevent calculated fields from being stored in the actual state tree:

```jsx
Cart.storeCalculatedInState = false
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
  Toolbar: Toolbar
}

export default Dashboard
```

## 13. Chaining Actions with next()

```jsx
MyComponent.model = {
  SAVE: (state, data, next) => {
    // Trigger VALIDATE immediately after this reducer completes
    next('VALIDATE', data)
    // Trigger NOTIFY after a 2-second delay
    next('NOTIFY', 'Save started', 2000)
    return { ...state, saving: true }
  },
  VALIDATE: (state, data) => ({ ...state, validated: true }),
  NOTIFY: {
    LOG: (state, data) => data
  }
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
  }
}
```

## 15. Multi-Driver Actions

Send commands to multiple drivers from a single action:

```jsx
MyComponent.model = {
  SAVE_ITEM: {
    // Update state
    STATE: (state, data) => ({ ...state, saving: true }),
    // Log to console
    LOG: (state, data) => `Saving item: ${data.name}`,
    // Dispatch custom event
    EVENTS: (state, data) => ({ type: 'item-saved', data }),
    // Send to custom API driver
    API: (state, data) => ({ endpoint: 'items', method: 'POST', body: data })
  }
}
```

### Passthrough with `true`

Setting a driver sink to `true` passes the intent data through as-is:

```jsx
MyComponent.model = {
  LOG_SOMETHING: {
    LOG: true  // whatever data came from intent goes directly to LOG
  }
}
```

## 16. Event Bus Communication

Cross-component communication via the EVENTS driver:

```jsx
// Publisher component
Publisher.model = {
  NOTIFY: {
    EVENTS: (state, data) => ({ type: 'user-action', data: { action: 'clicked' } })
  }
}

// Subscriber component
Subscriber.intent = ({ EVENTS }) => ({
  HANDLE_EVENT: EVENTS.select('user-action')
})

Subscriber.model = {
  HANDLE_EVENT: (state, data) => ({ ...state, lastAction: data.action })
}
```

## 17. Custom Drivers with driverFromAsync()

Wrap any async function as a Cycle.js driver:

```jsx
import { run, driverFromAsync } from 'sygnal'

// Create the driver
const apiDriver = driverFromAsync(
  async (url, options = {}) => {
    const response = await fetch(url, options)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  },
  {
    selector: 'endpoint',      // categorize requests/responses
    args: (cmd) => [cmd.url, cmd.options],  // extract function args
    return: 'data',            // wrap result in { data: result }
    post: (result, cmd) => ({  // post-process before sending to source
      ...result,
      requestedAt: Date.now()
    })
  }
)

// Register it
run(RootComponent, { API: apiDriver })
```

```jsx
// Use in components
MyComponent.intent = ({ DOM, API }) => ({
  FETCH_USERS: DOM.select('.load-btn').events('click'),
  USERS_LOADED: API.select('users')
})

MyComponent.model = {
  FETCH_USERS: {
    STATE: (state) => ({ ...state, loading: true }),
    API: () => ({ endpoint: 'users', url: '/api/users' })
  },
  USERS_LOADED: (state, response) => ({
    ...state,
    loading: false,
    users: response.data
  })
}
```

## 18. Custom Driver from Scratch

For full control over driver behavior:

```jsx
import xs from 'xstream'

function localStorageDriver(sink$) {
  sink$.addListener({
    next: (command) => {
      if (command.action === 'set') {
        localStorage.setItem(command.key, JSON.stringify(command.value))
      } else if (command.action === 'remove') {
        localStorage.removeItem(command.key)
      }
    }
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
        stop: () => {}
      })
    }
  }
}

// Register: run(RootComponent, { STORAGE: localStorageDriver })
```

## 19. BOOTSTRAP Action (On Mount)

Runs once when the component is instantiated (like React's `useEffect(() => {}, [])`):

```jsx
MyComponent.model = {
  BOOTSTRAP: {
    STATE: (state, data, next) => {
      next('LOAD_DATA')
      return state
    },
    LOG: () => 'Component mounted!'
  },
  LOAD_DATA: {
    STATE: (state) => ({ ...state, loading: true }),
    API: () => ({ endpoint: 'init', url: '/api/init' })
  }
}
```

## 20. Global DOM Events

To listen to events outside the component's isolated DOM scope:

```jsx
MyComponent.intent = ({ DOM }) => ({
  // Listen to keydown on the entire document
  KEY_PRESS: DOM.select('document').events('keydown').map(e => e.key),

  // Listen to window resize
  RESIZE: DOM.select('document').events('resize').map(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))
})
```

## 21. Stream Operations in Intent

Common patterns for transforming streams:

```jsx
import { xs, debounce, throttle, delay, dropRepeats, sampleCombine } from 'sygnal'

MyComponent.intent = ({ DOM, STATE }) => {
  const click$ = DOM.select('.btn').events('click')
  const input$ = DOM.select('.search').events('input').map(e => e.target.value)

  return {
    // Debounce rapid input (wait 300ms of inactivity)
    SEARCH: input$.compose(debounce(300)),

    // Throttle scroll events to once per 200ms
    SCROLL: DOM.select('.container').events('scroll').compose(throttle(200)),

    // Merge multiple sources into one action
    NAVIGATE: xs.merge(
      DOM.select('.link-a').events('click').mapTo('pageA'),
      DOM.select('.link-b').events('click').mapTo('pageB')
    ),

    // Map to a constant value
    RESET: DOM.select('.reset-btn').events('click').mapTo(null),

    // Filter events
    ENTER_KEY: DOM.select('.input').events('keydown').filter(e => e.key === 'Enter'),

    // Drop consecutive duplicates
    UNIQUE_INPUT: input$.compose(dropRepeats()),

    // Combine click with latest state
    CLICK_WITH_STATE: click$.compose(sampleCombine(STATE.stream)),

    // Delay emissions
    DELAYED: click$.compose(delay(500))
  }
}
```

## 22. CSS Classes Utility

```jsx
import { classes } from 'sygnal'

function NavItem({ state }) {
  const className = classes(
    'nav-item',
    { active: state.isActive, disabled: state.isDisabled },
    state.variant && `nav-item-${state.variant}`
  )

  return <li className={className}>{state.label}</li>
}
```

Accepts strings, arrays, and objects with boolean/function values.

## 23. TypeScript Component

```tsx
import { xs } from 'sygnal'
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
      <ul>
        {state.items.map(item => <li>{item}</li>)}
      </ul>
    </div>
  )
}

App.initialState = { count: 0, name: 'Counter', items: [] }

App.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click'),
  SET_NAME: DOM.select('.name-input').events('input')
    .map(e => (e.target as HTMLInputElement).value)
})

App.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  SET_NAME: (state, data) => ({ ...state, name: data })
}

export default App
```

### Typed Child Component

```tsx
import type { Component } from 'sygnal'

type ItemState = { id: number; text: string; done: boolean }
type ItemActions = { TOGGLE: null; DELETE: null }

const Item: Component<ItemState, any, any, ItemActions> = (_props, state) => {
  return (
    <div className={state.done ? 'done' : ''}>
      <span>{state.text}</span>
      <button className="toggle">Toggle</button>
      <button className="delete">Delete</button>
    </div>
  )
}

Item.intent = ({ DOM }) => ({
  TOGGLE: DOM.select('.toggle').events('click'),
  DELETE: DOM.select('.delete').events('click')
})

Item.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined
}

export default Item
```

## 24. TypeScript with exactState()

Enforce exact state shape — no extra properties allowed:

```tsx
import { exactState, ABORT } from 'sygnal'

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
    score: state.score + 10
    // TypeScript error if you add an unknown property here
  }),
  LOSE_LIFE: (state) => {
    if (state.lives <= 1) {
      return asGameState({ ...state, lives: 0, gameOver: true })
    }
    return asGameState({ ...state, lives: state.lives - 1 })
  }
}
```

## 25. Full SPA Scaffold

Complete application with routing, data loading, and form handling:

```jsx
// src/main.js
import { run, driverFromAsync } from 'sygnal'
import RootComponent from './RootComponent.jsx'

const apiDriver = driverFromAsync(
  async (url) => {
    const res = await fetch(url)
    return res.json()
  },
  { selector: 'endpoint', args: 'url', return: 'data' }
)

const { hmr, dispose } = run(RootComponent, { API: apiDriver })

if (import.meta.hot) {
  import.meta.hot.accept('./RootComponent.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
```

```jsx
// src/RootComponent.jsx
import { xs, processForm } from 'sygnal'
import HomePage from './pages/HomePage.jsx'
import FormPage from './pages/FormPage.jsx'

function RootComponent({ state }) {
  return (
    <div className="app">
      <nav>
        <button className="nav-home">Home</button>
        <button className="nav-form">Form</button>
      </nav>
      {state.loading && <div className="loader">Loading...</div>}
      <switchable
        of={{ home: HomePage, form: FormPage }}
        current={state.route}
      />
    </div>
  )
}

RootComponent.initialState = {
  route: 'home',
  loading: false,
  items: [],
  formData: { name: '', email: '' }
}

RootComponent.intent = ({ DOM, API }) => ({
  SET_ROUTE: xs.merge(
    DOM.select('.nav-home').events('click').mapTo('home'),
    DOM.select('.nav-form').events('click').mapTo('form')
  ),
  LOAD_ITEMS: DOM.select('.load-items').events('click'),
  ITEMS_LOADED: API.select('items')
})

RootComponent.model = {
  BOOTSTRAP: (state, data, next) => {
    next('LOAD_ITEMS')
    return state
  },
  SET_ROUTE: (state, route) => ({ ...state, route }),
  LOAD_ITEMS: {
    STATE: (state) => ({ ...state, loading: true }),
    API: () => ({ endpoint: 'items', url: '/api/items' })
  },
  ITEMS_LOADED: (state, response) => ({
    ...state,
    loading: false,
    items: response.data
  })
}

export default RootComponent
```

## 26. Astro Integration

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

export default defineConfig({
  integrations: [sygnal()]
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
