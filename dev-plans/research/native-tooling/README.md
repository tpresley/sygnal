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
logic**, single-threaded native beats JS on oxc-parser by only **~1.25×**. The rest comes from multiple cores
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
  lines. Native's same-logic factor is ~1.25×; it only matters once parallelism and incrementality are used up.
- **Someone needs ~10 ms CLI runs**: a tool invoking sygnal-check per file or per keystroke as a process, at
  hundreds of runs per task, where a long-lived MCP or LSP connection is not an option. The answer then is a
  small native *front end* (file facts plus a fast-path rule subset), not a port.
- **The model stops changing.** Rule work has slowed to a few per year and the parity suite can be generated
  from the existing tests. Until then, every plan pays the port twice.
- **Sygnal gets a compile step that runs in Rolldown on every module** and profiles above a few ms per module.
  Then share a Rust per-file-facts crate between the compiler and the checker.

Zig: no maintained JS/TS/JSX parser. Go: viable (esbuild), as the prototype shows, but the same maintenance
costs, and Go-to-Node napi is awkward (a CLI binary or WASM only).

## Files

| path | what |
|---|---|
| `bench/gen-synthetic.mjs` | N-component synthetic app with planted findings |
| `bench/profile.mjs` | phase profile (read/parse/index/model/rules/warm/edit), `SYGNAL_CHECK_SRC` for A/B |
| `bench/edit-loop.mjs`, `top-self.mjs`, `callers.mjs` | language-server-shaped loop for `--cpu-prof`, self time by function/file, callers of a hot function |
| `bench/ab.sh` | interleaved A/B of two sygnal-check trees |
| `bench/parsers.mjs` | parser shoot-out |
| `bench/warm.mjs`, `routes.py`, `one-file.mjs` | in-process routes, end-to-end routes, the incremental floor |
| `js-wins-E2-E3.patch` | scope tables + a11y usage index for `sygnal-check/src` |
| `lite/` | the 4-rule subset on ESTree, the oxc-parser runner, sygnal-check's findings for the same codes |
| `oxlint-plugin/` | the per-file rules as an oxlint JS plugin |
| `native-go/` | Go prototype on esbuild's parser (`sh build.sh`, then `bin/sygnal-native [-j N] [-time] [-repeat N] <dir>`) |
| `results/` | raw output of the runs above |

To reproduce:

- The npm parsers (`oxc-parser@0.156.0`, `@swc/core@1.16.20`, `meriyah@7.4.1`, `oxlint@1.90.0`) were installed
  into a scratch folder, not into the repo. Pass that folder to the scripts that take `<npmDir>`.
- Inputs are generated with `gen-large.mjs`, `gen-synthetic.mjs` and `check-doc-samples.mjs --out <dir>`.
- Footprint outside the repo: the Go module cache for esbuild and x/sys (35 MB) and the npm parsers (29 MB),
  both in the session scratch folder. No Rust toolchain was installed.
