---
title: Port an App
description: A small app built in Sygnal step by step, from component boxes to server data, with the React and Vue versions of each step for comparison
---

This page builds one small app in five steps, the way you'd port it from React or Vue: split it into components, write the static views, find the state and the actions, wire the events, then add the server. Each step is a live demo you can edit; the React and Vue code for the steps that differ is folded under each demo.

The app is a **book finder**: a list of books loaded from a server, a search box that filters it, a "Want to read" toggle on each book with a count of the books on your list, and a detail panel that loads more about a book when you pick it.

If you haven't yet, read [Sygnal for React developers](/coming-from/react/) or [Sygnal for Vue developers](/coming-from/vue/) first: this page uses the ideas they introduce.

## Step 1: Draw the component boxes

Split the screen into components, as you would in any component framework:

- **`BookFinder`**, the root: the search box, the count, the list, and the detail panel when a book is picked.
- **`BookRow`**, one per book: the title (a button that picks the book), the author, and the "Want to read" toggle.
- **`BookDetail`**: the panel for the picked book. It gets its own component in step 5, when it starts loading its own data.

## Step 2: Write the static views

Start with views and nothing else: a fixed `initialState` holding sample data, and no intent or model. In Sygnal that's already a component that runs. The list is a `<Collection>`, which renders one `BookRow` per element of `state.books` and gives each its element as `state`:

```css live
.books { padding-left: 0; list-style: none; }
.books li { display: flex; gap: 0.5rem; align-items: baseline; margin: 0.25rem 0; }
.detail { border: 1px solid var(--sl-color-gray-5); border-radius: 0.5rem; padding: 0.5rem 1rem; margin-top: 1rem; }
```

```jsx live
import { Collection } from 'sygnal'

function BookRow({ state }) {
  return (
    <li className="book">
      <button className="show">{state.title}</button> by {state.author}
      <button className="want" aria-pressed={state.want}>{state.want ? '★ On my list' : '☆ Want to read'}</button>
    </li>
  )
}

function BookFinder({ state }) {
  const picked = state.books.find((book) => book.id === state.selected)
  return (
    <div className="finder">
      <label>Search <input className="search" /></label>
      <p>1 on your reading list</p>
      <ul className="books">
        <Collection of={BookRow} from="books" />
      </ul>
      {picked && (
        <aside className="detail">
          <h3>{picked.title}</h3>
          <p>by {picked.author}</p>
          <button className="close">Close</button>
        </aside>
      )}
    </div>
  )
}

BookFinder.initialState = {
  query: '',
  selected: 2,
  books: [
    { id: 1, title: 'Frankenstein', author: 'Mary Shelley', want: true },
    { id: 2, title: 'Moby-Dick', author: 'Herman Melville', want: false },
    { id: 3, title: 'The Time Machine', author: 'H. G. Wells', want: false },
  ],
}

export default BookFinder
```

