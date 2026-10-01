---
title: Astro
description: Using Sygnal with Astro
---

Sygnal includes a first-class Astro integration for using Sygnal components as interactive islands in Astro sites.

## Setup

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

export default defineConfig({
  integrations: [sygnal()]
})
```

## Usage

Use Sygnal components in `.astro` files with client directives for hydration:

```astro
---
import Counter from '../components/Counter.jsx'
---

<Counter client:load />
<Counter client:visible title="Visitors" />
<Counter client:idle />
```

## Props

Props passed in the Astro template reach the view like any component's props: spread at the top level of the first argument, next to `state`. This is the same on the server and on the client:

```jsx
// src/components/Counter.jsx
function Counter({ state, title }) {
  return (
    <div>
      <h2>{title}</h2>
      <button className="inc">{state.count}</button>
    </div>
  )
}

Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (state) => ({ ...state, count: state.count + 1 }) }

export default Counter
```

A prop named `initialState` overrides the component's `.initialState` for that island. `state`, `context`, `children`, `slots` and `peers` are reserved view arguments, so don't use them as prop names.

## Diagnostics in Dev

In `astro dev`, islands get the same [diagnostics](/guide/diagnostics/) as a Vite app: the integration adds the Sygnal Vite plugin, which turns on the dev checks for the island client and runs `sygnal-check` (when installed). All diagnostics modes, strict mode and the ignore list are supported, with the same options as the [Vite plugin](/integration/bundler-config/#plugin-options):

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

export default defineConfig({
  integrations: [
    sygnal({
      diagnostics: { mode: 'warn', strict: true },
      check: { include: ['src/components'] },
    }),
  ],
})
```

Islands share the app's single Sygnal core, so diagnostics and devtools name each island after its component. Nothing is added to `astro build` output.

## How It Works

- On the server, the component is rendered to HTML with `renderToString()`, using its `initialState` (or the `initialState` prop) and the island props
- On the client, the island is started with `run()` on the server-rendered element, with the same props
- Re-hydrating an island disposes the previous instance first
