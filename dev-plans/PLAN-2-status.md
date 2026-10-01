# PLAN-2 Status Tracker

Tracks progress for [PLAN-2.md](PLAN-2.md). Maintained by the coordinator. The PLAN-1 tracker ([PLAN-1-status.md](PLAN-1-status.md)) remains the record for B-001…B-029, G-001…G-071 and D1–D38; new items here continue that numbering.

**Integration branch:** `plan2-integration` (cut from `main` at `64d5767`, the 5.4.0 merge) · **Current phase:** 0 + 1 · **Last updated:** 2026-10-01

---

## Phase Overview

| Phase | Status | Tag | Notes |
|---|---|---|---|
| 0 — Release follow-through, eval infrastructure | 🟡 In progress | — | 0-A ✅ · 0-B ✅ · 0-C ✅ · tier-3 pilot ✅ (20/20 pass; Sygnal 66.6 s vs React 45.7 s) · v2-baseline 🟡 (160 trials, D46) |
| 1 — Correctness backlog | ✅ Done | `plan2-phase1` | 1-A…1-F ✅ · 1-T trim ✅ · review: 6 findings + 2 notes, all fixed in 1-R · kanban 41,803 B (2 B headroom) |
| 2 — Known ergonomics improvements | 🟡 In progress | — | 2-A ✅ · 2-B ✅ · 2-C ✅ · 2-D ✅ |
| 3 — Experiments | ⚪ | — | |
| 4 — Adopt, measure, release | ⚪ | — | |

Legend: ⚪ not started · 🟡 in progress · 🔵 in review / merging · ✅ done · 🔴 blocked

## Workstreams

