# Sygnal Component Patterns (beyond SKILL.md)

`SKILL.md` already covers the core: component anatomy, state updates, `ABORT`, `set`/`toggle`, controlled inputs, multi-sink entries, `event()` + `EVENTS.select`, `PARENT` + `CHILD.select`, Collection, Switchable, commands + `EFFECT`, drivers, the wiring rules, and testing. The full normative spec is `llms.txt` (`node_modules/sygnal/llms.txt`, https://sygnal.js.org/llms.txt).

This file holds only the less common features. Every sample uses the canonical forms: object-form model entries, `event()` for EVENTS, `CHILD.select(Fn)`, destructured views, `ABORT` for "no change".

## Contents
1. Switchable routing
2. State lenses
3. Forms with processForm()
4. Calculated fields and context
5. Transitions
6. Portals
7. Slots
8. Refs
9. Lazy loading and Suspense
10. Lifecycle: BOOTSTRAP and DISPOSE
11. Drag and drop
12. PWA helpers
13. SSR and hydration
14. Astro
15. Vike
16. TypeScript

## 1. Switchable routing
```jsx
import { xs, ABORT, Switchable } from 'sygnal'

function Home() { return <h2 className="home">Home</h2> }
function Settings() { return <h2 className="settings">Settings</h2> }

function App({ state }) {
  return (
    <div>
      <nav>
        <button className="nav-home">Home</button>
        <button className="nav-settings">Settings</button>
      </nav>
      <Switchable of={{ home: Home, settings: Settings }} current={state.route} />
    </div>
  )
}
App.initialState = { route: 'home' }
App.intent = ({ DOM }) => ({
  SET_ROUTE: xs.merge(
    DOM.click('.nav-home').mapTo('home'),
    DOM.click('.nav-settings').mapTo('settings'),
  ),
})
App.model = {
  SET_ROUTE: (state, route) => (route === state.route ? ABORT : { ...state, route }),
}
```
Each page is a normal component; give it a slice with `state="key"` on the Switchable.

## 2. State lenses
`state="key"` gives a child one field. For anything else pass a lens `{ get, set }`:
```jsx
const userLens = {
  get: (parent) => ({ name: parent.userName, email: parent.userEmail }),
  set: (parent, child) => ({ ...parent, userName: child.name, userEmail: child.email }),
}

function UserForm({ state }) {
  return <input className="name" value={state.name} />
}
UserForm.intent = ({ DOM }) => ({ NAME: DOM.input('.name').value() })
UserForm.model = { NAME: (state, name) => ({ ...state, name }) }

function Profile({ state }) {
  return <div><UserForm state={userLens} /><p className="email">{state.userEmail}</p></div>
}
Profile.initialState = { userName: 'Ada', userEmail: 'ada@example.com' }
```

## 3. Forms with processForm()
`processForm(DOM.select('.form'), { events })` emits `{ [field name]: value, event, eventType }`. It calls `preventDefault()` on submit (`preventDefault: false` to opt out). Fields are uncontrolled here (no `value=`), so no input listener is needed.
```jsx
import { processForm } from 'sygnal'

function ContactForm({ state }) {
  return (
    <form className="contact-form">
      <input name="name" />
      <input name="email" />
      <button type="submit">Send</button>
      {state.sentTo && <p className="sent">Sent to {state.sentTo}</p>}
    </form>
  )
}
ContactForm.initialState = { sentTo: '' }
ContactForm.intent = ({ DOM }) => ({
  SUBMIT: processForm(DOM.select('.contact-form'), { events: 'submit' }),
})
ContactForm.model = {
  SUBMIT: (state, { email }) => ({ ...state, sentTo: email }),
}
```

## 4. Calculated fields and context
```jsx
function Cart({ state }) {
  return (
    <div>
      <p className="total">{state.total}</p>
      <CartLine state="first" />
    </div>
  )
}
Cart.initialState = { items: [{ price: 2, qty: 3 }], currency: 'EUR', first: { name: 'Tea' } }
Cart.calculated = {
  total: [['items'], (state) => state.items.reduce((sum, i) => sum + i.price * i.qty, 0)],
}
Cart.context = { currency: (state) => state.currency }   // every descendant reads context.currency

function CartLine({ state, context }) {
  return <p className="line">{state.name} ({context.currency})</p>
}
```
Calculated fields are read-only: don't set them in reducers.

## 5. Transitions
```jsx
import { Transition } from 'sygnal'

function Notice({ state }) {
  return (
    <Transition name="fade" duration={300}>
      {state.visible && <div className="notice">{state.message}</div>}
    </Transition>
  )
}
```
CSS classes applied: `fade-enter-from` / `fade-enter-active` / `fade-enter-to` and the `leave` equivalents. Also `appear` (animate the first render). Works around a Collection item's root element too.

## 6. Portals
Portal content renders into another container (`<div id="modal-root">` in index.html), outside the component's isolation scope, so select its events at document level.
```jsx
import { Portal } from 'sygnal'

function Modal({ state }) {
  return (
    <div>
      <button className="open">Open</button>
      {state.open && (
        <Portal target="#modal-root">
          <div className="overlay"><button className="close">Close</button></div>
        </Portal>
      )}
    </div>
  )
}
Modal.initialState = { open: false }
Modal.intent = ({ DOM }) => ({
  OPEN:  DOM.click('.open'),
  CLOSE: DOM.select('document').select('.close').events('click'),
})
Modal.model = {
  OPEN:  (state) => ({ ...state, open: true }),
  CLOSE: (state) => ({ ...state, open: false }),
}
```

## 7. Slots
```jsx
import { Slot } from 'sygnal'

function Card({ slots }) {
  return (
    <div className="card">
      <header>{...(slots.header || [])}</header>
      <main>{...(slots.default || [])}</main>
    </div>
  )
}

function Page() {
  return (
    <Card>
      <Slot name="header"><h2>Title</h2></Slot>
      <p>Body content (the default slot)</p>
    </Card>
  )
}
```
Content passed in slots belongs to the parent: the parent's intent selects its classes.

## 8. Refs
```jsx
import { createRef, createRef$ } from 'sygnal'

const field = createRef()      // field.current: the element after mount, null after unmount
const box = createRef$()       // box.stream: emits the element on mount, null on unmount

function Search({ state }) {
  return <div ref={box}><input className="q" ref={field} value={state.q} /></div>
}
Search.initialState = { q: '' }
Search.intent = ({ DOM }) => ({ Q: DOM.input('.q').value(), FOCUS: box.stream.filter(Boolean) })
Search.model = {
  Q:     (state, q) => ({ ...state, q }),
  FOCUS: { EFFECT: () => field.current?.focus() },
}
```

## 9. Lazy loading and Suspense
```jsx
import { lazy, Suspense } from 'sygnal'

const Chart = lazy(() => import('./Chart.jsx'))

function Dashboard() {
  return (
    <Suspense fallback={<div className="loading">Loading chart</div>}>
      <Chart state="chart" />
    </Suspense>
  )
}
Dashboard.initialState = { chart: { points: [] } }
```
A child is ready at once unless its model has a `READY` sink; then it is not ready until that sink sends `true`:
```jsx
function Report({ state }) {
  return <div className="report">{state.rows.length} rows</div>
}
Report.intent = ({ API }) => ({ LOADED: API.select('rows') })
Report.model = {
  BOOTSTRAP: { API: () => ({ category: 'rows', value: null }) },
  LOADED: {
    STATE: (state, { value }) => ({ ...state, rows: value }),
    READY: () => true,
  },
}
```

## 10. Lifecycle: BOOTSTRAP and DISPOSE
```jsx
import { event } from 'sygnal'

function Clock({ state }) {
  return <time className="clock">{state.now}</time>
}
Clock.initialState = { now: 0, id: 'clock' }
Clock.intent = ({ TIMER }) => ({ TICK: TIMER.select('tick') })
Clock.model = {
  BOOTSTRAP: { TIMER: () => ({ category: 'tick', value: 1000 }) },   // once, after mount
  TICK:      (state, { value }) => ({ ...state, now: value }),
  DISPOSE:   { EVENTS: event('CLOCK_GONE', (state) => ({ id: state.id })) },  // on unmount
}

function ClockLog({ state }) {
  return <p className="log">{state.gone}</p>
}
ClockLog.intent = ({ EVENTS }) => ({ GONE: EVENTS.select('CLOCK_GONE') })
ClockLog.model = { GONE: (state, { id }) => ({ ...state, gone: id }) }
```
`dispose$` (intent source) emits once on unmount, for stream composition such as `.endWhen(dispose$)`.

## 11. Drag and drop
For drags across components, use the drag driver: it listens at document level, so isolation doesn't block it.
```js
// main.js
import { run, makeDragDriver } from 'sygnal'
import Board from './Board.jsx'
run(Board, { DND: makeDragDriver() })
```
```jsx
import { ABORT } from 'sygnal'

function Board({ state }) {
  return (
    <div className="board">
      {state.lanes.map((lane) => (
        <div className="lane" data={{ lane: lane.id }}>
          {lane.cards.map((card) => <div className="card" draggable="true" data={{ id: card.id }}>{card.title}</div>)}
        </div>
      ))}
    </div>
  )
}
Board.initialState = { dragging: null, lanes: [{ id: 'a', cards: [{ id: 1, title: 'One' }] }, { id: 'b', cards: [] }] }
Board.intent = ({ DND }) => ({
  DRAG: DND.dragstart('card').data('id', Number),   // payload { element, dataset }; .data() reads dataset
  DROP: DND.drop('lane'),                           // payload { dropZone, insertBefore }
  END:  DND.dragend('card'),
})
Board.model = {
  BOOTSTRAP: {
    DND: () => [
      { category: 'card', draggable: '.card' },
      { category: 'lane', dropZone: '.lane', accepts: 'card' },
    ],
  },
  DRAG: (state, id) => ({ ...state, dragging: id }),
  DROP: (state, { dropZone }) => {
    const to = dropZone.dataset.lane
    const card = state.lanes.flatMap((l) => l.cards).find((c) => c.id === state.dragging)
    if (!card) return ABORT
    const lanes = state.lanes.map((l) => ({
      ...l,
      cards: l.id === to ? [...l.cards.filter((c) => c !== card), card] : l.cards.filter((c) => c !== card),
    }))
    return { ...state, lanes, dragging: null }
  },
  END: (state) => (state.dragging === null ? ABORT : { ...state, dragging: null }),
}
```
Within one component, `processDrag({ draggable: DOM.select('.card'), dropZone: DOM.select('.lane') })` returns `{ dragStart$, dragEnd$, dragOver$, drop$ }`.

## 12. PWA helpers
```js
// main.js
import { run, makeServiceWorkerDriver } from 'sygnal'
import App from './App.jsx'
run(App, { SW: makeServiceWorkerDriver('/sw.js', { scope: '/' }) })
```
```jsx
import { onlineStatus$, createInstallPrompt } from 'sygnal'

const install = createInstallPrompt()   // create once, at module level

function App({ state }) {
  return (
    <div>
      {state.offline && <p className="offline">Offline</p>}
      {state.updateReady && <button className="update">Update</button>}
      {state.canInstall && <button className="install">Install</button>}
    </div>
  )
}
App.initialState = { offline: false, updateReady: false, canInstall: false }
App.intent = ({ DOM, SW }) => ({
  ONLINE:      onlineStatus$,                              // boolean, emits navigator.onLine first
  WAITING:     SW.select('waiting'),                       // also installed, activated, controlling, error, message
  UPDATE:      DOM.click('.update'),
  CAN_INSTALL: install.select('beforeinstallprompt'),
  INSTALL:     DOM.click('.install'),
})
App.model = {
  ONLINE:      (state, online) => ({ ...state, offline: !online }),
  WAITING:     (state) => ({ ...state, updateReady: true }),
  UPDATE:      { SW: () => ({ action: 'skipWaiting' }), EFFECT: () => window.location.reload() },
  CAN_INSTALL: (state) => ({ ...state, canInstall: true }),
  INSTALL:     { STATE: (state) => ({ ...state, canInstall: false }), EFFECT: () => install.prompt() },
}
```
SW commands: `{ action: 'skipWaiting' | 'postMessage' | 'unregister', data? }`. The `vite-pwa` template of create-sygnal-app ships a working setup.

## 13. SSR and hydration
`renderToString(Component, { state?, props?, context?, hydrateState? })` renders HTML without a DOM. Intent and model don't run; Portal and Slot render inline, Transition unwraps, Suspense renders its children, `lazy()` renders its placeholder (import directly for SSR).
```js
// server.js
import { renderToString } from 'sygnal'
import App from './App.jsx'

export function render(state) {
  return renderToString(App, { state, hydrateState: true })   // appends <script>window.__SYGNAL_STATE__=...</script>
}
```
```js
// main.js (client)
import { run } from 'sygnal'
import App from './App.jsx'

if (window.__SYGNAL_STATE__) App.initialState = window.__SYGNAL_STATE__
run(App)
```
Use `hydrateState: '__MY_STATE__'` (a unique name) when a page has more than one app.

## 14. Astro
```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

export default defineConfig({ integrations: [sygnal()] })
```
```astro
---
import Counter from '../components/Counter.jsx'
---
<Counter client:load />
```
Directives: `client:load`, `client:visible`, `client:idle`. Each island is its own app (EVENTS don't cross islands).

## 15. Vike
```js
// vite.config.js
import { defineConfig } from 'vite'
import vike from 'vike/plugin'
import sygnal from 'sygnal/vite'

export default defineConfig({ plugins: [sygnal({ disableHmr: true }), vike()] })
```
```js
// pages/+config.js
import vikeSygnal from 'sygnal/config'
export default { extends: [vikeSygnal] }
```
Pages are ordinary components in `pages/<route>/+Page.jsx` (also `+Layout.jsx`, `+Head.jsx`). `+data.js` returns data that is merged into the page's `initialState`. `ssr: false` in a page's `+config.js` makes it client-only; `import { ClientOnly } from 'sygnal/vike/ClientOnly'` wraps browser-only children (`<ClientOnly fallback={...}>`).

## 16. TypeScript
```tsx
import type { RootComponent, Component } from 'sygnal'

type Item = { id: number; text: string; done: boolean }
type State = { draft: string; items: Item[] }
type Actions = { DRAFT: string; TOGGLE: number }

const App: RootComponent<State, {}, Actions> = ({ state }) => (
  <div>
    <input className="draft" value={state.draft} />
    <ul>{state.items.map((i) => <li className="item" data={{ id: i.id }}>{i.text}</li>)}</ul>
  </div>
)
App.initialState = { draft: '', items: [] }
App.intent = ({ DOM }) => ({
  DRAFT:  DOM.input('.draft').value(),
  TOGGLE: DOM.click('.item').data('id', Number),
})
App.model = {
  DRAFT:  (state, draft) => ({ ...state, draft }),
  TOGGLE: (state, id) => ({ ...state, items: state.items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) }),
}

type RowProps = { showDelete: boolean }
const Row: Component<Item, RowProps, {}, { REMOVE: null }> = ({ state, showDelete }) => (
  <div>{state.text}{showDelete && <button className="remove">x</button>}</div>
)
Row.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
Row.model = { REMOVE: () => undefined }
```
Generic order: `RootComponent<State, Drivers, Actions, Calculated, Context>`, `Component<State, Props, Drivers, Actions, Calculated, Context>`. `exactState<State>()` returns a checker that rejects extra keys: `const asState = exactState<State>()`, then `return asState({ ...state, draft })`. Register EVENTS types globally with `declare module 'sygnal' { interface SygnalEvents { DOC_SAVED: { id: string } } }` to type-check `event()` and `EVENTS.select()`.
