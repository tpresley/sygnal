# Diagnostics and tools

- Format: `[Sygnal SYG104] Lane: <what is wrong>. <how to fix> https://sygnal.js.org/reference/errors#syg104`. 1xx wiring, 2xx model/state, 3xx streams (SYG301: an RxJS operator), 4xx components, 5xx strict, 6xx drivers, 7xx accessibility (static: a clicked `div`, an unlabelled field, `<img>` without `alt`; warn, `--a11y=error` fails), 9xx internal.
- `npx --no-install sygnal-check` runs the local checker on `src` (`pages` for Vike): `--strict` for canonical forms, `--fix` for the mechanical rewrites, `--json`. Suppress one line with `// sygnal-ignore SYG110`. In a running dev app: `getDevTools()?.inspect()`.
- Vite plugin in dev: runtime checks print to the console, and an installed `sygnal-check` runs on every save. Stricter: `sygnal({ diagnostics: { mode: 'error', strict: true }, check: { strict: true } })`. Without the plugin: `run(App, drivers, { diagnostics: 'warn' })` and `import 'sygnal/diagnostics'`.

Every SYG code: https://sygnal.js.org/reference/errors.
