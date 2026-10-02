---
title: Switchable
description: Conditional component rendering
---

The `<Switchable>` component conditionally renders one of several components based on a state value. This is useful for tabs, views, or any UI that switches between different content.

```jsx
import { xs, Switchable } from 'sygnal'

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
| `state` | String or Lens | Optional state slice for the switched components |

## How It Works

- Only the `current` component's DOM is rendered
- Non-DOM sinks (EVENTS, `PARENT`, driver sinks) from *all* components remain active; a component's `PARENT` reaches the parent's `CHILD.select(Component)`
- Switching is efficient — components are pre-instantiated
- A hidden component keeps its own state and sub-components; it doesn't re-render while hidden and shows the current state when switched back in
- `current` must be one of the keys of `of` ([SYG416](/reference/errors/#syg416)), and `of` must map names to component functions ([SYG415](/reference/errors/#syg415))
- When the Switchable itself is removed, all of its components are disposed, including any nested Collections

The lowercase `<switchable>` (and `<collection>`) tags also work without an import; the docs use the capitalized, imported components.
