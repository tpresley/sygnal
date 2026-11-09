# vdom: is an own patch function smaller and faster than snabbdom?

**Go**, with two follow-ups the coordinator has to weigh (see "What other entries pay"). The core
is 979 B gzip smaller as shipped and about 1.4% faster, with no behaviour difference found.

## Result

| Measure | 7.4.0 | This branch | Delta |
|---|---|---|---|
| (a) `nativeGlobalThis: false`, gzip | 43,630 B | 42,649 B | -981 B |
| (b) default, gzip (what apps ship) | 39,630 B | 38,651 B | -979 B |
| (c) `src/core/**` alone | 53,951 min / 20,166 gzip | unchanged | 0 |

| Commit | (a) | (b) |
|---|---|---|
| Own patch function, `h`, `Fragment`, attrs / dataset / class modules | -936 B | -941 B |
| `styleModule` tightened (independent of the patch; can land alone) | -45 B | -38 B |

perf-ab, full run (4 rounds): **latency geometric mean 0.986, cpu 0.997**. Two ops were marked
`SLOWER` and neither held up when re-run alone with `--rounds=4`: `leaf update, 30 deep` 1.000
(was 1.255), `switch: show other page (500)` 1.004 (was 1.057). An earlier 2-round run gave 0.972.

## Gates

`TEST_EXAMPLES_INSTALL=1 npm test` exits 0: 6,310 library tests (7 of them new), the example
suites, types, Chromium browser suite 450/450, count gate within limits. The browser suite also
passes on Firefox and WebKit. `npm --prefix docs run build` passes and `check-live` passes 138
demos on Chromium; it was not run on Firefox or WebKit, as no docs changed.

No existing test was edited.

**One file changed outside the workstream's table**: `benchmarks/audit/lib/instrument.mjs`. The
perf gate counts patches by hooking `return function patch(...)` in `node_modules/snabbdom`, and
it throws when the hook isn't found. It now hooks the same function in `dist/index.esm.js`. If
another workstream renames `old` / `v` in that function, the hook's `find` string has to follow.

## What Sygnal relies on from snabbdom (inventory)

- **Vnode shape**: `sel`, `data`, `children`, `text`, `elm`, `key`. `sel` '' or undefined is a text
  node, '!' a comment. Widgets, tests, `flat`, `adopt` and the pragma's `Plain` all see these.
- **Module hooks** `pre/create/update/destroy/remove/post`, in module order. `makeDOMDriver`'s
  `modules` and `sygnal/host`'s `modules` option accept users' own modules (public).
- **Vnode hooks** `init/create/insert/prepatch/update/postpatch/destroy/remove`: Portal,
  Transition, refs, autoFocus, widgets, `<Outlet>`, thunk, compiled blocks, the toaster.
  `hook` and `data` are read before `init` runs, so a thunk's replaced data doesn't change them.
- **Ordering**: a vnode's `create` hook after its children; `insert` after the whole patch,
  children first, then `post`. `remove` waits for every callback. The same vnode twice runs only
  `prepatch` (the shortcut P45-A depends on).
- **Keyed children**: both ends first, then a key index; a number key and its string are one key
  (G-548); holes are skipped; the walk holds its end vnodes rather than re-reading them.
- **Custom `domApi`**: only `sygnal/host` (`hostApi`, which is public and keeps its shape). The
  host tree implements the same node methods as the DOM, so only the node creators are needed.
- **Fragments**: `flat` removes them before every patch, Portal's `box` and thunk's copy too. The
  `experimental.fragments` branch is dead in Sygnal.
