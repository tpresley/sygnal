---
title: Bundler Configuration
description: Vite, Webpack, and other bundler setup
---

## Vite Plugin (recommended)

The Sygnal Vite plugin configures JSX, wires up [HMR](/integration/hmr/) with state preservation, and turns on [diagnostics](/guide/diagnostics/) in the dev server:

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

| Option | Type | Default | Description |
|---|---|---|---|
| `disableJsx` | `boolean` | `false` | Don't configure JSX (set it up yourself) |
| `disableHmr` | `boolean` | `false` | Don't inject HMR wiring (handle HMR yourself, or let a framework such as Vike do it) |
| `diagnostics` | `'off' \| 'collect' \| 'warn' \| 'error'` or `{ mode, strict, ignore }` | `'warn'` | Runtime diagnostics in the dev server. `'off'` injects no checks |
| `diagnostics.mode` | same as above | `'warn'` | The runtime [diagnostics mode](/guide/diagnostics/#modes) |
| `diagnostics.strict` | `boolean` | `false` | Turn on the [strict-mode](/guide/strict-mode/) runtime checks; also the default for `check.strict` |
| `diagnostics.ignore` | `string[]` | `[]` | Codes to drop, at runtime and in `sygnal-check` |
| `check` | `boolean` or `{ strict, a11y, include, ignore, overlay }` | `true` | Run `sygnal-check` in the dev server (skipped silently when it isn't installed) |
| `check.strict` | `boolean` | `diagnostics.strict` | Also run the strict rules (SYG501-508) |
| `check.a11y` | `'warn' \| 'error'` | `'warn'` | Severity of the [accessibility](/guide/accessibility/) findings (SYG701-708). They stay warnings with `strict`; `'error'` makes them errors, which open the overlay |
| `check.include` | `string[]` | the existing `src/`, `pages/`, `renderer/` directories, else the project root | Files, directories or globs to check, relative to the Vite root |
| `check.ignore` | `string[]` | `diagnostics.ignore` | Codes to drop |
| `check.overlay` | `'error' \| false` | `'error'` | Whether error-severity findings open Vite's error overlay |
| `vitestSetup` | `boolean` | `true` | Under Vitest, add `sygnal/diagnostics` to `test.setupFiles` |
| `nativeGlobalThis` | `boolean` | `true` | Resolve xstream's `globalthis` polyfill to the native `globalThis` (see [below](#native-globalthis)) |
| `devtools` | `boolean` | `true` | Install the [DevTools](/integration/debugging/#devtools-extension) bridge in the dev server. `false` leaves it out |

```javascript
sygnal({
  diagnostics: { mode: 'error', strict: true, ignore: ['SYG105'] },
  check: { include: ['src', 'lib'] },
})
```

### What the plugin does in dev

Everything below happens only in `vite` / `vite dev`. A production build (`vite build`) gets the JSX configuration and the [`globalthis` alias](#native-globalthis), and nothing else: no flags, checks, wrappers, dev client or DevTools.

- **DevTools.** The same files also import `sygnal/devtools` first, which installs the bridge the [DevTools extension](/integration/debugging/#devtools-extension) connects to (`window.__SYGNAL_DEVTOOLS__`). It is independent of `diagnostics` (`'off'` still installs it); `sygnal({ devtools: false })` leaves it out.

- **Diagnostics.** Every file that imports `run` from `sygnal` gets a dev flag (runtime diagnostics in `'warn'` mode) and imports of `sygnal/diagnostics` (the dev checks) and `virtual:sygnal/dev` (which logs `sygnal-check` results in the browser console). They're added on an existing line, so line numbers and source maps don't change. A mode other than `'warn'`, or an ignore list, is passed to `run()` as its `diagnostics` option, unless the `run()` call sets that option itself. Opt out for one app with `run(App, drivers, { diagnostics: 'off' })`, or for the whole server with `sygnal({ diagnostics: 'off' })`.
- **Vike and Astro.** Their apps are started by Sygnal's own client entries, which get the same dev setup (see [Vike](/integration/vike/#diagnostics-in-dev) and [Astro](/integration/astro/#diagnostics-in-dev)).
- **sygnal-check.** When the `sygnal-check` package is installed, the plugin checks `check.include` when the dev server starts and after every source change. Findings are printed in the terminal and logged in the browser console. When `check.include` isn't set, it checks the `src/`, `pages/` and `renderer/` directories that exist, or the project root (skipping `node_modules` and build output) with a one-time notice; a notice is also logged when none of the given paths exists.
- **The error overlay.** Only error-severity findings open Vite's error overlay (`overlay: false` turns that off). Warnings never do, because Vite reloads the page on the next HMR update while an overlay is open; `overlay: 'warn'` is accepted but treated as `'error'`, with a notice. Most `sygnal-check` findings are warnings or info; the errors are wiring that fails for certain (SYG112, SYG124, SYG125, SYG128, SYG405 and a few more). The accessibility findings stay warnings, also with `strict`, unless `check.a11y` is `'error'`. The overlay is sent only to the page that loads, closed before each HMR update and sent again after the re-check, so it never causes a reload or goes stale.

### Vitest

Under Vitest, the plugin configures JSX and adds `sygnal/diagnostics` to `test.setupFiles` (merged with your own setup files, never added twice), so [`renderComponent()`](/integration/testing/) tests get the dev checks. It also allows that file's directory in `server.fs.allow`, so the setup works in `jsdom` and `happy-dom` environments with a linked Sygnal. Set `vitestSetup: false` to manage the setup yourself. Nothing else is injected under Vitest: no dev flags, HMR wiring or checker, because `renderComponent()` manages the diagnostics mode per test.

### Native globalThis

xstream loads the `globalthis` npm polyfill, which brings a chain of small packages (about 4 KB gzipped) into every app. Every browser and Node version Sygnal supports has a native `globalThis`, so the plugin adds a `resolve.alias` from `globalthis` to a stub in the Sygnal package (`sygnal/shims/globalthis`) that returns it. The alias applies in the dev server (including dependency pre-bundling), `vite build` and Vitest; the [Astro integration](/integration/astro/) adds it in `astro build` too. The alias applies to every import of `globalthis` in the app, so any other dependency that loads the polyfill gets the stub too. If your own `resolve.alias` (object or array form) already maps `globalthis`, the plugin leaves it alone and adds nothing. Set `nativeGlobalThis: false` to keep the polyfill package. Without the plugin, add the same alias yourself: `resolve: { alias: [{ find: /^globalthis$/, replacement: 'sygnal/shims/globalthis' }] }`.

### JSX and Vite versions

The plugin sets Vite 8's `oxc` JSX options. Under Vite 7 and older (for example Astro 6, or Vitest running on Vite 7), which compile JSX with esbuild, it also sets the `esbuild` options. In the Vite 8 dev server it also configures JSX for the dependency scanner, so the first page load doesn't fail to resolve `react/jsx-dev-runtime`.

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

HMR wiring is only added for a top-level `run()` call in a recognized shape. If you already have `import.meta.hot` in your file, the plugin leaves it alone. Test files (`*.test.*`, `*.spec.*`) are never transformed.

## Manual Vite Configuration

If you prefer not to use the plugin, configure JSX manually:

```javascript
// vite.config.js (Vite 8)
import { defineConfig } from 'vite'

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'sygnal' },
  },
})
```

Under Vite 7 and older, use the `esbuild` options instead:

```javascript
// vite.config.js (Vite 7)
import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'sygnal',
  },
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

And wire HMR yourself — see [Hot Module Replacement](/integration/hmr/). For diagnostics without the plugin, see [Diagnostics](/guide/diagnostics/#without-vite); for the DevTools extension, import `sygnal/devtools` in dev (see [DevTools without Vite](/integration/debugging/#without-vite)).

## Other Bundlers

For Webpack, Rollup, or other bundlers that support the automatic JSX transform, configure them with `sygnal` as the JSX import source. The general pattern is:

```javascript
// General pattern (option names vary by bundler)
const jsxOptions = {
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
// vite.config.js
export default defineConfig({
  build: {
    minify: 'terser',
    terserOptions: {
      mangle: {
        reserved: ['Fragment']
      }
    }
  }
})
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
