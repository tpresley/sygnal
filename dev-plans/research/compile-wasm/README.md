# Compiling Sygnal: AOT views, WASM, server compilation

Research, 2026-10-29, branch `claude/explore-compile-wasm-cce134` (from main at 8605f1f7, Sygnal
7.1.0). Question: are there speed, size or memory gains from compiling parts of Sygnal or of
Sygnal apps, including to WASM? Everything here is a measured prototype; nothing ships.

## Round 2 (2026-10-29): what was built

The prototypes above became a real, opt-in compiler on this branch. Plan and status:
[compiled-views-plan.md](compiled-views-plan.md).

| Part | Status | Checked by | Number |
|---|---|---|---|
| Quick wins: the `widget.ts` leak fixed, `SYGNAL_DEBUG` read once in Node | committed, full `npm test` gate green | `test/p9-g751-marker-treeshake.test.js` (Vite 8), `test/debug-env.test.js` | kanban −920 B gzip; 665 → 105 ns/action |
| `sygnal({ compile: true \| { views, ssr, blocks, test } })` (Vite 8; source maps via magic-string) | committed | `test/cv-compile.test.js` (option, maps, the CJS build, the Vite 7 warning) | — |
| Tier A (CV-2): `__cv.e`, data made by the pragma's own `sanitizeData` / `route()` | committed | 55 fixture views same vnodes; 202 repo JSX files compile; 11 example suites pass compiled | select 1k (3 runs, loaded machine): 1.7 → 1.0 ms; Collection 2.5 → 1.7 ms |
| Compiled SSR (CV-1): HTML parts in `renderToString` | committed | 55 fixture views byte-identical HTML; 2,000-shape differential test of the fast tag writer | table SSR 4.7× (1k rows), 5.5× (10k) |
| Blocks (CV-3; all client code since round 3, expanded for every vnode reader) | committed | jsdom: same DOM over 14 actions, blocks really made; Chromium: same DOM and same mutation counts per step; 11 example suites compiled | select row 1k 1.9 → 1.05 ms (React 0.9); create/append not faster yet (CV-3b) |
| Hydration of blocks (CV-4) | committed | server rows keep their elements and text nodes, then patch like a fresh mount | — |

Switchable on first use: deferred to the next major with the D471 lowercase-marker removal
(coordinator decision).

## Summary

| Direction | Verdict | Best number |
|---|---|---|
| **Compiled views, tier B "blocks"** (template clone + hole patching, like Million/Solid/ivi) | **Worth building, for list rows first.** Closes the single-view gap to React | select row 1k: 1.6–1.7 → 0.5–0.7 ms (React 0.7); create 1k −17 to −27%; remove −55%; heap for 1k rows −40% |
| Compiled views, tier A (pragma work moved to build time: pre-routed data, hoisted statics) | Good, cheap; the stepping stone to B | select 1.7 → 0.85 ms; update 10th 3.65 → 2.15 ms |
| Compiled views in a Collection | Small gain only: the per-instance cost dominates | select 1.9–2.1 → 1.3–1.6 ms; create 10k −10%; the rest within noise |
| **Compiled SSR** (JSX → string templates on the server) | **Worth building.** The largest ratio found | 1k rows: 2.11 → 0.12 ms (17.6×); 10k rows 27.8× |
| **Per-app dead-code elimination** (the plugin knows what the app uses) | **Worth doing; partly no compiler needed** | kanban gzip −902 B from one side-effect fix (done here), −824 B more for unused Switchable, −1.7 KB upper bound for message extraction |
| Compiling the model table / intent into direct dispatch | Not worth it: 0.1 µs/action left to win. But a runtime bug found on the way | Node: 665 → 103 ns/action by caching one `process.env` read (follow-up) |
| Precomputed calculated/context order | Already done at definition time (`define.ts`); nothing left | — |
| WASM vnode diff / same-output check | **Loses**: encoding the tree costs 4× the JS check | JS 146 µs vs WASM 7 µs + 568 µs encode |
| WASM keyed reconciliation (LIS) | Wins 1.3–2× on the kernel, irrelevant in absolute terms | 1k swap: 16 µs JS vs 13 µs WASM, inside a 1.5 ms op |
| WASM heavy reducers (numeric) | Marginal (13% on a 1M sort), and only if state lives in linear memory | — |
| WASM streaming parsers (SSE framing) | Loses to `String.indexOf` | JS 319 µs vs WASM 599 µs per MB |
| **QuickJS in WASM** (Sygnal headless in a sandbox) | **Works unmodified, ~10× slower than V8.** Not a speed play; a sandbox for generated/untrusted components (`sygnal/ai` compose, plugins, edge) | 25.6 µs/action, 74 ms SSR of 1k rows, 36 ms cold start |
| Rust/other-language models compiled to WASM | Loses unless the state stays in WASM (serialization per action) | see §WASM |
| Hermes / Static Hermes, V8 startup snapshots | Not applicable to the browser target; only for a native renderer or a Node SSR server | — |

