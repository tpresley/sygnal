# Compiled views and compiled SSR: plan

Draft, 2026-10-29, from the compile-wasm research (README.md in this folder: the numbers). Branch
`claude/explore-compile-wasm-cce134`. A PLAN-sized proposal; IDs below are local (CV-n, Q-n) until
the maintainer assigns PLAN numbers.

## Goal

An opt-in `sygnal/vite` option that compiles JSX views at build time, with no change to what a
component means:

- **server**: compiled SSR (string chunks instead of vnodes): 17–28× on `renderToString` of the
  benchmark table;
- **client, tier A**: the pragma's run-time work done at build time (pre-routed data, hoisted
  static data): select 1.7 → 0.85 ms, update every 10th −40%;
- **client, tier B, blocks**: template clone + hole patching for row-like subtrees: select 1.7 →
  0.5–0.7 ms (React 0.7), create −17 to −27%, heap −40%.

Non-goals: a new component model, fine-grained signals, changing what `view` receives, or making
compilation required. Uncompiled code keeps working, and compiled and uncompiled components mix
freely in one app.

## Why Sygnal compiles well

A view is a pure function of `{ state, context, props }` and has **no event handlers or closures
in its markup** (events come from the intent's selectors). So the dynamic part of a subtree is exactly its
`{expressions}`, and a compiler doesn't need Million's handler-identity tricks. 81% of the
examples' JSX elements sit in blockable subtrees, but blocks average 2.1 elements (`survey/`), so
the wins concentrate in lists (`.map()` rows, Collection item views) and large static regions.

## One IR, three back ends

The compiler turns each compilable JSX subtree into a **skeleton**: a static tree (tags, static
attributes already routed into snabbdom's buckets, static text) with numbered **holes**.

```js
// <div className={sel ? 'row danger' : 'row'}><span className="col-id">{row.id}</span><a className="lbl">{row.label}</a></div>
const $s0 = sk(['div', H(0, 'class'), ['span', { props: { className: 'col-id' } }, H(1, 'text')], ['a', { props: { className: 'lbl' } }, H(2, 'text')]])
// at the call site
B($s0, [sel ? 'row danger' : 'row', row.id, row.label], key)
```

The same skeleton feeds:
1. **DOM** (`makeDOMDriver`): a block, made by cloning a `<template>` built from the skeleton once,
   with the holes patched by direct DOM writes (the prototype's `block()`).
2. **vnodes** (`expand(B)`): the plain vnodes the pragma would have made. This is the path for the mock
   DOM (`renderComponent`), the host-tree renderers (alt-renderers), devtools, the dev checks and
   any driver that isn't the real DOM. It is also the oracle for the parity tests.
3. **HTML** (`renderToString`): static chunks concatenated with escaped hole values, escaped by
   `ssr.ts`'s own `escapeHtml` (so `t.html()`'s innerHTML mode stays right).

Tier A is the degenerate case: the compiler emits the vnode constructor calls directly (no
skeleton), which is what the other back ends would produce anyway. Hole kinds: `text`, `prop:<name>`, `attr:<name>`,
`class` (className), `classMap`, `style`, `dataset:<name>`, and `slot` (a vnode child: an array, a
conditional element, `children`; patched by snabbdom inside the element the block owns).

## What compiles, what bails

Compiled: intrinsic HTML elements (a fixed list of HTML tag names), string and expression
attributes, text and expression children, nested compiled elements, `key`.

Left to the pragma (the subtree root stays a `jsx()` call, its compilable children may still compile):
- components, markers (`Collection`, `Switchable`, `Portal`, `Slot`, ...), Fragments, controls
  and widgets (any capitalized or member-expression tag);
- **form fields and custom elements**: `input`, `textarea`, `select`, hyphenated tags. They are
  never "plain" (P46-P / the controlled-input re-sync);
- **any lowercase tag that isn't an HTML tag** (`view`, `txt`, `textinput`, SVG tags): the
  alt-renderers' proposed host field-tag registry (`registerFieldTags`, their C10/Q3) is a run-time
  list the compiler can't see, so non-HTML tags always go through the pragma, which consults it.
  SVG keeps its namespace handling in the pragma (`applySvg`);
- spreads, `ref`, `autoFocus`/`autoSelect`, `hook`, `innerHTML`, dynamic attribute names, and
  `class`/`style` values whose shape is unknown *at the bucket level* (a `class={expr}` is fine
  as a `classMap` hole; a spread is not).

**One routing implementation.** Tier A needs the pragma's routing of every key (`className` →
props, `for` → attrs, `data-x-y` → `dataset.xY`, ARIA booleans, ...). The plugin imports the
pragma's own `route()` (exported for the plugin from `src/pragma/index.ts`) and runs it at build
time, so the compiler can't drift from the pragma. The parity suite (CV-0) checks it on every
fixture. Run-time-only rules (ARIA false-value stringification, `undefined` skipping) stay run-time:
the hole's kind carries them.

**JSX whitespace and text coercion** follow the JSX spec (the same trimming as Babel's
`cleanJSXElementLiteralChild`) and the pragma's `createTextElement` (`false`/`null`/`undefined`
render nothing; numbers become text).