| ID | Title | Status | Branch | Agent | Merged | Notes |
|---|---|---|---|---|---|---|
| 0-A | Post-release verification + housekeeping | ✅ | (coordinator, direct) | coordinator | this commit | Smoke against the live registry: 8/8 templates (scaffold, sygnal 5.4.0 + sygnal-check 0.1.0, llms.txt, tests, `--strict`, build). G-068/G-071 gone. Stale PLAN-1 worktrees removed by the user (G-006). Housekeeping: `build` clears `dist/` first (G-072); vitest excludes `.claude/**` (G-073); `CHANGELOG.md` in root `files`; `create-sygnal-app/README.md`; `bin` paths without `./` (G-074); RELEASING.md notes on the sygnal-check install and npm 11 staged publishes (E409) |
| 0-B | Eval harness v2 | ✅ | `worktree-agent-a4c071684bfe36f9e` | subagent | `da17acb` | Headless runner (`run-trial.mjs`, stream-json transcripts + `.run.json` usage), `score.mjs` usage flags + locked writes, data-driven recommendations (`analysis/lib/preconditions.mjs`), `--model/--effort`, `orchestrate.mjs` (task discovery incl. tier 3, concurrency, resume, dry-run estimate). verify 44/44, 56 unit tests. Fix `e533025` (G-089/G-090: not-run trials never scored, preflight, pinned model, CLI version in manifest; 62 unit tests). **Smoke `v2-smoke` (user's terminal, CLI 2.1.287): sygnal-01 and react-01 both pass 3/3, ~20 s each, $0.44 total, model verified.** Fix2 `f0b6950`: Bash calls that write files count as edits (G-101); 67 unit tests. Estimate: tiers 1–2 ≈ 110 trials / ≈ $50 / ≈ 55 min at concurrency 4; all tiers ≈ $90–110 / 1.5–2 h |
| 0-C | Tier 3 tasks | ✅ | `worktree-agent-a2fd2b304453eea73` | subagent | `b06b318` | Tasks 13 course-portal (multi-file: Switchable + Collection + driver), 14 fix-support-inbox (debug: EVENTS constant mismatch, isolation two levels), 15 fix-reading-list (debug: Collection `from` on a calculated field, stale-closure throttle), 16 split-checkout (refactor, markup snapshots), 17 address-lookup (form + latest-only async, real DOM checked/value/focus). Both arms; 14 mutants all caught; `verify.mjs` mutants + `--reruns`; 78/78 checks on HEAD and on the 5.4.0 tarball; 5 reruns stable |
| 1-A | Rendering and props (B-014, B-015, B-017, G-033) | ✅ | `worktree-agent-adaf64faf566ceb22` | subagent | `1ebf856` | All four reproduced (17/19 jsdom + 5/5 browser tests failed first). B-014: pragma `toClassMap` (string/array `class` → map). B-015: new `removedPropsModule` (clears removed/nullish props by type + reflected attribute; skips className and form value/checked; also fixes `title={null}` → "null"). B-017: selectModule queues on update too, re-applies after children. G-033: SYG111 reports a literal select value. Kanban **+282 B → 41,717 B (88 B headroom)** |
| 1-B | State and components (B-016, G-027/G-044, G-036, G-007 SYG106) | ✅ | `worktree-agent-a96e740ac129168e8` | subagent | `12ca03d` | B-016: empty model for isolatedState+initialState without model. G-027/G-044: decision record D43; `fail()` tags errors and `legacy.caught()` reports them under their own code (SYG215/405/413/414/903/606), SYG218 reported directly, SYG420 collected via the bridge, SYG405 default error. G-036: `run(…, { diagnostics: { strict } })` + new SYG608 when the dev entry is missing. D41: SYG106 error under runtime strict (no static rule exists). 19 failing-first tests. Kanban +268 B alone |
| 1-C | Drivers (G-069) | ✅ | `worktree-agent-ac88e05e39e97d91f` | subagent | `fd3fc7c` | Replies that resolve before the first `select()` listener are buffered (≤ 100, oldest dropped) and flushed on a microtask after the first subscribe, so a BOOTSTRAP request gets its reply; later replies with no listener are dropped; `stop()` clears `sendFn`. 5 tests, failing first |
| 1-D | Integrations (B-020, G-046, G-037) | ✅ | `worktree-agent-a2111196f25b78f43` | subagent | `af2bac5` | B-020: reproduced (pre-bundled `sygnal_vike_onRenderClient.js` with an inlined core + source core); `sygnal/vite` dev sets `optimizeDeps.exclude: ['sygnal/vike/onRenderClient']`; verified linked and installed (packed tarball): one core. G-046: `urlPathname` removed from `passToClient` (client falls back to `window.location.pathname`). G-037: Vike page named from its function/`componentName` (counter stays in `sel`); Astro already fixed in PLAN-1. 6 failing-first tests. Kanban 0 B |
| 1-E | Types and build hygiene (B-002/G-012, G-019, G-075, G-076, G-077) | ✅ | `worktree-agent-a2c537d37c4e12f41` | subagent | `07c4eab` | Build prints 0 TS diagnostics (was 56); `test:types` = full `tsc --noEmit` + type-tests (fails on any error). G-012's testing.ts errors not reproduced. G-019: 97 assertions moved to `type-tests/public-api.ts`, exposing 9 wrong ones (fixed). G-075: audit 12 → 2 (vite pinned `^7.3.6` via overrides; deferred: `@rollup/plugin-terser` 1.0 major for serialize-javascript). G-076: browser runner whitelists expected errors and **fails on unexpected ones**. G-077: `NonStateSinkValue` (constants on non-STATE sinks). Kanban 0 B |
| 1-T | Size trim (G-088) | ✅ | `worktree-agent-af1bfdae13632e5a7` | subagent | `12cc8b9` | 41,991 → **41,719 B** with no behaviour change: `onlineStatus$` marked pure (−105), `optionsOf()` replaces 4 copy-pasted option blocks (−92), short core SYG608 text (−26), pragma `chainHooks` and marker fall-through (−26), small dedups (−23). Top contributors: component.ts 11.6k, xstream 3.4k, get-intrinsic 2.5k (via xstream's `globalthis`), devtools 2.3k |
| 1-R | Review fixes + leftovers (G-083, G-084, G-086, G-087, G-091…G-098) | ✅ | `worktree-agent-ac20436bed98cd91a` | subagent | `1275440`, `a0e0170`, `1c81963` | All fixed (G-095: img error not reproducible in Chromium; iframe about:blank on attribute removal is per spec). G-084 root cause: `getComponents()` descended into component vnodes' children, so every ancestor made a never-rendered duplicate instance that ran BOOTSTRAP/timers and wrote state keys; scan now stops at component vnodes. G-098 reproduced as a hydration failure (`MemoryStream` export) → `'sygnal'` added to optimizeDeps.include for installed sygnal. G-083: Vike config is one ESM `dist/vike/config/+config.js` + generated `package.json` (type module); CJS config build removed. `SortSpec` type exported. Kanban +84 B → 41,803 B |
| 2-A | Testing completeness (G-064, G-065, G-053) | ✅ | `worktree-agent-a9a235cb519e6198d` | subagent | `5b35476` | G-064: harness records every driverless sink in the tree from each `model$` (children, grandchildren, Collection items); passed drivers still win. G-065: behaviour fix — `ready()` arms a cursor that the first `next()` starts from (other `t.*` calls disarm it); timeouts name an already-matched earlier state. G-053: `timeoutMs`/`settleMs`/`eventWaitMs` options; timeouts name pending model `next('X')` delays (parsed from the core debug log line — coupling G-111). 20 tests (15 failed first). Kanban 0 B |
| 2-B | Agent docs (2-D1 snapshot semantics, 2-D2 extract-component recipe, 2-D3 latest-only pattern) | ✅ | `worktree-agent-a44b2fbe9d096f4ac` | subagent | `032363c` | 2-D1: guide/model.md "Sinks See the State Before the Action" + one bullet each in llms.txt/SKILL.md (verified with a scratch test; B-003 tests already guard it). 2-D2: guide/parent-child.md recipe (snapshot → move markup → PARENT + `CHILD.select` → re-run), compact SKILL.md form, llms.txt pointer; validated on the task-08 starter (identical HTML). 2-D3: guide/drivers.md "Only the Latest Response" (reqId in state, echoed by the driver, ABORT on mismatch, clear bumps reqId); scratch-tested out-of-order, stale failure, clear-in-flight. llms.txt 249 lines; 382 samples strict-clean |
| 2-C | Component and Vike bugs (G-102, G-106, G-107, G-108, G-109) | ✅ | `worktree-agent-a130ae35c89dc73bf` | subagent | `ed0ffac`…`43aacbc` | G-102: two causes — `propsIsEqual` ignored `of`/`from`/`filter` (now only `state`), and an unchanged state object was dropped by `dropRepeats` when only filter/sort changed (shallow copy sent); also `sort` without filter sorted the parent array in place (fixed). G-107: sub-components with a model but no intent get BOOTSTRAP. G-108: only a non-ABORT symbol is SYG218; null/arrays/bigints go to the driver (explanation regenerated). G-109: propsModule + removedPropsModule merged into one `propsModule.ts` that never writes nullish values (−64 B). G-106: Vike shell state nested (`wrapper_0.layout_0.page`) in initial state, view, navigation, hydration and SSR; verified in a real installed-tarball Vike app with Playwright. Kanban −91 B |
| 2-D | `globalthis` alias in `sygnal/vite` + size-gate script (G-099) | ✅ | `worktree-agent-a2f656507f54d98a7` | subagent | `a75d332` | xstream only does `require('globalthis').getPolyfill()`; stub `dist/shims/globalthis.cjs` (also exported as `sygnal/shims/globalthis`) aliased via `resolve.alias` in serve/build/Vitest; opt-out `sygnal({ nativeGlobalThis: false })`; `sygnal/astro` adds it in `astro build` too. Verified kanban, Vike SSR, Astro, Vitest, and installed tarballs of 3 templates (build/preview/dev). `scripts/size-gate.mjs`: gated (opt-out) **41,803 B** / 42,300; default **37,812 B** (−3,991) |
| 1-F | Examples (G-052, G-063) | ✅ | (same branch as 1-C) | subagent | `fd3fc7c` | todomvc ids = max id + 1; `LOG` sink uses the reducer form (type gap → G-077); build runs `tsc --noEmit`; custom pollers removed from `app.test.ts`, which uses `next`/`settle`/`html`; new id test. Strict-clean |

## Gate Results

| Merge | build:all | vitest | examples | types | browser | sygnal-check | doc samples | error docs | docs build | kanban gz |
|---|---|---|---|---|---|---|---|---|---|---|
| 0-A | ✅ | 942 ✅ | | | | | | | | |
| 1-R | ✅ (0 TS) | 916 ✅ | ✅ | ✅ | 121 ✅ | 183 ✅ | 374 ✅ | ✅ | ✅ | 41,803 B ✅ |
| 1-T | ✅ | 893 ✅ | ✅ | ✅ | 119 ✅ | 183 ✅ | 374 ✅ | ✅ | | 41,719 B ✅ |
| 2-C | ✅ (0 TS) | 953 ✅ | ✅ | ✅ | 121 ✅ | 183 ✅ | 384 ✅ | ✅ | ✅ | 41,712 B gated / 37,720 B default ✅ |
| 2-A/B/D | ✅ (0 TS) | 941 ✅ | ✅ | ✅ | 121 ✅ | 183 ✅ | 384 ✅ | ✅ | ✅ | 41,803 B gated / 37,812 B default ✅ |
| 1-B + 1-E | ✅ (0 TS warnings) | 893 ✅ | 105 ✅ | ✅ | 119 ✅ | 183 ✅ | 374 ✅ | ✅ | ✅ | **41,991 B ❌ (+186 over)** |
| 1-D | ✅ | 971 ✅ | 104 ✅ | ✅ | 119 ✅ | 178 ✅ | 373 ✅ | | ✅ | 41,717 B |
| 1-A | ✅ | 966 ✅ | | | 119 ✅ | 182 ✅ | 373 ✅ | ✅ | | 41,717 B |
| 1-C/1-F | ✅ | 947 ✅ | 105 ✅ | ✅ | 114 ✅ | 178 ✅ | 373 ✅ | | | 41,435 B |

## Open Questions (awaiting user)

| # | Question | Raised | Blocks | Answer |
|---|---|---|---|---|
| Q1 | G-007: rename/alias `event()`? Should strict mode make SYG106 (reserved view-prop names) an error? | PLAN-2 §3 | 1-E (G-007 part) | ✅ Keep `event`; SYG106 is an error in strict mode (D41, assigned to 1-B) |
| Q2 | Eval budget for Phase 0: React re-run + Sygnal reference (12 tasks × 5 × 2 arms = 120 trials) and the tier-3 pilot (4–6 tasks × 2 trials × 2 arms) | Phase 0 | 0-B steps 2–3, 0-C pilot | ✅ Full v2-baseline approved: tier-3 pilot, then tiers 1–3 × both arms × 5 trials (D42) |

## Decision Log

| # | Date | Decision | By | Rationale |
|---|---|---|---|---|
| D39 | 2026-10-01 | `plan2-integration` cut from `main` after the 5.4.0 merge; PLAN-2 commits cherry-picked onto it | Coordinator | PLAN-2 §1 |
| D41 | 2026-10-01 | G-007: keep `event()` as is; SYG106 becomes an error under strict mode (runtime and `--strict`), a warning otherwise | User | `event` already in 5.4.0 docs and used correctly |
| D42 | 2026-10-01 | Phase 0 eval budget: tier-3 pilot (≈2 trials × task × arm), then the full v2-baseline (tiers 1–3, both arms, 5 trials) | User | Q2 |
| D43 | 2026-10-01 | G-027/G-044: 'error' = the operation failed (thrown, or caught and logged while the app continues); 'warn' = likely mistake, behaviour continues; a call site may lower severity. Caught Sygnal errors keep their own code; SYG216/214/408 only for uncoded exceptions. SYG405 default error (Collection/Switchable sites warn). One SYG401 site error → warn | 1-B (coordinator accepted) | Codes surface as documented |
| D44 | 2026-10-01 | Review R4: limit B-016 to sub-components with no `state` prop; an existing parent slice is never overwritten by a model-less child's initialState (5.4.0 behaviour kept) | Coordinator | Smallest behaviour change; matches the tracker's intent |
| D45 | 2026-10-01 | The tier-3 pilot and the v2-baseline run against the **published** `sygnal@5.4.0` tarball with the **5.4.0** skill installed (not the integration branch), so PLAN-2 changes are measured against the release | Coordinator | PLAN-2 0-B step 3 ("on 5.4.0") |
| D46 | 2026-10-01 | Tier-3 pilot: 20/20 pass with Opus 5.5 (no pass-rate signal), but a clear efficiency gap (1.46× wall, 1.58× cost). Tiers 1–3 frozen as efficiency tiers; pass-rate discrimination left to E7 (smaller models). Full v2-baseline started: 160 trials on the 5.4.0 tarball | User | Hardening may still give 100% on Opus; E7 is the better lever |
| D47 | 2026-10-01 | G-099: `sygnal/vite` aliases xstream's `globalthis` polyfill chain to a native stub by default, with an opt-out (≈ −4 KB gz per app) | User | Native `globalThis` everywhere Sygnal runs |
| D48 | 2026-10-01 | Size budget re-baselined 41,805 → **42,300 B**, measured with the D47 alias turned off so it tracks core growth | User | 2 B headroom after Phase 1; leave room for Phase 2–4 fixes |
| D40 | 2026-10-01 | 0-B and 0-C build and self-verify without paid eval runs (0-B may run ≤ 2 smoke trials, `v2-smoke`, to validate the headless runner); full runs and pilots wait for Q2 | Coordinator | PLAN-2 §8 (user approves budgets per phase) |

## Bugs & Gaps Found

| ID | Found in | Severity | Area | Description | Status |
|---|---|---|---|---|---|
| G-072 | 5.4.0 release | medium | Build | `build` didn't clear `dist/`; stale files (284 vs 163) went into the pack | ✅ 0-A: `clean` step |
| G-073 | 5.4.0 release | low | Tests | Root vitest collected ~1,560 files from `.claude/worktrees` | ✅ 0-A: excluded |
| G-074 | 5.4.0 release | low | Packaging | npm 11 warns "bin … invalid and removed" for `./`-prefixed bin paths (harmless normalization) | ✅ 0-A |
| G-075 | 5.4.0 release | low | Dev deps | `npm audit`: 12 findings, all in dev tooling (runtime 0) | ✅ 1-E: 12 → 2 (terser plugin major deferred) |
| G-077 | 1-F | low | Types | Runtime accepts a constant non-STATE sink value (`mapTo(value)`), but `SinkValue` in `index.d.ts` allows only `true` or a reducer, so `LOG: 'text'` fails tsc | ✅ 1-E (types only; not in canonical docs) |
| G-086 | 1-E | low | Types | `SortObject` in `index.d.ts` allows a sort function per field, which the runtime rejects (SYG418); the runtime accepts `1 \| -1` and sorter arrays the type rejects | ✅ 1-R |
| G-087 | 1-B | low | Diagnostics text | SYG218 says "returned a object" for null/arrays (uses `typeof`) | ✅ 1-R |
| G-088 | 1-B merge | **high** (gate) | Size budget | After 1-A (+282) and 1-B (+268), kanban is 41,991 B: **186 B over** the 41,805 budget | ✅ User: trim first → 1-T, 41,719 B |
| G-078 | 1-C/1-F | low | Gate setup | The setup didn't install every example (`npm test` fails until `TEST_EXAMPLES_INSTALL=1`), and `npm --prefix …/kanban exec -- vite build` resolves from the current dir | ✅ Setup below fixed |
| G-079 | 1-A | low | Rendering | classNameModule dropped selector classes (`h('p.s', { className: 'k' })` → only `k`); hyperscript only | ✅ Fixed in 1-A |
| G-080 | 1-A | low | Rendering | `selectModule`'s pending queue is module-level and shared by the main patch and `portalPatch`; a portal patch mid-main-patch could flush early | Open (low risk) |
| G-081 | 1-A | low | Controlled inputs | `value={undefined}` is dropped by the pragma (absent prop) while `value={null}` writes `elm.value = null`; null/undefined semantics for controlled fields undecided | Open → decide in Phase 2 |
| G-082 | 1-A | med | Size budget | Kanban at 41,717 B, 88 B under the 41,805 B budget; later core work may exceed it | ✅ D48: budget 42,300 B |
| G-083 | 1-D | low | Vike packaging | Every Vike dev start warns `sygnal/config unexpected export { module.exports }`, and Node warns MODULE_TYPELESS_PACKAGE_JSON for `dist/vike/+config.js` (ESM in `.js`, no `"type"`). Likely fix: emit `+config.mjs` (rollup + exports) | ✅ 1-R |
| G-084 | 1-D | med | Vike shell / component.ts | `inspect()` shows Layout under two parents and, after one navigation, Page ×4 (3 with stale home state): children instantiated by several ancestors, or stale instances kept after navigation. Pre-existing; possible leak/duplicate work | ✅ 1-R |
| G-085 | 1-D | low | Dev gotcha | `npm --prefix <example> exec -- vike dev` from the repo root serves `create-sygnal-app/template-vike`; use `npm --prefix <example> run dev` | Noted |
| G-089 | 0-B smoke | high (eval) | Harness | An auth failure (401, `duration_api_ms` 0) was scored as a FAIL trial and the queue continued; no preflight | ✅ 0-B fix `e533025` |
| G-090 | 0-B smoke | high (eval) | Harness | `--model opus` resolves to `claude-opus-4-6` on CLI 2.1.90; runs must pin the full id and verify the resolved model | ✅ 0-B fix `e533025` |
| G-101 | v2-smoke | med (eval) | Analyzer | Edits made through Bash (python heredoc writing `src/App.jsx`) are counted as verify time, with 0 edit rounds and "wrote test 0 / kept 1" | ✅ 0-B fix2 |
| G-091 | Review R1 | med | Types | `SinkConstant<unknown>` = `unknown`, so a driver sink typed `unknown` loses all reducer checking (state becomes implicit any; wrong reducers accepted) | ✅ 1-R |
| G-092 | Review R2 | med | driverFromAsync | Early rejections are not buffered: a BOOTSTRAP request that rejects at once never reaches `errors()` (same timing bug as G-069) | ✅ 1-R |
| G-093 | Review R3 | low-med | run() | `diagnostics.strict` leaks across `run()` calls and isn't restored on `dispose()` | ✅ 1-R |
| G-094 | Review R4 | low-med | component.ts | B-016 fix also makes a model-less isolatedState child overwrite an existing parent slice (`state="user"`) with its initialState | ✅ 1-R |
| G-095 | Review R5 | low | removedPropsModule | On create/removal, URL props get `elm.src = ''` (img/video error event, iframe about:blank) before the attribute is removed | ✅ 1-R |
| G-096 | Review R6 | low | Pragma | `class={['btn', { active: on }]}` gives `[object`/`Object]` classes; merge objects and flatten arrays (clsx-style) | ✅ 1-R |
| G-097 | Review | low | Types | `ParentSinkValueReturn` maps a `PARENT: false` constant to never (checks `boolean`, should check literal `true`) | ✅ 1-R |
| G-098 | Review | low (unverified) | Vite/Vike | With the onRenderClient exclude, an installed-sygnal Vike app whose pages never import `'sygnal'` directly may re-optimize on first load; maybe add `'sygnal'` to `optimizeDeps.include` | ✅ 1-R |
| G-099 | 1-T | med (size) | Bundle | xstream `require('globalthis')` pulls a polyfill chain (get-intrinsic, object-keys, has-symbols, …); aliasing it to a `() => globalThis` stub cuts kanban 41,719 → ~37,741 B (−9.5%). Could ship as a `resolve.alias` in `sygnal/vite`, but it changes users' bundles and would mask core growth in the gate | ✅ D47 → 2-D |
| G-100 | 1-T | low (size) | Bundle | `src/extra/devtools.ts` (~2.3 KB gz) ships in production because `run()` always calls `init()`; opt-in/lazy would be a feature change | Open → Phase 2 candidate |
| G-102 | 0-C | med | Collection | A Collection inside a child component ignores a change to its `filter` prop (with or without `state=`) until some item's own state changes; works in the root. Likely the pickCombine/props$ family (PLAN-1 known issue 5) | ✅ 2-C |
| G-103 | 0-C | low | sygnal-check | No static rule for a Collection bound to a calculated field (runtime SYG409 only), even with `--strict` | Open → Phase 2 candidate (E1 input) |
| G-104 | 0-C | low | sygnal-check | Can't follow imported EVENTS type constants, so a cross-file mismatch is invisible statically | Open → Phase 2 candidate (E1/E8 input) |
| G-105 | 0-C | low | Collection | Collection always renders a `div` container (invalid inside `<ul>`/`<table>`) | Open → Phase 2 candidate |
| G-106 | 1-R | med | Vike | After client navigation with both a Wrapper and a Layout, the page's `+data` is lost: shell state keys are root-relative (`wrapper_0`, `layout_0`) while the Layout reads `wrapper_0.layout_0`; navigation writes `layout_0.page` at the root (previously read only by G-084's duplicates). Fix: nest shell state in onRenderClient (navigation + hydration) and onRenderHtml | ✅ 2-C |
| G-107 | 1-R | low | component.ts | A sub-component with a `model` but no `intent` never gets BOOTSTRAP (a root component does) | ✅ 2-C |
| G-108 | 1-R | low | Types/diagnostics | SYG218 rejects reducers returning arrays to driver sinks, but the types (and constant values) allow arrays | ✅ 2-C |
| G-109 | 1-R | low | Rendering | `src={null}` is written as "null" by propsModule before removedPropsModule removes it (harmless in Chromium) | ✅ 2-C |
| G-110 | 2-A | low-med | Diagnostics | In a real `run()` app, a child component's sink with no driver is silently dropped (no core or `sygnal/diagnostics` warning) | Open → Phase 2/3 candidate (new SYG code) |
| G-111 | 2-A | low | Testing | G-053's delayed-`next()` detection parses the core debug log text `next() action: <TYPE> Nms delay`; a wording change breaks it (tests would catch it). Cleaner: an `onNext` diagnostics hook (costs core bytes) | Open |
| G-112 | 2-D | low | browser-tests | `browser-tests/vite.config.js` doesn't use the sygnal plugin, so `test:browser` never exercises `sygnal/vite` in dev | Open |
| G-113 | 2-D | low | Astro dev | Cold-cache first load logs `504 (Outdated Optimize Dep)` while Vite re-optimizes (pre-existing; island still works) | Open |
| G-114 | 2-D | low | Docs | CLAUDE.md test counts are stale (892 → 941 library tests) | Open → Phase 4 release prep |
| G-115 | 2-C | low (perf) | Collection | `fieldLense.get` creates new item objects (`{...item, id}`) on every state emission, so every item re-renders on any parent state change; G-102 makes filter/sort prop changes re-emit too. Also: a child given an inline-arrow `filter` prop now re-renders on every parent render | Open → Phase 3/4 candidate |
| G-116 | 2-C | low | Collection | A Collection with no `from` (whole state is the array) or a custom `from={{get,set}}` silently ignores `filter` and `sort` | Open → diagnostic or support |
| G-076 | 5.4.0 release | low | browser-tests | The browser run prints expected console errors from error-path tests, which look like failures | ✅ 1-E (whitelist updated for SYG405 at the 1-B merge) |

## Worktree Setup (each subagent, inside its own isolated worktree)

```bash
git merge --ff-only plan2-integration
npm ci --no-audit --no-fund
npm ci --prefix browser-tests --no-audit --no-fund
npm install --prefix sygnal-check --no-audit --no-fund
npm install --prefix examples/kanban --no-audit --no-fund
npm run build
TEST_EXAMPLES_INSTALL=1 npm run test:examples   # installs every example once
```

Kanban size gate (absolute paths; vite needs the example dir as its root):

```bash
npm --prefix <abs>/examples/kanban exec -- vite build <abs>/examples/kanban --outDir /tmp/kb --emptyOutDir
gzip -c /tmp/kb/assets/index-*.js | wc -c      # budget 41,805 B
```

## Activity Log

- 2026-10-01 — 2-C merged; full gate green (953 vitest, 121 browser, 41,712 B gated). All Phase 2 workstreams merged; Phase 2 closes after the targeted eval against v2-baseline.
- 2026-10-01 — 2-D merged; size gate is now `node scripts/size-gate.mjs` (budget 42,300 B gated); apps ~4 KB smaller by default.
- 2026-10-01 — 2-A merged (coordinator merge; the agent's own merge was blocked by permissions); gates green: 936 vitest, 121 browser, 384 samples, llms.txt 249.
- 2026-10-01 — 2-B merged (docs; samples 382 clean, docs build OK).
- 2026-10-01 — Tier-3 pilot done (20/20, $7.55); D46: tiers frozen, v2-baseline (160 trials, est. $58 / 1.3 h) started from the user's terminal; Phase 2 workstreams 2-A, 2-B, 2-C launched.
- 2026-10-01 — 0-C merged (tier 3, 78/78 incl. vs the 5.4.0 tarball); 0-B fix2 merged; 1-R merged, full gate green (916 vitest, 121 browser, 41,803 B); Phase 1 closed, tagged `plan2-phase1`. 5.4.0 skill installed (D45); tier-3 pilot (20 trials) started from the user's terminal. New: G-102…G-109.
- 2026-10-01 — User re-logged the CLI (2.1.287). 0-B fix merged; real smoke passed 2/2 ($0.44, Opus 5.5 verified); analyzer gap G-101 → 0-B fix2.
- 2026-10-01 — 1-T merged; full gate green at 41,719 B; 1-R launched (review findings + G-083/084/086/087).
- 2026-10-01 — 0-B merged; installed skill re-synced (D35; backup in scratchpad); smoke attempt from the user's terminal: both trials 401 (CLI login invalid), $0 spent, results moved out of the repo; 0-B fix requested (G-089/G-090). Phase 1 review: 6 findings + 2 notes (G-091…G-098) → fix workstream 1-R after 1-T.
- 2026-10-01 — 1-E and 1-B merged; browser whitelist updated (SYG408 → SYG405 after D43); all gates green except size: kanban 41,991 B (G-088, to the user).
- 2026-10-01 — 1-D merged (B-020, G-046, G-037); gates green; G-083/G-084 logged for a Phase 1 fix workstream.
- 2026-10-01 — 1-A merged (B-014, B-015, B-017, G-033); gates green; kanban 41,717 B.
- 2026-10-01 — 1-C/1-F merged (G-069, G-052, G-063); gates green; G-077 sent to 1-E.
- 2026-10-01 — PLAN-2 started. `plan2-integration` created; 0-A done (smoke 8/8 on the live registry, housekeeping); 0-B, 0-C and 1-A…1-F launched in parallel.
