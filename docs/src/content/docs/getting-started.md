---
title: 'Quick Start'
description: 'Get up and running with Sygnal in minutes'
---

Sygnal is an intuitive framework for building fast, small, and composable web components and applications. It uses functional reactive programming under the hood but keeps the developer experience simple and familiar.

If you've used React, you'll feel right at home. If you haven't, don't worry — Sygnal is easy to learn.

## What You'll Build

By the end of this guide, you'll have a working Sygnal application with interactive components that respond to user input and manage state automatically.

## Prerequisites

- [Node.js](https://nodejs.org/) (v12 or higher)
- A package manager (npm, yarn, or pnpm)

## Quick Start

The fastest way to get started is with `create-sygnal-app`:

```bash
npm create sygnal-app my-app
```

You'll be prompted to choose a template and language:

- **Vite (SPA)** — Single-page app with Vite + HMR
- **Vike (SSR)** — File-based routing with SSR, layouts, and data fetching
- **Astro** — Content-focused site with island hydration

Each template is available in **JavaScript** or **TypeScript**.

After scaffolding, start the dev server:

```bash
cd my-app
npm run dev
```

Open `http://localhost:5173` in your browser (or the port shown in the terminal).

## Manual Setup

If you prefer to set things up yourself:

### 1. Create a project and install Sygnal

```bash
mkdir my-app && cd my-app
npm init -y
npm install sygnal
npm install -D vite
```

### 2. Configure Vite

Create `vite.config.js`:

```javascript
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
})
```

The Sygnal Vite plugin configures JSX and [HMR](/integration/hmr/) automatically. See [Bundler Configuration](/integration/bundler-config/) for manual setup or other bundlers.

### 3. Create the HTML entry point

Create `index.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My Sygnal App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

### 4. Create your first component

Create `src/RootComponent.jsx`:

```jsx
function RootComponent({ state }) {
  return (
    <div>
      <h1>Hello {state.name}!</h1>
    </div>
  )
}

RootComponent.initialState = {
  name: 'World'
}

export default RootComponent
```

### 5. Start the application

Create `src/main.js`:

```javascript
import { run } from 'sygnal'
import RootComponent from './RootComponent.jsx'

run(RootComponent)
```

### 6. Run it

Add a dev script to `package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
```

```bash
npm run dev
```

Open your browser to `http://localhost:5173` and you'll see "Hello World!".

## Your First Interactive Component

Static content isn't very exciting. Let's make a counter that responds to clicks.

Replace `src/RootComponent.jsx` with:

```jsx
function RootComponent({ state }) {
  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button className="increment">+</button>
      <button className="decrement">-</button>
    </div>
  )
}

// Set the starting state
RootComponent.initialState = {
  count: 0
}

// Intent: WHEN should things happen?
RootComponent.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click'),
  DECREMENT: DOM.select('.decrement').events('click')
})

// Model: WHAT should happen?
RootComponent.model = {
  INCREMENT: (state) => ({ count: state.count + 1 }),
  DECREMENT: (state) => ({ count: state.count - 1 })
}

export default RootComponent
```

Save the file and watch the browser update. Click the buttons to see the count change.

### What Just Happened?

Sygnal uses a pattern called **Model-View-Intent** (MVI):

1. **View** (the function itself) — *How* things look. Renders the UI based on the current state.
2. **Intent** (`.intent`) — *When* things happen. Listens for DOM events and maps them to named actions.
3. **Model** (`.model`) — *What* happens. Defines how each action updates the state.

The data flows in one direction: **DOM events → Intent → Model → State → View → DOM**.

## Working with User Input

Let's build a component with two-way data binding:

```jsx
function Greeter({ state }) {
  return (
    <div>
      <h1>Hello {state.name}!</h1>
      <input className="name-input" value={state.name} />
    </div>
  )
}

Greeter.initialState = { name: 'World' }

Greeter.intent = ({ DOM }) => ({
  CHANGE_NAME: DOM.input('.name-input').value()
})

Greeter.model = {
  CHANGE_NAME: (state, name) => ({ name })
}

export default Greeter
```

Notice the `.value()` in the intent. This extracts `e.target.value` from the input event before passing it to the model. The `name` parameter in the model reducer receives the string directly. Other extraction helpers include `.checked()`, `.data('name')`, and `.key()` — see the [Intent guide](/guide/intent/) for details.

## Adding Child Components

Components nest naturally, just like in React:

```jsx
// Header.jsx
function Header({ title }) {
  return <h1>{title}</h1>
}
export default Header
```

```jsx
// RootComponent.jsx
import Header from './Header.jsx'

function RootComponent({ state }) {
  return (
    <div>
      <Header title="My App" />
      <p>Count: {state.count}</p>
      <button className="increment">+</button>
    </div>
  )
}

RootComponent.initialState = { count: 0 }

RootComponent.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click')
})

RootComponent.model = {
  INCREMENT: (state) => ({ count: state.count + 1 })
}

export default RootComponent
```

### Passing State to Children

By default, child components receive the entire application state. To give a child only a slice of state, use the `state` prop:

```jsx
function RootComponent({ state }) {
  return (
    <div>
      {/* UserCard only sees state.user as its root state */}
      <UserCard state="user" />
    </div>
  )
}

RootComponent.initialState = {
  user: { name: 'Alice', age: 30 },
  settings: { theme: 'dark' }
}
```

Inside `UserCard`, `state` will be `{ name: 'Alice', age: 30 }` — not the entire app state. If `UserCard` updates its state, those changes flow back up to `state.user` in the parent automatically.

## Hot Module Replacement (HMR)

Sygnal supports HMR out of the box, preserving your application state across code changes:

```javascript
// src/main.js
import { run } from 'sygnal'
import RootComponent from './RootComponent.jsx'

const { hmr, dispose } = run(RootComponent)

if (import.meta.hot) {
  import.meta.hot.accept('./RootComponent.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
```

Now when you edit your component, the page updates without losing state.

## Using Without JSX

If you prefer not to use JSX, import `h` from Sygnal and use hyperscript-style calls:

```javascript
import { h, run } from 'sygnal'

function RootComponent({ state }) {
  return h('div', [
    h('h1', `Count: ${state.count}`),
    h('button.increment', '+')
  ])
}

RootComponent.initialState = { count: 0 }

RootComponent.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.increment').events('click')
})

RootComponent.model = {
  INCREMENT: (state) => ({ count: state.count + 1 })
}

run(RootComponent)
```

## Using with Astro

Sygnal integrates natively with Astro:

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

export default defineConfig({
  integrations: [sygnal()]
})
```

Then use Sygnal components in `.astro` files with client directives:

```astro
---
import Counter from '../components/Counter.jsx'
---

<Counter client:load />
```

## Using with Vike

Sygnal integrates with [Vike](https://vike.dev) for file-based routing with SSR:

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
import vike from 'vike/plugin'

export default defineConfig({
  plugins: [sygnal({ disableHmr: true }), vike()],
})
```

```javascript
// pages/+config.js
import vikeSygnal from 'sygnal/config'
export default { extends: [vikeSygnal] }
```

Then create page components in `pages/`:

```jsx
// pages/index/+Page.jsx
function Page({ state }) {
  return <h1>Count: {state.count}</h1>
}
Page.initialState = { count: 0 }
export default Page
```

See the [Vike integration guide](/integration/vike/) for layouts, data fetching, SPA mode, and more.

## Key Concepts Summary

| Concept | What It Does |
|---------|-------------|
| **View** (function) | Renders UI from state. Pure — no side effects. |
| **Intent** (`.intent`) | Maps DOM events to named actions. |
| **Model** (`.model`) | Defines state changes for each action. |
| **State** (`.initialState`) | Sets the component's starting state. |
| **`run()`** | Bootstraps the application. |
| **Drivers** | Handle all side effects (DOM, state, logging, custom). |
| **Error Boundaries** (`.onError`) | Catch rendering errors with fallback UI. |
| **Refs** (`createRef()`) | Access DOM elements declaratively. |
| **Portal** (`<Portal>`) | Render children into a different DOM container. |
| **Transition** (`<Transition>`) | CSS enter/leave animations. |
| **Lazy** (`lazy()`) | Code-split components with automatic loading placeholders. |
| **Suspense** (`<Suspense>`) | Show fallback UI while children signal not-ready. |
| **Disposal** (`dispose$`) | Run cleanup logic when components unmount. |

## Next Steps

- **[Detailed Guide](/guide/architecture/)** — Deep dive into state management, collections, switchable components, custom drivers, context, and more.
- **[API Reference](/reference/api/)** — Complete reference for all Sygnal exports and configuration options.
- **[Examples](https://github.com/tpresley/sygnal/tree/main/examples)** — Working example applications.
- **[Sygnal ToDoMVC](https://github.com/tpresley/sygnal-todomvc)** — Full TodoMVC implementation ([Live Demo](https://tpresley.github.io/sygnal-todomvc/)).
- **[Sygnal 2048](https://github.com/tpresley/sygnal-2048)** — 2048 game built with Sygnal ([Live Demo](https://tpresley.github.io/sygnal-2048/)).
- **[Sygnal Mahjong](https://github.com/tpresley/mahjong-trainer)** — Mahjong game built with Sygnal ([Live Demo](https://tpresley.github.io/mahjong-trainer)).