Measured on an Apple M3 Max shared with three other sessions (load average ≈ 9 on 16 cores
during the browser runs), so the timings carry noise of roughly ±0.3 ms on the small ops and
±10% on the large ones; the count gate, the size numbers and the SSR/WASM/QuickJS node
benchmarks are much steadier. Every compiled variant renders the same DOM as its baseline after
each step of a 10-step op sequence (`check-dom.mjs`).

## Where the time goes today

CPU profiles (`benchmarks/audit/profile.mjs`, unminified build) of the benchmark table:

- **select row, 1k rows, one view** (1.6–2.0 ms): the JSX pragma (`ca`, `sanitizeData`,
  `flatten`, `jsx`) ≈ 0.8 ms; the modules' update hook + `sameData` ≈ 0.4 ms; snabbdom's own diff
  only ≈ 0.15 ms. About 5 ms/op of trailing GC from 4,000 short-lived vnodes and data objects.
- **create 1k rows** (18 ms): DOM creation dominates (createElement, appendChild, the module
  create hooks); the pragma ≈ 0.7 ms.
- **select row, Collection** (2–2.6 ms): each of the 1,000 rows re-renders (they read
  `context.selected`); the cost is the instance machinery (`context()`, `cell.get`, the context
  read-tracking Proxy) plus the pragma and the same-output check.

So roughly half of an update in a single view is work the pragma does at run time on
information that is static in the source, and most of the rest is diffing parts that cannot change.
That is what a compiler removes.

## 1. Compiled views