## The core changes

- `same()` (`src/core/instance.ts`): a block is the same output when its skeleton and hole
  values are (`sameKids(a.v, b.v)`), so a Collection row whose view re-ran with the same values
  keeps its vnode. This is the 3-line change the prototype measured (reverted from the quick-win
  commits; it returns with CV-3).
- Context read-tracking (D168): the compiler knows which `context.<key>` reads a compiled view makes
  when they are plain member reads, and emits `View.$ctx = ['selected']`; the core then skips the
  per-render Proxy and `Set` for that view. This is the next Collection-select win (not measured yet; CV-5).
- Nothing else: the block is a vnode (`sel`, `key`, constant `data.hook`), so reconcile,
  `flat()`, isolation (`scoped()` copies keep `v`) and keyed moves work unchanged.

## Hydration

The server HTML of a block is exactly its skeleton's HTML, so hydration adopts it. `adopt()`
(`makeDOMDriver.ts`, G-456) makes old vnodes with `children` from the server DOM; the block's
`prepatch` sees an old vnode without refs (`!old.r`), resolves its hole paths in the existing
element, and clears `old.children` so snabbdom doesn't remove the adopted children. Text holes
need a node to write to: an empty string renders no text node on the server, so the skeleton's
HTML puts a comment or an empty-text guard where a text hole may be empty (the prototype's `' '`
placeholder text). Decide by measuring (CV-4).

## Tooling

- **`renderComponent`**: default mock DOM → the vnode back end (`expand`), so tests see the same
  vnodes as uncompiled code; `dom: 'real'` → blocks. Under Vitest the plugin compiles by default only
  if `compile.test` is set (Q-3).
- **devtools / dev checks** read vnodes from `onRender`: they call `expand` (dev only; production
  never expands on the real DOM).
- **sygnal-check**: reads source, unaffected. The graph view is unaffected.
- **Source maps**: the transform splices generated code into the module. It needs `magic-string`
  (Q-2), or Vite 8's `transformWithOxc` on a rewritten AST.
- **Parser**: Vite 8's `parseAst(code, { lang: 'jsx' | 'tsx' })` (rolldown/oxc, ESTree with JSX),
  so there's no new parser dependency. Under Vite 7 the option is a warned no-op.

## Gates and measurement

- **Parity suite (CV-0, before any back end ships)**: every example app, docs code sample and
  `test/` fixture view is compiled. For each, the compiled vnodes (`expand`) must equal the pragma's
  vnodes (deep equality on sel/key/text/data buckets/children), the compiled SSR must be
  byte-equal to `renderToString`, and on a real DOM the block DOM must equal the uncompiled DOM after
  each step of the scripted ops (`check-dom.mjs` generalized). Run under `npm test`.
- **Count gate**: the existing limits hold with compile on (patches per op stay 1). New
  count metrics on a compiled `table-coll` / `table` page: DOM mutation records for select row
  (expected 2), pragma calls per select (expected 0 for compiled rows).
- **Timing**: `perf-report` gets compiled pages next to the uncompiled ones (warn-only), with
  targets: single-view select ≤ 1.0× React, Collection select ≤ 2×.
- **Size**: the size gate stays on the uncompiled kanban (a budget is a core budget). An
  informational line for kanban with `compile: true` (runtime ≈ 0.5 KB gzip plus skeletons, minus
  the `jsx()` calls).

## Phases

| ID | What | Depends | Size |
|---|---|---|---|
| CV-0 | Parity harness: fixture corpus (examples, docs samples, tests), vnode / HTML / DOM comparison, wired into `npm test` | — | M |
| CV-1 | **Compiled SSR** for server builds (`opts.ssr`): skeleton + HTML back end in `ssr.ts`, root element kept a vnode (it gets `data-sygnal-ssr`), components inside chunks go through the walk | CV-0 | M |
| CV-2 | **Tier A** on the client: pre-routed vnodes, hoisted static data, `route()` shared with the pragma; dev and prod | CV-0 | M |
| CV-3 | **Tier B blocks** for `.map()` callbacks and Collection item views: DOM back end, vnode back end (`expand`), block-aware `same()`, renderComponent/devtools wiring | CV-2 | L |
| CV-4 | Hydration of blocks; SSR ↔ block markup agreement; Vike/Astro smoke | CV-1, CV-3 | M |
| CV-5 | Static context keys (`$ctx`) to skip read-tracking; measure Collection select | CV-2 | S |
| CV-6 | Docs (a "Compiled views" page: what compiles, how to see it, opting out per file with `/* @sygnal-compile off */`), llms.txt, the skill, CHANGELOG | CV-3 | S |

