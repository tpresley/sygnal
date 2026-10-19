---
title: Sygnal for Vue Developers
description: What carries over from Vue, what's different, and the Sygnal version of the Vue patterns you already know, with every Sygnal sample live
---

Much of Vue has a direct counterpart in Sygnal: components with props, computed values, watchers, provide/inject, emits, slots, `<Transition>`, `<Teleport>`, `<KeepAlive>`. Here is a whole component. Type your name and wave:

```jsx live
function Hello({ state }) {
  return (
    <div>
      <label>Your name <input className="name" value={state.name} /></label>
      <p>Hello, {state.name || 'stranger'}!</p>
      <button className="wave">Wave</button> {state.waves > 0 && <span>× {state.waves}</span>}
    </div>
  )
}

// Your ref() start values
Hello.initialState = { name: '', waves: 0 }

// Your @input and @click, in one place
Hello.intent = ({ DOM }) => ({
  NAME: DOM.input('.name').value(),
  WAVE: DOM.click('.wave'),
})

// Your functions, returning the next state
Hello.model = {
  NAME: (state, name) => ({ ...state, name }),
  WAVE: (state) => ({ ...state, waves: state.waves + 1 }),
}
```

The view is a plain function of state, written in JSX, with no `@` handlers in it. The `intent` says which events become which actions, and the `model` says what each action does to the state. That split is most of what's new; the rest of this page maps the Vue features you know onto it and explains the few places where Sygnal thinks differently. Every Sygnal sample on the page runs: edit it and the result updates.

**Try it:** press **Edit** and add a reset button. Put `<button className="reset">Reset</button>` in the view, `RESET: DOM.click('.reset')` in the intent, and `RESET: (state) => ({ ...state, name: '', waves: 0 })` in the model. Three lines, one in each part, and nothing else to wire.

**The short version:** Sygnal views are JSX rather than templates, and state is never mutated in place. A component's state changes only through named actions handled by pure functions, like Pinia actions that return the next state instead of assigning to it. Clicks, timers, fetches and messages to the parent are all actions, so a component has no lifecycle hooks and no watchers with side effects.

## What carries over

- **Components with props.** A parent passes props and the child reads them: `function Rating({ value, max })`.
- **Computed values, watchers, provide/inject, emits, slots**: each has a counterpart, shown below.
- **Vue's names**: `<Transition>` uses Vue's class names (`fade-enter-from`, `fade-leave-active`, …); `<Portal>` is `<Teleport>`; `<Switchable>` keeps hidden pages alive like `<KeepAlive>`; `<Suspense>` and `lazy()` are `<Suspense>` and `defineAsyncComponent`.
- **Vite and TypeScript.** `npm create sygnal-app` scaffolds a Vite project; Vike and Astro cover server rendering, where you'd use Nuxt.

## At a glance

