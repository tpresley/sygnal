# Sygnal for js-framework-benchmark

Two entries for [krausest/js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), laid out like its `frameworks/` tree:

| Directory | Upstream path | Difference |
|---|---|---|
| `keyed/sygnal/` | `frameworks/keyed/sygnal/` | every `<tr>` has `key={row.id}`, so rows move with their data |
| `non-keyed/sygnal/` | `frameworks/non-keyed/sygnal/` | no `key`: rows are patched in place by position |

Each entry is one root component (`src/Main.jsx`) in the canonical Sygnal forms (`sygnal-check --strict` clean), mounted with `run(Main, {}, { mountPoint: '#main' })`. It follows the benchmark's rules and markup:

- the buttons `#run` (create 1,000 rows), `#runlots` (create 10,000), `#add` (append 1,000), `#update` (every 10th row gets `' !!!'`), `#clear`, `#swaprows` (rows 2 and 999), inside the standard `jumbotron` / `col-sm-6 smallpad` layout;
- `table.table.table-hover.table-striped.test-data > tbody > tr`, each row `td.col-md-1` (id), `td.col-md-4 > a` (label; click selects the row: `tr.danger`), `td.col-md-1 > a > span.glyphicon.glyphicon-remove` (click removes the row), `td.col-md-6`;
- the `span.preloadicon` after the table, the `/css/currentStyle.css` stylesheet, and a classic `<script src="dist/main.js">`;
- the standard label word lists and `Math.random()` labels; ids count up from 1 across creates.

The row click handlers are `DOM.click('.lbl').data('id', Number)` and `DOM.click('.remove').data('id', Number)`, reading `data-id` on the `<tr>`. The `<a>` elements without `href` are the benchmark's markup, so the a11y rule SYG704 is suppressed on those two intent lines with `// sygnal-ignore SYG704`.

## Build here

The entries have no `node_modules` of their own in this repo; they resolve `sygnal` (this checkout, via `file:..`) and `vite` from `benchmarks/node_modules`:

```bash
npm run build                              # the library: dist/
npm ci --prefix benchmarks
npm --prefix benchmarks run build:jfb      # → keyed/sygnal/dist/main.js, non-keyed/sygnal/dist/main.js
npm --prefix browser-tests run perf -- --jfb   # checks every op in a real browser and times it
```

`--jfb` serves this directory, clicks every button and row link the way the benchmark's tests do (`tbody>tr:nth-of-type(2)>td:nth-of-type(2)>a`, `…td:nth-of-type(3)>a>span:nth-of-type(1)`), and fails if the DOM isn't what the benchmark expects. Its timings are a smoke check only (they include the check's own DOM reads); use the benchmark itself for comparable numbers.

## Drop into a js-framework-benchmark checkout

```bash
# in a clone of krausest/js-framework-benchmark (see its README for the one-time setup:
# npm ci && npm run install-local, then npm start to serve on :8080)
cp -R <sygnal>/benchmarks/js-framework-benchmark/keyed/sygnal     frameworks/keyed/sygnal
cp -R <sygnal>/benchmarks/js-framework-benchmark/non-keyed/sygnal frameworks/non-keyed/sygnal
cd frameworks/keyed/sygnal && npm install && npm run build-prod && cd -
cd frameworks/non-keyed/sygnal && npm install && npm run build-prod && cd -
# open http://localhost:8080/frameworks/keyed/sygnal/index.html to try it, then run only this framework:
cd webdriver-ts && npm run bench -- --framework keyed/sygnal non-keyed/sygnal
npm run isKeyed -- --framework keyed/sygnal non-keyed/sygnal     # the benchmark's keyed/non-keyed check
```

Before submitting upstream: pin the published `sygnal` version in each `package.json` (`devDependencies`; it is `^5.4.0` here), commit the generated `package-lock.json` (the benchmark requires one), and fill in `"issues"` in the `js-framework-benchmark` block if a rule note applies. `npm run dev` rebuilds unminified on change.

## Note: why not `<Collection>`

The idiomatic Sygnal list is `<Collection of={Row} from="rows" />`, but a Collection always renders its items inside a `<div>` (`injectComponents` in `src/component.ts` sets `sel: 'div'`), so it can't produce `tbody > tr` rows, which the benchmark's selectors require. The entries therefore map the rows to keyed elements in one component. `browser-tests/perf` measures both shapes; see `benchmarks/RESULTS.md`.