CV-1 can ship before CV-3: it changes no client code, and it has the largest ratio.

## Risks

- **Semantic drift between compiler and pragma** (routing, whitespace, text coercion, SVG/field
  detection). Mitigation: one `route()`, the parity suite on a large corpus, conservative bail-outs.
- **Opaque blocks** to anything that walks vnodes on the real DOM in production (third-party
  snabbdom modules, a user's own `hook` usage on a child): a subtree with `hook` bails, and blocks
  only reach `makeDOMDriver`.
- **Alt renderers**: a non-DOM driver must call `expand` (or the core does it for any driver that
  doesn't declare `blocks: true`). That's safer: blocks are opt-in per driver.
- **Collections gain less** than single views (per-instance cost). CV-5 is the next lever; beyond
  it, the instance machinery itself (not a compile question).

## Open questions for the maintainer

- **Q-1**: option shape: `sygnal({ compile: true })` vs `{ compile: { ssr, views, blocks } }`; on by
  default in a later minor once the parity suite has run on real apps?
- **Q-2**: `magic-string` as a regular dependency of the package (plugin-only, never in app bundles;
  D209-compatible: small, maintained, framework-neutral), or source maps via oxc?
- **Q-3**: compile under Vitest by default (tests then run what ships) or not (tests see plain vnodes)?
- **Q-4**: export the pragma's `route()` from an internal subpath the plugin can import (`sygnal/internal`), or
  duplicate the plugin's own copy, kept in sync by the parity suite?

## Status

- **CV-2 started** (2026-10-29): `sygnal({ compile: true })` (Vite 8) compiles HTML elements to
  `__cv.e(sel, data, children, key)` (`src/vite/compile.ts`; runtime `__cv` in
  `src/pragma/index.ts`). The compiler never re-implements routing, which settles Q-4 (no shared
  `route()` export needed): a static element's data is made by the pragma's own `sanitizeData`
  once at module load (hoisted), and a dynamic element's keys are routed once at load by the
  pragma's `route()` (`__cv.r`). Its data is then built per render by the same per-key code
  `sanitizeData` uses (`put`, `__cv.d`). Text follows oxc's JSX whitespace rules (tabs inside a line
  stay); elements with HTML entities bail (the parser keeps entities raw).
- Parity: `test/cv-compile.test.js`, 50 fixture views (`test/fixtures/cv/views.jsx`) give the same
  vnodes, plain flags included, compiled and not. All 202 `.jsx`/`.tsx` files in the repo compile
  to code oxc accepts (3,070 elements). `check-dom.mjs` shows the same DOM for `table-cv` and
  `coll-cv` (the JSX baselines built with `compile: true`).
- Every installed Vite 8 example passes its own suite with compile on
  (`test-examples-compiled.mjs`: 11 suites, 220 tests; a probe confirmed kanban's three views were
  compiled under Vitest). getting-started is on Vite 7 (compile is a no-op there).
- First timing (3 runs, before pre-routed data): select row 1k, table 1.7 → 1.0 ms (hand-written
  tier A 0.9), Collection 2.5 → 1.7 ms. The full run waits for a quieter machine (load ≈ 46).
- Size: uncompiled kanban +3 B (the `put()` refactor): 42,058 B, 942 B headroom.
- **Decisions (coordinator, 2026-10-29):** Q-1 `compile: true | { views, ssr, test }` (each part
  defaults on in the object form; `true` = everything shipped; off by default, default-on revisited at
  the dev preview). Q-2 `magic-string` (^1.4.3) as a regular dependency, external in `sygnal/vite` and
  `sygnal/astro` (no dist file bundles it). Q-3 compile under Vitest by default (`views` only), opt
  out with `compile: { test: false }`. Done; tests in `test/cv-compile.test.js` (option shape, source
  map, node_modules/virtual skips, the once-only Vite 7 warning).
- **CV-1 done** (compiled SSR). In server builds (never under Vitest) the outermost compiled element
  is `__cvs.r` (a vnode, so the root's `data-sygnal-ssr` stamp and the walk work), and compiled
  elements below it are HTML chunks (`__cvs.f/s`, `src/extra/ssr.ts`). JSX in a *direct value
  position* of a compiled element's child expression (`?:`, `&& || ??`, arrays, a `.map()` arrow's
  expression body) is a chunk too; JSX anywhere else stays a vnode. Open tags and static subtrees
  are serialized by `vnodeToHtml` once per escaping mode. Dynamic open tags take a fast path for
  `props` + `dataset` that mirrors `buildAttributes` (a 2,000-shape differential test against
  `vnodeToHtml`). Non-compiled children keep the child path the JSX runtime's tree gives them, so
  `uid()` and hydration ids match. `test/cv-ssr.test.js`: all 55 fixture views give byte-identical
  HTML. Benchmark table (`ssr/bench.mjs`, the real compiler): **1k rows 1.78 → 0.38 ms (4.7×), 10k
  rows 23.7 → 4.3 ms (5.5×)**; the hand-written template's 16–26× is the ceiling (left: per-row data
  objects and the fast-path tag writer).
