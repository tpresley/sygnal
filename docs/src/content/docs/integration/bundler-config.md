---
title: Bundler Configuration
description: Vite, Webpack, and other bundler setup
---

## Vite

Sygnal supports the automatic JSX transform, which is the modern standard used by React, Preact, Solid, and others. The bundler automatically inserts the necessary imports — no manual injection needed.

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
