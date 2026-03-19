---
title: Hot Module Replacement
description: Live reloading during development
---

Sygnal has built-in HMR support that preserves application state across code changes.

## Vite Setup

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

## Webpack Setup

```javascript
import { run } from 'sygnal'
import RootComponent from './RootComponent'

const { hmr, dispose } = run(RootComponent)

if (module.hot) {
  module.hot.accept('./RootComponent', hmr)
  module.hot.dispose(dispose)
}
```

## How It Works

1. When a file changes, the bundler triggers the `accept` callback
2. Sygnal captures the current application state
3. The old application instance is disposed
4. A new instance is created with the updated code
5. The captured state is restored into the new instance

State is preserved across reloads via `window.__SYGNAL_HMR_PERSISTED_STATE`.

## TypeScript HMR

For TypeScript projects, you may need to cast the module:

```typescript
import { run } from 'sygnal'
import App from './app'

const { hmr } = run(App)

if (import.meta.hot) {
  import.meta.hot.accept('./app', (mod) => {
    hmr((mod as { default?: typeof App })?.default ?? App)
  })
}
```
