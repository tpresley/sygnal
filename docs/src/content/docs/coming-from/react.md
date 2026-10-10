---
title: Sygnal for React Developers
description: What carries over from React, what's different, and the Sygnal version of the React patterns you already know, with every Sygnal sample live
---

You already know most of what a Sygnal component is made of: JSX, function components, props, keys, and a virtual DOM that patches the page. This page maps the React habits you have onto Sygnal and explains the few places where Sygnal thinks differently. Every Sygnal sample on the page runs: edit it and the result updates.

**The short version:** if you've used `useReducer` or Redux, you already know Sygnal's core idea. A component's state changes only through named actions handled by pure reducers. What's new is that the rest follows the same rule: clicks, timers, fetches and messages to the parent are all actions too, so a component has no hooks and no effects.

## What carries over

- **JSX and function components.** A view is a function of its props that returns JSX. `className`, `style`, `key` and fragments work as you expect.
- **Props.** A parent passes props; the child reads them from its first argument: `function Rating({ value, max })`.
- **Familiar names**: `<Suspense>` and `lazy()`, `<Portal>`, error boundaries (an `onError` on any component), refs (`createRef()`).
- **Vite and TypeScript.** `npm create sygnal-app` scaffolds a Vite project; Vike and Astro cover server rendering.

## At a glance

