# Router (makeRouter + route) and HEAD

Routes, links, guards and redirects, blocking navigation for unsaved changes, per-route page state, document title / meta.

```jsx
// src/routes.js
import { makeRouter } from 'sygnal'
export const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', admin: '/admin', notFound: '*' } })  // first match wins
export const { href } = router   // href('task', { id: 2 }) → '/tasks/2'
```
```jsx
// src/App.jsx; main.js: run(App, { ROUTER: router.driver, HEAD: makeHeadDriver() })
import { ABORT, Switchable } from 'sygnal'
import { router, href } from './routes.js'
function App({ state }) {
  return (
    <main>
      <nav><a href={href('home')}>All</a> <a href={href('task', { id: 2 })}>Task 2</a></nav>
      <Switchable of={{ home: Home, task: TaskPage, admin: Admin, notFound: NotFound }} current={state.route.name} instance={state.route.path} />
    </main>
  )
}
App.route = 'ROUTE'                                     // ROUTE gets { name, params, query, hash, path } on start and every change
App.initialState = { route: router.current(), user: null, draft: '', leaving: null }  // root: initialState required (SYG132)
App.head = (state) => ({ title: state.route.name === 'task' ? `Task ${state.route.params.id}` : 'Tasks' })  // also meta, link
App.model = {
  ROUTE: {                                              // a guard refuses the route and redirects
    STATE:  (state, route) => (route.name === 'admin' && !state.user ? ABORT : { ...state, route, draft: '', leaving: null }),
    ROUTER: (state, route) => (route.name === 'admin' && !state.user ? { to: 'home', replace: true } : ABORT),
  },
}
// TaskPage: no initialState (SYG405); view + intent as usual
TaskPage.model = {
  EDIT:  { STATE: (state, draft) => ({ ...state, draft }), ROUTER: () => ({ block: 'CONFIRM_LEAVE' }) },  // guard unsaved changes
  CONFIRM_LEAVE: (state, { proceed }) => ({ ...state, leaving: proceed }),   // a blocked navigation: { to, route, proceed }
  LEAVE: { STATE: (state) => ({ ...state, leaving: null }), ROUTER: (state) => ({ ...state.leaving, block: false }) },
  DONE:  { ROUTER: () => ({ to: 'home', block: false }) },   // also { to, params, query, replace }, { url }, { back: true }
}
```
- Links are plain `<a href={href(...)}>`: the driver intercepts same-origin clicks. `params` are strings. `instance={state.route.path}` gives `/tasks/1` and `/tasks/2` separate page state. SSR: `router.current(req.url)`. Vike: `makeRouter({ routes, navigate })` (from `'vike/client/router'`). Guides: https://sygnal.js.org/guide/router/, https://sygnal.js.org/guide/head/