Sygnal views are unusually compilable: they are pure functions of `{ state, context, props }`
with **no event handlers or closures in the markup** (events come from the intent's selectors),
so a subtree's dynamic parts are exactly its `{expressions}`. React/Million have to preserve
handler identity; Sygnal has nothing to preserve.

Prototype: hand-written "compiler output" for the benchmark's two table apps, measured against
the same apps written in JSX (`apps/`, `proto/compiled-runtime.js`). The runtime the output
imports would be a ~1 KB `sygnal/compiled` subpath.

**Tier A, pre-routed vnodes** (`apps/table-a.jsx`): each JSX element becomes `new P(sel, data,
children, text, key)`, a vnode of the pragma's own class (`$p`, so the core treats it as plain),
with `className` already in `props`, `data={{}}` already in `dataset`, text children already
strings, and every static data object hoisted to module scope (so `sameData` hits `a === b`).
No core change. Static *vnodes* cannot be hoisted the same way: snabbdom writes `vnode.elm`, so a
vnode shared by two instances (1,000 Collection rows) points at one of their elements.

**Tier B, blocks** (`apps/table-b.jsx`): the row becomes `Row([cls, id, id, label], key)`. The
block's static markup is parsed once into a `<template>`; on create the element snabbdom made gets
a clone of it and the holes are written by direct DOM ops; on update only the holes whose value
changed are written. To snabbdom a block is a childless element with a constant `data` object
(its hook), so the module update hook returns at once and the diff never walks inside. One core
change (5 lines, `src/core/instance.ts` `same()`): a block is "the same output" when its hole
values are, so a Collection row whose view re-ran with the same values keeps its vnode (before,
any vnode with a hook was never the same, G-349).

Results (median latency in ms, event → DOM settled + layout; React 19 is the audit's own app):

| Op | table (JSX) | tier A | tier B | React 19 | Collection (JSX) | Coll. tier A | Coll. tier B |
|---|---:|---:|---:|---:|---:|---:|---:|
| create 1k rows | 18.0 / 22.1 | 18.6 | **13.2 / 18.3** | 13.3 | 19.3 / 20.9 | 19.0 / 22.2 | 23.8 / 20.1 |
| replace 1k rows | 18.6 / 17.7 | 15.9 | **16.0 / 14.3** | 20.7 | 21.8 / 23.0 | 25.0 / 21.4 | 34.4 / 21.1 |
| update every 10th | 3.65 / 2.8 | 2.15 | **2.55 / 2.2** | 2.25 | 3.0 / 3.2 | 4.45 / 3.1 | 3.1 / 3.5 |
| select row | 1.6 / 1.7 | 0.85 | **0.5 / 0.7** | 0.7 | 2.1 / 1.9 | 1.75 / 1.4 | **1.6 / 1.3** |
| swap rows | 1.95 / 2.2 | 1.55 | **1.35 / 1.8** | 14.9 | 2.2 / 2.3 | 3.0 / 2.0 | 1.75 / 1.8 |
| remove row | 2.2 / 2.4 | 2.05 | **1.05 / 0.9** | 1.25 | 1.8 / 1.7 | 1.9 / 1.8 | 1.75 / 1.9 |
| create 10k rows | 157 / 156 | 145 | **135 / 134** | 263 | 226 / 220 | 210 / 206 | **202 / 197** |
| append 1k to 1k | 17.3 / 20.0 | 16.5 | **13.2 / 13.6** | 13.6 | 22.7 / 19.6 | 19.3 / 20.1 | 17.9 / 20.0 |
| clear 1k rows | 2.7 / 2.9 | 2.6 | **2.05 / 2.4** | 2.45 | 3.6 / 3.6 | 3.5 / 3.7 | 2.95 / 3.3 |
| heap for 1k rows (MB) | 0.89 | 0.54 | **0.53** | 1.36 | 5.75 | 5.41 | 5.43 |

`a / b`: run 1 (10 iterations) / run 2 (15 iterations, a different page order); single values are
run 1 only (`results/bench-*.json`). Differences under ≈ 15% between the Collection columns are
within the run-to-run noise here (see coll-b replace: 34.4 then 21.1).

Reading it:
- **Single view: tier B is at or near React on every op** (select 0.5–0.7 vs 0.7; remove 0.9–1.05
  vs 1.25; append 13.2–13.6 vs 13.6; create 13.2–18.3 vs 13.3, React measured in run 1 only), from
  up to 2.3× React with JSX, and faster than its own JSX baseline on every op in both runs. Tier A gets a good part of the
  update gain (select −45%, update −40%) and none of the create gain: create is DOM work, which
  only the template clone reduces.
- **Collection: about −30% on select and −10% on create 10k; nothing reliable elsewhere.** A Collection row costs an
  instance (cell, context, scope, isolation copy of the vnode), and that, not the view, is what
  create/replace/update pay. A compiler can still take one more piece: the view's context reads
  are known statically (`context.selected`), so the core could skip the per-render read-tracking
  Proxy and `Set` (D168) for compiled views. Not prototyped.
- Memory: −40% heap for a 1k-row single view (fewer retained data objects); no change in a
  Collection (instances dominate).

How far does this reach in real apps? `survey/blockable.mjs` parses every example app (122
files, 2,089 JSX elements): **81% of elements are inside a blockable subtree** (intrinsic tags
only, no form field, ref, spread, component or marker), 45% in blocks without a vnode "slot"
(a `.map()`, `children` or JSX-valued hole, which needs a nested diff). But blocks are small,
**2.1 elements per block root on average**: components and slots cut the trees up. The table
row (4 elements, 4 holes) is the good case; the gain per block is roughly the per-element
pragma + module work it skips, so expect the big wins on lists and the large static pieces,
and small ones elsewhere.

What a real compiler needs beyond the prototype:
- A JSX transform in `sygnal/vite` (Babel or oxc AST; the parser `sygnal-check` already ships
  would do) that emits tier A for everything and tier B for blockable subtrees, with a bail-out to
  the pragma for anything it doesn't understand (spreads, dynamic tags, `class={obj}` with unknown
  shape is fine as a hole).
- Hole kinds: text, attribute, property, `className`/`class` map, `style`, dataset, and "slot"
  (a vnode child, patched by snabbdom inside a child element the block owns).
- Hydration: a block adopting server HTML (walk the hole paths in the existing element instead
  of cloning). Its SSR twin is §2.
- Dev tooling: devtools and `renderComponent`'s mock DOM read vnodes; a block is opaque to them.
  The mock DOM path would need the pragma path (the plugin already knows when it runs under Vitest).
- Size: the prototype runtime is 785 B min / 486 B gzip; compiled output is smaller than `jsx()` calls per element for
  static markup and slightly larger for small dynamic elements (hoisted data objects).

## 2. Compiling for the server

`ssr/bench.mjs`: the table view as a string template (static markup as constants, escaped holes)
vs `renderToString` (pragma vnodes, then the SSR walk). Byte-identical output, checked, including
labels with `<`, `&` and quotes.

| Rows | HTML | renderToString | compiled | |
|---:|---:|---:|---:|---:|
| 1,000 | 129 KB | 2.11 ms | 0.12 ms | **17.6×** |
| 10,000 | 1.3 MB | 24.95 ms | 0.90 ms | **27.8×** |

This is the Marko/Solid/Svelte SSR result, and it applies to Sygnal for the same reason as §1: the
markup is static except for expressions. Components, Collections, Suspense and `head` still need
the walk (the compiled template calls back into `renderToString` for those). It is the easiest of
the compile wins to ship (string output, no DOM, no hydration change), and it speeds up Vike/Astro
SSR, `renderComponent`'s `t.html()` and the docs' build.

## 3. Per-app dead-code elimination (size)

The size gate had **25 B of headroom** (kanban, 42,975 B gzip). `size/attribute.mjs` maps every
byte of the kanban bundle back to its source (through `dist/*.map`); `size/dce.mjs` measures what
dropping a feature saves.

- **`src/extra/widget.ts` shipped in every app** (2.2 KB min), used or not: one top-level
  statement, `;(rewrite as any).$k = inPortal`, is a side effect the bundler must keep, and it kept
  the module. Moved into `defineWidget()` (the only place `rewrite` gets registered), **kanban
  42,975 → 42,073 B gzip (−902 B)** (measured with the prototype `instance.ts` change also in, so the fix alone is a few bytes more). No compiler needed; widget and portal tests pass (13 files,
  105 tests). This change is on this branch (`src/extra/widget.ts`) and is the one result here
  worth merging as is.
- **Switchable's host registers on import** (by design, so the lowercase `<switchable>` tag works
  without an import). An app that never names `Switchable`/`switchable` pays **824 B gzip**
  (kanban). The plugin can see that in the app's source: either define a flag that skips the
  registration, or rewrite `<switchable>` to the imported marker so the host can register on first
  use like Portal (G-751).