| In React you'd use… | In Sygnal | Guide |
|---|---|---|
| `useState` | `initialState`, plus a `model` entry per action | [State](/guide/state/), [Model](/guide/model/) |
| `useReducer`, Redux reducers | the `model`: one reducer per action name, one state tree | [Model](/guide/model/) |
| `onClick={…}` in JSX | an `intent` entry: `DOM.click('.save')` | [Intent](/guide/intent/) |
| `<input value onChange>` | `value={state.x}` + `DOM.input('.x').value()` | [Inputs](/guide/inputs/) |
| `useMemo`, derived values | `calculated` fields | [Calculated Fields](/guide/calculated-fields/) |
| `useEffect(() => …, [])` | the `BOOTSTRAP` action | [Model](/guide/model/#built-in-actions) |
| an effect's cleanup | the `DISPOSE` action | [Disposal Hooks](/advanced/disposal/) |
| `useEffect` for a side effect | an `EFFECT` sink, or a driver | [Effect Handlers](/advanced/effect/), [Drivers](/guide/drivers/) |
| `setInterval` in an effect | the `timers` static | [Timers](/guide/timers/) |
| `fetch` in an effect, React Query's `useQuery` | the `resources` static | [Resources and Caching](/guide/resources/) |
| a mutation, `setQueryData` | an `HTTP` sink with reply actions, `updates`, `invalidates` | [HTTP](/guide/http/) |
| callback props (`onRemove`) | the child's `PARENT` sink, `CHILD.select(Child)` in the parent | [Parent-Child](/guide/parent-child/) |
| lifting state up | the state is already up: one tree, and `state="key"` gives a child a slice | [State](/guide/state/) |
| `items.map(i => <Item key={i.id} />)` | `<Collection of={Item} from="items" />` | [Collections](/guide/collections/) |
| `createContext`, `useContext` | the `.context` static | [Context](/guide/context/) |
| a store shared by distant components | the `EVENTS` bus | [Drivers](/guide/drivers/#the-event-bus-events-driver) |
| custom hooks | behaviors (`defineBehavior`, `uses`) | [Behaviors](/guide/behaviors/) |
| `useRef` + `.focus()` | `autoFocus`, the `ELEMENT` sink, `createRef()` | [Inputs](/guide/inputs/), [Element Commands](/guide/element-commands/), [Refs](/advanced/refs/) |
| `createPortal` | `<Portal>` | [Portals](/advanced/portals/) |
| `React.lazy` + `<Suspense>` | `lazy()` + `<Suspense>` | [Lazy Loading](/advanced/lazy-loading/), [Suspense](/advanced/suspense/) |
| an error boundary class | `.onError` on any component | [Error Boundaries](/advanced/error-boundaries/) |
| React Hook Form, Formik | the `form` behavior | [Forms](/guide/forms/) |
| React Router | `makeRouter()` and the `route` static | [Router](/guide/router/) |
| `localStorage` in an effect | `persist()` | [Persistence](/guide/persistence/) |
| React Testing Library | `renderComponent()` | [Testing](/integration/testing/) |
| Next.js | Vike or Astro | [Vike](/integration/vike/), [Astro](/integration/astro/) |
| one React component you can't replace | `fromReact()` | [Adapters](/guide/adapters/) |

The rest of the page covers the five differences behind most of that table.

## 1. Events are named in `intent`, not bound in JSX

In React, a handler is attached to the element in the JSX:

<!-- docs-check: skip -->
```jsx title="React"
function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <button onClick={() => setCount((c) => c - 1)}>−</button>
      <span>{count}</span>
      <button onClick={() => setCount((c) => c + 1)}>+</button>
    </div>
  )
}
```

In Sygnal the view only describes the page. The component's `intent` names each action and the event that triggers it, and its `model` says what each action does to the state:

```jsx live
function Counter({ state }) {
  return (
    <div>
      <button className="dec" aria-label="Decrement">−</button>
      <span>{state.count}</span>
      <button className="inc" aria-label="Increment">+</button>
    </div>
  )
}

Counter.initialState = { count: 0 }

Counter.intent = ({ DOM }) => ({
  DEC: DOM.click('.dec'),
  INC: DOM.click('.inc'),
})

Counter.model = {
  DEC: (state) => ({ ...state, count: state.count - 1 }),
  INC: (state) => ({ ...state, count: state.count + 1 }),
}
```

- **The class is the link** between the view and the intent: `DOM.click('.inc')` hears clicks on the element with `className="inc"`.
- **The view is a plain function of state.** It creates no closures and holds no state; it can be rendered on a server or in a test without running anything else.
- **An action is data.** `INC` is a name with an optional value; it shows up in the [devtools](/integration/debugging/) action log, and a test can dispatch it directly.

:::tip[Where Sygnal helps]
Every way a component can change is listed in one place, its `intent`. Reading an unfamiliar component means reading one object, not searching the JSX for handlers.
:::

:::caution
`onClick={…}` in a Sygnal view does nothing: no listener is attached and no warning is printed. Name the element with a class and add an intent entry instead.
:::

## 2. State changes are reducers, keyed by action

With `useState`, each setter is called from the handler that needs it. A Sygnal component has one `model`: for each action name, a pure function from the current state to the next one, like a `useReducer` reducer split by action type.

<!-- docs-check: skip -->
```jsx title="React"
function Todos() {
  const [draft, setDraft] = useState('')
  const [todos, setTodos] = useState([])
  const add = () => {
    if (!draft.trim()) return
    setTodos([...todos, { id: Date.now(), text: draft.trim(), done: false }])
    setDraft('')
  }
  return (
    <div>
      <label>New todo <input value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
      <button onClick={add}>Add</button>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input type="checkbox" checked={todo.done}
                onChange={() => setTodos(todos.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)))} />
              {todo.text}
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

```jsx live
import { ABORT } from 'sygnal'

function Todos({ state }) {
  return (
    <div>
      <label>New todo <input className="draft" value={state.draft} /></label>
      <button className="add">Add</button>
      <ul>
        {state.todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input type="checkbox" className="done" data={{ id: todo.id }} checked={todo.done} />
              {todo.text}
            </label>
          </li>
        ))}
      </ul>
      <p>{state.todos.filter((todo) => !todo.done).length} left</p>
    </div>
  )
}

Todos.initialState = { draft: '', nextId: 1, todos: [] }

Todos.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.draft').value(),
  ADD: DOM.click('.add'),
  TOGGLE: DOM.change('.done').data('id', Number),
})

