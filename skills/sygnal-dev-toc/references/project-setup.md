# Project setup, run(), TypeScript, more guides

Vite setup and `main.js`, `run()` options, conventions, TypeScript component types and EVENTS registration, and where the other features (SSR, Astro/Vike, Portals, Transitions, …) are documented.

## Vite
`index.html` has `<div id="root"></div>` and `<script type="module" src="/src/main.js">`; `src/App.test.js` sits next to `src/App.jsx`.
```js
// vite.config.js: the plugin sets up JSX, HMR, dev diagnostics and Vitest
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
export default defineConfig({ plugins: [sygnal()] })
```
```js
// src/main.js
import { run } from 'sygnal'
import App from './App.jsx'
run(App)   // mounts on #root; pass drivers as the 2nd argument
```
Conventions: PascalCase component files, ALL_CAPS action names, `$` suffix for streams, class-name selectors, `classes()` for conditional class names, `state="key"` to give a child a slice.

## run()
- **run(App, drivers = {}, { mountPoint = '#root', diagnostics, onError })** returns `{ sources, sinks, dispose, hmr }`. `onError: (error, { componentName, action, phase }) => …` reports every error (reporting only). DOM, EVENTS, LOG and STATE are built in. `app.sources.STATE.stream` is the state stream; `app.dispose()` fires DISPOSE.

## TypeScript
- **TypeScript**: `const intent = ({ DOM }: IntentSources<State>) => ({ ... })`, then `const C: Component<State, Props, {}, ActionsOf<typeof intent>, Calculated, Context, { PARENT: Payload }> = ({ state, context }) => ...` (root: `RootComponent<State, {}, Actions>`; unused parameters `{}`). Without `{ PARENT: Payload }` the parent's `CHILD.select(C)` is a `Stream<unknown>`. Register EVENTS names in `declare module 'sygnal' { interface SygnalEvents { DOC_SAVED: { id: string } } }` in a file that keeps `export {}` (without it: "has no exported member"). Guide: https://sygnal.js.org/integration/typescript/

## Where to look next
Other features (Portals, Transitions, Suspense, Slots, SSR, Astro/Vike): https://sygnal.js.org/guide/components/.
Every SYG code: https://sygnal.js.org/reference/errors. Testing: https://sygnal.js.org/integration/testing/. More: `node_modules/sygnal/dist/guide/undo.md`, https://sygnal.js.org/guide/view-transitions/, https://sygnal.js.org/reference/api/#sygnalelement (`defineElement`), `node_modules/sygnal/dist/guide/error-boundaries.md` (`run({ onError })` phases incl. `'patch'`).