- **Messages**: Sygnal's (and xstream's) prose strings in a production bundle are **≈ 1.7 KB gzip**
  of kanban (upper bound: every string ≥ 20 chars with a space replaced by `""`). React-style
  extraction (production prints the SYG code and the docs URL, the text lives in the diagnostics
  entry and `explanations.json`) would keep most of that; the code registry already exists.
- SVG support, when the app's JSX has no SVG tag: −147 B. Not worth a flag.

## 4. Compiling dispatch (model table, intent)

`dispatch/bench.mjs`: 200k actions through intent → model → STATE (headless, node):

| | ns/action |
|---|---:|
| the reducer called directly | 10 |
| through the core | **665** |
| the same, `process.env` read cached | **103** |
| + one context entry / + one calculated field | +35 / +66 |

A CPU profile put **73% of the per-action time in `dbg()`** (`src/core/debug.ts`): on every
action it reads `process.env.SYGNAL_DEBUG` (twice), and in Node a `process.env` property read is
a slow C++ lookup. In the browser `ENV` is `window`, a cheap miss, so this is Node only: SSR,
tests (vitest), headless/edge apps. Fix: read the variable once (or once per flush). Not made
here, because `test/p3-1b-effect.test.js` sets `process.env.SYGNAL_DEBUG` after import; the fix
needs that test (or the documented semantics: "SYGNAL_DEBUG=true in Node") settled first.

