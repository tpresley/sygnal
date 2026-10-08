---
title: Switchable
description: Conditional component rendering
---

The `<Switchable>` component conditionally renders one of several components based on a state value. This is useful for tabs, views, or any UI that switches between different content.

```jsx live
import { xs, Switchable } from 'sygnal'

function HomePanel() {
  return <p>Welcome home.</p>
}

function SettingsPanel() {
  return <p>Your settings.</p>
}

function TabContainer({ state }) {
  return (
    <div>
      <button className="tab-home">Home</button>
      <button className="tab-settings">Settings</button>
      <Switchable
        of={{ home: HomePanel, settings: SettingsPanel }}
        current={state.activeTab}
      />
    </div>
  )
}

TabContainer.initialState = { activeTab: 'home' }

TabContainer.intent = ({ DOM }) => ({
  SET_TAB: xs.merge(
    DOM.select('.tab-home').events('click').mapTo('home'),
    DOM.select('.tab-settings').events('click').mapTo('settings')
  )
})

TabContainer.model = {
  SET_TAB: (state, data) => ({ ...state, activeTab: data })
}
```

## Switchable Props

| Prop | Type | Description |
|------|------|-------------|
| `of` | Object | Maps names to components: `{ name: Component }` |
| `current` | String | The name of the currently active component |
| `instance` | String or Number | Optional key of the current page's instance: when it changes, the page is created again with fresh state ([below](#a-new-instance-of-a-page-instance)) |
| `state` | String or Lens | Optional state slice for the switched components |

## How It Works

- Only the `current` component's DOM is rendered
- Non-DOM sinks (EVENTS, `PARENT`, driver sinks) from *all* components remain active; a component's `PARENT` reaches the parent's `CHILD.select(Component)`
- Switching is efficient: every component is instantiated up front and stays alive while hidden, so memory grows with the number of pages (and what they hold), not with switching
- A hidden component keeps its own state and sub-components, and keeps working on the current state: its reducers, `EVENTS`/`PARENT`/`EFFECT` answers and `.context` see the state changed while it was hidden. Only its rendering waits: it doesn't re-render while hidden, and renders the current state once when switched back in (until then the previous page stays on screen, never the hidden page's old content)
- A hidden component's `connections` and `resources` pause, except the entries marked `background: true` ([below](#hidden-pages-pause-connections-and-resources))
- `current` must be one of the keys of `of` ([SYG416](/reference/errors/#syg416)), and `of` must map names to component functions ([SYG415](/reference/errors/#syg415))
- When the Switchable itself is removed, all of its components are disposed, including any nested Collections

## A new instance of a page: `instance`

Pages stay alive across switches, so a page shown for one record keeps its state when the app shows it for another (a draft typed for task 1 would still be there for task 2). Give the Switchable an `instance` key: when it changes, the current page is disposed (its `DISPOSE` action runs, its connections close, its requests are aborted) and created again with fresh state.

```jsx
import { Switchable } from 'sygnal'

function App({ state }) {
  return (
    <main>
      <Switchable
        of={{ list: TaskList, task: TaskPage }}
        current={state.page}
        instance={state.taskId}
      />
    </main>
  )
}

App.initialState = { page: 'list', taskId: null }
```

- Switching `current` without changing `instance` keeps the pages alive, as before.
- A hidden page is re-created when it's shown again with another key than the one it last had (it was hidden while the key changed). A page that was never shown takes the key it's first shown with.
- With a router, use the path: `instance={state.route.path}`. Going from `/tasks/1` to `/tasks/2` re-creates the task page; going back to a page with the path it had keeps it.
- The page sees the new state once before it is re-created (state reaches it before the Switchable re-renders with the new key), so in that moment it may start a request or open a connection for the new values; disposing the old instance aborts or closes it right away.

## Hidden pages pause connections and resources

While a page is hidden, it and every component inside it (sub-components and Collection items) declare only the [`connections`](/guide/sockets/) and `resources` entries marked `background: true`. The others pause: their sockets close (without a `close` action), and their resource requests in flight are aborted while each resource keeps its last result (or goes back to `idle` if nothing had arrived). When the page is shown again, every entry is declared again: the sockets open as new connections (`open` with `reconnected: false`) and the resources refetch, keeping their data with `refreshing: true` ([Resources and Caching](/guide/resources/)).

```jsx
function Chat({ state }) {
  return <ul>{state.messages.map((m) => <li>{m.text}</li>)}</ul>
}

Chat.initialState = { roomId: 'general', messages: [], unread: 0 }

Chat.connections = (state) => ({
  // closes while the page is hidden
  room: { socket: `/ws/rooms/${state.roomId}`, message: 'RECEIVED' },
  // stays open: counts notifications for the badge in the header
  alerts: { socket: '/ws/alerts', message: 'ALERT', background: true },
})

Chat.model = {
  RECEIVED: (state, msg) => ({ ...state, messages: [...state.messages, msg] }),
  ALERT: (state) => ({ ...state, unread: state.unread + 1 }),
}
```

- `background` goes on the entry (`{ socket, background: true }`, `{ url, background: true }`), not on the component.
- Messages a paused socket would have received are not replayed: mark a connection `background: true` when the page must not miss them while hidden.
- A declaration that isn't a set of entries (the router's `route`) stays live while hidden.

The lowercase `<switchable>` (and `<collection>`) tags also work without an import; the docs use the capitalized, imported components.