| In Vue you'd use… | In Sygnal | Guide |
|---|---|---|
| `ref`, `reactive` | `initialState`, plus a `model` entry per action | [State](/guide/state/), [Model](/guide/model/) |
| `@click`, `v-on` | an `intent` entry: `DOM.click('.save')` | [Intent](/guide/intent/) |
| `v-model` on an input | `value={state.x}` + `DOM.input('.x').value()`, or the `form` behavior | [Inputs](/guide/inputs/), [Forms](/guide/forms/) |
| `v-model` on a component | a state slice: `<Stepper state="adults" />` | [State](/guide/state/) |
| `computed` | `calculated` fields | [Calculated Fields](/guide/calculated-fields/) |
| `watch`, `watchEffect` | `STATE.watch(selector)` in the intent | [Intent](/guide/intent/#reacting-to-state-changes-statewatch) |
| `onMounted` | the `BOOTSTRAP` action | [Model](/guide/model/#built-in-actions) |
| `onUnmounted` | the `DISPOSE` action | [Disposal Hooks](/advanced/disposal/) |
| `defineEmits`, `emit()` | the child's `PARENT` sink, `CHILD.select(Child)` in the parent | [Parent-Child](/guide/parent-child/) |
| `v-for` over components | `<Collection of={Item} from="items" />` | [Collections](/guide/collections/) |
| `provide`, `inject` | the `.context` static | [Context](/guide/context/) |
| default and named slots | `children`, and `<Slot name>` with `slots` | [Slots](/advanced/slots/) |
| `<Transition>` | `<Transition>` (same class names) | [Transitions](/advanced/transitions/) |
| `<Teleport>` | `<Portal>` | [Portals](/advanced/portals/) |
| `<KeepAlive>` + `<component :is>` | `<Switchable>` | [Switchable](/guide/switchable/) |
| `defineAsyncComponent`, `<Suspense>` | `lazy()`, `<Suspense>` | [Lazy Loading](/advanced/lazy-loading/), [Suspense](/advanced/suspense/) |
| composables | behaviors (`defineBehavior`, `uses`) | [Behaviors](/guide/behaviors/) |
| Pinia | the state tree itself, and the `EVENTS` bus between distant components | [State](/guide/state/), [Drivers](/guide/drivers/#the-event-bus-events-driver) |
| `fetch` in a watcher, VueUse `useFetch`, TanStack Query | the `resources` static | [Resources and Caching](/guide/resources/) |
| template refs | `autoFocus`, the `ELEMENT` sink, `createRef()` | [Element Commands](/guide/element-commands/), [Refs](/advanced/refs/) |
| Vue Router | `makeRouter()` and the `route` static | [Router](/guide/router/) |
| VueUse `useLocalStorage` | `persist()` | [Persistence](/guide/persistence/) |
| Vue Test Utils | `renderComponent()` | [Testing](/integration/testing/) |
| Nuxt | Vike or Astro | [Vike](/integration/vike/), [Astro](/integration/astro/) |

## Templates become JSX

A Sygnal view is a function that returns JSX: HTML-like tags with JavaScript expressions in braces. There are no directives; you use JavaScript's own operators instead:

| Vue template | Sygnal JSX |
|---|---|
| `{{ count }}` | `{state.count}` |
| `:title="tip"` | `title={state.tip}` |
| `v-if` / `v-else` | `cond ? <A /> : <B />`, or `cond && <A />` |
| `v-show="open"` | `hidden={!state.open}`, or a `style` |
| `v-for="item in items" :key="item.id"` | `{state.items.map((item) => <li key={item.id}>…</li>)}` |
| `:class="{ unread: !m.read }"` | `class={{ unread: !m.read }}`, or a string `className="…"` |
| `:style="{ color }"` | `style={{ color: state.color }}` |
| `<template>` around siblings | a fragment, `<>…</>` |
| `@click="…"` | no attribute: an intent entry (next section) |

```css live
.unread { font-weight: bold; }
```

```jsx live
function Inbox({ state }) {
  const shown = state.messages.filter((m) => state.showRead || !m.read)
  return (
    <div>
      <button className="toggle">{state.showRead ? 'Hide read' : 'Show read'}</button>
      {shown.length === 0 ? (
        <p>No unread messages.</p>
      ) : (
        <ul>
          {shown.map((m) => <li key={m.id} class={{ unread: !m.read }}>{m.subject}</li>)}
        </ul>
      )}
      <p hidden={!state.showRead}>Read messages are shown in normal weight.</p>
    </div>
  )
}

Inbox.initialState = {
  showRead: true,
  messages: [
    { id: 1, subject: 'Lunch on Friday?', read: false },
    { id: 2, subject: 'Your invoice', read: true },
    { id: 3, subject: 'Release notes', read: false },
  ],
}

Inbox.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })

Inbox.model = {
  TOGGLE: (state) => ({ ...state, showRead: !state.showRead }),
}
```

- **The view gets everything as arguments**: `state`, the props the parent passed, `context`, `children`, `slots`. Nothing is in scope implicitly.
- **`class` and `className`**: a string `className="card wide"` sets the class attribute; `class={{ name: condition }}` turns classes on and off, like Vue's object syntax.

## 1. Events are named in `intent`, not bound in the template

<!-- docs-check: skip -->
```vue title="Vue"
<script setup>
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <div>
    <button aria-label="Decrement" @click="count--">−</button>
    <span>{{ count }}</span>
    <button aria-label="Increment" @click="count++">+</button>
  </div>
</template>
```

In Sygnal the view only describes the page. The component's `intent` names each action and the event that triggers it, and its `model` says what each action does to the state:

```jsx live title="Sygnal"
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
- **Modifiers are stream methods.** `@submit.prevent` is `DOM.select('form').events('submit', { preventDefault: true })`; `@keyup.enter` is `DOM.keyup('.field').filter((e) => e.key === 'Enter')`; `.value()` reads `event.target.value`. See [Intent](/guide/intent/).
- **An action is data.** `INC` is a name with an optional value. It shows up in the [devtools](/integration/debugging/) action log, and a test can dispatch it directly.

:::tip[Where Sygnal helps]
Every way a component can change is listed in one place, its `intent`. Reading an unfamiliar component means reading one object, not scanning the template for `@` attributes.
:::

## 2. State is replaced, not mutated

Vue tracks changes by watching assignments: `count.value++`, `todos.value.push(todo)`. Sygnal state is a plain object that is never changed in place. Each action's reducer returns the next state, and Sygnal re-renders what depends on it:

<!-- docs-check: skip -->
```vue title="Vue"
<script setup>
import { ref, computed } from 'vue'
const draft = ref('')
const todos = ref([])
let nextId = 1
const left = computed(() => todos.value.filter((todo) => !todo.done).length)

function add() {
  const text = draft.value.trim()
  if (!text) return
  todos.value.push({ id: nextId++, text, done: false })
  draft.value = ''
}
</script>

<template>
  <div>
    <label>New todo <input v-model="draft" /></label>
    <button @click="add">Add</button>
    <ul>
      <li v-for="todo in todos" :key="todo.id">
        <label><input type="checkbox" v-model="todo.done" /> {{ todo.text }}</label>
      </li>
    </ul>
    <p>{{ left }} left</p>
  </div>
</template>
```

```jsx live title="Sygnal"
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
      <p>{state.left} left</p>
    </div>
  )
}

Todos.initialState = { draft: '', nextId: 1, todos: [] }

Todos.calculated = {
  left: (state) => state.todos.filter((todo) => !todo.done).length,
}

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

- **`v-model` is two halves**: `value={state.draft}` writes the state into the field on every render, and the `DRAFT` action writes what the user types back into the state. A field with only the first half is reset on the next render; Sygnal warns about it as [SYG111](/reference/errors/#syg111). For whole forms, the [`form` behavior](/guide/forms/) binds every field by its `name`.
- **`calculated` is `computed`**: `state.left` is recomputed when the state changes and reads like any other field.
- **`data={{ id }}` and `.data('id', Number)`** carry the row's id from the view to the action.
- **`ABORT`** means "no change": nothing re-renders.

:::tip[Where Sygnal helps]
Because every change is a new state produced by a named action, the devtools can list each action with the state before and after it, [undo and redo](/advanced/undo/) are a behavior rather than a library, and a reducer can be tested by calling it: `Todos.model.ADD(state)`.
:::

:::caution
Mutating `state` and returning it does nothing: Sygnal compares the returned object with the previous one, sees the same object, and ignores the change ([SYG222](/reference/errors/#syg222)). Return a new object with the spread syntax.
:::

## 3. Watchers and side effects become actions

In Vue, side effects run in watchers and lifecycle hooks. A Sygnal component never calls the outside world itself: it *declares* what it needs, or returns a request from a model entry, and a **driver** does the work and sends the result back as an action. Drivers are set up once in `run(App, drivers)`; on this page the demos get an `HTTP` and a `TIMER` driver automatically.

### Fetching data

<!-- docs-check: skip -->
```vue title="Vue"
<script setup>
import { ref, watch } from 'vue'
const id = ref(1)
const quote = ref({ status: 'loading' })

watch(id, async (id, _old, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  quote.value = { status: 'loading' }
  try {
    const res = await fetch(`/api/quotes/${id}`, { signal: controller.signal })
    if (!res.ok) throw new Error(res.statusText)
    quote.value = { status: 'success', data: await res.json() }
  } catch (error) {
    if (error.name !== 'AbortError') quote.value = { status: 'error', error }
  }
}, { immediate: true })
</script>

<template>
  <div>
    <button @click="id++">Next</button>
    <p>{{ quote.status === 'loading' ? 'Loading…' : quote.status === 'error' ? 'No such quote.' : quote.data.text }}</p>
  </div>
</template>
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

```jsx live title="Sygnal"
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
- Add `queryCache()` to the driver for what TanStack Query adds: caching, request sharing, refetch on focus. See [Resources and Caching](/guide/resources/).

:::tip[Where Sygnal helps]
No watcher to write, no cleanup to register, no response arriving for a request that's no longer wanted. The request is a function of state, so when the state changes, the old request is aborted.
:::

### Watching state

A `watch` that saves something after a pause becomes an action: `STATE.watch(selector)` in the intent emits the selected value each time it changes, and stream operators such as `debounce` shape it. The save itself is a request the model returns. A stand-in server stores the note:

<!-- docs-check: skip -->
```vue title="Vue"
<script setup>
import { ref, watch } from 'vue'
const text = ref('')
const status = ref('')
let timer

watch(text, (value) => {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    status.value = 'Saving…'
    await fetch('/api/note', { method: 'PUT', body: JSON.stringify({ text: value }) })
    status.value = 'Saved'
  }, 800)
})
</script>

<template>
  <label>Note <textarea v-model="text" /></label>
  <p>{{ status }}</p>
</template>
```

```js live-server
let note = ''

export default {
  'PUT /api/note': ({ json }) => {
    note = json.text
    return { json: { text: note }, delayMs: 400 }
  },
}
```

```jsx live title="Sygnal"
import { debounce } from 'sygnal'

function Note({ state }) {
  return (
    <div>
      <label>Note <textarea className="text" value={state.text} /></label>
      <p>{state.status}</p>
    </div>
  )
}

Note.initialState = { text: '', status: '' }

Note.intent = ({ DOM, STATE }) => ({
  EDIT: DOM.input('.text').value(),
  SAVE: STATE.watch((state) => state.text).compose(debounce(800)),
})

Note.model = {
  EDIT: (state, text) => ({ ...state, text }),
  SAVE: {
    STATE: (state) => ({ ...state, status: 'Saving…' }),
    HTTP: (state, text) => ({ url: '/api/note', method: 'PUT', json: { text }, ok: 'SAVED', latest: true }),
  },
  SAVED: (state) => ({ ...state, status: 'Saved' }),
}
```

The request uses the debounced action value (`text`), so it saves the text that triggered this action. In Sygnal 7, `STATE` runs first and the `HTTP` reducer receives the updated state; here only `status` changes. Use the fourth argument's `previousState` when a request needs a value from before the action.

### Timers and lifecycle

<!-- docs-check: skip -->
```vue title="Vue"
<script setup>
import { ref, watch, onUnmounted } from 'vue'
const running = ref(false)
const seconds = ref(0)
let timer

watch(running, (on) => {
  clearInterval(timer)
  if (on) timer = setInterval(() => seconds.value++, 1000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div>
    <p>{{ seconds }} s</p>
    <button @click="running = !running">{{ running ? 'Pause' : 'Start' }}</button>
  </div>
</template>
```

```jsx live title="Sygnal"
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

`timers` is computed from the state: while `state.running` is true there's an interval, and when it turns false, or the component unmounts, it stops. For other lifecycle work, a model entry for the built-in `BOOTSTRAP` action runs once after the first render (`onMounted`), and one for `DISPOSE` runs before the component is removed (`onUnmounted`).

## 4. Emits become `PARENT`

<!-- docs-check: skip -->
```vue title="Vue"
<!-- TaskItem.vue -->
<script setup>
defineProps(['task'])
const emit = defineEmits(['pick', 'remove'])
</script>

<template>
  <li>
    {{ task.title }}
    <button @click="emit('pick', task.id)">Pick</button>
    <button @click="emit('remove', task.id)">Remove</button>
  </li>
</template>

<!-- TaskList.vue -->
<script setup>
import { ref } from 'vue'
import TaskItem from './TaskItem.vue'
const tasks = ref([{ id: 1, title: 'Write' }, { id: 2, title: 'Test' }, { id: 3, title: 'Ship' }])
const picked = ref(null)
const remove = (id) => { tasks.value = tasks.value.filter((t) => t.id !== id) }
</script>

<template>
  <div>
    <p>Picked: {{ picked ?? 'none' }}</p>
    <ul>
      <TaskItem v-for="task in tasks" :key="task.id" :task="task" @pick="picked = $event" @remove="remove" />
    </ul>
  </div>
</template>
```

A Sygnal child sends a value up through its `PARENT` sink, and the parent reads it with `CHILD.select(Child)` in its intent. A list of components is a `<Collection>`: each item gets one element of the array as its state, and an item removes itself by returning `undefined`:

```jsx live title="Sygnal"
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
- **Items are keyed by `id`**, so a Collection needs no `key`. `filter` and `sort` props change what's shown without touching the array.
- **Components far apart** talk through the `EVENTS` bus, where you might reach for a Pinia store or an event emitter: one sends `event('SAVED', data)`, the other listens with `EVENTS.select('SAVED')`.

## 5. One state tree: slices instead of `v-model`, context instead of `provide`

A Sygnal app has one state tree, kept by the root component. A child sees its parent's state, or a slice of it with `state="key"`, and can change that slice directly: it works like `v-model` on a component, without the event. `.context` is `provide`: values computed from a component's state, readable by every component below it.

<!-- docs-check: skip -->
```vue title="Vue"
<!-- Stepper.vue -->
<script setup>
import { inject } from 'vue'
defineProps(['label'])
const count = defineModel({ type: Number })
const full = inject('full')
</script>

<template>
  <p>
    {{ label }}: {{ count }}
    <button :aria-label="`Fewer ${label}`" :disabled="count === 0" @click="count--">−</button>
    <button :aria-label="`More ${label}`" :disabled="full" @click="count++">+</button>
  </p>
</template>

<!-- Booking.vue -->
<script setup>
import { ref, computed, provide } from 'vue'
import Stepper from './Stepper.vue'
const adults = ref(2)
const kids = ref(0)
const guests = computed(() => adults.value + kids.value)
provide('full', computed(() => guests.value >= 6))
</script>

<template>
  <Stepper v-model="adults" label="Adults" />
  <Stepper v-model="kids" label="Children" />
  <p>{{ guests }} guests{{ guests >= 6 ? ' (the maximum)' : '' }}</p>
</template>
```

```jsx live title="Sygnal"
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

- **`state="adults"`** gives the first Stepper `state.adults` as its state. Its reducers read and return that slice, and Sygnal writes it back into the parent's state.
- **A child doesn't declare `initialState`**: the parent's state holds its start values (`adults: { count: 2 }`). A child that does is reported as [SYG405](/reference/errors/#syg405). For state that really is private to a component, see [`isolatedState`](/guide/state/#isolated-state).
- **Pinia's role is taken by the tree itself.** State shared by many components lives high in the tree; `.context` passes derived values down, and `EVENTS` carries messages across.

:::tip[Where Sygnal helps]
The whole app's state is one plain object: the devtools show it, `persist()` saves parts of it, and a test can start any component from any state with `renderComponent(App, { initialState })`.
:::

## Slots

A component receives its children as `children`, and named regions as `slots`. The parent fills a named slot with `<Slot name="…">`:

<!-- docs-check: skip -->
```vue title="Vue"
<!-- Card.vue -->
<template>
  <div class="card">
    <header><slot name="header" /></header>
    <slot />
    <footer><slot name="actions" /></footer>
  </div>
</template>

<!-- App.vue -->
<template>
  <Card>
    <template #header><h2>Release 6.1</h2></template>
    <p>Sygnal 6.1 adds sygnal/ai.</p>
    <template #actions><button>Read more</button></template>
  </Card>
</template>
```

```jsx live title="Sygnal"
import { Slot } from 'sygnal'

function Card({ slots }) {
  return (
    <div className="card">
      <header>{slots.header}</header>
      {slots.default}
      <footer>{slots.actions}</footer>
    </div>
  )
}

function App() {
  return (
    <Card>
      <Slot name="header"><h2>Release 6.1</h2></Slot>
      <p>Sygnal 6.1 adds sygnal/ai.</p>
      <Slot name="actions"><button className="more">Read more</button></Slot>
    </Card>
  )
}

export default App
```

- **Events in slot content go to the child.** This is the one real difference from Vue. In Vue, `@click` on slot content runs in the parent. In Sygnal, a component's intent hears the elements its view renders, and slot content is rendered by `Card`. A `DOM.click('.more')` in `App` would never fire; Sygnal warns about it as [SYG104](/reference/errors/#syg104). Handle the click in `Card` and send it up with `PARENT`, or keep the button outside `Card`.
- **Scoped slots** have no direct equivalent. Pass a function prop and call it in the child: `<List items={state.items} renderItem={(item) => <b>{item.name}</b>} />`.

## Testing

Vue Test Utils tests drive the DOM. `renderComponent` can do that too, and it can also dispatch actions and answer requests directly, without a mock server:

<!-- docs-check: skip -->
```js title="Vue"
test('shows the next quote', async () => {
  server.use(http.get('/api/quotes/2', () => HttpResponse.json({ id: 2, text: 'Less, but better.' })))
  const wrapper = mount(Quote)
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('Less, but better.')
})
```

```jsx title="Sygnal"
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

## Mistakes Vue developers make

Sygnal's development diagnostics catch most of these, in the browser console and in [`sygnal-check`](/guide/diagnostics/):

| Habit | What happens | Instead |
|---|---|---|
| `state.todos.push(todo); return state` | The change is ignored ([SYG222](/reference/errors/#syg222)) | Return a new object: `{ ...state, todos: [...state.todos, todo] }` |
| `value={state.x}` expecting `v-model` | Typing is undone on the next render ([SYG111](/reference/errors/#syg111)) | Add `DOM.input('.x').value()` and a reducer |
| `onClick={…}` (or `@click`) on an element | Nothing: Sygnal attaches no listener | A class on the element and an intent entry |
| The parent selects a button that a child renders | The action never fires ([SYG104](/reference/errors/#syg104)) | Handle it in the child, send it up with `PARENT` |
| A button in a slot, handled in the parent's intent | The action never fires ([SYG104](/reference/errors/#syg104)): the child renders it, so the child's intent hears it | Handle it in the child and send it up with `PARENT`, or keep the button outside the child |
| A class in the view that doesn't match the intent's selector | The action never fires ([SYG110](/reference/errors/#syg110)) | Keep the names in step; `sygnal-check` compares them |
| A child with its own `initialState` | An error ([SYG405](/reference/errors/#syg405)) | Put its start values in the parent's state |
| An `HTTP` or `PARENT` sink that reads what `STATE` just set | In Sygnal 7, it sees committed state by default | `props.previousState` holds old values; 6.x used pre-action state ([Model](/guide/model/)) |

## Using Sygnal from a Vue app

`defineElement('task-list', TaskList)` from `sygnal/element` publishes a Sygnal component as a custom element, and Vue renders custom elements natively: `<task-list>` in a template, with `compilerOptions.isCustomElement` set so Vue doesn't try to resolve it as a Vue component. That lets you move one widget at a time. See [Web Components](/guide/web-components/#publishing-a-component-as-a-custom-element).

## Where next

- [Port an App](/coming-from/port-an-app/): a small app built step by step, with the React and Vue code for each step.
- [Quick Start](/getting-started/): set up a project.
- [Architecture](/guide/architecture/): how intent, model and view fit together, and why.
