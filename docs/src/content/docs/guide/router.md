---
title: Router
description: Client-side routing with makeRouter(), the route static, links, guards and redirects
---

`makeRouter()` is a single-page-app router built as a driver. The URL is external state, like a socket: the app declares that it wants the route, the driver answers with an action, and the app's own reducer stores it. Links are plain `<a href>` elements; views never bind click handlers for navigation.

## Setup

Define the routes once, in a module the views can import:

```javascript
// routes.js
import { makeRouter } from 'sygnal'

export const router = makeRouter({
  routes: { home: '/', task: '/tasks/:id', notFound: '*' },
})
export const { href } = router
```

- Route patterns are `/literal/:param` paths. The first match wins, so list specific routes first.
- `'*'` is the not-found route: it matches anything the others don't.
- `base: '/app'` serves the app under a prefix; `mode: 'hash'` keeps the route in the fragment (`/#/tasks/1`), for static hosting without rewrites.

Register the driver in `main.js`:

```javascript
import { run } from 'sygnal'
import { router } from './routes.js'
import App from './App.jsx'

run(App, { ROUTER: router.driver })
```

## Reading the Route

The root declares `App.route = 'ROUTE'`. The driver then sends it a `ROUTE` action with `{ name, params, query, hash, path }` on start and on every change: link clicks, back and forward, and commands. The reducer stores it; a `Switchable` renders the page:

```jsx
import { Switchable } from 'sygnal'
import { router, href } from './routes.js'
import TaskList from './TaskList.jsx'
import TaskPage from './TaskPage.jsx'
import NotFound from './NotFound.jsx'

function App({ state }) {
  return (
    <main>
      <nav><a href={href('home')}>All tasks</a></nav>
      <Switchable of={{ home: TaskList, task: TaskPage, notFound: NotFound }} current={state.route.name} />
    </main>
  )
}
App.route = 'ROUTE'
App.initialState = { route: router.current(), tasks: [] }
App.model = {
  ROUTE: (state, route) => ({ ...state, route }),
}

export default App
```

- `router.current()` reads the current location, so the first render already shows the right page. On the server, pass the request URL: `router.current(request.url)`.
- `params` are decoded strings (`{ id: '2' }`), `query` is an object of strings (the last value of a repeated key), `hash` has no `#`.
- Matching ignores a trailing slash and empty segments: `/tasks/2/` is the `task` route, and its `path` is `/tasks/2`. `href()` never adds a trailing slash.
- A root that declares `route` needs an `initialState`, seeded with `router.current()` (SYG132). A sub-component can declare it too, with or without a model.

Pages read the route from the state they get. A page that loads data derives its `resources` from `state.route.params`, so changing the id loads the new task.

## Links

Links are ordinary anchors built with `href(name, params?, query?, hash?)`:

```jsx
import { href } from './routes.js'

function TaskList({ state }) {
  return (
    <ul>
      {state.tasks.map(task => (
        <li><a href={href('task', { id: task.id }, { tab: 'notes' })}>{task.title}</a></li>
      ))}
    </ul>
  )
}

export default TaskList
```

The driver intercepts same-origin link clicks at the document level and navigates without a reload. It leaves the browser to handle:

- clicks with a modifier key (Ctrl, Cmd, Shift, Alt) or a button other than the left one;
- links with a `target` other than `_self`, a `download` attribute, `rel="external"` or `data-router-ignore`;
- links to another origin, or outside `base`;
- in history mode, a link that only changes the fragment of the current page (`#comments`), which scrolls as usual;
- form submissions.

SVG `<a>` elements, links inside open shadow roots and relative links (resolved against `<base href>`) are intercepted too.

`href()` is typed from the route table: `href('task', { id })` type-checks, and an unknown name, a missing `id` or an extra param are type errors. In development the dev entry reports the same mistakes at run time (SYG130, SYG131).

## Navigating from the Model

