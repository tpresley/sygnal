# PLAN-5 §1.4 / B-2 recipes: the tested code

The code of every page under `docs/src/content/docs/recipes/`, run against the built `sygnal` (`file:../../..`). The libraries are devDependencies of this project only, never of sygnal (D209).

```bash
npm run build                                                   # in the repo root: the tests import dist/
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix dev-plans/research/p5-recipes
npm --prefix dev-plans/research/p5-recipes test                 # vitest: the docs' tests (mock DOM) + docs drift
BROWSER=chromium npm --prefix dev-plans/research/p5-recipes run test:browser   # also firefox, webkit; ONLY=<dir>
node dev-plans/research/p5-recipes/size.mjs                     # gzip size each recipe adds (Sygnal external)
```

- `src/<recipe>/` holds the files the page shows verbatim (`src/docs-sync.test.js` fails when a page and its files differ), the page's own test (`*.test.jsx`, vitest + jsdom), and `*.browser.jsx`: the recipe mounted with `renderComponent(..., { dom: 'real' })` in a real browser, driven by real Playwright input (`run-browser.mjs`, Playwright 1.63.0, the browsers browser-tests already installed). Console errors fail the browser run.
- `size.mjs` bundles each recipe's component with Vite (minified, `process.env.NODE_ENV=production`) with `sygnal` external, and prints the gzipped size.

| Page | Library (tested version) | Browser test exercises |
|---|---|---|
| charts | chart.js 4.5.1, echarts 6.1.0 | a real click on a bar, update from state, destroy/dispose |
| rich-text | @tiptap/core + starter-kit 3.31.4 | typing, Bold/Italic commands on a selection, reset from state, destroy |
| code-editor | codemirror 6.0.2, @codemirror/lang-javascript 6.2.5 | the `focus` command, typing, reset from state, destroy |
| carousel | embla-carousel 8.6.0 | next/dot commands, a real drag, `update` + `reInit`, destroy |
| data-table | @tanstack/table-core 9.2.6 | real sort/page clicks, typing a search; per-render cost |
| data-grid | ag-grid-community 36.2.0 | a real cell edit (rows not mutated), selection, export command, destroy |
| icons | lucide 1.52.0 | SVG namespace and attributes, drawn paths, stable across patches |
| i18n | i18next 26.4.2 | a real language switch through context, plurals and currency, persist |
