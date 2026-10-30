# Native tooling: is a Rust/Go/Zig sygnal-check worth it?

Exploration, 2026-10-29, branch `claude/explore-rust-tooling-200699` (from `main` at 8605f1f7, sygnal 7.1.0,
sygnal-check 0.12.0). Research and experiments only: nothing here ships, and `sygnal-check/src` is unchanged on
this branch (the JS fixes below are a patch file).

**Answer: no, not now.** sygnal-check is slow where it does a lot of analysis, not because it is written in JS.
Three things buy more than a native port, at a fraction of the cost:

1. **Incremental checking in the language server.** It gives 30–100× on keystroke latency. Re-checking only the
   edited file costs 0.5 ms; the whole 20k-line project costs 139 ms.
2. **Algorithmic fixes.** Two are done here (scope tables, a quadratic a11y rule): −6 % to −29 %, output
   byte-identical, all 1,737 sygnal-check tests pass.
3. **Bundling the CLI.** About −30 % of a small project's CLI time, which is mostly module loading.

The native prototype (Go on esbuild's parser, four rules) is 15–25× faster end to end. But on the **same rule
logic**, single-threaded Go beats JS on oxc-parser by only **~1.25×**. **Round 3 corrects this for Rust:** on oxc,
in one Linux container with all three, Rust is **7–8×** faster than JS on one core
([Round 3](#round-3-rust-oxc-vs-go-vs-js-same-rules-one-container)). The recommendation holds there with a revised
threshold. The rest of Go's lead comes from multiple cores
(which JS can get with workers) and from doing **far less analysis** than sygnal-check. The lite rules have
**19 false positives on the real examples** and 82 % precision on the docs samples, where sygnal-check has none.
That gap is the 26k lines of model code a port would have to rewrite and keep in parity.

Thresholds for revisiting this are in the [Recommendation](#recommendation).

Machine: Apple M3 Max (16 cores), Node 24.14.0, Go 1.24.0. Other sessions shared the machine (load average 7–30),
so every comparison is interleaved or A/B in the same time window, and medians are reported. Raw output:
[`results/`](results/).

## 1. Profile

Inputs:

- the examples;
- the 873 docs samples (`scripts/check-doc-samples.mjs --out`);
- `large20k` / `large100k` (PLAN-7's `gen-large.mjs`: copies of kanban, plan5-showcase and ai-panel-spa);
- `synth500` / `synth2000`, from [`bench/gen-synthetic.mjs`](bench/gen-synthetic.mjs): a generated tree of N
  components. Each file imports its 4 children, and there are planted SYG101/102/105/110 findings.

### Where the time goes

[`bench/profile.mjs`](bench/profile.mjs), `--strict`, in-process medians (ms):

| input | files | lines | parse | index | model | rules | warm check | one-file edit (warm cache) | cold (1st in process) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| kanban | 5 | 360 | 1.7 | 0.4 | 1.4 | 3.0 | 4.4 | 2.3 | 31 |
| plan5-showcase | 50 | 2.3k | 7.8 | 3.0 | 5.6 | 11.9 | 25 | 16 | 74 |
| docs samples | 873 | 12.9k | 31 | 18 | 48 | 106 | 212 | 148 | 389 |
| synth500 | 501 | 18k | 29 | 26 | 69 | 127 | 256 | 190 | 374 |
| large20k | 380 | 21.4k | 32 | 27 | 53 | 99 | 219 | **145** | 344 |
| synth2000 | 2001 | 72k | 110 | 96 | 275 | 744 | 1311 | 988 | 1441 |
| large100k | 1745 | 100k | 155 | 116 | 235 | 498 | 1054 | 708 | 1273 |

Column notes:

- *parse*: `@babel/parser`.
- *index*: the parent WeakMap and the `sygnal-ignore` suppressions.
- *model*: `buildProject` with every parse a cache hit.
- *rules*: `runRules`, all strict rules.
- *one-file edit*: what the language server pays per check.

What the profile shows:

- **Parsing is 10–15 % of a cold check and ~0 % of an edit.** The parse cache (PLAN-7 C-3) already removes it
  from the editor path. A faster parser cannot help the language server.
- **Model plus rules is 75–85 %.** The CPU profile of the edit loop on large20k
  ([`bench/edit-loop.mjs`](bench/edit-loop.mjs), [`top-self.mjs`](bench/top-self.mjs),
  [`callers.mjs`](bench/callers.mjs)) breaks it down:
  - `ast.js` walks: 20 %, spread over ~25 callers (`contextReads` 3.8 %, `scanNext` 3.4 %, view, controls,
    a11y, …);
  - `scope.js` `findBinding`/`declInScope`: 21 %. Every lookup rescans each enclosing statement list up to the
    Program.
  - reading files: 13 %. Every build re-reads every file from disk, and `sygnalVersion` probes package.json
    files up to `/`. That probe is mostly an artifact of fixtures with no `node_modules/sygnal`.
- **Some of it is superlinear.** `a11y-field-label` takes 36 ms on synth500 and 354 ms on synth2000: 4× the
  components, 10× the time. `componentInLabel` scans every JSX element of the project, per field and per level.
- **The latency gate is close to failing.** PLAN-7's gate (20k lines, one-file edit ≤ 150 ms) measured 80–97 ms
  after G-660. Today it is 136–145 ms on the same kind of project. The rules added in PLAN-8–13 account for
  some of that and machine load for the rest. This is worth a run of the gate alone on a quiet machine.
- **Startup**, CLI on kanban, 15 interleaved runs:

  | run | median |
  |---|---:|
  | `node -e 0` | 26 ms |
  | `sygnal-check` from `src/` | 140 ms |
  | esbuild-bundled CLI | 113 ms |
  | bundled + `NODE_COMPILE_CACHE` | 102 ms |

  Importing `src/index.js` takes ~80 ms. The CLI statically imports the LSP, MCP and graph-view modules even
  for a plain check (the bundle had to be placed so that `lsp/server.js`'s `../../package.json` resolves).
  The check itself is 4 ms.

### Cheap JS wins (tried)

[`js-wins-E2-E3.patch`](js-wins-E2-E3.patch) applies to `sygnal-check/src` at 8605f1f7.

- **E-2, `scope.js`:** a per-scope-node declaration table (WeakMap, built once per AST; the same immutability
  contract the parse cache relies on).
- **E-3, `a11y/shared.js`:** `<Name>` usages indexed by name, and `componentInLabel` memoized per build.

A/B of the one-file edit, interleaved against a HEAD copy ([`bench/ab.sh`](bench/ab.sh)), 4 rounds of 10 edits:

| input | HEAD | E-2 + E-3 | change |
|---|---:|---:|---:|
| large20k | 139–149 ms | 136–137 ms | −6 % |
| synth500 | 192–209 ms | 171–177 ms | −10 % |
| synth2000 | 990–1014 ms | 707–727 ms | −29 % |

The `--strict --json` output is byte-identical to HEAD on plan5-showcase, ai-showcase, the docs samples,
synth2000 and large20k, and the sygnal-check suite passes (1,737 + 4 skipped).

Not tried, by expected size:

- **Incremental re-check (the big one).** `bench/one-file.mjs`: checking only the edited file, with its
  imports loaded, takes **0.5 ms** on large20k and on synth2000. The whole project takes 139 / 709 ms.
  - ASTs are immutable and cached, so per-file facts can be memoized per AST: components, intent/model/view,
    events, controls.
  - Each build then only re-joins the cross-file parts: EVENTS counterparts, children and injected JSX, the
    SYG104 child search, a11y usages. In the prototype that join takes ~1 ms for 2,000 files.
  - It needs a reverse-import graph for invalidation (an edit to a child re-derives its parents' view facts).
  - PLAN-7 §3 deferred this ("incremental rules are a later item"); this data says it is the item.
- **A single shared walk.** Rules and model passes each walk every file again. An eslint-style dispatch by node
  type, or a per-AST `type → nodes[]` index, removes most of the 20 % walk cost.
- **Keep file texts between builds** (stat or watcher-driven) and cache `sygnalVersion` per directory across
  builds: ~10 % of an edit.
- **CLI:** lazy-import the `lsp` / `mcp` / `graph` modules, and/or publish a bundled bin, plus
  `module.enableCompileCache()`. That takes 140 → ~100 ms for a small project.

### Parser swap

Parse-only, warmed JIT, medians of 5 ([`bench/parsers.mjs`](bench/parsers.mjs)):

| input | @babel/parser | oxc-parser (eager) | oxc raw transfer | oxc lazy | @swc/core (JSON) | meriyah (JS) |
|---|---:|---:|---:|---:|---:|---:|
| plan5-showcase | 5.3 | 7.2 | 3.0 | 0.9 | 9.4 | 3.8 |
| docs samples | 26 | 37 | 13 | 5.4 | 53 | 15 |
| large20k | 26 | 60 | 15 | 5.8 | 83 | 23 |
| large100k | 110 | 281 | 102 | 27 | 387 | 100 |

What this shows:

- Babel, once JIT-warm, is competitive.
- Native parsers lose most of their speed copying the AST into JS. Eager oxc and swc are *slower* than Babel.
- oxc's raw transfer is 1.1–2× faster. Lazy looks fast only because it defers that cost to when a rule touches
  each node, and every rule touches every node.
- Best case for a parser swap: ~5–10 % of a cold check and 0 % of an edit. Against that, the AST moves from
  Babel's shape to ESTree (`ObjectProperty` → `Property`, `StringLiteral` → `Literal`, JSX attribute
  values, …), which touches every rule and model file.
- **Not worth it on its own.** It becomes free only as part of a migration that happens for other reasons, for
  example reusing the parse Vite 8 / Rolldown already does: `ctx.parse()` in the plugin returns ESTree from oxc.

## 2. Prototype

### The rule subset

[`lite/facts-estree.mjs`](lite/facts-estree.mjs): four rules written as per-file facts plus a project-wide join,
the shape a native core or a hybrid would have:

- **SYG101**: an intent key with no model entry (`'A | SINK'` keys expanded; a component with `uses` is
  skipped).
- **SYG105**: an EVENTS type selected but never emitted, or the reverse, **across files**. These are
  sygnal-check's `scanFileEvents` semantics: `{ EVENTS: ev }` aliases, `emit` / `event` only when imported from
  sygnal, and a dynamic emit downgrades the finding to info.
- **SYG110 lite**: an intent `DOM.*('.x' | '#x')` selector, one simple token, that the component's own view
  never renders, when every class/id attribute in the view is a literal.
- **SYG302**: a default import from `xstream`.

Implementations:

- **JS on oxc-parser** (napi, raw transfer): [`lite/run-oxc.mjs`](lite/run-oxc.mjs). This is the "native parse,
  JS rules" hybrid.
- **oxlint JS plugin**: [`oxlint-plugin/`](oxlint-plugin/) (oxlint 1.90, ESLint plugin API). SYG101, SYG110 and
  SYG302 only: a per-file lint API has no place for SYG105.
- **Native**: [`native-go/`](native-go/), a Go binary on **esbuild's parser**, which includes scope and symbol
  resolution. It mirrors `facts-estree.mjs` function for function and parses and extracts facts on N
  goroutines. The esbuild packages are `internal/` to its module, so `build.sh` copies them in uncommitted; the
  binary is 3.7 MB, static.

  Why Go and not Rust/oxc: the coordinator approved a user-local rustup, but this session's permission
  classifier blocked the official installer (`curl … | sh`). Go was already installed. esbuild and oxc are in
  the same performance class for parsing, and the per-node work here is trivial, so the conclusions carry over.
  A Rust/oxc port would mainly add `oxc_semantic`'s scope tree.

### Output parity

Normalized `CODE file:line:column` lines (columns in UTF-16 units, like Babel's), compared with `comm`:

| input | Go | JS on oxc | Go = JS | sygnal-check (same 4 codes) | Go ∩ sygnal-check |
|---|---:|---:|---:|---:|---:|
| synth500 | 130 | 130 | 130 | 130 | **130** |
| synth2000 | 518 | 518 | 518 | 518 | **518** |
| kanban, todomvc, playground, ts-2048 | 0 | 0 | ✓ | 0 | ✓ |
| plan5-showcase | 7 | 7 | 7 | 0 | 0 |
| ai-panel-spa | 3 | 3 | 3 | 0 | 0 |
| ai-showcase | 8 | 8 | 8 | 0 | 0 |
| advanced-feature-tests | 1 | 1 | 1 | 0 | 0 |
| docs samples | 101 | 101 | 101 | 94 | 83 |
| large20k / large100k | 57 / 267 | 57 / 267 | ✓ | 0 / 0 | 0 |

- **The two implementations agree exactly, and agree with sygnal-check on code shaped like the generator's.**
  One bug was found on the way: esbuild keeps a JSX attribute string as `EJSXText` with its quotes, not
  `EString`. AST-shape surprises like this are the daily cost of a second parser.
- **On real apps the lite rules are wrong.** 19 false positives on the examples, from:
  - Toaster's implicit `TOAST` selects;
  - behaviors' namespaced actions;
  - views assembled by helpers;
  - controls and widgets.

  On the docs samples they reach 82 % precision and 88 % recall. Every one of those cases is handled by
  sygnal-check's model (`behaviors.js`, `view.js`, `controls.js`, `widgets.js`, `resolve.js`, …). A native
  checker has to port those too, not just the rules.

### Speed

**In-process, warm** ([`bench/warm.mjs`](bench/warm.mjs); Go `-repeat 9`, median of the check):

| input | sygnal-check, all strict rules | sygnal-check, the 4 rules (full model) | JS lite on oxc | Go, 1 core | Go, 16 cores |
|---|---:|---:|---:|---:|---:|
| plan5-showcase | 29 | 11 | 6.0 | 4.1 | 2.9 |
| docs samples | 210 | 110 | 42 | 36 | 9.2 |
| large20k | 222 | 127 | 44 | 35 | 8.9 |
| synth2000 | 1044 | 560 | 174 | 132 | 30 |
| large100k | 1140 | 612 | 278 | 198 | 48 |

**End to end, process included** ([`bench/routes.py`](bench/routes.py), interleaved medians):

| input | sygnal-check CLI | JS lite on oxc | oxlint + JS plugin | Go, 16 cores |
|---|---:|---:|---:|---:|
| kanban | 155 | 54 | 45 | **8** |
| plan5-showcase | 270 | 82 | 54 | **11** |
| docs samples | 503 | 116 | 376 | **20** |
| large20k | 426 | 113 | 513 | **19** |
| large100k | 1547 | 369 | 2192 | **90** |

How the speedup breaks down, on large20k warm:

| step | from → to | factor |
|---|---:|---:|
| sygnal-check model → the prototype's facts (doing less) | 127 → 44 ms | ~3× |
| JS → Go, same logic, one core (the language) | 44 → 35 ms | ~1.25× |
| 1 core → 16 cores | 35 → 9 ms | ~4× |
| process startup, small inputs (Node's ~25 ms boot plus ~80 ms of module loading → a ~3 ms binary) | | 5–15× |

Only the language step and the startup step are unique to native code. JS gets parallelism from
`worker_threads`: per-file facts are embarrassingly parallel, and the language server already checks in a
worker.

### The oxlint route

The oxlint JS plugin is **slower than sygnal-check** on large inputs: 513 vs 426 ms on large20k, 2.2 vs 1.5 s on
large100k. Every file's AST crosses into JS for the plugin, and the plugin API is per file, so SYG105, SYG104,
SYG129, the graph and every other cross-file rule cannot be expressed in it.

A **native** oxlint rule means a fork or upstream work in oxc (no stable Rust plugin API) and the same
second-language cost.

Its value is distribution, not speed: show findings in an editor that already runs oxlint. The LSP already
covers that.

## 3. Wider tooling

- **`sygnal/vite` transforms.**
  - Under Vite 8 the plugin uses `ctx.parse()` (Rolldown's oxc, native) and JSX is oxc's.
  - The plugin's own work per file is small, and string/AST checks on an already-parsed module are
    microseconds.
  - Nothing to gain. In-dev checking calls sygnal-check in-process, so the language-server conclusions apply.
- **HMR.** It's a pattern rewrite per changed module; not a hot spot.
- **`--graph` / the graph page.** The same model as the check, plus layout in the browser. Same conclusion; the
  incremental model would also make `--watch` updates instant.
- **The docs build.**
  - `remark-live` compiles each live block with `@babel/standalone`. That runs in the browser for edited code,
    so it must stay JS/WASM.
  - `check-doc-samples` is one CLI process for 873 samples (~0.4–0.5 s).
  - Astro dominates the build. Native code would save under a second.
- **A compile step.** The compile-wasm session (`dev-plans/research/compile-wasm/` on its branch `claude/explore-compile-wasm-cce134`) found compiled views ("blocks")
  bring big wins. That step is a Vite/Rolldown transform: per module, on an AST Rolldown has already parsed.
  - Written as a JS plugin on `ctx.parse()`, it costs milliseconds per module.
  - Only a transform running on every module of a very large app would justify a Rust plugin, and then only
    inside Rolldown's native plugin interface (not stable for third parties).
  - If one is ever needed, the per-file-facts design above is the shape to share between the checker and the
    compiler.
- **Agent and CI loops.** CLI startup dominates small projects (140 ms total, 4 ms of checking). A bundled bin
  gets ~100 ms; native gets ~8 ms. That matters only if something runs sygnal-check hundreds of times per task.
  - A pre-commit hook or a single agent tool call doesn't.
  - The MCP server and the language server are long-lived and don't pay startup at all.

## 4. Maintenance cost of a native checker

- **Two languages, one behavior.**
  - sygnal-check is ~26k lines of JS: 46 rule files, 24 model modules, the LSP, graph and MCP code. 1,737
    tests run its output.
  - A native core means porting at least the model (`project`, `view`, `intent`, `modelEntries`, `behaviors`,
    `controls`, `widgets`, `resolve`, `events`, `positions`, …) and keeping it in lockstep. Every new feature
    (PLAN-8..13 each added rules) lands twice, or the native side goes stale.
  - The parity harness here (normalized lines plus `comm`) would have to run on every PR. The lite rules show
    that differences hide in exactly the long tail the model handles.
- **The registries.** `codes.ts` ↔ `explanations.js` ↔ `explanations.json` ↔ `reference/errors.md` already have
  drift tests in JS. A Rust/Go rule set needs its own codegen from the same table, or a fifth drift test.
- **Distribution.**
  - napi-rs prebuilt binaries mean 6–8 platform packages (darwin-arm64/x64, linux-x64/arm64 gnu/musl,
    win32-x64/arm64) published through the keyless release workflow, plus a WASM fallback.
  - The VS Code extension bundles sygnal-check today (one `.vsix`, 598 KB). It would need per-platform
    `.vsix`es or the WASM build.
  - `create-sygnal-app` templates and `npx sygnal-check` must still work on every platform.
  - Today's dependency is one: `@babel/parser`, 1.9 MB of pure JS.
- **Ergonomics.**
  - Contributors and agents fix rules in JS today with a fast loop: edit, vitest.
  - Rust adds cargo, a native build step before tests, and an AST shape different from the one the docs and
    `llms.txt` examples use.
  - Agents writing Sygnal rules (PLAN-1's evals) work best in the same language as the framework.
- **Hybrid variants.**
  - *Native parse, JS rules*: a parser swap with an AST migration. ~0 % for the language server; see §1.
  - *Native per-file facts, JS rules and join*: gets the 4× parallelism and some constant factor, but crossing
    the facts into JS costs again, and the facts code (most of the model) is still ported.
  - Neither is cheaper than incremental JS.

## Recommendation

Do now, in JS (small, safe, measured):

1. Land E-2 and E-3 ([`js-wins-E2-E3.patch`](js-wins-E2-E3.patch)) and re-measure the PLAN-7 latency gate on a
   quiet machine. It is at 136–145 ms against a 150 ms limit.
2. CLI: lazy-load `lsp` / `mcp` / `graph`, enable the compile cache, and optionally publish a bundled bin.
3. Plan **incremental checking**: per-AST memoized per-file facts, a reverse-import invalidation graph, and the
   cross-file join per build. It is the only change that takes the editor path from O(project) to O(edit). The
   one-file floor is 0.5 ms; the join is ~1 ms per 2k files.
4. Optional: a shared single walk (node-type dispatch) for rules and model passes, and parallel fact extraction
   in `worker_threads` for cold checks of very large projects.

Revisit a native core **only if** one of these holds after (1)–(3):

- **An incrementally re-checked edit is still above ~50 ms on a real app**, not a generated one, of ≥ 100k
  lines. Round 3 measured the same-logic factor at 7–8× for Rust/oxc (the ~1.25× was Go/esbuild); it matters only once parallelism and incrementality are used up.
- **Someone needs ~10 ms CLI runs**: a tool invoking sygnal-check per file or per keystroke as a process, at
  hundreds of runs per task, where a long-lived MCP or LSP connection is not an option. The answer then is a
  small native *front end* (file facts plus a fast-path rule subset), not a port.
- **The model stops changing.** Rule work has slowed to a few per year and the parity suite can be generated
  from the existing tests. Until then, every plan pays the port twice.
- **Sygnal gets a compile step that runs in Rolldown on every module** and profiles above a few ms per module.
  Then share a Rust per-file-facts crate between the compiler and the checker.

Zig: no maintained JS/TS/JSX parser. Go: viable (esbuild), as the prototype shows, but the same maintenance
costs, and Go-to-Node napi is awkward (a CLI binary or WASM only).

## Round 2: the JS wins, landed

The coordinator accepted the recommendation. Items 1–3 are now in `sygnal-check` on this branch:

- `a3fbee8d`: E-2 and E-3, with tests;
- `fa7ac254`: incremental checking and the compile cache.

### What was built

- **Model reuse** (`Project` option `previous`, `model/project.js`).
  - A build reuses the last build's FileInfo, analyzed components and views for every file whose
    text is unchanged and that imports nothing that changed (transitively).
  - The changed files and their importers (`project.rebuilt`) are discovered and analyzed again. The
    project-wide joins (EVENTS lists, injected JSX) are redone from the per-file parts.
  - Import edges are recorded in `loadImport`. A relative import that didn't resolve is retried, and
    its importer is rebuilt once the file appears.
  - A disk file with the same size, mtime and inode isn't read again.
  - A different file list, `cwd` or `replyKeys` starts afresh.
- **Per-file rule memo** (`run.js` `createRuleMemo`, rule flag `perFile`).
  - A `perFile` rule runs once per changed file on a project narrowed to that file. Its findings for
    reused files are replayed, so findings are attributed to the file iterated, not to the file
    reported in.
  - Rules marked `perFile`, chosen by reading them: byid-binding (keyed by the installed major),
    removed-forms, webmcp-form-attrs, missing-export, lowercase-markers, xstream-default-import,
    widgets, behaviors, a11y-aria, strict 503 and 506.
  - Project-wide rules still run in full on the reused model: context-provider, field-label,
    controls, agent, sink-driver, timers, persist, SYG105, …
  - Their per-file parts are memoized by FileInfo: app roots (`findApps`, which three rules
    recomputed per build), render-graph entries, a11y elements and descriptions, and
    controlled-input's own listeners and fields.
- **API.** `createCheckSession()` and `checkFiles(files, { cache, session })`. It is used by live.js
  (the language server and `--watch`; `createLiveProject({ incremental: false })` opts out), the
  language server core and the MCP server.
- **`sygnalFor`** looks the installed Sygnal up once per directory: it re-read every ancestor's
  manifests for each directory.
- **CLI:** `module.enableCompileCache()` in the bin, which runs about 10 % faster (98 vs 110 ms on
  kanban).

### Correctness

- [`test/incremental.vtest.js`](../../../sygnal-check/test/incremental.vtest.js): a seeded edit fuzz,
  14 tests and about 500 steps.
  - **Inputs:** 7 examples, 3 fixture sets, and a generated app with cross-file EVENTS, children and a
    shared helper.
  - **Edits:** literals renamed, lines deleted, duplicated or moved, imports dropped or added, text
    cut so it doesn't parse, components added, files restored, new files. Half go through unsaved
    buffers, half through disk writes.
  - **Checked after every step:** `checkFiles` with a session equals a fresh `checkFiles`, as JSON.
    The live project's diagnostics and graph JSON equal those of a twin live project with the same
    history and `incremental: false`.
  - **Its power:** breaking the invariant (not rebuilding importers) fails 11 of the 14 tests.
- **`SYGNAL_CHECK_PERFILE=1`** sends every `runRules` through the per-file split. `npm test` now
  runs the suite a second time that way (`test/run-perfile.mjs`), so every rule's own tests check
  its `perFile` marking.
  - Marking a project-wide rule `perFile` by mistake fails 5 tests (context-provider), 2
    (field-label) or 3 (agent).
  - controls passes even when marked, which suggests it would be safe, but it stays project-wide:
    its tests don't cover the case.
- **Suites:** sygnal-check passes 1,755 + 4 skipped, both runs; the docs sample checker reports 873
  clean.
- **With `SYGNAL_CHECK_LATENCY=1` inside the full parallel suite**, two timing tests failed: the
  latency gate's cold ≤ 1 s (2.1 s, run in parallel, which its header says not to do) and a watcher
  debounce test (p10-watch). Run alone, both pass, the latter 3/3, while other sessions loaded the
  machine.

### Numbers

One-file edit, `--strict`, warm, median of 10–15; findings identical in every row
([`bench/session-edit.mjs`](bench/session-edit.mjs), [`results/r2-session.jsonl`](results/r2-session.jsonl)):

| input | files rebuilt | parse cache only | with a check session |
|---|---:|---:|---:|
| large20k (leaf edit) | 1 | 116 ms | **24 ms** |
| large20k (root component) | 2 | 116 ms | **26 ms** |
| large100k | 1–2 | 541–576 ms | **129–132 ms** |
| synth2000 (2,000 components) | 1–2 | 718–736 ms | **214–219 ms** |

Before round 2, the parse-cache-only path measured 134–145 ms on large20k; E-2/E-3 and the shared
`findApps` explain the difference.

Latency gate (`test/lsp-latency.vtest.js`, run alone, load ~15):

- one-file edit with a session: 25–26 ms, gated at **≤ 60 ms**;
- plain path: 118–127 ms (gate unchanged, ≤ 150 ms);
- language server, didChange → publish: 187–190 ms with the 150 ms debounce, gated at **≤ 300 ms**
  (was 400 ms);
- navigation right after a change: 37–38 ms (gate ≤ 150 ms, unchanged).

What is left is the project-wide rules, which stay O(project), about 1.3 ms per 1k lines on the
large inputs: field-label's label search through usages, context-provider's render graph, controls,
agent, SYG105. Making those incremental means per-build joins over memoized per-component facts,
the same pattern as `findApps`. Next candidates, by cost: context-provider (renderGraph), field-label,
controls.

### Bundling: measured, not done

kanban, medians of 20:

| run | median |
|---|---:|
| `src` | 107 ms |
| `src` + compile cache | 98 ms |
| esbuild bundle | 88 ms |
| bundle + compile cache | 79 ms |

The bundle would save another ~19 ms per CLI run, but:

- sygnal-check has no build step today, and the bundle would be a second copy of the CLI that can
  go stale against `src/` (and the bin is what contributors and agents run);
- the language server starts its worker from `src/lsp/worker.js` by URL;
- the VS Code extension copies `bin/` and `src/` and detects features by `src/lsp/completion.js`;
- `sygnal/vite` and the docs scripts import `src/index.js`.

Lazy-loading the LSP, MCP and graph modules was measured too. The check path alone costs ~41 of the
CLI's ~51 ms of imports, and `main()` would have to become async, so it isn't worth it.

## Round 3: Rust (oxc) vs Go vs JS, same rules, one container

[`native-rust/`](native-rust/) is the four lite rules as a Rust crate on the oxc crates at 0.156.0,
the version the npm `oxc-parser` used by the JS runner is built from. It mirrors
`lite/facts-estree.mjs` function for function, like the Go binary, and runs on N threads with
`std::thread::scope`. Its release binary is 1.5 MB.

**Setup** ([`docker/`](docker/)):

- One image built from official bases: `rust:1-slim-bookworm` with Node copied from
  `node:24-bookworm-slim` and Go from `golang:1.24-bookworm`. All three variants run in the same
  container, so on the same kernel, CPUs and file system.
- Digests used:
  - `rust@sha256:24707e70a4f1e23d9a7b25202ec43126d28a52294b96aad5c670df1fd1f1d400`
  - `node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c`
  - `golang@sha256:1a6d4452c65dea36aac2e2d606b01b4a029ec90cc1ae53890540ce6173ea77ac`
- Toolchain versions: rustc 1.99.1, Node 24.22.2, Go 1.24.13 (linux/arm64), 16 CPUs.
- **This is Docker Desktop's Linux VM on the M3 Max, not the host.** The numbers compare the three
  variants with each other; they don't compare with the macOS numbers above.
- The inputs were generated inside the container with the same generators. `target/`, cargo, Go and
  npm caches and the inputs lived in a named volume.
- Raw output: [`results/docker-rust-go-js.log`](results/docker-rust-go-js.log).

**Parity.** JS (oxc-parser via napi), Go (esbuild) and Rust (oxc) produce byte-identical sorted
output on plan5-showcase (7 findings), synth500 (130), synth2000 (518), large20k (57) and
large100k (267).

**In-process, warm** (median of 9 whole-project runs; files read from the page cache):

| input | JS, 1 core | Go, 1 core | Rust, 1 core | Go, 16 | Rust, 16 | Rust vs JS, 1 core |
|---|---:|---:|---:|---:|---:|---:|
| plan5-showcase (50 files) | 7.2 ms | 5.3 | 1.0 | 5.3 | 0.4 | 7× |
| synth500 | 50.3 | 32.7 | 6.4 | 13.1 | 1.4 | 8× |
| large20k | 53.2 | 38.4 | 7.2 | 16.2 | 1.0 | 7× |
| synth2000 | 201.3 | 113.6 | 25.6 | 33.0 | 4.1 | 8× |
| large100k | 241.4 | 153.2 | 31.4 | 45.3 | 3.6 | 8× |

**End to end**, process included (median of 7): large20k JS 128 ms, Go 27 ms, Rust **4 ms**;
large100k JS 349, Go 66, Rust 9; plan5-showcase JS 54, Go 7, Rust 2.

**Where JS spends its time** (large20k, files in memory): oxc's native parse plus raw transfer into
JS objects is 16 ms; the JS facts walk is **32 ms**; the cross-file join is 0.6 ms. synth2000: 46 /
136 / 4 ms. Two things follow:

- The JS side's cost is mostly the generic `for (k in node)` walk over the ESTree objects, not the
  parser.
- sygnal-check's own walker is tighter: a flat pre-order node list per AST, built once (G-660). So
  this ratio overstates the gap for a tuned JS checker.

**What this changes in the conclusion.** Round 1's "~1.25×" was Go vs JS. esbuild's parser is a
bundler parser that runs a full visit pass (symbols, scopes, lowering checks), and the Go side paid
for it. **Rust on oxc, with the same logic, is 7–8× faster than JS on one core, and 50–70× on 16
cores.** The language factor is real, and larger than round 1 said.

The recommendation still stands:

- **Editor path.** Incremental JS now re-checks a 20k-line project in 25 ms, inside the language
  server's 150 ms debounce. A Rust core would cut that to a few ms. That is a gain nobody sees
  behind the debounce, bought with a second implementation of the model.
- **Cold, whole-project checks** (CI, the docs sample checker, `--graph` on a 100k-line app) are
  where 7–8× is visible: ~1.3 s → maybe 150–250 ms for the full rule set, if the model ports with
  the same factor. Today that is a CI cost of about a second.
- **Revised threshold.** Consider a Rust core (oxc parser plus a per-file facts layer, rules and
  join in JS or Rust) once a real app's cold full check exceeds ~2 s, or a tool needs whole-project
  checks in the tens of milliseconds outside a long-lived process.

  A hybrid that keeps rules in JS pays the AST or facts transfer: here 16 ms of raw transfer per
  20k lines, about 2× Rust's whole check. To keep the speed, the facts layer must stay on the Rust
  side and send compact facts, not ASTs.

  The maintenance costs in §4 are unchanged.

**Footprint, all removed afterwards.**

| item | size |
|---|---:|
| the bench image | 1.2 GB |
| base images: rust (817 MB), golang (861 MB), node (249 MB) | 1.9 GB |
| the cache volume: target/ 211 MB, cargo 80 MB, Go caches 87 MB, inputs 22 MB, npm 12 MB | 406 MB |

All removed after the run. One mistake during cleanup: `docker builder prune --filter until=2h`
removed build-cache entries *older* than two hours, so it cleared about 8.1 GB of the machine's
Docker build cache that wasn't this session's. No images, containers or volumes were touched; the
cache rebuilds on the next `docker build`.

## Files

| path | what |
|---|---|
| `bench/gen-synthetic.mjs` | N-component synthetic app with planted findings |
| `bench/profile.mjs` | phase profile (read/parse/index/model/rules/warm/edit), `SYGNAL_CHECK_SRC` for A/B |
| `bench/edit-loop.mjs`, `top-self.mjs`, `callers.mjs` | language-server-shaped loop for `--cpu-prof`, self time by function/file, callers of a hot function |
| `bench/ab.sh` | interleaved A/B of two sygnal-check trees |
| `bench/parsers.mjs` | parser shoot-out |
| `bench/warm.mjs`, `routes.py`, `one-file.mjs` | in-process routes, end-to-end routes, the incremental floor |
| `bench/session-edit.mjs`, `session-loop.mjs` | round 2: one-file edits with a check session vs the parse cache only (asserts identical findings); the session loop for `--cpu-prof` with per-rule medians |
| `js-wins-E2-E3.patch` | scope tables + a11y usage index for `sygnal-check/src` |
| `lite/` | the 4-rule subset on ESTree, the oxc-parser runner, sygnal-check's findings for the same codes |
| `oxlint-plugin/` | the per-file rules as an oxlint JS plugin |
| `native-go/` | Go prototype on esbuild's parser (`sh build.sh`, then `bin/sygnal-native [-j N] [-time] [-repeat N] <dir>`) |
| `native-rust/` | Rust prototype on the oxc crates 0.156.0 (`cargo build --release`; same flags as the Go binary) |
| `docker/` | the one-container comparison: `Dockerfile` (official bases), `run.sh` (builds, inputs, parity, timings), `warm-js.mjs`, `e2e.mjs` |
| `results/` | raw output of the runs above |

To reproduce:

- The npm parsers (`oxc-parser@0.156.0`, `@swc/core@1.16.20`, `meriyah@7.4.1`, `oxlint@1.90.0`) were installed
  into a scratch folder, not into the repo. Pass that folder to the scripts that take `<npmDir>`.
- Inputs are generated with `gen-large.mjs`, `gen-synthetic.mjs` and `check-doc-samples.mjs --out <dir>`.
- Footprint outside the repo: the Go module cache for esbuild and x/sys (35 MB) and the npm parsers (29 MB),
  both in the session scratch folder. No Rust toolchain was installed.
