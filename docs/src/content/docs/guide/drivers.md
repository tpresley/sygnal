---
title: Drivers
description: Side effects and custom driver creation
---

Drivers handle all side effects in a Sygnal application. They are the bridge between your pure component code and the outside world.

Every driver has two sides:
- **Source** — Provides data *to* your component (e.g., DOM events, API responses)
- **Sink** — Receives commands *from* your component (e.g., state updates, log messages)

## Default Drivers

Sygnal's `run()` function automatically includes these drivers:

| Driver / Source | Source (in intent) | Sink (in model) |
|--------|--------|------|
| `DOM` | `.select(css).events(event)` or shorthand `.click(css)` | Handled automatically by the view |
| `STATE` | `.stream` — The state Observable | Reducer functions from model |
| `EVENTS` | `.select(type)` — Custom event bus | Event objects `{ type, data }` |
| `CHILD` | `.select(ComponentFn)` — Events from child components | — |
| `PARENT` | — | Values sent to the parent component |
| `READY` | — | Boolean signal for [Suspense](/advanced/suspense/) boundaries |
| `LOG` | — | Any value — logged to the console |
| `props$` | Stream of props passed from the parent | — |
| `children$` | Stream of children passed from the parent | — |
| `context$` | Stream of merged [context](/guide/context/) values from ancestors | — |
| `dispose$` | Emits `true` once on [unmount](/advanced/disposal/) | — |

## Adding Custom Drivers

Pass additional drivers as the second argument to `run()`:

```javascript
import { run } from 'sygnal'
import RootComponent from './RootComponent.jsx'
import myCustomDriver from './drivers/myCustomDriver'

run(RootComponent, {
  CUSTOM: myCustomDriver
})
```

The driver is then available as both a source (in intent) and a sink (in model):

```jsx
MyComponent.intent = ({ DOM, CUSTOM }) => ({
  DATA_RECEIVED: CUSTOM.select('some-category')
})

MyComponent.model = {
  FETCH: {
    CUSTOM: (state) => ({ category: 'some-category', url: '/api/data' })
  }
}
```

## The Event Bus (EVENTS Driver)

The EVENTS driver provides a lightweight pub/sub system for cross-component communication:

```jsx
// Publishing events (in model)
Publisher.model = {
  NOTIFY: {
    EVENTS: (state) => ({ type: 'notification', data: { message: 'Hello!' } })
  }
}

// Subscribing to events (in intent)
Subscriber.intent = ({ EVENTS }) => ({
  HANDLE_NOTIFICATION: EVENTS.select('notification')
})
```

## The LOG Driver

The LOG driver sends values to the browser console:

```jsx
MyComponent.model = {
  SOME_ACTION: {
    STATE: (state) => ({ ...state, updated: true }),
    LOG: (state, data) => `Action triggered with: ${data}`
  }
}
```

## Writing a Driver from Scratch

A Cycle.js driver is a function that takes a sink stream and returns a source object:

```javascript
function myDriver(sink$) {
  // Listen to commands from the app
  sink$.addListener({
    next: (command) => {
      // Perform side effects here
      console.log('Received command:', command)
    }
  })

  // Return a source for the app to observe
  return {
    select: (type) => {
      // Return a filtered stream
    }
  }
}
```

## Using driverFromAsync()

For the common case of wrapping a Promise-returning function as a driver, use `driverFromAsync()`:

```javascript
import { driverFromAsync } from 'sygnal'

const apiDriver = driverFromAsync(
  async (url) => {
    const response = await fetch(url)
    return response.json()
  },
  {
    selector: 'endpoint',  // Property name for categorizing requests
    args: 'url',           // Property to extract as function arguments
    return: 'data',        // Property name for the return value
    pre: (incoming) => incoming,         // Pre-process incoming commands
    post: (result, incoming) => result   // Post-process results
  }
)

// Register the driver
run(RootComponent, { API: apiDriver })
```

### driverFromAsync() Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `selector` | String | `'category'` | Property used to categorize/filter responses |
| `args` | String, Array, or Function | `'value'` | How to extract function arguments from incoming commands |
| `return` | String | `'value'` | Property name to wrap the return value in |
| `pre` | Function | Identity | Pre-process incoming sink values |
| `post` | Function | Identity | Post-process results before sending to source |

### Using the Driver in Components

```jsx
// Intent — receive API responses
MyComponent.intent = ({ API }) => ({
  DATA_LOADED: API.select('users')  // Filter by the selector property
})

// Model — send API requests
MyComponent.model = {
  FETCH_USERS: {
    API: (state) => ({ endpoint: 'users', url: '/api/users' })
  },
  DATA_LOADED: (state, data) => ({ ...state, users: data.data })
}
```
