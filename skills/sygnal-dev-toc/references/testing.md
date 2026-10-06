# Testing your change

Extends the basic test in SKILL.md: `simulateEvent`, waiting (`t.next`, `t.waitForState`, `t.settle`), fake timers, the action log, driver fakes (HTTP, resources, sockets, router), TypeScript, real-DOM tests.

## Contents
- Events and waiting
- Timer tests (fake timers)
- The action log and `simulateAction`
- HTTP, resources, sockets, router fakes
- TypeScript, mock vs real DOM

## Events and waiting
- `simulateEvent(sel, type, init?)`: init `{ value }`, `{ checked }`, `{ key: 'Enter' }`, `{ data: { id: 2 } }`; `'document'` targets `DOM.select('document')` listeners. Calls made before the component is ready are buffered. `sel` is a CSS selector over the rendered tree (not `:has()`, `+`, `~`); if it matches nothing within 300ms the test fails naming it (check `t.html()`; `{ allowMissing: true }` drops the event).
- `t.next(pred)` matches only future states. `t.waitForState(pred)` also matches states already recorded (e.g. the initial one): use it only for a state that can't already exist. Both resolve after the whole tree renders. `t.settle()` doesn't wait out a model `next('X', data, ms)` longer than 20ms: `await t.next(pred)` instead. `t.state` is the latest state (with calculated fields); `t.states`, `t.emitted` (EVENTS sent) and `t.sinkValues('PARENT')` (any sink, children's too) are live arrays. `t.html()` is serialised like `innerHTML` (`Couldn't`, not `&#39;`); before the first render it throws: `await t.ready()`.

## Timer tests (fake timers)
- Timer tests: use fake timers, never sleep out a real delay. `t.next`/`t.waitForState`/`t.settle`/`t.ready` advance the fake clock themselves; `vi.advanceTimersByTimeAsync(ms)` moves it by hand:
```js
beforeEach(() => vi.useFakeTimers())
afterEach(() => { t?.dispose(); vi.useRealTimers() })
it('searches once, 300 ms after the last keystroke', async () => {
  t = renderComponent(Search)                       // HTTP needs no driver in tests
  await t.ready()                                   // mount first, so the input is timed from here
  for (const q of ['d', 'du', 'dune']) { t.simulateEvent('.q', 'input', { value: q }); await vi.advanceTimersByTimeAsync(50) }
  await vi.advanceTimersByTimeAsync(249)
  expect(t.requests('HTTP')).toHaveLength(0)
  await t.next(s => s.status === 'Searching…')      // advances to the debounce, no real wait
  expect(t.requests('HTTP')).toHaveLength(1)
  await t.respond('HTTP', { results: [{ title: 'Dune' }] }, 'RESULTS')  // delivered as RESULTS, then rendered
  expect(t.state.status).toBe('')
})
```

## The action log and simulateAction
- `t.actions` logs every action, `{ type, data, component, sinks, cause, at }`: when "nothing happened", it shows whether the action ran and what it produced. `t.explain(s => s.count === 5)` names the action behind a state.

## HTTP, resources, sockets, router fakes
- `t.simulateAction('LOADED', data)` pushes an action into intent → model. **Drivers need no wiring in tests**: the HTTP fake is the real `makeFetchDriver` over an in-memory fetch. `t.requests('HTTP')` lists requests as objects (a string URL is `{ url }`). `await t.respond('HTTP', body, target?)` answers one (its `ok` action gets the body); `await t.fail('HTTP', 404 | error, target?)` fails it. Both resolve once reduced and rendered. Target: an action/key name, a resource name, a URL, a partial request (`{ url: '/items/2' }`) or a predicate; none = the newest pending. Identical requests (a refetch): `{ nth: 0 }` is exactly `t.requests('HTTP')[0]` (`-1` the newest). A superseded, aborted or answered request **throws at the call**. Write `latest: true` on the request: the fake can't see main.js.
- Resources: a fetch is `{ url, resource: 'quote' }`: `await t.respond('HTTP', data, 'quote')`. Right after a `simulate*`, `t.respond` waits for the fetch it causes. Cache: `renderComponent(C, { http: { cache: queryCache({ staleTime: 2000 }) } })`, `t.cache('HTTP')` (`{ key, stale, data }`), `t.focus()`, `t.online()`.
- Sockets: `connections` get a fake `WS` (the real driver; they open by themselves, `{ autoConnect: false }` waits for `await t.open('WS')`). `await t.push('WS', { text: 'hi' })` = a server frame; `await t.drop('WS', { code: 1011 })` = a drop the app didn't make (retry: `await vi.advanceTimersByTimeAsync(1000)`); `t.sent('WS')` = the `{ to, json }` sent; `t.connections('WS')` = `{ name, url, state }`.
- Router: `renderComponent(App, { router, url: '/tasks/2' })` runs the real router on an in-memory history: `await t.navigate('/admin')` or `t.navigate({ to: 'task', params: { id: 1 } })`, `await t.back()`, `t.location.path`, `t.sent('ROUTER')` (commands); a `simulateEvent` click on a link goes through the router. `t.head()` = `{ title, meta, link }`.

## TypeScript, mock vs real DOM
- TypeScript: `renderComponent` infers the state; declare `let t: RenderResult<State>`, not `any`. Without the Vite plugin, `import 'sygnal/diagnostics'` in the test.
- `t.query(sel)` / `t.queryAll(sel)` work on the mock DOM: snapshots of what the view rendered (`textContent`, `value`, `checked`, `disabled`, `getAttribute`, `querySelector`). State the user typed/clicked, focus: `renderComponent(C, { dom: 'real' })` in a jsdom test (`// @vitest-environment jsdom`), same `t.*` API in ONE suite; `'click'` toggles a checkbox, `'focus'` moves `document.activeElement`.
