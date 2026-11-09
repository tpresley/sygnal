# Workstream `xstream`

Question: can a compact, behaviour-identical xstream replace the npm package and its `globalthis`
chain? And (added by the maintainer) would absorbing xstream into Sygnal earn a major release?

**Verdict: go for the alias, as a modest win. No for a major release on these numbers alone.**

| Build (kanban, gzip) | (a) `nativeGlobalThis: false` | (b) default, what apps ship | Plain esbuild, no plugin |
|---|---|---|---|
| 7.4.0 | 43,630 B | 39,630 B | 62,372 B (measured on the alias branch, which doesn't change this path) |
| Alias (this branch) | 43,630 B (unchanged by design) | **38,833 B (-797 B, -2.0%)** | 62,372 B (unaffected) |
| Native (spike branch) | 38,462 B (-5,168 B) | 38,462 B (-1,168 B, -2.9%) | 56,652 B (-5,720 B, -9.2%) |

(c) `src/core/**` alone is unchanged on this branch: 53,951 B min / 20,166 B gzip.

The earlier 16 KB minified estimate overstated the win. Minified xstream is 16 KB, but gzip already
absorbs most of what the compact build removes (D188). The compact module is 10,454 B minified and
3,148 B gzip on its own.

## The alias option (branch `claude/sweep-xstream-1bd348`)

### Changes

| Commit | Change | (b) delta |
|---|---|---|
| `src/xstream.ts`, `test/xstream-compact.test.js`, rollup entry, `./shims/xstream` export | The compact build and its differential test, not wired yet | 0 B |
| `src/vite/globalthis.ts`, `src/vite/plugin.ts` | `sygnal/vite` resolves `xstream` to the compact build | -797 B |

`resolveId`, not `resolve.alias`: the npm `xstream/extra/*` files do `require('../index')`, which an
alias can't attribute to xstream. The hook catches `xstream`, `xstream/index(.js)`, and `../index`
imported from `xstream/extra/*`, so the extras build on the same Stream and npm's index isn't
bundled alongside it.

Who gets it: client production builds through `sygnal/vite` only. These keep the npm package:

- dev, Vitest and SSR
- bundlers without the plugin, and the Astro integration (its build doesn't use `sygnal/vite`)
- `sygnal({ nativeGlobalThis: false })`, which is why (a) doesn't move. No new option: the docs say
  that flag keeps xstream's original dependencies, and it keeps (a) measuring core growth as the
  size gate's comments say
- a user `resolve.alias` of `xstream`, which wins

### D209

I agree the exception applies. The last xstream release was 11.14.0 on 2020-10-12, and the package
stays a dependency, so `npm audit` still sees it. The file keeps the MIT attribution.

### Behaviour identity

`test/xstream-compact.test.js` (161 tests) runs each scenario against npm xstream and the compact
one under fake timers, and compares the logs: events, producer start/stop and stream state after
every step.

- Matrix: 49 operators and npm extras, each on a plain and a memory stream, through 11 event
  sequences (next/error/complete, remove and re-add in one turn, restart after stop, a throwing
  listener, a second listener).
- Also: factories, async stop timing, memory replay during a pending stop, sync re-entrancy,
  `imitate` and cycle pruning, the debug listener, `fromObservable` and `Symbol.observable`, module
  shape, error messages.
- Mixing: npm streams and compact streams composed in both directions.
- Real builds on Vite 7 and Vite 8: one copy of Stream in the bundle, a direct `import xs from
  'xstream'` plus an npm extra works and `instanceof` holds, and three of the opt-outs above (`nativeGlobalThis: false`, a user alias, SSR).

Does the test catch real bugs? 18 deliberate mutations of the compact build: 14 were caught at
first, one more after I added the scenario it exposed. The other 3 can't be observed: `fold`'s
reset on start (it also resets on stop), `flatten` clearing `out` before the inner remove, and
`replaceError`'s remove (the listener list is already cleared by then).

The whole library suite was also run with `xstream` and the npm extras pointing at the compact
build (a one-off Vitest config, not committed): 6,290 passed. Its failures also appear in the npm
run: `docs-live-server` (docs dependencies weren't installed yet) and a `vite-plugin-dev` timing
test under load. `side-effects` also failed in both, because the new file had no `exports` entry;
that is fixed.

Differences from npm that remain, none visible through the API or the internals Sygnal uses:

- `Remember` and `StartWith` inherit `_n/_e/_c` from the operator base (npm's have none); nothing
  calls them.
- `Merge` has an own `ins` of `undefined`.
- `MemoryStream.prototype` doesn't redeclare the methods npm's only overrode for types.
- `_e`'s unreachable trailing `throw` is gone.

Stream and MemoryStream stay callable functions with enumerable prototypes, so ES5-style subclasses
and `for...in` behave as before (an ES `class` would save 23 B and break both).

Integration points checked: the teardown swap of `Stream.prototype._remove`, `instanceof`, the
`xstreamInterop` shim (`ns.default.create`), `xs.fromObservable`, the debug listener, and the extras
Sygnal exports.

### Needed outside my files (not made here)

1. **`benchmarks/audit/lib/instrument.mjs`, required.** The perf gate throws "hook not found" on
   this branch, because the Stream constructor is now in `dist/shims/xstream.mjs`. `npm test` fails
   at its last stage until this is applied:
   ```diff
   -    file: /node_modules\/xstream\/index\.js$/,
   +    file: /(node_modules\/xstream\/index\.js|dist\/shims\/xstream\.mjs)$/,
   ```
   I ran the gate with this applied, uncommitted.
2. `docs/.../integration/bundler-config.md` and `reference/api.md`: the `nativeGlobalThis` row should
   say it also keeps the npm xstream.
3. Optional: the Astro integration could use the same resolver.

The new file must be excluded from any property mangling unless `src/core/teardown.ts` and the npm
extras are mangled to match (for `mangle`).

### Gates

| Gate | Result |
|---|---|
| `npm run build` | passes |
| `vitest run` | 6,451 passed. 3 files failed: `p5-2z-preact` and `vite-plugin-dev` (1 test each, on a machine shared with the other workstreams) and `docs-live-server` (docs dependencies missing). All 3 passed when re-run alone after `npm ci --prefix docs` |
| `test:examples` | passes on the re-run. `platformer` failed one timing test on the first run, and passed alone and in the full re-run |
| `test:types` | passes |
| `test:browser` | passes (Chromium; this runs in dev mode, so it exercises the npm package) |
| `test:perf-gate` | passes with the patch above; every metric within its limit, streams per item 1.0, heap 0.97 MB |
| Size gate | passes |
| `perf-ab`, full run | `latency 0.987, cpu 1.029; 0 op(s) marked SLOWER` |

`leaf update, 30 deep` showed 1.345 unmarked, and 1.351 marked on the spike. Run alone: 0.852 (4
rounds), 1.043 (8 rounds), so it's noise. The CPU mean of 1.029 is within the per-op CPU noise the
protocol describes. No test was edited.

Compact production code was exercised in a real browser through the perf gate and `perf-ab`, which
build with `sygnal/vite`. The browser suite itself was not run against it.

### Tried and rejected (gzip on (b))

| Idea | Saves | Why not |
|---|---|---|
| Stream as an ES class | 23 B | Breaks ES5 `Stream.call` subclasses and enumerable prototypes |
| `_e`/`_c` always via a snapshot | 17 B | An extra allocation on every completion |
| `fromArray` as an object literal | 14 B | A closure per call; marginal, not worth the churn |

## The native option (spike branch `claude/sweep-xstream-native-spike`, not for merge)

Worktree `.claude/worktrees/sweep-xstream-native`. The main entry bundles `src/xstream.ts`; every
other entry imports it from `sygnal`.

| Step | (a) = (b) | Delta |
|---|---|---|
| Alias option (b), for reference | 38,833 B | |
| Absorb; drop `xstreamInterop` | 38,729 B | -104 B |
| `xstreamCompat` without interop | 38,608 B | -121 B |
| Drop the `_remove` swap (teardown mode inside Stream) | 38,525 B | -83 B |
| Short private names | 38,462 B | -63 B |
| Drop operator `type` strings (measured, not committed; loses debug info) | 38,361 B | -101 B |

So the native option gains **371 B over the alias (472 B without the `type` strings)**, about 1%.

Estimate, not measured: having the core and the DOM driver use streams directly instead of
`xs.create` proxies. I'd expect a few hundred bytes at most, since most of what remains is the
operator surface, which stays public (`xs` from `sygnal`). Reaching it means rewriting the core's
wiring, which is a separate project.

Where it does help: **non-Vite users** get -5,720 B gzip (-9.2%, esbuild on kanban), because the
alias gives them nothing and they still ship the `globalthis` chain. SYG302's CJS default-import
problem and `xstreamInterop` also go away.

Speed: `perf-ab` full run on the spike: `latency 1.000, cpu 1.044; 2 op(s) marked SLOWER`. Both
marks went away when re-run alone with 4 rounds: `leaf update, 30 deep` 0.821 and
`create 1k rows [Collection]` 0.991. So no slowdown, and no speed gain beyond noise, even with the
prototype swap gone.

Library suite on the spike, which still imports the npm `xstream` in its tests:

- At the spike's tip (short private names): 2,641 failed, nearly all `s[i]._a is not a function`,
  where an npm stream meets a Sygnal one. That is the cost of the rename, measured.
- One commit earlier (the rename removed): 25 failed, 6,428 passed. By file these are mostly tests
  pinning what the spike changes on purpose (`dist-exports`, `vite-plugin*`, `xstream-compact`,
  `xstreamCompat`, `diagnostics/rxjs`, `p45-d-teardown`, `p46-r6`) plus `docs-live-server`, which
  wasn't set up in that worktree. I didn't triage them one by one, and 2 in
  `parity/reentrancy` would need a look before any real 8.0 work.

### What breaks for app authors in 8.0

- **`import xs from 'xstream'`** stops being Sygnal's stream, unless it stays a dependency. An app
  with its own `xstream` then has two Stream classes. Streams from the two still compose while
  the private protocol is unchanged (tested on the alias branch), and stop composing once private
  names change. `instanceof` fails across them, and the separate copy's streams stop on xstream's
  own timers instead of the core's queue. In the repo: 67 test files, 8 browser-test files, 3 docs
  pages; the examples already import from `sygnal`.
- **`xstream/extra/*`:** the 8 extras Sygnal already ports move to `sygnal` imports.
  `buffer`, `dropUntil`, `fromDiagram`, `fromEvent`, `flattenConcurrentlyAtMost`, `split`, `tween`
  and `pairwise` have no port; they would need porting or a compat package. 9 repo files import an
  extra.
- **Third-party Cycle drivers:** anything importing `xstream` (`@cycle/dom` has it as a peer) keeps
  working only while the private protocol (`_add`, `_remove`, `_n`, ...) is unchanged. Short private
  names break them; that saving and this compatibility can't both be had.
- **Types:** `xstream`'s `.d.ts` would have to be ported into `src/index.d.ts`.
- **Migration:** `sygnal-check --fix` already rewrites `import xs from 'xstream'` and the ported
  extras (SYG302). It would need a removed-form error for the rest, and the extras without ports
  need a decision.

### Recommendation

**No, native xstream doesn't earn a major release on these numbers.** For Vite apps it's 371 B
(1%) beyond the alias, with no measurable speed gain, and part of it (short private names, 63 B) conflicts with
third-party driver compatibility. The one real gain is 5.7 KB for non-Vite users. If that audience
matters, a smaller step gets most of it: make `sygnal`'s non-Vite builds depend on a package without
the `globalthis` chain, or document the alias for other bundlers. If 8.0 is happening for other
reasons, absorbing xstream is reasonable to include then.
