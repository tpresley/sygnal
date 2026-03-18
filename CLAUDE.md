# Sygnal

Reactive component framework built on Cycle.js patterns. All source is TypeScript.

## Build & Test

```bash
npm run build        # Rollup → dist/ (8 entries: UMD, CJS, ESM, JSX, Astro)
npm test             # Vitest (318 tests)
npm run build:types  # Generate .d.ts bundles
npm run build:all    # build + build:types
```

This is a **library package** — no dev server. Verify changes via `npm run build` + `npm test`.

## Architecture

**Component pattern (MVI):**
```ts
function MyComponent({ state, context }) { return <div>...</div> }
MyComponent.intent = ({ DOM, EVENTS, CHILD }) => ({ ACTION: stream$ })
MyComponent.model = { ACTION: (state, data) => newState }
MyComponent.initialState = { ... }
MyComponent.context = { field: state => computed }
```

**Source layout:**
- `src/component.ts` — Core component class (1,600 lines)
- `src/collection.ts`, `src/switchable.ts` — Collection and dynamic component rendering
- `src/extra/` — Helpers (processForm, processDrag, eventDriver, driverFactories, etc.)
- `src/pragma/` — JSX createElement implementation
- `src/astro/` — Astro framework integration (client hydration + SSR)
- `src/cycle/` — Absorbed Cycle.js internals (run, isolate, state, dom)

**Absorbed dependencies:**
All `@cycle/*` packages have been absorbed into `src/cycle/`. The only external runtime dependencies are `snabbdom`, `xstream`, and `extend`.

- `src/cycle/dom/snabbdom.ts` — Local barrel that imports from snabbdom subpaths (e.g., `snabbdom/build/h`) to avoid snabbdom's broken barrel export which triggers a `styleModule` `window` ReferenceError in Node.js
- `src/cycle/dom/styleModule.ts` — Local copy of snabbdom's styleModule with a fixed `typeof window !== "undefined"` guard (snabbdom 3.6.3 regression)

**Rollup externals:** Use the `isExternal` function in `rollup.config.mjs` which matches any import starting with `snabbdom/` or `xstream/`.

## Key Conventions

- All source files are `.ts` (converted from `.js` as part of the absorption project)
- `src/index.d.ts` contains standalone type declarations for the component public API — these are separate from the `.ts` source types
- Tests are in `test/` and `examples/*/src/*.test.js`
- Build must produce all 8 entries successfully before tests are meaningful