Todos.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state) => {
    const text = state.draft.trim()
    if (!text) return ABORT
    return { ...state, draft: '', nextId: state.nextId + 1, todos: [...state.todos, { id: state.nextId, text, done: false }] }
  },
  TOGGLE: (state, id) => ({
    ...state,
    todos: state.todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)),
  }),
}
```

- **A controlled input works like React's**: `value={state.draft}` writes the value on every render, and the `DRAFT` action keeps the state in step as the user types.
- **`data={{ id }}` and `.data('id', Number)`** carry the row's id from the view to the action, where React would close over `todo.id` in a handler.
- **`ABORT`** means "no change": nothing re-renders.
- The second argument of a reducer is the action's value: the text for `DRAFT`, the id for `TOGGLE`.

:::tip[Where Sygnal helps]
A reducer always receives the current state, so there are no stale closures and no need for the `setTodos((todos) => …)` form. Reducers are plain functions: you can test `Todos.model.ADD(state)` without rendering anything.
:::

## 3. Side effects are sinks, not hooks

A React component reaches the outside world from effects. A Sygnal component never does: it *declares* what it needs, or returns a request from a model entry, and a **driver** does the work and sends the result back as an action. Drivers are set up once in `run(App, drivers)`; on this page the demos get an `HTTP` and a `TIMER` driver automatically.

### Fetching data

<!-- docs-check: skip -->
```jsx title="React"
function Quote() {
  const [id, setId] = useState(1)
  const [quote, setQuote] = useState({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    setQuote({ status: 'loading' })
    fetch(`/api/quotes/${id}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data) => setQuote({ status: 'success', data }))
      .catch((error) => error.name !== 'AbortError' && setQuote({ status: 'error', error }))
    return () => controller.abort()
  }, [id])
  return (
    <div>
      <button onClick={() => setId(id + 1)}>Next</button>
      <p>{quote.status === 'loading' ? 'Loading…' : quote.status === 'error' ? 'No such quote.' : quote.data.text}</p>
    </div>
  )
}
```

A Sygnal component declares the request it needs, computed from its state, in its `resources`. The fetch driver sends it, aborts it when the request changes, and keeps `state.quote` up to date. A stand-in server answers for quotes 1 to 3:

```js live-server
const quotes = { 1: 'Start where you are.', 2: 'Less, but better.', 3: 'Done is done.' }

export default {
  'GET /api/quotes/:id': ({ params }) => (quotes[params.id]
    ? { json: { id: Number(params.id), text: quotes[params.id] }, delayMs: 800 }
    : { status: 404, json: { message: 'No such quote' }, delayMs: 400 }),
}
```

```jsx live
function Quote({ state }) {
  const { status, data } = state.quote
  return (
    <div>
      <button className="next">Next</button>
      <p>{status === 'loading' ? 'Loading…' : status === 'error' ? 'No such quote.' : data?.text}</p>
    </div>
  )
}

Quote.initialState = { id: 1 }

Quote.resources = {
  quote: (state) => `/api/quotes/${state.id}`,
}

Quote.intent = ({ DOM }) => ({ NEXT: DOM.click('.next') })

Quote.model = {
  NEXT: (state) => ({ ...state, id: state.id + 1 }),
}
```

Click Next past quote 3 to see the error state, or click it twice quickly: the first request is aborted.

- `state.quote` is `{ status, data, error, refreshing }`: no loading flags to write.
- Add `queryCache()` to the driver for what React Query adds: caching, request sharing, refetch on focus. See [Resources and Caching](/guide/resources/).
- A write (a POST, a PUT) is an `HTTP` sink in a model entry, with actions for the reply. See [HTTP](/guide/http/).

:::tip[Where Sygnal helps]
No dependency array to keep in sync, no cleanup to forget, no response arriving for a request that's no longer wanted. The request is a function of state, so when the state changes, the old request is aborted.
:::

### Timers

<!-- docs-check: skip -->
```jsx title="React"
function Timer() {
  const [running, setRunning] = useState(false)
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [running])
  return (
    <div>
      <p>{seconds} s</p>
      <button onClick={() => setRunning(!running)}>{running ? 'Pause' : 'Start'}</button>
    </div>
  )
}
```

```jsx live
import { toggle } from 'sygnal'

function Timer({ state }) {
  return (
    <div>
      <p>{state.seconds} s</p>
      <button className="toggle">{state.running ? 'Pause' : 'Start'}</button>
    </div>
  )
}

Timer.initialState = { running: false, seconds: 0 }

Timer.timers = (state) => ({
  tick: state.running && { every: 1000, action: 'TICK' },
})

Timer.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })

Timer.model = {
  TOGGLE: toggle('running'),
  TICK: (state) => ({ ...state, seconds: state.seconds + 1 }),
}
```

Like `resources`, `timers` is computed from the state: while `state.running` is true there's an interval, and when it turns false the interval stops. The component also stops it when it unmounts. See [Timers](/guide/timers/).

### Other effects

| React | Sygnal |
|---|---|
| `useEffect(() => { … }, [])` to start something | the `BOOTSTRAP` action: a model entry that runs once after the first render |
| `localStorage` read in `useState`, written in `useEffect` | `App.persist = persist({ key: 'app', pick: ['todos'] })` ([Persistence](/guide/persistence/)) |
| `document.title = …` in an effect | the `head` static ([Document Head](/guide/head/)) |
| a one-off imperative call (analytics, clipboard) | an `EFFECT` sink on a model entry ([Effect Handlers](/advanced/effect/)) |
| `ref.current.focus()` | `ELEMENT: { focus: '.title' }` on a model entry ([Element Commands](/guide/element-commands/)) |
| a WebSocket in an effect | the `connections` static ([Sockets](/guide/sockets/)) |

## 4. Data goes up as actions, not callbacks

In React, a child reports to its parent by calling a function prop:

<!-- docs-check: skip -->
```jsx title="React"
function TaskItem({ task, onPick, onRemove }) {
  return (
    <li>
      {task.title} <button onClick={() => onPick(task.id)}>Pick</button>
      <button onClick={() => onRemove(task.id)}>Remove</button>
    </li>
  )
}

function TaskList() {
  const [tasks, setTasks] = useState([{ id: 1, title: 'Write' }, { id: 2, title: 'Test' }, { id: 3, title: 'Ship' }])
  const [picked, setPicked] = useState(null)
  return (
    <div>
      <p>Picked: {picked ?? 'none'}</p>
      <ul>
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} onPick={setPicked}
            onRemove={(id) => setTasks(tasks.filter((t) => t.id !== id))} />
        ))}
      </ul>
    </div>
  )
}
```

A Sygnal child sends a value up through its `PARENT` sink, and the parent reads it with `CHILD.select(Child)` in its intent. A list of components is a `<Collection>`: each item gets one element of the array as its state, and an item removes itself by returning `undefined`:

```jsx live
import { Collection } from 'sygnal'

function TaskItem({ state }) {
  return (
    <li>
      {state.title} <button className="pick">Pick</button> <button className="remove">Remove</button>
    </li>
  )
}

TaskItem.intent = ({ DOM }) => ({
  PICK: DOM.click('.pick'),
  REMOVE: DOM.click('.remove'),
})

TaskItem.model = {
  PICK: { PARENT: (state) => ({ id: state.id }) },
  REMOVE: () => undefined,
}

function TaskList({ state }) {
  return (
    <div>
      <p>Picked: {state.picked ?? 'none'}</p>
      <ul>
        <Collection of={TaskItem} from="tasks" />
      </ul>
    </div>
  )
}

TaskList.initialState = {
  picked: null,
  tasks: [{ id: 1, title: 'Write' }, { id: 2, title: 'Test' }, { id: 3, title: 'Ship' }],
}

TaskList.intent = ({ CHILD }) => ({
  PICKED: CHILD.select(TaskItem),
})

TaskList.model = {
  PICKED: (state, { id }) => ({ ...state, picked: id }),
}

export default TaskList
```

- **A parent can't listen to a child's elements.** `DOM.click('.remove')` in `TaskList` would never fire: a component's `DOM` sees only the elements its own view renders. Handle the click in the child and send the result up. In development, Sygnal reports this mistake as [SYG104](/reference/errors/#syg104).
- **Items are keyed by `id`**, so you don't write `key` props for a Collection. `filter` and `sort` props change what's shown without touching the array.
- **Siblings far apart** (a toolbar and a status bar) talk through the `EVENTS` bus instead of a shared store: one sends `event('SAVED', data)`, the other listens with `EVENTS.select('SAVED')`. See [Drivers](/guide/drivers/#the-event-bus-events-driver).
- Props still flow down as usual: `<TaskItem>` inside a Collection gets its item as `state`, and any other component gets the props you pass.

:::tip[Where Sygnal helps]
`TaskItem` updates and removes its own array element: the parent has no `onRemove` handler and no `filter` to write. The parent only handles what it cares about (the pick).
:::

## 5. One state tree; children get slices

In React, state lives in the component that owns it, and you lift it up when two components need it. In Sygnal there's one state tree, kept by the root component, and a child sees the parent's state, or a slice of it with `state="key"`. A child can change its slice directly, and the parent sees the change at once: no callback, no lifting.

<!-- docs-check: skip -->
```jsx title="React"
const LimitContext = createContext(false)

function Stepper({ label, value, onChange }) {
  const full = useContext(LimitContext)
  return (
    <p>
      {label}: {value}{' '}
      <button aria-label={`Fewer ${label}`} disabled={value === 0} onClick={() => onChange(value - 1)}>−</button>
      <button aria-label={`More ${label}`} disabled={full} onClick={() => onChange(value + 1)}>+</button>
    </p>
  )
}

function Booking() {
  const [adults, setAdults] = useState(2)
  const [kids, setKids] = useState(0)
  const guests = useMemo(() => adults + kids, [adults, kids])
  return (
    <LimitContext.Provider value={guests >= 6}>
      <Stepper label="Adults" value={adults} onChange={setAdults} />
      <Stepper label="Children" value={kids} onChange={setKids} />
      <p>{guests} guests{guests >= 6 && ' (the maximum)'}</p>
    </LimitContext.Provider>
  )
}
```

```jsx live
function Stepper({ state, context, label }) {
  return (
    <p>
      {label}: {state.count}{' '}
      <button className="dec" aria-label={`Fewer ${label}`} disabled={state.count === 0}>−</button>
      <button className="inc" aria-label={`More ${label}`} disabled={context.full}>+</button>
    </p>
  )
}

Stepper.intent = ({ DOM }) => ({
  DEC: DOM.click('.dec'),
  INC: DOM.click('.inc'),
})

Stepper.model = {
  DEC: (state) => ({ ...state, count: state.count - 1 }),
  INC: (state) => ({ ...state, count: state.count + 1 }),
}

function Booking({ state }) {
  return (
    <div>
      <Stepper state="adults" label="Adults" />
      <Stepper state="kids" label="Children" />
      <p>{state.guests} guests{state.guests >= 6 && ' (the maximum)'}</p>
    </div>
  )
}

Booking.initialState = { adults: { count: 2 }, kids: { count: 0 } }

Booking.calculated = {
  guests: (state) => state.adults.count + state.kids.count,
}

Booking.context = {
  full: (state) => state.guests >= 6,
}

export default Booking
```

- **`state="adults"`** gives the first Stepper `state.adults` as its state. Its reducers read and return that slice; Sygnal writes it back into the parent's state.
- **`calculated`** is `useMemo` for state: `state.guests` is recomputed when the state changes, and reads like any other field.
- **`.context`** is a provider without the wrapper: values computed from this component's state, readable by every component below it through `context`. It can use calculated fields: `full` reads `state.guests`.
- **A child doesn't declare `initialState`**: the parent's state holds its start values (`adults: { count: 2 }`). A child that does is reported as [SYG405](/reference/errors/#syg405). For state that really is private to a component, see [`isolatedState`](/guide/state/#isolated-state).

:::tip[Where Sygnal helps]
The whole app's state is one plain object. The devtools show it, `persist()` saves parts of it, undo and redo are a behavior over it, and a test can start a component from any state with `renderComponent(App, { initialState })`.
:::

## Testing

React Testing Library tests drive the DOM. `renderComponent` can do that too, and it can also dispatch actions and answer requests directly, without a mock server:

<!-- docs-check: skip -->
```jsx title="React"
test('shows the next quote', async () => {
  server.use(http.get('/api/quotes/2', () => HttpResponse.json({ id: 2, text: 'Less, but better.' })))
  render(<Quote />)
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('Less, but better.')).toBeInTheDocument()
})
```

```jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import Quote from './Quote.jsx'

it('shows the next quote', async () => {
  const t = renderComponent(Quote)
  t.simulateEvent('.next', 'click')
  await t.respond('HTTP', { id: 2, text: 'Less, but better.' }, 'quote')
  expect(t.html()).toContain('Less, but better.')
  t.dispose()
})
```

The test's `HTTP` driver is the real fetch driver over an in-memory network: each request waits until the test answers it with `t.respond` or `t.fail`. See [Testing](/integration/testing/).

## Mistakes React developers make

These come from watching developers and coding agents write their first Sygnal components. Sygnal's development diagnostics catch most of them, in the browser console and in [`sygnal-check`](/guide/diagnostics/):

| Habit | What happens | Instead |
|---|---|---|
| `onClick={…}` on an element | Nothing: Sygnal attaches no listener | A class on the element and an intent entry |
| The parent selects a button that a child renders | The action never fires ([SYG104](/reference/errors/#syg104)) | Handle it in the child, send it up with `PARENT` |
| A button passed to a child as `children`, handled in the parent's intent | The action never fires ([SYG104](/reference/errors/#syg104)): the child renders it, so the child's intent hears it | Handle it in the child and send it up with `PARENT`, or keep the button outside the child |
| A class in the view that doesn't match the intent's selector | The action never fires ([SYG110](/reference/errors/#syg110)) | Keep the names in step; `sygnal-check` compares them |
| `value={state.x}` without an `input` action | Typing is undone on the next render ([SYG111](/reference/errors/#syg111)) | `DOM.input('.x').value()` and a reducer |
| A child with its own `initialState` | An error ([SYG405](/reference/errors/#syg405)) | Put its start values in the parent's state |
| `state.todos.push(todo); return state` | The change is ignored ([SYG222](/reference/errors/#syg222)) | Return a new object: `{ ...state, todos: [...state.todos, todo] }` |
| An `HTTP` or `PARENT` sink that reads what `STATE` just set | It sees the state from before the action | Compute the value from `(state, data)` in each sink ([Model](/guide/model/)) |

## Bringing Sygnal into a React codebase

You don't have to move everything at once. Two adapters work in opposite directions:

- **A React component inside a Sygnal app**: `fromReact(Component)` from `sygnal/react` makes a JSX tag that renders it. Use it for the one component you can't replace yet; it brings React's runtime with it. See [Adapters](/guide/adapters/).
- **A Sygnal component inside a React app**: `defineElement('task-list', TaskList)` from `sygnal/element` publishes the component as a custom element. React renders `<task-list>` like any other tag, and React 19 passes props to it as properties. See [Web Components](/guide/web-components/#publishing-a-component-as-a-custom-element).

## Where next

- [Port an App](/coming-from/port-an-app/): a small app built step by step, with the React and Vue code for each step.
- [Quick Start](/getting-started/): set up a project.
- [Architecture](/guide/architecture/): how intent, model and view fit together, and why.