- **CV-3 v1 done** (blocks, `compile.blocks`, production client builds only). Each block's code is
  its tier-A vnode code with the holes as parameters (`__cvb.b((h) => …, kinds)`), so calling it
  with the values IS the JSX runtime's vnode tree. That one function gives the template, which
  snabbdom renders once with Sygnal's own modules. It also gives the fallback (a text hole holding
  a vnode or array renders plain vnodes under another key) and the expansion: the core expands
  blocks for any DOM driver that isn't `makeDOMDriver` with its default modules
  (`DOMDriver.blocks`), which covers renderComponent's mock DOM and host renderers. Inner dynamic
  data goes through the same modules' create/update. A static prop that a clone doesn't keep
  turns the block off. Blocks: `.map()` rows in a direct value position of a compiled element, and
  the element a capitalized component returns. The core's same-output check knows blocks
  (`ext.sb`: text holes `===`, data holes `sameData`); the expander and the check register on first
  use (`src/core/registry.ts` `ext`), and `blocks.ts` has no module-level side effects: uncompiled
  kanban 42,109 B (+51 B for the core hooks, 891 B headroom). Hydration: a block adopting server
  markup makes its inside again (a first cut of CV-4).
- Tests: `test/cv-blocks.test.js` (jsdom): the fixture apps (`.map()` rows, Collection items,
  text holes switching between text, arrays, null and 0) give the same DOM compiled and not after
  14 actions; blocks were really made (a counter); a Collection select makes 1 attribute mutation;
  renderComponent's mock DOM gives the same HTML. In real Chromium (`check-dom.mjs`) the `-cv`
  (tier A + blocks) and `-cva` (tier A) pages give the same DOM at every step and **the same DOM
  mutation count per step** as the JSX pages. The CommonJS plugin build is tested (it had a
  magic-string interop bug, fixed: the named import).
- Gate after CV-3: vitest 5,300; examples 14 suites / 232 tests; types; browser 381; count gate;
  and every installed Vite 8 example's suite with `compile: true` (11 suites, 220 tests). That run
  caught the compile plugin depending on the main plugin's `config` hook for its Vitest / dev
  flags (SSR-compiled code ran under Vitest when the compile plugin was used alone); it has its
  own hook now, with a test.
