# TodoMVC in a Web Worker (experimental)

[examples/todomvc](../todomvc)'s app, unchanged (`app.tsx`, `components/`, `lib/` are the same
files; `worker.test.ts` checks it), running in a module Web Worker with `sygnal/worker`. The page
runs only `sygnal/worker/page`'s bridge and the two drivers a worker can't: localStorage and the
hash router.

| File | Thread | What |
|---|---|---|
| `worker.ts` | worker | `run(App, { DOM: target.driver, STORE: target.remote('STORE', ['get']), ROUTER: target.remote('ROUTER') })` |
| `page.ts` | page | `startBridge(worker, root, { drivers: { STORE, ROUTER } })` |
| `page/*.ts` | page | the two drivers, on plain `xstream` (no Sygnal core on the page) |

```bash
npm install
npm run dev     # http://localhost:5174
npm test        # the page DOM mirrors the worker's tree after 120 random actions (jsdom)
```

The guide: [Running off the main thread](https://sygnal.js.org/renderers/off-main-thread). A
TodoMVC this small is the case where a worker doesn't pay: every response takes one frame more.
It's here because it exercises everything the bridge does (forms, refs, `autoFocus`,
`<Transition>`, `Collection`, page drivers).
