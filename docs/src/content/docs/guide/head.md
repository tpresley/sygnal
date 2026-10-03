---
title: Document Head
description: The page title, meta and link tags with makeHeadDriver() and the head static
---

`makeHeadDriver()` manages the document's `<title>`, `<meta>` and `<link>` tags. Components declare what they want in the head as a function of their state; the driver merges the declarations of every mounted component and updates the document.

```javascript
import { run, makeHeadDriver } from 'sygnal'
import App from './App.jsx'

run(App, { HEAD: makeHeadDriver({ titleTemplate: '%s · Tasks' }) })
```

`titleTemplate` is optional; `%s` is replaced by each title.

## The head Static

A component's `head` static maps its state to a head value, `{ title?, meta?, link? }`:

```jsx
function TaskPage({ state }) {
  return <h1>{state.task.title}</h1>
}
TaskPage.head = (state) => ({
  title: state.task.title,
  meta: { description: state.task.summary, 'og:title': state.task.title },
  link: [{ rel: 'canonical', href: `https://example.com/tasks/${state.task.id}` }],
})
TaskPage.model = {}

export default TaskPage
```

It is sent to the driver at start and whenever the result changes. Each component instance has one entry; its next value replaces it, and a falsy value or the component's disposal removes it.

- Like every declaration static, `head` is only sent by a component that has a model (an empty one is enough) and state; the dev entry reports SYG132 otherwise.
- `meta` keys starting with `og:`, `article:`, `fb:` (and the other Open Graph prefixes) become `<meta property>`, the others `<meta name>`. A `null` value removes a key a component mounted earlier set.
- `link` entries are merged by `key` when they have one, else by `rel` for `canonical`, else by `rel` and `href`.

## Merging

Entries are merged in mount order: the component mounted last wins the title, so a page's title replaces the app's default, and the default comes back when the page goes. `meta` keys and links merge the same way.

The driver only changes what it manages:

- `document.title` returns to the page's original title when no entry sets one;
- tags it creates carry a `data-sygnal-head` attribute and are removed when no entry sets them;
- an existing `<meta>` with the same name (for example a description in `index.html`) is updated, and its original content restored later.

## Values from the Model

A model entry can send a head value to the `HEAD` sink too, for example after a request:

```jsx
function Report({ state }) {
  return <div><button className="load">Load</button><p>{state.status}</p></div>
}
Report.initialState = { status: 'idle' }
Report.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
Report.model = {
  LOAD: { HTTP: () => ({ url: '/api/report', ok: 'LOADED' }) },
  LOADED: {
    STATE: (state, report) => ({ ...state, status: 'ready', report }),
    HEAD:  (state, report) => ({ title: report.name }),
  },
}

export default Report
```

It shares the component's entry with its `head` static (the last value sent wins). To clear it, send an empty object `{}`.

## With the Router

The router and the head driver don't know about each other: the route is state, so the title is derived from it like anything else.

```jsx
import { Switchable } from 'sygnal'
import { router } from './routes.js'
import TaskList from './TaskList.jsx'
import TaskPage from './TaskPage.jsx'

const TITLES = { home: () => 'All tasks', task: (route) => `Task ${route.params.id}` }

function App({ state }) {
  return <main><Switchable of={{ home: TaskList, task: TaskPage }} current={state.route.name} /></main>
}
App.route = 'ROUTE'
App.initialState = { route: router.current() }
App.head = (state) => ({ title: TITLES[state.route.name](state.route) })
App.model = {
  ROUTE: (state, route) => ({ ...state, route }),
}

export default App
```

## Server-Side Rendering

`renderToString(App, { head: list })` collects the `head` static of each component it renders into `list`, and `renderHead(list)` turns them into tags for the document's `<head>`:

```javascript
import { renderToString, renderHead } from 'sygnal'
import App from './App.jsx'

const head = []
const body = renderToString(App, { state: App.initialState, head })
const html = `<!doctype html><html><head>${renderHead(head, { titleTemplate: '%s · Tasks' })}</head><body><div id="app">${body}</div></body></html>`
```

The client's head driver takes over the tags `renderHead()` wrote. Only the `head` static is rendered on the server: values that model entries send need the running app. In Vike apps, `sygnal/vike` collects the `head` statics of the page and its layouts; they override the `title` and `description` settings of the Vike config.