Nothing responds yet: the components have no intent. The search box is left uncontrolled for now; step 4 binds it to `state.query` together with the action that updates it (a bound field with no action would undo the user's typing on the next render, [SYG111](/reference/errors/#syg111)).

## Step 3: Find the state and the actions

In React you'd now decide which component owns which `useState`; in Vue, which component holds which `ref`. In Sygnal the state is one tree, held by the root, so the question is only *what's in it*:

| State | Kind |
|---|---|
| `books`: the list, each with a `want` flag | state (from the server in step 5) |
| `query`: the search text | state |
| `selected`: the id of the picked book, or `null` | state |
| the books matching `query` | derived: Collection's `filter` prop |
| the number of books on the list | derived: a `calculated` field |

Then list what can happen, which becomes the actions:

| Action | Triggered by | Handled in |
|---|---|---|
| `SEARCH` | typing in the search box | `BookFinder` |
| `WANT` | the toggle on a row | `BookRow`: it flips its own `want` |
| `SHOW` | the title button on a row | `BookRow` sends the id up; `BookFinder` sets `selected` |
| `CLOSE` | the panel's Close button | `BookFinder` (in step 5, `BookDetail`) |

`WANT` stays in the row: a Collection item can change its own element of the array, so the parent needs no handler for it. `SHOW` changes the parent's `selected`, so the row sends it up with `PARENT`, where a React row would call an `onShow` prop and a Vue row would `emit('show')`.

## Step 4: Wire the events

Each component gets an `intent` (which events trigger which actions) and a `model` (what each action does). `BookRow` moves into its own module, so the next step can import it too:

```jsx live-file=./BookRow.jsx
// BookRow.jsx
export function BookRow({ state }) {
  return (
    <li className="book">
      <button className="show">{state.title}</button> by {state.author}
      <button className="want" aria-pressed={state.want}>{state.want ? '★ On my list' : '☆ Want to read'}</button>
    </li>
  )
}

BookRow.intent = ({ DOM }) => ({
  SHOW: DOM.click('.show'),
  WANT: DOM.click('.want'),
})

BookRow.model = {
  SHOW: { PARENT: (state) => ({ id: state.id }) },
  WANT: (state) => ({ ...state, want: !state.want }),
}
```

```jsx live
import { Collection } from 'sygnal'
import { BookRow } from './BookRow.jsx'

function BookFinder({ state }) {
  const picked = state.books.find((book) => book.id === state.selected)
  const matches = (book) => book.title.toLowerCase().includes(state.query.toLowerCase())
  return (
    <div className="finder">
      <label>Search <input className="search" value={state.query} /></label>
      <p>{state.wanted} on your reading list</p>
      <ul className="books">
        <Collection of={BookRow} from="books" filter={matches} />
      </ul>
      {picked && (
        <aside className="detail">
          <h3>{picked.title}</h3>
          <p>by {picked.author}</p>
          <button className="close">Close</button>
        </aside>
      )}
    </div>
  )
}

BookFinder.initialState = {
  query: '',
  selected: null,
  books: [
    { id: 1, title: 'Frankenstein', author: 'Mary Shelley', want: true },
    { id: 2, title: 'Moby-Dick', author: 'Herman Melville', want: false },
    { id: 3, title: 'The Time Machine', author: 'H. G. Wells', want: false },
  ],
}

BookFinder.calculated = {
  wanted: (state) => state.books.filter((book) => book.want).length,
}

BookFinder.intent = ({ DOM, CHILD }) => ({
  SEARCH: DOM.input('.search').value(),
  SHOW: CHILD.select(BookRow),
  CLOSE: DOM.click('.close'),
})

BookFinder.model = {
  SEARCH: (state, query) => ({ ...state, query }),
  SHOW: (state, { id }) => ({ ...state, selected: id }),
  CLOSE: (state) => ({ ...state, selected: null }),
}

export default BookFinder
```

- Toggle a book: the row changes its own `want`, and the parent's count (`state.wanted`) follows, because the row's element *is* part of the parent's state.
- Search for "the": `filter` hides rows without touching `state.books`, so a hidden book keeps its `want` flag.
- The parent hears `SHOW` through `CHILD.select(BookRow)`, never by selecting the row's button: a component's `DOM` only sees its own elements.

<details>
<summary>The same step in React</summary>

<!-- docs-check: skip -->
```jsx title="React"
function BookRow({ book, onShow, onToggleWant }) {
  return (
    <li className="book">
      <button onClick={() => onShow(book.id)}>{book.title}</button> by {book.author}
      <button aria-pressed={book.want} onClick={() => onToggleWant(book.id)}>
        {book.want ? '★ On my list' : '☆ Want to read'}
      </button>
    </li>
  )
}

function BookFinder() {
  const [books, setBooks] = useState(SAMPLE_BOOKS)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const wanted = books.filter((book) => book.want).length
  const shown = books.filter((book) => book.title.toLowerCase().includes(query.toLowerCase()))
  const picked = books.find((book) => book.id === selected)
  const toggleWant = (id) => setBooks((list) => list.map((b) => (b.id === id ? { ...b, want: !b.want } : b)))
  return (
    <div className="finder">
      <label>Search <input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <p>{wanted} on your reading list</p>
      <ul className="books">
        {shown.map((book) => <BookRow key={book.id} book={book} onShow={setSelected} onToggleWant={toggleWant} />)}
      </ul>
      {picked && (
        <aside className="detail">
          <h3>{picked.title}</h3>
          <p>by {picked.author}</p>
          <button onClick={() => setSelected(null)}>Close</button>
        </aside>
      )}
    </div>
  )
}
```

</details>

<details>
<summary>The same step in Vue</summary>

```vue title="Vue"
<!-- BookRow.vue -->
<script setup>
defineProps(['book'])
const emit = defineEmits(['show', 'toggle-want'])
</script>

<template>
  <li class="book">
    <button @click="emit('show', book.id)">{{ book.title }}</button> by {{ book.author }}
    <button :aria-pressed="book.want" @click="emit('toggle-want', book.id)">
      {{ book.want ? '★ On my list' : '☆ Want to read' }}
    </button>
  </li>
</template>

<!-- BookFinder.vue -->
<script setup>
import { ref, computed } from 'vue'
import BookRow from './BookRow.vue'
const books = ref(SAMPLE_BOOKS)
const query = ref('')
const selected = ref(null)
const wanted = computed(() => books.value.filter((book) => book.want).length)
const shown = computed(() => books.value.filter((book) => book.title.toLowerCase().includes(query.value.toLowerCase())))
const picked = computed(() => books.value.find((book) => book.id === selected.value))
const toggleWant = (id) => {
  const book = books.value.find((b) => b.id === id)
  book.want = !book.want
}
</script>

<template>
  <div class="finder">
    <label>Search <input v-model="query" /></label>
    <p>{{ wanted }} on your reading list</p>
    <ul class="books">
      <BookRow v-for="book in shown" :key="book.id" :book="book" @show="selected = $event" @toggle-want="toggleWant" />
    </ul>
    <aside v-if="picked" class="detail">
      <h3>{{ picked.title }}</h3>
      <p>by {{ picked.author }}</p>
      <button @click="selected = null">Close</button>
    </aside>
  </div>
</template>
```

</details>

## Step 5: Add the server

Two requests are left, and they're different kinds of request:

- **The book list is loaded once, then changed locally** (the `want` flags). That's an action: the built-in `BOOTSTRAP` action runs once after the first render (where React uses `useEffect(…, [])` and Vue `onMounted`) and returns a request on its `HTTP` sink, whose reply arrives as the `LOADED` action.
- **The details follow `selected`**: whenever a book is picked, its details are fetched, and a newer pick replaces an older one. That's a `resources` entry, computed from the state. The panel moves into its own component, `BookDetail`, which declares it.

A stand-in server answers the two requests:

```js live-server
const books = [
  { id: 1, title: 'Frankenstein', author: 'Mary Shelley', year: 1818, pages: 280, summary: 'A young scientist builds a living creature and spends the rest of his life running from what he made.' },
  { id: 2, title: 'Moby-Dick', author: 'Herman Melville', year: 1851, pages: 635, summary: 'A whaling captain hunts the white whale that took his leg, and takes his crew with him.' },
  { id: 3, title: 'The Time Machine', author: 'H. G. Wells', year: 1895, pages: 118, summary: 'An inventor travels to the year 802,701 and finds humanity split in two.' },
  { id: 4, title: 'Pride and Prejudice', author: 'Jane Austen', year: 1813, pages: 432, summary: 'Five sisters, one mother set on marrying them well, and a first impression that turns out wrong.' },
  { id: 5, title: 'Dracula', author: 'Bram Stoker', year: 1897, pages: 418, summary: 'Letters and diaries follow a count from Transylvania to England, and the people who hunt him.' },
  { id: 6, title: 'Middlemarch', author: 'George Eliot', year: 1871, pages: 880, summary: 'The lives of a provincial English town, and of a young woman who wants to do some good in it.' },
]

export default {
  'GET /api/books': () => ({ json: books.map(({ id, title, author }) => ({ id, title, author })), delayMs: 700 }),
  'GET /api/books/:id': ({ params }) => {
    const book = books.find((b) => b.id === Number(params.id))
    return book ? { json: book, delayMs: 500 } : { status: 404, json: { message: 'No such book' } }
  },
}
```

```jsx live-file=./BookDetail.jsx
// BookDetail.jsx
export function BookDetail({ state }) {
  const { status, data } = state.detail
  return (
    <aside className="detail">
      {status === 'loading' && <p>Loading…</p>}
      {status === 'error' && <p>Could not load the details.</p>}
      {status === 'success' && (
        <>
          <h3>{data.title}</h3>
          <p>{data.year} · {data.pages} pages</p>
          <p>{data.summary}</p>
        </>
      )}
      <button className="close">Close</button>
    </aside>
  )
}

BookDetail.resources = {
  detail: (state) => state.selected && `/api/books/${state.selected}`,
}

BookDetail.intent = ({ DOM }) => ({ CLOSE: DOM.click('.close') })

BookDetail.model = {
  CLOSE: (state) => ({ ...state, selected: null }),
}
```

```jsx live
import { Collection } from 'sygnal'
import { BookRow } from './BookRow.jsx'
import { BookDetail } from './BookDetail.jsx'

function BookFinder({ state }) {
  const matches = (book) => book.title.toLowerCase().includes(state.query.toLowerCase())
  return (
    <div className="finder">
      <label>Search <input className="search" value={state.query} /></label>
      <p>
        {state.status === 'loading' ? 'Loading books…'
          : state.status === 'error' ? 'Could not load the books.'
          : `${state.wanted} on your reading list`}
      </p>
      <ul className="books">
        <Collection of={BookRow} from="books" filter={matches} />
      </ul>
      {state.selected && <BookDetail />}
    </div>
  )
}

BookFinder.initialState = { query: '', selected: null, status: 'loading', books: [] }

BookFinder.calculated = {
  wanted: (state) => state.books.filter((book) => book.want).length,
}

BookFinder.intent = ({ DOM, CHILD }) => ({
  SEARCH: DOM.input('.search').value(),
  SHOW: CHILD.select(BookRow),
})

BookFinder.model = {
  BOOTSTRAP: {
    HTTP: () => ({ url: '/api/books', ok: 'LOADED', error: 'FAILED' }),
  },
  LOADED: (state, books) => ({ ...state, status: 'done', books: books.map((book) => ({ ...book, want: false })) }),
  FAILED: (state) => ({ ...state, status: 'error' }),
  SEARCH: (state, query) => ({ ...state, query }),
  SHOW: (state, { id }) => ({ ...state, selected: id }),
}

export default BookFinder
```

- **`BookDetail` has no `state` prop**, so it shares its parent's state: it reads `state.selected`, its resource writes `state.detail`, and its `CLOSE` sets `selected` back to `null`. A component that only works on part of the state would get a slice with `state="key"`.
- **Pick two books quickly**: the first request is aborted, so its details never replace the second's. There is no request id or "ignore stale responses" flag in the code.
- **`BookRow` didn't change.** It still only flips its own `want` and reports `SHOW`; where the list came from is the parent's business.

<details>
<summary>The same step in React</summary>

<!-- docs-check: skip -->
```jsx title="React"
function BookDetail({ id, onClose }) {
  const [detail, setDetail] = useState({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    setDetail({ status: 'loading' })
    fetch(`/api/books/${id}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data) => setDetail({ status: 'success', data }))
      .catch((error) => error.name !== 'AbortError' && setDetail({ status: 'error' }))
    return () => controller.abort()
  }, [id])
  return (
    <aside className="detail">
      {detail.status === 'loading' && <p>Loading…</p>}
      {detail.status === 'error' && <p>Could not load the details.</p>}
      {detail.status === 'success' && (
        <>
          <h3>{detail.data.title}</h3>
          <p>{detail.data.year} · {detail.data.pages} pages</p>
          <p>{detail.data.summary}</p>
        </>
      )}
      <button onClick={onClose}>Close</button>
    </aside>
  )
}