- **Timing run** (2026-10-29 15:33–15:53, coordinator's quiet window: the other sessions idle;
  load average 5.6 at the start, 9.5 at the end; the maintainer's k3d cluster container held ~90%
  of one core throughout). `results/bench-2026-10-30T0153.json`, 10 iterations + 3 warm-up, median
  latency in ms (cpu in the file):

  | Op | table (JSX) | tier A | tier A + blocks | React 19 | Collection (JSX) | Coll. tier A | Coll. + blocks |
  |---|---:|---:|---:|---:|---:|---:|---:|
  | create 1k | 20.3 | 19.7 | 21.8 | 18.4 | 24.2 | 24.95 | 21.95 |
  | replace 1k | 17.55 | 16.2 | 18.35 | 21.35 | 29.7 | 21.55 | 26.65 |
  | update every 10th | 3.85 | 2.95 | 3.7 | 2.95 | 4.45 | 3.2 | 3.55 |
  | **select row** | 1.9 | 1.5 | **1.05** | 0.9 | 1.8 | 1.5 | **1.4** |
  | swap rows | 2.95 | 2.8 | 2.1 | 15.15 | 1.85 | 2.0 | 2.85 |
  | remove row | 2.95 | 2.45 | 2.1 | 1.95 | 2.15 | 1.8 | 1.7 |
  | create 10k | 162.4 | 160.1 | 149.75 | 254.5 | 232.9 | 211.05 | 218.25 |
  | append 1k | 18.5 | 18.9 | 19.3 | 15.75 | 23.35 | 18.75 | 21.7 |
  | clear 1k | 3.9 | 4.15 | 2.95 | 4.15 | 3.75 | 4.55 | 3.1 |
  | heap, 1k rows (MB) | 0.89 | 0.70 | 0.62 | 1.36 | 5.75 | 5.56 | 5.46 |

  Select row (the op compiling targets) goes 1.9 → 1.05 ms, against React's 0.9; remove and clear
  are at or under React; heap −30%. Under this load the other ops move by about their noise
  (swings of 20–30% between the Collection columns). **Create and append don't gain with the
  compiled blocks**: a 20-iteration re-run (`bench-2026-10-30T0158.json`, load ~8) gave create 1k
  22.8 (JSX) / 22.5 (compiled blocks) / **18.25 (the hand-written block prototype)** / 20.5 (React).
  Both pages make the same DOM (checked). The per-row JS differs by ~1 ms (the compiled block's
  root data goes through the snabbdom modules); the remaining ~3 ms is native and `(program)` time
  in the profile. The clone source isn't the cause (template content, an innerHTML fragment and
  a createElement fragment clone at the same speed). Open item CV-3b.
- **Blocks in dev and under Vitest** (round 3): `compile.blocks` now applies to all client code.
  Whatever reads vnodes gets the block's plain vnodes, each element with its `elm` from the
  template's element paths: the core's `onRender` / `onPatch` hooks (dev checks, devtools),
  renderComponent's real-DOM element→vnode mapping and the SSR walk (`t.html()`, renderToString of
  client code in tests). A hot swap that replaces a block's module makes the block's inside again.
  Every installed Vite 8 example passes compiled (11 suites, 220 tests; kanban's TaskCard is a
  block there).
- **CV-4 hydration**: makeDOMDriver's `adopt()` keeps a block's server element, and the block
  takes the server's markup as its own when it is the template with these values (text nodes split
  where the server joined them, an empty text hole's node added); otherwise it makes its inside
  again. Test: a server-rendered table and Collection keep every row's element and text node, no
  block is made, then 5 actions patch like a fresh mount.
- Size: uncompiled kanban 42,145 B (855 B headroom; the alt-renderers branch adds ~12 B).
- **CV-3b (create/append): not a compiler gap; the earlier numbers were load drift.** Measured
  interleaved (`ab.mjs`: every page open, round-robin in a rotating order; load 9.6 → 7.2), create
  1k gives JSX 18.9 [17.9–22.2], tier A 20.7 [16.9–22.7], compiled blocks 19.5 [16.3–21.4], the hand
  prototype 17.3 [14.8–18.9], React 18.2 [16.8–20.8] ms (median [p25–p75], 25 rounds). Append 1k:
  15.9 / 15.7 / 16.6 / 14.3 (JSX / blocks / hand / React). The spreads are wider than the
  differences. A timeline trace (`trace.mjs`) shows why: about half the latency is Layout
  (8–12 ms), with style and GC on top. Compiling doesn't change those, and they swing with the load.
  JS time is 5.8 ms (JSX), 4.8 ms (compiled blocks), 4.0 ms (hand prototype). The remaining JS
  difference is the block root's data going through the snabbdom modules (className, dataset:
  ≈0.5 ms) plus the runtime's bookkeeping (path lookup, expansion map). It's the price of exact
  module semantics, kept. The sequential bench's 22.5 vs 18.3 ms came from pages measured minutes
  apart while the load drifted. Ruled out: the DOM made (identical), the clone source (a
  template's content, an innerHTML fragment and a createElement fragment clone at the same speed in
  Chromium; importNode is cloneNode plus an adopt, so it can't be faster than a same-document
  clone), and insertBefore vs append (both pages insert each row through snabbdom's insertBefore
  and append one cloned fragment per row). Blocks pay off on patches (select, remove, clear, swap),
  where JS is most of the time; on create, layout bounds them.
- **CV-5 skipped**: the per-render read tracking a static `$ctx` would skip (a Proxy and a Set per
  view) costs ≈40 ns per view (node microbenchmark), ≈0.04 ms of the 1.4 ms Collection select at 1k
  rows (≈3%, within noise). The Collection's per-instance cost is elsewhere (context(), cell reads,
  the isolation copy).
- CV-6 (docs): done, `integration/compiled-views`.
