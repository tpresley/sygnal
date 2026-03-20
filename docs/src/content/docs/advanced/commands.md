---
title: "Commands"
description: "Send imperative commands from parent to child components"
---

Send commands from a parent component to a specific child using `createCommand()`:

```jsx
import { createCommand } from 'sygnal'

const playerCmd = createCommand()

function App({ state }) {
  return (
    <div>
      <button className="play-btn">Play</button>
      <button className="seek-btn">Seek</button>
      <VideoPlayer commands={playerCmd} />
    </div>
  )
}

App.intent = ({ DOM }) => ({
  PLAY: DOM.select('.play-btn').events('click'),
  SEEK: DOM.select('.seek-btn').events('click'),
})

App.model = {
  PLAY: () => { playerCmd.send('play'); return ABORT },
  SEEK: () => { playerCmd.send('seek', { time: 30 }); return ABORT },
}
```

The child receives commands through the `commands$` source, which is automatically available when a `Command` object is passed as a prop:

```jsx
function VideoPlayer({ state }) {
  return <video className="player" src={state.src} />
}

VideoPlayer.intent = ({ commands$ }) => ({
  PLAY: commands$.select('play'),
  SEEK: commands$.select('seek'),
})

VideoPlayer.model = {
  PLAY: (state) => ({ ...state, playing: true }),
  SEEK: (state, { time }) => ({ ...state, currentTime: time }),
}
```

## How It Works

`createCommand()` returns an object the parent uses to send commands:

- **`send(type, data?)`** — Send a named command with optional data

When a `Command` is passed as any prop to a child component, Sygnal automatically provides a `commands$` source in the child's intent:

- **`commands$.select(type)`** — Returns a stream that emits the `data` argument each time a command of that type is sent

The prop name doesn't matter — you can call it `commands`, `cmd`, `actions`, or anything. Sygnal detects the Command object by its internal marker.

## Sending Data

The second argument to `send()` is extracted by `select()`:

```jsx
// Parent sends
cmd.send('set-color', '#ff0000')
cmd.send('set-size', { width: 100, height: 50 })

// Child receives
Widget.intent = ({ commands$ }) => ({
  SET_COLOR: commands$.select('set-color'),  // emits '#ff0000'
  SET_SIZE:  commands$.select('set-size'),   // emits { width: 100, height: 50 }
})
```

If `send()` is called without a data argument, `select()` emits `undefined`. This works fine for signal-style commands like `'play'` or `'reset'` where you only care that the command fired.

## Using ABORT

When the parent only needs to forward a command without updating its own state, use `ABORT`:

```jsx
import { ABORT } from 'sygnal'

App.model = {
  PLAY: () => { playerCmd.send('play'); return ABORT },
}
```

`ABORT` prevents the reducer from writing a new state, so the parent doesn't re-render.

## When to Use Commands vs Other Patterns

| Pattern | Direction | Use Case |
|---------|-----------|----------|
| `createCommand()` | Parent → Child | Imperative actions: play, pause, reset, scroll-to |
| `PARENT` / `CHILD` | Child → Parent | Data and events flowing upward |
| `EVENTS` driver | Any → Any | Global broadcast (notifications, theme changes) |
| `context` | Parent → Descendants | Shared reactive data (theme, user, locale) |

Commands are the right choice when a parent needs to tell a specific child to *do* something, rather than passing it data to render.