function BookFinder() {
  const [books, setBooks] = useState([])
  const [status, setStatus] = useState('loading')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  useEffect(() => {
    fetch('/api/books')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((list) => {
        setBooks(list.map((book) => ({ ...book, want: false })))
        setStatus('done')
      })
      .catch(() => setStatus('error'))
  }, [])
  const wanted = books.filter((book) => book.want).length
  const shown = books.filter((book) => book.title.toLowerCase().includes(query.toLowerCase()))
  const toggleWant = (id) => setBooks((list) => list.map((b) => (b.id === id ? { ...b, want: !b.want } : b)))
  return (
    <div className="finder">
      <label>Search <input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <p>
        {status === 'loading' ? 'Loading books…'
          : status === 'error' ? 'Could not load the books.'
          : `${wanted} on your reading list`}
      </p>
      <ul className="books">
        {shown.map((book) => <BookRow key={book.id} book={book} onShow={setSelected} onToggleWant={toggleWant} />)}
      </ul>
      {selected && <BookDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
```

</details>

<details>
<summary>The same step in Vue</summary>

```vue title="Vue"
<!-- BookDetail.vue -->
<script setup>
import { ref, watch } from 'vue'
const props = defineProps(['id'])
const emit = defineEmits(['close'])
const detail = ref({ status: 'loading' })

watch(() => props.id, async (id, _old, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  detail.value = { status: 'loading' }
  try {
    const res = await fetch(`/api/books/${id}`, { signal: controller.signal })
    if (!res.ok) throw new Error(res.statusText)
    detail.value = { status: 'success', data: await res.json() }
  } catch (error) {
    if (error.name !== 'AbortError') detail.value = { status: 'error' }
  }
}, { immediate: true })
</script>

<template>
  <aside class="detail">
    <p v-if="detail.status === 'loading'">Loading…</p>
    <p v-else-if="detail.status === 'error'">Could not load the details.</p>
    <template v-else>
      <h3>{{ detail.data.title }}</h3>
      <p>{{ detail.data.year }} · {{ detail.data.pages }} pages</p>
      <p>{{ detail.data.summary }}</p>
    </template>
    <button @click="emit('close')">Close</button>
  </aside>
</template>

<!-- BookFinder.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import BookRow from './BookRow.vue'
import BookDetail from './BookDetail.vue'
const books = ref([])
const status = ref('loading')
const query = ref('')
const selected = ref(null)
const wanted = computed(() => books.value.filter((book) => book.want).length)
const shown = computed(() => books.value.filter((book) => book.title.toLowerCase().includes(query.value.toLowerCase())))
const toggleWant = (id) => {
  const book = books.value.find((b) => b.id === id)
  book.want = !book.want
}

onMounted(async () => {
  try {
    const res = await fetch('/api/books')
    if (!res.ok) throw new Error(res.statusText)
    books.value = (await res.json()).map((book) => ({ ...book, want: false }))
    status.value = 'done'
  } catch {
    status.value = 'error'
  }
})
</script>

<template>
  <div class="finder">
    <label>Search <input v-model="query" /></label>
    <p v-if="status === 'loading'">Loading books…</p>
    <p v-else-if="status === 'error'">Could not load the books.</p>
    <p v-else>{{ wanted }} on your reading list</p>
    <ul class="books">
      <BookRow v-for="book in shown" :key="book.id" :book="book" @show="selected = $event" @toggle-want="toggleWant" />
    </ul>
    <BookDetail v-if="selected" :id="selected" @close="selected = null" />
  </div>
</template>
```

</details>

## What the port changed

- **Handlers became actions.** Every `onClick` / `@click` became an intent entry and a model entry, so each component's behavior is listed in two objects.
- **Callbacks and emits became `PARENT`**, and the row's `want` toggle needed no callback at all: the row changed its own element.
- **Effects became declarations.** The list load is a `BOOTSTRAP` request with a reply action; the details are a resource that follows `selected`. Neither component has cleanup code, and neither can show a stale response.
- **The state is one object.** At any moment, `BookFinder`'s state is the whole app: the books with their flags, the query, the pick and its details. A test can start from any of it: `renderComponent(BookFinder, { initialState })`.

## Where next

- [Collections](/guide/collections/): filtering, sorting and keys in depth.
- [Resources and Caching](/guide/resources/): refetching, the query cache, pagination.
- [Testing](/integration/testing/): testing this app's actions and requests without a server.
