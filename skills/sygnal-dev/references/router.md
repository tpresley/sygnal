# Sygnal: router and HEAD

It assumes the core (`llms.txt`).

```jsx
import { makeRouter } from 'sygnal'
export const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', admin: '/admin', notFound: '*' } })  // first match wins
export const { href } = router   // href('task', { id: 2 }, { tab: 'notes' }) → '/tasks/2?tab=notes'
```
// src/App.jsx; on the root: App.drivers = { ROUTER: router.driver, HEAD: makeHeadDriver({ titleTemplate: '%s · Tasks' }) }
App.model = {
  ROUTE: {                                             // a guard: refuse the route and redirect
    STATE:  (state, route) => (route.name === 'admin' && !state.user ? ABORT : { ...state, route, draft: '', leaving: null }),
    ROUTER: (state, route) => (route.name === 'admin' && !state.user ? { to: 'home', replace: true } : ABORT),
  },
}
TaskPage.model = {   // a page shares the parent's state: no initialState (SYG405)
  EDIT:  { STATE: (state, draft) => ({ ...state, draft }), ROUTER: () => ({ block: 'CONFIRM_LEAVE' }) },   // unsaved changes
  CONFIRM_LEAVE: (state, { proceed }) => ({ ...state, leaving: proceed }),   // a blocked attempt: { to, route, proceed }
  LEAVE: { STATE: (state) => ({ ...state, leaving: null }), ROUTER: (state, data, next, { previousState }) => ({ ...previousState.leaving, block: false }) },
  DONE:  { ROUTER: () => ({ to: 'home', block: false }) },
}
```
- Links are plain `<a href={href(...)}>`, never click handlers: the driver intercepts same-origin left clicks at the document (not modified clicks, `target`, `download`, `rel="external"`, `data-router-ignore`, other origins, `makeRouter({ external })`). `params` and `query` values are strings; `href()` is typed from the route table (unknown names, missing params: type errors; SYG130/131 at run time). The `key` makes each visit a new page; `path` excludes the query: add query keys that should re-create it (`` `${route.name}:${route.path}?${route.query.s ?? ''}` ``). Not Switchable (hidden pages stay live). Pages read the route from context (`App.context = { route: (s) => s.route }`): `TaskPage.resources = { task: (s, { context: { route } }) => `/api/tasks/${route.params.id}` }`.
- ROUTER commands (pushed unless `replace`, even to the current URL): `{ to, params, query, hash, replace, scroll }`, `{ url }`, `{ back: true }`, `{ forward: true }`, `{ go: n }`, `{ block: 'ACTION' | false }` (also stops back/forward and turns on the `beforeunload` leave-page prompt; `proceed` navigates anyway and clears the block it overrode). A block belongs to the component that set it (only its own `{ block: false }` clears it): put CONFIRM_LEAVE and LEAVE next to the `block`, `{ prefetch: 'task', params }` (calls `makeRouter({ prefetch })`). `route` is reserved for the declaration. A bad command is SYG620. The first declarer (the root) gets each route first, so keep guards there.
- Options: `makeRouter({ routes, base: '/app', mode: 'hash', scroll, focus })`. SSR: `router.current(req.url)` in the seeded state; `renderToString(App, { head: list })` + `renderHead(list)`. Vike: `makeRouter({ routes, navigate })` with `navigate` from `'vike/client/router'`, registered in `pages/+drivers.js`. HEAD: a later-mounted component's title wins; `meta`/`link` merge; a model entry can also send `HEAD: (state, data) => ({ title })`. Guides: https://sygnal.js.org/guide/router/, https://sygnal.js.org/guide/head/
