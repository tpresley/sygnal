---
title: Switchable
description: Conditional component rendering
---

The `<switchable>` element conditionally renders one of several components based on a state value. This is useful for tabs, views, or any UI that switches between different content.

```jsx
import { xs } from 'sygnal'

function TabContainer({ state }) {
  return (
    <div>
      <button className="tab-home">Home</button>
      <button className="tab-settings">Settings</button>
      <switchable
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
- Non-DOM sinks (like EVENTS) from *all* components remain active
- Switching is efficient — components are pre-instantiated

## Using `Switchable` (capitalized)

```jsx
import { Switchable } from 'sygnal'

<Switchable of={{ home: HomePanel, settings: SettingsPanel }} current={state.activeTab} />
```
