# Workstream `periphery`: the pragma, run(), helpers, and what apps pull in

Branch `claude/sweep-periphery-e60b62`, cut from `claude/core-size-sweep` at 7.4.0.

## Result

| Measure | 7.4.0 | This branch | Delta |
|---|---|---|---|
| Size gate (a) `nativeGlobalThis: false`, gzip | 43,630 B | 43,388 B | -242 B |
| Size gate (b) default, gzip | 39,630 B | 39,375 B | -255 B |
| Size gate (c) `src/core/**` alone | 53,951 B min / 20,166 B gzip | unchanged | 0 |
| Minimal app (one component, real `sygnal/vite`), gzip | 37,252 B | 37,024 B | -228 B |

Measured with Vite 8.3.7 in examples/kanban (`npm install` resolved that, not 8.3.6). The baseline
came out at exactly the README's numbers on it.

Perf A/B, full run: `geometric mean, candidate / baseline: latency 0.967, cpu 0.977; 0 op(s) marked
SLOWER`. `keystroke (1k list)` read 1.139 in that run (+0.12 ms, under the marking threshold); alone
with 6 rounds it read 0.792, so it was noise.

Gates: `npm run build`, then `TEST_EXAMPLES_INSTALL=1 npm test` passed in full on a quiet machine
(vitest, examples, types, browser, perf count gate; heap 0.97 MB). `node scripts/size-gate.mjs` OK.
`sygnal-check` wasn't run: nothing it reads changed.

Earlier full runs at a load average above 100 failed on different timing tests each time
(`test/p45-d-lazy-wiring.test.js`, which races a 40 ms timer; `compose-generated-*`, `replay`,
`vite-plugin-mcp`, `examples/tui-tracker`). Each passes alone and the quiet run passed them all.

## Changes (gzip delta on (b))

| Commit | Change | Delta |
|---|---|---|
| 7db4919b, 6702773d | `xstreamCompat`: a plain import; the builds' xstream shim already does the interop, so the namespace object, `getXs` and a retained top-level statement go. `xs` stays typed `any` | -115, +5 B |
| 2d81f412 | Pragma: the SVG tags as one regex (run once per tag, cached) | -33 B |
| 2d81f412 | Pragma: `put` reads the route by index, not by array destructuring | +5 B, createElement about 10% faster (microbench, both orders) |
| 7f9f948d | Pragma: SYG420 only through the diagnostics bridge; the console fallback was unreachable in any build | -49 B |
| d13477a4 | `dragDriver`: dragover and drop share their zone search; the four source methods from one loop | -30 B |
| 958e023a | `StateSource`: `isolateSource` / `isolateSink` as methods rather than two fields per instance; lens functions compacted | -14 B |
| 95fbf9bb | `run`: the hot module resolves straight to the component; a redundant `__hooks` copy removed | -24 B |

Notes for review:

- The SVG regex lists exactly the 56 tags of the old table (checked by script). The old `tag in
  svgTags` was also true for `Object.prototype` names, so `<constructor>` got the SVG bit. No real
  tag is affected.
- The pragma appears only in `dist/index.esm.js`, `index.cjs.js` and `sygnal.min.js`, all of which
  load `legacy.ts`, which publishes `__SYGNAL_DIAGNOSTICS__.error`. **For `prod-strip`:** if a
  production transform removes that bridge, an undefined JSX tag prints nothing. Today it prints
  through the bridge, as `test/plan2-1b.test.js` pins.
- `makeDragDriver` has no unit tests of real drags, so I ran one scripted session (dragstart, over,
  drop, end, dispose, `accepts`, `.data()`, `.element()`) in jsdom against 7.4.0 and this branch.
  The logs were identical.

## Tests edited

`test/xstreamCompat.test.js`: the `resolveInteropDefault` block is gone with the function. It was an
internal interop helper, not exported from any entry. The `xs` and `Stream` tests are unchanged. No
pragma test was edited.

## What real apps ship

Built with the real `sygnal/vite`, attributing minified bytes through chained source maps. A
one-component app is 37.0 KB gzip against kanban's 39.4 KB, so nearly all of the bundle is fixed
cost, and a small app is not much smaller than a real one.

- **The Collection and Switchable hosts are the largest thing an app ships without using it**: 8 KB
  minified. They stay only because the lowercase tags work without an import (idea 1 below).
- The marker statics, `VirtualCollection`, the AI, form, router and other exports do tree-shake: none
  of them are in the minimal bundle.
- **`sideEffects` is not broader than it needs to be.** Taking `dist/index.esm.js` and
  `dist/index.cjs.js` off the list changes neither number by a byte: an app always uses something
  from the entry, and statement-level shaking doesn't depend on the flag. Left as it is.
- The rest of the always-kept top-level code belongs to other workstreams: the diagnostics bridge
  (`prod-strip`), xstream and its `symbol-observable` and CommonJS wrapper (`xstream`).

## Tried and rejected

| Spike | Result |
|---|---|
| `run`: one shared `window` lookup in place of six `typeof window` checks | -153 B raw, **+9 B gzip**: no-go |
| `dragDriver`: `.data()` and `.element()` through one helper | -2 B gzip: under the 10 B bar |
| Removing `sideEffects` entries | 0 B |

Micro-tuning the rest of the pragma wasn't worth it. Its self time is in `put` and `bucket`, which
are keyed writes to per-element objects, and repeated text there is already absorbed by gzip.

## Outside my files, for the coordinator

- **The modulepreload polyfill** is 1.5 KB minified in every Vite app: -287 B gzip on kanban, -290 B
  on the minimal app with `build.modulePreload: { polyfill: false }`. `sygnal/vite` could default it
  off (an app's own setting still winning). It only affects a preload hint on browsers without
  `modulepreload`, but it does change what apps get, so it's the maintainer's call. `src/vite/` is
  not mine.
- `src/cycle/run/adapt.ts` (no owner) reads `globalThis.Cyclejs.adaptStream` on every call. Nothing
  in the repo sets it. About 150 B minified, and removing it would drop a global hook.
- The README's worktree setup omits `npm ci --prefix docs`; without it `test/docs-live-server.test.js`
  fails. CLAUDE.md has it.

## 8.0 ideas

1. **Remove the lowercase `<collection>` and `<switchable>` tags; register the hosts on first use
   through `$reg`**, as Portal, Transition and Suspense do (G-751). The tags have been deprecated
   since 6.3.0 and the docs already say the next major removes them (SYG426, with a `--fix`).
   Measured by removing the registrations: **-833 B gzip on kanban** (Switchable, which it doesn't
   use) and **-2,982 B gzip (8%) on an app using neither**. `test/p9-g751-marker-treeshake.test.js`
   pins the current behaviour (`ALWAYS`). Without an API change this can't be shaken: a string tag
   gives a bundler nothing to follow.
2. **Remove `StateSource.isolateSource` / `isolateSink`.** Nothing in the core calls them on a
   StateSource since `isolate()` went (R5), and they are undocumented, but they are visible in the
   public type. Removal would also drop `makeSetter` and `updateArrayEntry`. Not measured.
