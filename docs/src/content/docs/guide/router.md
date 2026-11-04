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

The root declares `App.route = 'ROUTE'`. The driver then sends it a `ROUTE` action with `{ name, params, query, hash, path }` on start and on every change: link clicks, back and forward, and commands. The reducer stores it, and the view renders the current page, and only that one:

```jsx
import { router, href } from './routes.js'
import TaskList from './TaskList.jsx'
import TaskPage from './TaskPage.jsx'
import NotFound from './NotFound.jsx'

const PAGES = { home: TaskList, task: TaskPage, notFound: NotFound }

function App({ state }) {
  const { route } = state
  const Page = PAGES[route.name]
  return (
    <main>
      <nav><a href={href('home')}>All tasks</a></nav>
      <Page key={`${route.name}:${route.path}`} />
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

The `key` is the visit: a new key disposes the page (its `DISPOSE` runs, its requests are aborted, its connections close) and mounts a new one, which gets `INITIALIZE` and `BOOTSTRAP`. Going from `/tasks/1` to `/tasks/2` is a new visit: the page's local state and its children start over, and what it wrote to the app's state is still there.

- `path` is the pathname only: it never includes the query string or the hash. When a query value should make a new visit too, put it in the key: `` key={`${route.name}:${route.path}?${route.query.session ?? ''}`} ``. Leave out the query keys a page just reads (a sort order, a filter), so changing them doesn't re-create it.
- A page mounted per visit sees the state as it is at mount. A `STATE.watch()` emits only later changes, so a page that reacts to state already present at mount needs `STATE.watch(selector, { immediate: true })` ([Reacting to state changes](/guide/intent/#reacting-to-state-changes-statewatch)).
- The old page doesn't act on the new route: what a page's watch sends waits for the render that decides which page stays, and a page that is gone is disposed first, so its watches and sinks never run for the next visit.
- Don't use [`Switchable`](/guide/switchable/) as the page outlet. It creates every page at mount and keeps the hidden ones running: their intents, watches and model sinks (`EFFECT`, `HTTP`) keep running while another page shows, so a hidden page can send a request, and pages that declare the same resource name collide. Switchable is for tabs, panels and wizard steps on one page.

- `router.current()` reads the current location, so the first render already shows the right page. On the server, pass the request URL: `router.current(request.url)`.
- `params` are decoded strings (`{ id: '2' }`), `query` is an object of strings (the last value of a repeated key), `hash` has no `#`.
- Matching ignores a trailing slash and empty segments: `/tasks/2/` is the `task` route, and its `path` is `/tasks/2`. `href()` never adds a trailing slash.
- A root that declares `route` needs an `initialState`, seeded with `router.current()` (SYG132). A sub-component can declare it too, with or without a model.
- How the current route was reached: `ROUTER.navigation()` in an intent returns `'load'` (the page loaded), `'push'` (a link or a command), `'replace'` (a replace) or `'traverse'` (the browser's Back or Forward). The wizard's `restart: 'entry'` uses it to resume on Back.

Pages read the route from context, so their own state needs no copy of it. Provide it once at the root, and a page's [declaration statics](/guide/resources/) read it from their second argument, the [bag](/guide/state/#what-every-function-gets), as views do:

```jsx
App.context = { route: (state) => state.route }

// TaskPage.jsx: a new id loads the new task; nothing about the route is in the page's state
TaskPage.resources = { task: (state, { context: { route } }) => `/api/tasks/${route.params.id}` }
```

Every declaration static (`resources`, `timers`, `connections`, `head`, `browser`, `route`) gets `(state, bag)`, the bag being what the view gets (`{ ...props, state, context, uid }`), and is computed again when the component's state, context or props change.

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
- links to a URL another app owns (the `external` option: see [Routes another app owns](#routes-another-app-owns));
- in history mode, a link that only changes the fragment of the current page (`#comments`), which scrolls as usual;
- form submissions.

A link to a route another app owns (a server-rendered page, another single-page app under the same origin) is left to the browser when the router's `external` option lists it, or when the link has `data-router-ignore` or `rel="external"`. Without either the router intercepts it and shows its own not-found route.

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

A `{ to }` or `{ url }` command always pushes a new history entry, even when it names the URL already shown; pass `replace: true` when it shouldn't add one.

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

With several declaring components, the **first one declared is the guard owner**. Declarations are kept in mount order, so it is normally the root. It gets each route first; the other declarers get it right after the guard owner's `ROUTE` entry ran, and only if that entry didn't navigate elsewhere. A route the guard redirects away from never reaches them. This all happens before the page is patched: every declarer has its first route when the app first appears (a field typed into right away keeps its text), and a navigation updates the page once. Put guards in the root's `ROUTE` entry; a guard that redirects later (after a request, for example) is not covered, and the other declarers see the route first. Redirects made from `ROUTE` entries run at once (a chain like `/secret` → `/login` → `/other` is still one patch); a redirect loop doesn't hang the page: after 32 navigations in a row without a pause, each next one waits a task (in development a warning says so, once).

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
    ROUTER: (state, data, next, { previousState }) => ({ ...previousState.pending, block: false }),   // clear the block and go
  },
  NO: (state) => ({ ...state, pending: null }),
}

export default Editor
```

- Back and forward have already happened when the router hears of them; a blocked one is undone with `history.go()`, and its `proceed` is `{ go: n, force: true }`.
- While any block is set, closing the tab or reloading shows the browser's own "Leave site?" prompt (`beforeunload`).
- **A block belongs to the component that set it**: its `{ block: false }` clears it, and another component's doesn't, so put `CONFIRM_LEAVE` and the Leave action next to the `block`. `{ block: false }` also works as part of a navigation (`{ ...attempt.proceed, block: false }`), and sending a `proceed` clears the block it overrode, whichever component sends it; a disposed component's block goes with it. Clear the block when the changes are saved or discarded: a page mounted per visit drops its block when it is disposed, but a tab kept alive by `Switchable` is not disposed when it is hidden. With several blocks, the last one set gets the attempt.

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

## Routes Another App Owns

When Sygnal shares an origin with other apps, some URLs belong to someone else. This happens while you port an app page by page behind a proxy (a strangler migration), or when several apps each own part of a site (islands, multi-zones). A navigation to one of those URLs has to load the page from the server. If the router made it a client-side navigation, it would show its own not-found route.

List them in `external`:

```javascript
// src/routes.js
import { makeRouter } from 'sygnal'

export const router = makeRouter({
  routes: { home: '/', task: '/tasks/:id', billing: '/billing/:id', signIn: '/auth/login', notFound: '*' },
  // still served by the old app
  external: ['/billing/:id', '/auth/*'],
})
```

A navigation to a matching URL is a full page load: `location.assign(url)`, or `location.replace(url)` for a `replace`. It never pushes a history entry, wherever the navigation comes from:

- a link click: the router doesn't intercept it, so the browser follows the link;
- a `{ to }` or `{ url }` command;
- a guard's redirect, such as `{ to: 'signIn', replace: true }` from the root's `ROUTE` entry;
- the `proceed` a component sends after a `{ block }`.

Leave blocks are still asked first: a component with unsaved changes gets the attempt, as for any navigation.

`external` takes route patterns, the same syntax as `routes` (`:param` matches one segment), plus a trailing `*` that matches the rest of the path (`'/auth/*'` matches `/auth`, `/auth/login` and `/auth/sso/callback`). Patterns match the path without `base`. For anything else, pass a function of the resolved `URL`: `external: (url) => url.pathname.startsWith('/legacy/')`.

Keep the other app's routes in `routes` too, so `href('billing', { id })` builds the link and `{ to: 'billing', params }` type-checks. A URL that matches neither table still shows your not-found route. A mistyped link stays inside the app instead of reloading the page.

Under Vike, which owns link clicks, `external` applies to the router's commands.

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

`t.navigate('/tasks/2')` or `t.navigate({ to: 'task', params: { id: 2 } })` navigates, `t.back()` and `t.forward()` traverse, and `t.location` is the current location (`path`, `search`, `query`, `hash`, `href`). A `simulateEvent` click on a link goes through the router's link interception. `t.pageLoads` lists the full page loads (`{ url, replace }`): `external` navigations and links the router left to the browser. They are recorded, not made. Each call resolves once the route has been reduced and rendered. A `{ block }` stops them as it would stop a user. `t.head()` returns the merged head when no `HEAD` driver is passed.

Outside `renderComponent`, `makeRouter({ routes, window })` (and `history`, `location`, `document`) takes stand-ins, for an in-memory history in a test that calls `run()`.