Send commands to the `ROUTER` sink:

| Command | Effect |
|---|---|
| `{ to: 'task', params: { id }, query?, hash? }` | push the route |
| `{ to: …, replace: true }` | replace the current entry instead |
| `{ to: …, scroll: false }` | push without scrolling to the top |
| `{ url: href(…) }` | navigate to a URL built earlier |
| `{ back: true }`, `{ forward: true }`, `{ go: n }` | traverse the history |
| `{ block: 'CONFIRM_LEAVE' }`, `{ block: false }` | set or clear a navigation guard (below) |
| `{ prefetch: 'task', params }` | warm the data for a route (below) |

```jsx
function TaskPage({ state }) {
  return (
    <article>
      <h1>{state.task.title}</h1>
      <button className="delete">Delete</button>
    </article>
  )
}
TaskPage.intent = ({ DOM }) => ({ DELETE: DOM.click('.delete') })
TaskPage.model = {
  DELETE: {
    STATE: (state) => ({ ...state, deleted: true }),
    ROUTER: () => ({ to: 'home', replace: true }),
  },
}

export default TaskPage
```

The `route` key is reserved for the `route` declaration: `{ route: 'home' }` is not a command. A command the router can't perform (an unknown route, a missing param) is reported as SYG620 and ignored, also in production.

## Guards and Redirects

Guards live in the model. The `ROUTE` handler that receives a route can refuse it and redirect:

```jsx
import { ABORT } from 'sygnal'

function App({ state }) {
  return <main><h1>{state.route.name}</h1></main>
}
App.route = 'ROUTE'
App.initialState = { route: { name: 'home', params: {}, query: {}, hash: '', path: '/' }, user: null }
App.model = {
  ROUTE: {
    STATE:  (state, route) => (route.name == 'admin' && !state.user ? ABORT : { ...state, route }),
    ROUTER: (state, route) => (route.name == 'admin' && !state.user ? { to: 'login', replace: true } : ABORT),
  },
}

export default App
```

With several declaring components, the **first one declared is the guard owner**. Declarations are kept in mount order, so it is normally the root. It gets each route at once; the other declarers get it one task later, and only if no newer navigation happened in between. A route the guard redirects away from never reaches them. Put guards in the root's `ROUTE` entry; a guard that redirects later (after a request, for example) is not covered, and the other declarers see the route first.

## Unsaved Changes

`{ block: 'CONFIRM_LEAVE' }` stops navigation while the component has unsaved changes. Each attempt (a link click, a command, back or forward) is not made; instead the component gets `CONFIRM_LEAVE` with `{ to, route, proceed }`. Sending `proceed` back makes the navigation anyway:

```jsx
function Editor({ state }) {
  return (
    <div>
      <textarea className="text" aria-label="Text" value={state.text} />
      {state.pending && <p className="confirm">Discard changes? <button className="yes">Leave</button><button className="no">Stay</button></p>}
    </div>
  )
}
// its state slice starts as { text: '', dirty: false, pending: null }
Editor.intent = ({ DOM }) => ({ EDIT: DOM.input('.text').value(), YES: DOM.click('.yes'), NO: DOM.click('.no') })
Editor.model = {
  EDIT: {
    STATE:  (state, text) => ({ ...state, text, dirty: true }),
    ROUTER: () => ({ block: 'CONFIRM_LEAVE' }),
  },
  CONFIRM_LEAVE: (state, attempt) => ({ ...state, pending: attempt.proceed }),
  YES: {
    STATE:  (state) => ({ ...state, dirty: false, pending: null }),
    ROUTER: (state) => ({ ...state.pending, block: false }),   // clear the block and go
  },
  NO: (state) => ({ ...state, pending: null }),
}

export default Editor
```

