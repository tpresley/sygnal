# PLAN-9 Status Tracker

Tracks progress for [PLAN-9.md](PLAN-9.md) (composing UI from prepared parts in `sygnal/ai`).

**Numbering:** a reserved block, decisions **D450–D499**, gaps **G-750–G-799**.

**Integration branch:** `plan9-integration`, cut from `main` `06560b4a` on 2026-10-11 (the research branch
fast-forwarded into `main` first), in the worktree `.claude/worktrees/sygnal-ide-plugins-research-4d5a79`.

**State:** Phase 0 complete (2026-10-11). Phase 1 in progress. The plan and the research are written, and §5's questions are answered (D460–D465, 2026-10-11).

## Decisions

| # | Date | Decision |
|---|---|---|
| D450 | 2026-10-11 | One catalog for both backends; one layout format (node map, identity keys) (user) |
| D451 | 2026-10-11 | Backends chain off `compose`: `compose.decisions()`, `compose.llm()` (user) |
| D452 | 2026-10-11 | `<Composed>` marker: spike (0-S1) first; ship on its core impact, user decides (user) |
| D453 | 2026-10-11 | The `compose` behavior plus `catalog.render()`; the builder layer documented; no `<Composed>` component (user) |
| D454 | 2026-10-11 | Chat cards built into `chat` (`ask`, client tools) (user) |
| D455 | 2026-10-11 | `ask_user({ need })` two-step by default; `direct: true` opt-in (user) |
| D456 | 2026-10-11 | Core: instance identity from the vnode `key`, after 0-S2 measures it (user) |
| D457 | 2026-10-11 | No json-render dependency, renderer or wrapper; interop only on request (user) |
| D458 | 2026-10-11 | Containers are view functions; the model never chooses one (`in`, built-in `row`) |
| D459 | 2026-10-11 | Names: `defineCatalog`, `compose` (+ `.decisions`, `.llm`, `.answer`), `composeWith`, `chat({ ask })`; `byId` in `sygnal` |
| D460 | 2026-10-11 | Release 6.3.0, sygnal-check minor if X-2 ships (user, P9-Q1) |
| D461 | 2026-10-11 | `llms.txt` limit 322 (+2 lines) (user, P9-Q2) |
| D462 | 2026-10-11 | Result helper `compose.answer(props, value)` (user, P9-Q3) |
| D463 | 2026-10-11 | `byId` in `sygnal` (user, P9-Q4) |
| D464 | 2026-10-11 | Docs demos on fixtures; optional Jev dev proxy in the example, key from an env file outside the repo (user, P9-Q5) |
| D465 | 2026-10-11 | E-4 eval spend asked for at Phase 4 (user, P9-Q6) |
| D466 | 2026-10-11 | **Ship `<Composed>`** (M-1), as 0-S1 built it: a `pres` rewrite registered by `enableComposed()` (user) |
| D467 | 2026-10-11 | **Size budget:** do the tree-shaking fix (G-751) first; if it doesn't free enough, raise the budget to fit everything, and report the numbers (user) |
| D468 | 2026-10-11 | **G-750 is fixed in 6.3.0** with PLAN-9; no 6.2.x patch (user) |
| D469 | 2026-10-11 | 0-S3's recommendations adopted: `clientTools` option, `TOOL_OUTPUT` (not TOOL_RESULT), `TOOL_CALL` host entry, compose requests see only `need` + app state, a driver `abort: string[]`, uiMessageStream keeps `ui` (docs: store raw), `ask_user` fires TOOL_CALL (coordinator; user did not object) |
| D470 | 2026-10-11 | 0-S2's key identity goes in (`key ?? props.id ?? path`, +6 B), in Phase 1 with the G-751 / G-750 work |

## Items