After that fix the core costs ≈ 0.1 µs per action. A compiled direct dispatch could win part of
that, which matters for nobody: 10k actions/s is 1 ms/s. Calculated-field and context orders are
already computed once per definition (`define.ts`). **Not worth compiling.**

## 5. WASM

`wasm/kernels.ts` (AssemblyScript 0.27, 1.7 KB `.wasm`) vs line-for-line JS twins
(`wasm/bench.mjs`, node 24 = the V8 in Chromium). The boundary is cheap (4.9 ns per call vs
3.8 ns for a JS call); the problem is always getting Sygnal's data, which is JS objects, into
linear memory.

| Candidate | JS | WASM | Verdict |
|---|---:|---:|---|
| same-output check, two 4,001-vnode trees | 146 µs | 7 µs + **568 µs to encode the trees** | Loses 4×. A vnode diff in WASM has to read every JS object anyway, and reading it *is* the diff. The real win for this check is §1's blocks (compare 4 holes, not 4 vnodes) |
| keyed moves (key map + LIS), 1k swap | 16 µs (24 µs with a `Map`) | 12 µs (+1 µs copying keys) | Wins 1.3–2×, on ≈ 1% of the op. snabbdom doesn't run an LIS anyway; moving it to WASM buys nothing visible |
| same, 10k shuffled | 253 µs (624 µs `Map`) | 137 µs (+15 µs) | 1.8×, still < 0.3 ms |
| sort 1M f64 (a numeric reducer) | 82 ms (native and JS quicksort) | 71 ms | 13%, if the data already lives in linear memory; reading 1M row objects into it costs 1.4 ms, a JS-object state tree gives most of that back |
| SSE framing, 1 MB | 319 µs (`indexOf` on the string) | 599 µs (copy + scan) | Loses; and JS needs the decoded string for `JSON.parse` anyway (134 µs) |

**Models written in Rust (or anything) compiled to WASM:** each action would serialize the state
across the boundary (JSON or a binary format) unless the whole state lives in WASM memory, at which
point views, context and the devtools all read it through accessors. For ordinary reducers V8 is
already within ~10–30% of WASM; this only pays for a domain kernel (physics, CRDT merge, image or
audio processing, a solver) that an app calls *from* a reducer or an EFFECT. Sygnal needs nothing
special for that: a driver or a plain import of a WASM module works today.

**Running Sygnal itself in a WASM-hosted engine** (`quickjs/bench.mjs`, quickjs-emscripten 0.31):
the unmodified core (178 KB min guest bundle) runs model + intent headless and renders SSR inside
QuickJS-in-WASM with identical results (same final state, same 129,756 HTML bytes):

| | V8 (node `vm` context) | QuickJS in WASM |
|---|---:|---:|
| engine init | — | 3.7 ms |
| load the core bundle | 5 ms | 32 ms |
| 10k actions (todo reducer, 200 items) | 24 ms | 256 ms (25.6 µs/action) |
| SSR, 1k rows | 7 ms | 74 ms |

