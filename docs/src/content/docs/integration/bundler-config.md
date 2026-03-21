---
title: Bundler Configuration
description: Vite, Webpack, and other bundler setup
---

## Vite Plugin (recommended)

The Sygnal Vite plugin handles everything automatically — JSX configuration and [HMR](/integration/hmr/) with state preservation:

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
})
```

That's it. Your entry file just needs `run()`:

```javascript
// src/main.js
import { run } from 'sygnal'
import App from './App.jsx'

run(App)
```

The plugin detects the `run()` call, finds the imported root component, and automatically injects HMR wiring during development. No manual `import.meta.hot` boilerplate needed.

### Plugin Options

```javascript
sygnal({
  disableJsx: false,  // Set true to configure JSX yourself
  disableHmr: false,  // Set true to handle HMR manually
})
```

### How the HMR transform works

In dev mode, the plugin transforms your entry file from:

```javascript
import { run } from 'sygnal'
import App from './App.jsx'
run(App)
```

Into:

```javascript
import { run } from 'sygnal'
import App from './App.jsx'
const __sygnal = run(App)
if (import.meta.hot) {
  import.meta.hot.accept('./App.jsx', __sygnal.hmr)
  import.meta.hot.dispose(__sygnal.dispose)
}
```

If you already have `import.meta.hot` in your file, the plugin leaves it alone.

## Manual Vite Configuration

If you prefer not to use the plugin, configure JSX manually:

```javascript
// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'sygnal',
  }
})
```

For TypeScript projects, also add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "sygnal"
  }
}
```

And wire HMR yourself — see [Hot Module Replacement](/integration/hmr/).

## Other Bundlers

For Webpack, Rollup, or other bundlers that support the automatic JSX transform, configure them with `sygnal` as the JSX import source. The general pattern is:

```javascript
// General pattern (varies by bundler)
{
  jsx: 'automatic',           // or equivalent setting
  jsxImportSource: 'sygnal',  // or equivalent setting
}
```

<details>
<summary>Classic JSX transform (legacy, still supported)</summary>

If your bundler does not support the automatic JSX transform, you can use the classic transform:

```javascript
// vite.config.js
export default defineConfig({
  esbuild: {
    jsxInject: `import { jsx, Fragment } from 'sygnal/jsx'`,
    jsxFactory: 'jsx',
    jsxFragment: 'Fragment'
  }
})
```

Note: With the classic transform, some minifiers may rename the `Fragment` function, causing JSX fragments to break. To fix this with Vite, install terser and add:

```javascript
build: {
  minify: 'terser',
  terserOptions: {
    mangle: {
      reserved: ['Fragment']
    }
  }
}
```

This is not an issue with the automatic transform.
</details>

## Using Without JSX

If you prefer not to use JSX, use the `h()` function from Sygnal (re-exported from `@cycle/dom`):

```javascript
import { h } from 'sygnal'

function MyComponent({ state }) {
  return h('div', [
    h('h1', `Hello ${state.name}`),
    h('button.increment', 'Click me')
  ])
}
```