| Item | State | Notes |
|---|---|---|
| Phase 0: merge research, cut branch | done | `06560b4a` on `main` (pushed); `plan9-integration` cut there; §4 code reservations confirmed free in `codes.ts` (SYG160–169, 250–259, 450–459, 680–689) |
| 0-S1 `<Composed>` marker spike | done; ship (D466) | [`research/ai-compose/marker-spike.md`](research/ai-compose/marker-spike.md): a `pres` rewrite (no host), 0 lines changed in existing core files, 0 B for non-users, +217 B gzip when imported, perf counts unchanged, parity holds; recommendation: ship as low-priority sugar (M-1). Found G-750 (core bug), G-751, G-752 |
| 0-S2 identity from vnode `key` | done; merged with CORE (D470) | `exp/p9-key-identity` `8d8ae48c`: `idOf` = `key ?? props.id ?? path` (`!= null`, so `key={0}` counts); SSR `childUid` same rule; Vike shell drops its component keys; `JSX.IntrinsicAttributes.key` typed. **+6 B gzip** (42,690 → 42,696; **4 B headroom left**); full `npm test` gate green (vitest 4,417, examples, types, browser 375/375, perf); 17 new tests + a type test. Coordinator re-ran the tests (23 pass) and the size gate. Follow-ups: optional dev warning for duplicate sibling identities; docs line that a key on `<Collection>` re-creates its items; react.md, llms.txt and the skill describe keyed identity |
| 0-S3 chat client tools design | done | [`research/ai-compose/chat-client-tools.md`](research/ai-compose/chat-client-tools.md): `clientTools` option, `TOOL_OUTPUT` (AI SDK 7's `addToolOutput`; replaces the plan's TOOL_RESULT), `TOOL_CALL` host entry, `ANSWER`; 12 edge-case rules; card on `part.ui`; SYG684–686; 5 open questions with recommendations. Possible existing bug to check in H-1: a persisted busy status may lock SEND after reload |
| P9-Q1…Q6 | done | accepted as recommended (D460–D465) |
| K-1 `defineCatalog` | done | worker A (`p9-compose`); canonical param shapes by `kind` (integration `7a604856`) |
| K-2 `catalog.render` | done | key + id (until CORE's key identity merges), memoized lenses (G-752: 0 re-renders on unrelated host changes), container views + `control`, error containment (SYG406, no core change) |
| K-3 layout utilities | done | `fromTree`/`toTree`/`removeNode`/`finish` (idempotent); one maxDepth rule (page = 0; a container at depth d > maxDepth moves to the page) |
| B-1 decisions: select + layout | done | worker B; live on Jev: structure 191/210 (research 189/210) |
| B-2 decisions: params + records | done | live on Jev: params 57/60 (research 54/60), records 57/60; open: rows ≥ 5 unreachable, non-param choices not split for Ollama's 26-option limit |
| B-3 `compose.llm()` | done | worker C; live on qwen3:8b via chatCompletions: 11/11, 15/15, 20/20, 0 invalid (research equal); open: a non-JSON reply fails in the driver before repair |
| B-4 edits | todo | |
| B-5 large catalogs | todo | |
| C-1 `compose` behavior | done | worker A |
| C-2 agents | todo | |
| H-1 client tools | todo | after 0-S3 |
| H-2 `chat({ ask })` | todo | |
| H-3 `direct: true` | todo | |
| T-1 `composeWith` | done | uses each backend's `fake()`; B's fake round-trips ~2,450 random targets |
| T-2 per-backend matrix | done | `test/p9-compose-matrix.test.js`: 8 scenarios × 2 backends |
| M-1 `<Composed>` | todo (D466) | from `exp/p9-composed` `fce942d6` |
| X-1 runtime diagnostics | done | SYG161, 162, 250, 251, 252, 450, 452, 680, 681, 682, 683; explanations + errors doc regenerated (189 codes) |
| X-2 sygnal-check rules + description lint | todo | |
| D-1…D-4 docs | todo | |
| E-1 `examples/ai-compose` on the API | done (merged `8eb493c1`) | catalog of the 9 parts with enum/number params; two hosts (decisions on HTTP, llm on LLM) behind a Switchable sharing app state; backend picker from /api/tags + Jev; dev-only Jev proxy (`server/decide-proxy.js`: key from `TYPESAFE_ENV_FILE`, never logged or returned, POST JSON ≤ 512 kB, model allowlist, cross-site refused); 22 tests (1 `it.fails`: G-753); strict clean; vite build OK. Live `npm run try`: nimble 7/11 flat + 3/4 params (~4.5 s), qwen3:8b 9/11 + 4/4 (~1.4 s) |
| E-2 `examples/ai-ask` | todo | |
| E-3 live accuracy check | todo | |
| E-4 agent eval | todo | spend asked first |

## Research baseline (2026-10-11, for E-3 and the §3 thresholds)

| | Jev | nimble | qwen3:8b + schema | Claude (blind) |
|---|---|---|---|---|
| Flat dashboard (11) | 9/11 | 9/11 | 11/11 | 10/11 |
| Structure (5 catalogs) | 189/210 | 38/68 | 15/15, 14/15 (dashboard, ops) | 14/15, 14/15 |
| Enum params | 54/60 | 19/20 | 20/20 | 20/20 |
| Records | 35–36/40 | 18/20 | — | — |
| Edits | 66/66, 43/48 held-out | 18/22, 10/16 | 27/31 | 31/31 |
| Time per composition | ~0.35 s | ~3 s | ~3.4 s | — |

## Verification log

- 2026-10-11, CORE merged (`0c887d6c`) + render keyed by `key` only (`3f47687b`), full gate on the combined branch: vitest 4,593 passed / 33 skipped; examples 10/10 suites; test:types green; browser chromium 376/376, WebMCP 45/45; perf gate within limits; size gate (a) **42,495 B** (budget 42,700, 205 B headroom; not raised), (b) 38,476 B, (c) core 18,346 B gzip; docs build + link check + code titles green; sygnal-check 1,243 passed. CORE's own run: G-750's browser case passes on chromium, firefox and webkit; check-doc-samples 808 clean.
- Size by CORE step (kanban gzip, gated / default / src-core): baseline 42,690 / 38,679 / 18,244; + key identity 42,696 / 38,684 / 18,249; + G-751 lazy markers 42,473 / 38,453 / 18,346; + G-750 42,495 / 38,476 / 18,346; + SYG453 (dev only) 42,495 / 38,476 / 18,346.
- 2026-10-11, Phase 1 A/B/C merged + integration (`7a604856`, `a595ff3c`): `npx vitest run test/p9-` 146 passed (coordinator re-ran); root vitest 4,546 passed, 0 failed; `test:types` green; `sygnal-check` 1,242 passed; size gate (a) 42,690 B (unchanged: compose is tree-shaken), (b) 38,679 B, (c) core 18,244 B gzip.

## Gaps

| # | Found in | Gap | Proposed | Priority |
|---|---|---|---|---|
| G-750 | 0-S1 | **Core bug, independent of PLAN-9:** in a real DOM, a component instance with an `id` that moves to an *earlier* parent element in one patch crashes the DOM driver (`Inst.inject` reuses the cached vnode; snabbdom's `createElm` overwrites the shared `elm`, then removing it from the old parent throws NotFoundError). Plain-core repro in `exp/p9-composed` `examples/ai-compose-api/src/realdom-move.test.jsx`; the mock DOM hides it | Fix in the core before K-2 promises that parts survive moves; add a browser test | **fixed** (CORE `f10207cb`): in `src/cycle/dom/IsolateModule.ts` (no `src/core/` change), +22 B; 9 jsdom tests + a browser case (chromium, firefox, webkit). Limit: if the old parent itself isn't patched, the moved root's own `hook.destroy` sees the new element. 6.3.0 (D468) |
| G-751 | 0-S1 | Markers registered at module level are not tree-shaken: `package.json` has no `sideEffects` field, so Portal is in kanban's bundle and D157's "pays nothing" doesn't hold for markers exported from the main index | Measure adding `sideEffects` or lazy registration | **fixed** (CORE `f24f2855`, `f06c87c2`): `sideEffects` can't help (single-file dist entries, 0 B); Portal, Transition, Suspense and `lazy` register lazily (the pragma calls a marker's `$reg`); Collection and Switchable stay on import because lowercase `<collection>`/`<switchable>` must work without an import. −223 B in kanban. Dropping the lowercase tags would free ~3.2 KB more for marker-free apps (a later decision) |
| G-753 | E-1 | Real DOM: keyed instances moving into a parent element **created in the same patch** (the preview's cards moving into a new row) leave the DOM at the old arrangement, silently (after G-750's fix; before it, NotFoundError). Repro: `examples/ai-compose/src/realdom.test.js` (`it.fails`) | Fix in the same layer as G-750, plain-core tests, browser case | **in progress** (fix worker `p9-fix-move`) |
| G-754 | E-1 | The compose behavior's CONTROL intent selects `[data-compose-control]` even when the catalog has no containers that emit controls: SYG103 in dev | Wire the selector only when needed, or mark it optional | **in progress** (`p9-fix-move`) |
| G-755 | E-1 | `compose.decisions()` on nimble scores 7/11 on the flat prompts vs the research example's 9/11 (Jev and qwen unaffected); most misses are left/right order inside a row | Phase 2: compare the `left_`/`beside_` wording and `rowMean` on nimble; maybe a per-model profile | Phase 2 |
| G-752 | 0-S1 | `local` composed parts re-render on every host state change (a new lens object per render) | K-2: memoize lenses per node key | **fixed** in K-2 (worker A): 0 re-renders on unrelated host changes; a context change still re-renders a `local` part |