- **SVG**: `data.ns` from the pragma or `h`; `xlink:` / `xml:` / `xmlns:` attributes.
- **`patch(element, vnode)`**: Portal and compiled blocks. `patch(documentFragment, ...)` has no caller.
- **Perf gate**: see above.
- **Public reach**: `h` and `thunk` are exported from `sygnal`; `VNode` / `VNodeData` are public
  types (still snabbdom's, type-only); `Fragment` from the JSX entries. `snabbdomOptions` is on
  `DOMDriverOptions` but undocumented; it is accepted and ignored.
- **Other entries**: `src/zag.ts` has a private snabbdom patch and is unchanged, so `snabbdom`
  stays a dependency. `src/host/driver.ts` imports through the barrel.

## D209

D209 forbids copying maintained third-party code. `patch.ts` is new code written against the
contract above: it has no DOM wrapper layer or fragment support, drives nodes directly, and is
structured around Sygnal's needs. **It is not a clean-room implementation**: I read snabbdom's
`init.js` to list the contract, and it deliberately uses the same two-ended keyed walk, because
identical move and hook order is the behaviour being preserved. The algorithm is a general one
(Vue 2 and Inferno use it too).

The spirit of D209 is that users get patches through npm. Moving this code in-house means fixes
now come from Sygnal rather than from snabbdom, which is a decision for the maintainer. The code
has little attack surface (it doesn't parse strings or take URLs), but it is now ours to maintain.

## Risk

A patch function has a long tail of DOM edge cases.

**Covered**
- `test/vdom-patch-differential.test.js` (in the gate, 300 sequences): snabbdom and this patch on
  the same random vnode sequences, comparing the DOM, every module and vnode hook in order, every
  DOM insert / append / remove in order, and whether each throws. Keyed and unkeyed lists, holes,
  duplicate keys, `1` next to `'1'`, text / element / comment transitions, reused vnodes, every
  attribute namespace. Run at 30,000 sequences once, clean. It caught one real divergence (the
  held end vnodes above) that all 6,300 other tests missed.
- The existing suites, on three real browser engines, plus 138 docs demos on Chromium.

**Not covered**
- The differential runs under jsdom, so a difference that only shows in a real engine would rely
  on the browser suite, which pins behaviours rather than comparing with snabbdom.
- Thunks, real `style.remove` transitions and customized built-ins are not in the differential
  (the existing suites and one unit test cover them).
- Third-party modules passed through the `modules` options are only as covered as the logging
  module in the differential.
- Production apps. A release candidate on a real app would be worth more than any more fuzzing.

**Known differences from snabbdom** (all at internal or crash-only level)
1. A key named after an `Object.prototype` member (`constructor`, `__proto__`) now works. In
   snabbdom it reached the key index's inherited entry and threw. Pinned by a test.
2. `createElement` gets one argument unless `data.is` is set (part of the speed gain).
3. No fragment branch and no `patch(documentFragment, ...)`; neither is reachable from Sygnal.

## What other entries pay

Both are one internal export away from being fixed, but that export is in `src/index.ts`
(`periphery`'s file), so neither change is on this branch.

| App using | 7.4.0 gzip | This branch | With the fix |
|---|---|---|---|
| `sygnal/host` (terminal, worker, native) | 68,451 B | 68,857 B (+406) | 67,567 B (-884, measured) |
| `sygnal/zag` (and Menu / Select / Combobox) | 68,913 B | 70,727 B (+1,814) | not measured |

(esbuild bundles of a small entry, minified; compare the deltas, not the totals with the size gate.)

- **`sygnal/host`** inlines its own copy of the patch, as it does the modules. Fix, measured: add
  `export {init as __patchInit} from './cycle/dom/snabbdom'` to `src/index.ts`, and in
  `src/host/driver.ts` import it from `'../index'` in place of the barrel. Size gate (b) unchanged.
- **`sygnal/zag`** apps now ship snabbdom and this patch. Fix: move `src/zag.ts` to `__patchInit`
  and the local modules, keeping snabbdom's `propsModule` semantics and `eventListenersModule`
  (Zag needs them; Sygnal's `propsModule` differs). Not done: `src/zag.ts` is in nobody's table
  and the port needs its own check. After it, `snabbdom` could become types-only.

## Tried and rejected

| Change | Result | Why not |
|---|---|---|
| `classNameModule` tightened | (a) -1 B, (b) -9 B | Under the 10 B rule |
| `isField` as one regex | (a) +13 B, (b) +11 B; ratios 0.97 to 1.04, no measured gain | Bigger, no gain |
| Text written in place (`firstChild.data` in place of `textContent`) | +24 B; update every 10th 0.94 / 1.00, keystroke 0.85, leaf 0.86 (1 ms ops: the noise is wide) | A behaviour change: a user's `MutationObserver` with `childList` but not `characterData` stops seeing those text changes. Left for the maintainer |

## Comments and docs left out of date (outside this workstream's files)

Comments across `src/` and four docs pages say "snabbdom" for what is now this function
(`docs/.../renderers/custom-targets.md`, `guide/inputs.md`, `reference/api.md`,
`advanced/portals.md`), as do CLAUDE.md and the rollup comments. `src/cycle/dom/snabbdom.ts`
keeps its name so other workstreams' imports don't move; renaming it is a simple later change.

## 8.0 ideas

None that need an API change. `snabbdomOptions` could be removed from `DOMDriverOptions`.
