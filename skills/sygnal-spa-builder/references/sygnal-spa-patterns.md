# Sygnal SPA Patterns

## Table Of Contents

1. Root App Scaffold
2. Route-Like View Switching
3. Collection Rendering
4. Intent/Model Driver Flow
5. Refactor Checklist

## 1. Root App Scaffold

```js
import { run } from 'sygnal'

function RootComponent({ state }) {
  return (
    <div className="app-shell">
      <h1>{state.title}</h1>
      <switchable
        of={{ home: HomePage, settings: SettingsPage }}
        current={state.route}
        state="pages"
      />
    </div>
  )
}

RootComponent.initialState = {
  title: 'Sygnal App',
  route: 'home',
  pages: {
    home: { loading: false, items: [] },
    settings: { theme: 'light' }
  }
}

RootComponent.intent = ({ DOM }) => ({
  GO_HOME: DOM.select('.go-home').events('click').mapTo('home'),
  GO_SETTINGS: DOM.select('.go-settings').events('click').mapTo('settings')
})

RootComponent.model = {
  GO_HOME: (state, route) => ({ ...state, route }),
  GO_SETTINGS: (state, route) => ({ ...state, route })
}

run(RootComponent, {}, { mountPoint: '#root' })
```

## 2. Route-Like View Switching

Use `<switchable>` for SPA page transitions driven by state:

```jsx
<switchable
  of={{ dashboard: DashboardPage, profile: ProfilePage, help: HelpPage }}
  current={state.route}
  state="pages"
/>
```

- Keep route in state (`state.route`).
- Use reducers to change route (`SET_ROUTE`).
- Keep per-page data under `pages` or another mapped subtree.

## 3. Collection Rendering

Use `<collection>` for arrays of repeated components:

```jsx
<collection of={TodoItem} from="todos" />
```

- Ensure `state.todos` is an array.
- Keep item reducers local to `TodoItem`; Sygnal maps updates back into the array.
- Remove an item by returning `undefined` as the item state in reducer flow.

## 4. Intent/Model Driver Flow

Pattern for side effects with purity:

1. Read source events in `.intent`.
2. Emit action streams (`LOAD_USERS`, `SAVE_FORM`).
3. Handle action in `.model`.
4. Send driver command (`API`, `HTTP`, custom sink) or state reducer.
5. Consume driver response stream in `.intent`.
6. Reduce response into state in `.model`.

Note on subcomponents:
- If you do not set a `state` mapping/lens on a subcomponent, it receives shared app state by default.
- In that default case, prefer handling DOM events in the subcomponent's own `.intent` and updating shared state in that same subcomponent's `.model`.
- Use `PARENT`/`CHILD` relay only when you need explicit event forwarding semantics, not for routine shared-state updates.

Example shape:

```js
MyComponent.intent = ({ DOM, API }) => ({
  LOAD: DOM.select('.load').events('click'),
  LOADED: API.users$
})

MyComponent.model = {
  LOAD: {
    API: () => ({ resource: 'users', method: 'GET' }),
    STATE: (state) => ({ ...state, loading: true })
  },
  LOADED: (state, users) => ({ ...state, loading: false, users })
}
```

## 5. Refactor Checklist

- Preserve `.intent` trigger semantics.
- Preserve `.model` action names and payload shapes unless intentionally changed.
- Keep state mapping (`state="..."` or lens) compatible with child assumptions.
- Keep view functions side-effect free.
- Keep driver contracts stable (request/response format).