- Back and forward have already happened when the router hears of them; a blocked one is undone with `history.go()`, and its `proceed` is `{ go: n, force: true }`.
- While any block is set, closing the tab or reloading shows the browser's own "Leave site?" prompt (`beforeunload`).
- `{ block: false }` clears it, also as part of a navigation (`{ ...attempt.proceed, block: false }`); a disposed component's block goes with it. Clear the block when the changes are saved or discarded: a page kept alive by `Switchable` is not disposed when it is hidden. With several blocks, the last one set gets the attempt.

## Scroll and Focus

Each history entry gets a `{ key, i }` in `history.state`, and the router keeps a scroll position per key:

- a push scrolls to the top (or, after the page renders, to the element whose `id` is the hash);
- back and forward restore the saved position once the page has rendered;
- a replace leaves the scroll alone;
- a reload is left to the browser.

After a push, back or forward, focus moves to the first `[data-router-focus]` element, else the `main h1`, else the first `h1` (`tabindex="-1"` is added when needed), so screen readers announce the new page. Initial load and replace don't move focus.

"After the page renders" means once the DOM has stopped changing for `settleMs` (30 ms), watched with a `MutationObserver`, at most one second. Content that arrives later, such as data still loading, isn't waited for, so a restore can land short on a page that renders its data late. `makeRouter({ routes, scroll: false, focus: false })` turns either off; `focus: '#main-title'` picks other targets.

## Prefetching

`{ prefetch: 'task', params: { id } }` (for example on a link's hover) calls `makeRouter({ prefetch: (route, url) => … })` and does not navigate. Without the option it does nothing. Use it to warm a route's data in the fetch driver's `queryCache()`: see [Prefetching a route's data](/guide/resources/#prefetching-a-routes-data).

## Server-Side Rendering

`href()`, `router.match(url)` and `router.current(url)` are pure, so views render on the server. Seed the state from the request: `renderToString(App, { state: { ...App.initialState, route: router.current(req.url) } })`. Without a `window` the driver does nothing.

## Vike

Vike has its own router. Inside a Vike app, give `makeRouter` Vike's `navigate()`:

```javascript
// pages/routes.js
import { makeRouter } from 'sygnal'
import { navigate } from 'vike/client/router'

export const router = makeRouter({ routes: { home: '/', task: '/tasks/:id' }, navigate })
```

```javascript
// pages/+drivers.js
import { router } from './routes.js'

export default { ROUTER: router.driver }
```

Write the route table to match the Vike routes, with `:param` for Vike's `@param`. The router then leaves link clicks and history to Vike, navigates with `navigate(url, { overwriteLastHistoryEntry })`, leaves scrolling to Vike, and re-reads the route after each Vike navigation (the Sygnal Vike hooks signal it). A Layout can declare `route` and keep the route in its state across pages. Without `navigate` the dev entry reports SYG133.

## Testing

Pass the router to [`renderComponent`](/integration/testing/#routing-navigate-back-location). It runs the router's driver over an in-memory history that starts at `url`, and the test drives it like a user:

```jsx
import { renderComponent } from 'sygnal'
import { router } from './routes.js'
import App from './App.jsx'

it('redirects to login from the admin page', async () => {
  const t = renderComponent(App, { router, url: '/admin' })
  await t.waitForState(s => s.route.name === 'login')
  expect(t.location.path).toBe('/login')
  expect(t.sent('ROUTER')).toEqual([{ to: 'login', replace: true }])
})
```

`t.navigate('/tasks/2')` or `t.navigate({ to: 'task', params: { id: 2 } })` navigates, `t.back()` and `t.forward()` traverse, and `t.location` is the current location. A `simulateEvent` click on a link goes through the router's link interception. Each call resolves once the route has been reduced and rendered. A `{ block }` stops them as it would stop a user. `t.head()` returns the merged head when no `HEAD` driver is passed.

Outside `renderComponent`, `makeRouter({ routes, window })` (and `history`, `location`, `document`) takes stand-ins, for an in-memory history in a test that calls `run()`.