Not a performance option (≈ 10× slower), but a real capability: **a sandbox for code Sygnal
didn't write.** The `sygnal/ai` compose work generates components; QuickJS-in-WASM could run a
generated component's model/intent with no access to the page, a memory limit and an
interrupt handler, and hand only its vnodes (or its HTML) back to the host. 25 µs per action is
fine for UI-rate events. Same shape for user plugins and for edge runtimes without `eval`. The
guest needed only `global` and a `setTimeout` shim (xstream's deferred stop).

## 6. Other compile targets

- **Hermes / Static Hermes**: React Native's engines. A browser app can't use them; only relevant if
  a non-DOM renderer (the alt-renderers exploration) targets a Hermes host. Static Hermes wants
  typed, monomorphic code, which the core mostly is, but the gain would show up only in a native app.
- **Startup snapshots**: browsers have no user snapshots. Node's `--build-snapshot` could snapshot an
  SSR server with the core loaded (startup ≈ 5 ms here: not worth it). Startup of a client app is
  INITIALIZE + first render, already timer-free (PLAN-4.6).
- **Bytecode caching**: V8's code cache already does this for large scripts on repeat visits.

## Recommended next steps

1. **Done on this branch (round 2):** the `widget.ts` side-effect fix with a Vite 8 regression test,
   and `SYGNAL_DEBUG` read once in Node (665 → 105 ns per action). Before that: **merge the `widget.ts` side-effect fix** (−902 B gzip on kanban, restores real size headroom).
   Check the other entry points for the same pattern (a top-level property assignment on an
   unexported function): `size/attribute.mjs` is the tool.
2. **Fix the Node `process.env` read in `dbg()`** after deciding whether `SYGNAL_DEBUG` may change
   at run time (the one test that does it could set `Component.debug` instead). 6.5× on headless
   dispatch; also speeds up vitest suites.
3. **Compiled SSR** in `sygnal/vite` for server builds (largest ratio, no client risk).
4. **Compiled views, tier A then B**, behind an opt-in plugin option, starting with `.map()` rows and
   Collection item views: a PLAN-sized project (transform, hole kinds, hydration, mock-DOM fallback,
   devtools). Keep the count gate's patch counts; add timing ops for blocks to the perf report.
5. **Switchable registration on first use: −824 B, lands with the D471 lowercase-marker removal
   patch** ([`../lowercase-marker-removal/`](../lowercase-marker-removal/)) in the next major. In 7.x
   the lowercase `<switchable>` tag is documented to work with no import, so the host stays
   registered on import (coordinator decision, 2026-10-29). Production message extraction (≈ 1.5 KB)
   is a separate decision (it changes what users see in production consoles).
6. **WASM: nothing in the core.** Optionally a sandboxed-component runner on QuickJS-in-WASM as a
   `sygnal/ai` experiment, if running generated components safely becomes a goal.

## Files

| Path | What |
|---|---|
| `proto/compiled-runtime.js` | the would-be `sygnal/compiled` runtime: `P` (tier A vnode) and `block()` (tier B) |
| `apps/*.jsx` | hand-written compiler output (`-a`, `-b`) and the JSX baselines (`-base`), sharing intent/model (`table-statics.js`) |
| `bench.mjs` | builds the pages + the audit's React table, times the table ops with the audit's method; `results/bench-*.json` |
| `check-dom.mjs` | the compiled variants render the same DOM as the baselines through 10 ops |
| `ssr/bench.mjs` | compiled SSR string template vs `renderToString` |
| `size/attribute.mjs`, `size/dce.mjs` | bytes per source in the kanban bundle; per-feature DCE probes |
| `dispatch/bench.mjs` | ns per action through the core |
| `wasm/kernels.ts`, `wasm/kernels.wasm`, `wasm/bench.mjs` | the WASM kernels and their JS twins |
| `quickjs/` | Sygnal headless + SSR inside QuickJS-in-WASM |
| `survey/blockable.mjs` | how much of the examples' JSX a block compiler could take |

Source changes on this branch: `src/extra/widget.ts` (the side-effect fix; mergeable) and
`src/core/instance.ts` (the block-aware same-output check; prototype only, only matters with
compiled blocks).

To re-run: `npm run build`, `npm ci --prefix benchmarks`, then e.g.
`CW_OUT=<scratch dir> node dev-plans/research/compile-wasm/bench.mjs` (≈ 15 min; `--pages=`,
`--ops=`, `--iter=`), `node dev-plans/research/compile-wasm/check-dom.mjs`; the WASM and QuickJS
benches need AssemblyScript / quickjs-emscripten from npm in a separate folder
(`quickjs/bench.mjs <that folder>`).
