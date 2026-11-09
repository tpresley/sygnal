# Workstream `mangle`: renaming private property names in `dist/`

**Outcome: no-go.** The names that can be proven private save 382 B gzip on (b), under the bar of
about 400 B set for the spike, and about half of that is in code other workstreams are rewriting.
Nothing ships from this branch: `dist/` and every source file are unchanged, so the size and speed
are exactly the 7.4.0 baseline.

## Final numbers

| Measure | Baseline, and this branch | With the list that passes every rule |
|---|---|---|
| (a) `nativeGlobalThis: false`, gzip | 43,630 B | 43,255 B (-375) |
| (b) default, gzip | 39,630 B | 39,248 B (-382) |
| (c) `src/core/**` alone, gzip | 20,166 B | 20,166 B (the gate builds (c) from `src/`, so a pass over `dist/` can't show there) |

Speed: `perf-ab` was not run. With no change on the branch there is nothing to compare, and a
20-minute run would hold the shared lock for no result. Renaming properties shouldn't move timing,
but that is unmeasured.

Vite: `examples/kanban` resolved 8.3.7, not the 8.3.6 the protocol names. The baseline still
reproduced to the byte (43,630 / 39,630 / 20,166), so the numbers compare.

## What was measured

Each row renames the listed names in `dist/index.esm.js` only (the last two: every entry), then
runs the size gate. Deltas are against (b) 39,630 B.

| List | Names | (a) | (b) | Delta (b) | Safe? |
|---|---|---|---|---|---|
| Generous first pass (no word in a lib, xstream, snabbdom or any `.d.ts`) | 515 | 42,941 | 38,928 | -702 | No: contains markers and shared globals |
| Plus the hooks contract and names seen in tools, docs | 237 | 42,710 | 38,699 | -931 | No |
| Private by word search, plus generic internals (`disposed`, `app`, `def`, `hooks`, `uid`, `cell`, ...) | 153 | 42,877 | 38,864 | -766 | No, see below |
| Plus delegator names that tests read | 96 | 43,107 | 39,111 | -519 | Needs test edits |
| Private by word search only | 86 | 43,235 | 39,231 | -399 | Mostly |
| Reviewed site by site | 84 | 43,208 | 39,201 | -429 | Yes, one-entry allocator |
| Same, with a collision-free `$` namespace | 84 | | 39,268 | -362 | Yes |
| Same 84, one map across all 61 `dist/*.js` | 84 | 43,225 | 39,215 | -415 | Passes the library tests |
| **Rule-checked list, real rollup plugin** | **78** | **43,255** | **39,248** | **-382** | **Yes** |

Split of the 84 by owner: `src/cycle` names alone -224 B, core and the rest -232 B. The two halves
don't quite add up to the whole, as usual with gzip.

gzip does absorb the names: 3,000 raw bytes removed becomes about 400 B.

## Why the larger numbers aren't reachable

Everything above -519 B depends on names like `disposed`, `app`, `def`, `hooks`, `uid`, `pages`,
`dirty`, `phase`, `shown`, `failed`, `opts`, `cur`. A mangler working on `dist/` has no receiver
types, so a name is renamed everywhere or nowhere. These names are also used on other objects:
`src/extra/ai/**`, public `.d.ts` members, wire formats, and objects app authors see. Renaming
`.app` or `.disposed` globally breaks them.

Scoping the rename to `Inst` / `App` / `Def` would need real types (`instance.ts` alone has 79
`any`) or a per-module proof, which is more fragile than the 370 B it would add.

## Other reasons for no-go

- About half of the 382 B is in `src/cycle/dom` names (`isolateModule`, `propagationHasBeenStopped`,
  `namespaceByElement`, ...), which `dom-events` is restructuring, and the rest in `src/core`, which
  `core` is working on. Any name they shorten or remove stops counting here, so the combined result
  would be below 382 B. The overlap wasn't measured, since the other branches aren't finished.
- The ongoing cost is a build pass over 41 configs, a list to maintain, and internals in `dist/`
  that read as `inst.J` in a debugger. A future reflection on a listed name would break at run time.

## What was tested

The 84-name list on all entries: `npx vitest run`: 6,291 passed, 2 failed, neither from mangling.
`test/docs-live-server.test.js` needs the docs dependencies, which weren't installed in this
worktree, and one dev-server test in `test/vite-plugin-dev.test.js` timed out under load and passed
when run alone. The browser suite, the example suites and the perf gate were not run against the
mangled build, because the spike stopped at no-go. No test was edited.

The 78-name list (the last row) came from the same names minus six that failed the check rules;
it was built and size-gated but not run through vitest.

## The prototype, if the question is reopened

It is off the branch, kept in the sweep's shared notes folder as `mangle-prototype/`:

- `rollup-mangle.mjs`: a `renderChunk` plugin (`order: 'pre'`, so before terser in the UMD build;
  magic-string, so sourcemaps chain). It renames non-computed member and key sites, one fixed map
  for all entries. A listed name that no longer exists is simply not found, so renames elsewhere
  can't break the build. The build stops if a target short name collides with an existing property
  or if bundled third-party code uses a listed name.
- `mangle-names.json`: the 78 names and their targets, an allowlist.
- `mangle-names.mjs`: `--check` (refuses standard or DOM members, xstream / snabbdom / virtual-core
  properties, public `.d.ts` members, the hooks contract, names appearing as string literals in
  `src/`, and names used in docs, examples, devtools or benchmarks; prints those also seen in
  tests), `--candidates` (eligible names not yet listed, by weight), `--write` (drops names that
  are gone and reassigns targets).
- `classify.mjs`, `applyall.mjs`: the throwaway measuring scripts.
- `rollup.config.patch`: the two-line wiring.

To re-measure after the sweep merges: apply the patch, `--write`, `--check`, build, size gate. Worth
doing only if the merged branch still has long private names; `--candidates` shows that directly.

## Ideas that came out of this

- Not an 8.0 API item, a note for `dom-events` and `core`: the top of the list shows where the
  names cost most (`isolateModule` 15 sites, `_namespace` 16, `_name` 21, `propagationHasBeenStopped`,
  `namespaceByElement`, `outv` 17). A rename in source gets the same bytes with no build step,
  where the readability trade is acceptable.
- Test-pinned delegator internals (`nonBubblingListeners`, `_eventDelegator`, `namespaceTree`, ...)
  are worth about 90 B more to any mangler, at the cost of editing the tests that read them.
