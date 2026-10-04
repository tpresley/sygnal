# PLAN-4 Status Tracker

Tracks progress for [PLAN-4.md](PLAN-4.md) (controls and core ergonomics). The coordinator maintains it.

**Numbering:**
- Decisions start at **D100** and gaps at **G-200**. D92–D99 and G-184–G-199 are left for PLAN-3, which is still recording its final eval.
- PLAN-5 (ecosystem) continues after PLAN-4's last number.
- "P4-D" with no number is the CT-1 canonical-form decision made after 1-E (P4-Q10).

**Integration branch:** `plan4-integration`, cut from `main` at `3214ed9` on 2026-10-03 (worktree `.claude/worktrees/plan-4-execution-7ae8e8`). The release stays held (D56): no version bumps, tags, PR to main or publish.

**State:** Phases 1–3 done and tagged. Phase 4: everything not depending on controls is merged (4-A1, 4-B1/2, 4-D1, 4-X). Waiting for the user's 0-E and 1-E eval runs → P4-D → 4-C, 4-A2, 4-D2 → 4-E → 4-F.

## Baseline (0-A)

Measured 2026-10-03 on `plan4-integration` at `3214ed9` (= `main`). All gates green.

| Measure | Value |
|---|---|
| Size gate, kanban gated | **40,536 B** / 42,300 B (**1,764 B** left for PLAN-4 + PLAN-5); default (native globalThis) 36,548 B |
| `llms.txt` | **285 lines** / 300; `docs/public/llms.txt` byte-identical |
| SKILL.md | **34,996 B** / 36,000 B (1,004 B left) |
| Library vitest | 1,546 passed |
| `test:examples` | 9 examples, 105 tests passed |
| `test:types` | pass |
| `test:browser` | 136 passed |
| `sygnal-check` | 245 passed |
| `check-doc-samples` | 444 checked, 444 clean, 5 skipped |
| `gen-error-docs --check`, docs build | pass |
| Eval reference | PLAN-3 4-C and Phase 6 runs (`results/REPORT-v3.md`) |

PLAN-3's end-of-Phase-5 figures (40,403 B, 283 lines, 34,343 B) grew with #12 and the PLAN-3 Phase 6 docs; the numbers above are the PLAN-4 baseline.

**Experiments re-run (0-D check):** `gap-study-experiments` on this build: 12/15 pass. X2, X2b and X8 pass (B-0, B-1 fixed). X1 fails as expected (GS-4 not implemented). X7 fails only on its stale assertion: it expected the parent wrapper to hear a click *before* the child's own listener; G-145 settled native order (child first, then wrapper), which both drivers now follow. Every wrapper click is heard in mock and real DOM. (The mock reports `wrap:SPAN` where the real DOM reports `wrap:txt` because the mock target has no `className`; test artifact.) No action needed.

## Workstreams

| ID | Workstream | Status | Branch | Owner | Merge | Notes |
|---|---|---|---|---|---|---|
| 0-A | Setup, baseline, §11 answers | ✅ | `plan4-integration` | coordinator | | |
| 0-B | Size spikes (CT-1 incl. spec objects, GS-1, GS-2, GS-5, GS-7, small core group) | ✅ table below | `exp/p4-spikes` (`b752a14`) | subagent | not merged | CT-1 spike includes the D101 spec path and D102 command lookup |
| 0-C | Eval prep: `ergo` tier 26–29, CT-1 A/B variant | ✅ ergo tier merged; A/B variant ⬜ (next) | `p4-0c-ergo-tier` (`cbbae2d`) | subagent | `284a648` | 56 tasks / 238 checks verify OK; 18–20 mutants; dialog `close` gap → G-204 |
| 0-D | Bug fixes (B-0, B-1, bubbling) | ✅ before PLAN-4 | `main` | other session | #12 (`2cef7ee`) | Recorded as G-144…G-146 in `PLAN-2-status.md`; 0-A re-runs X2, X2b, X7, X8 |
| 0-E | `ergo` baseline eval (user's terminal) | ⬜ command given to the user | run `p4-ergo-baseline` from the 0-C worktree (PLAN-3 build) | user | | |
| 1-A | Controls core | ✅ merged `3b32e04` (with 1-T) | `p4-1a-controls` (`e4bac86`) | subagent | `3b32e04` | +51 B gated, +156 B per app using controls; 40/42 failing-first; SYG124/125 dev-only; G-202 done |
| 1-T | Controls types | ✅ merged with 1-A | `p4-1t-types` (`c503914`) | subagent | | 19 failing-first; props from `HTMLElementTagNameMap` (Sygnal's `JSX.IntrinsicElements` is `any`); component in `DOM.click`/`query` is a type error |
| 1-D | Controls checker | ✅ merged | `p4-1d-checker` (`36b9d4d`) | subagent | `6565844` | sygnal-check 245 → 293; 33/38 failing-first; `--fix --controls` converts kanban 7/9, todomvc 6, tests unchanged, idempotent |
| 1-E | Controls A/B eval | ⬜ | | user | | |
| 2-A | Core I: GS-4, GS-11, GS-9 | ✅ merged | `p4-2a-core` (`4816283`) | subagent | (merge after `284a648`) | +229 B (GS-4 +5, GS-11 +120, GS-9 +104); SYG222 dev-only (0 B core); SYG502 retired; SSR uid determinism test in the gate |
| 2-B | Core II: GS-6, GS-1 runtime | ✅ merged | `p4-2b-core` (`bf463ba`) | subagent | | +78 B (GS-6 +50 incl. end-on-dispose, GS-1 +28); `behaviors.ts` ≈ 925 B per app using it; 20/22 failing-first; SYG127 dev-only; merge rules in `behaviors.ts` header |
| 2-C | Testing: GS-10 `t.actions` | ✅ merged | `p4-2c-actions` (`3e9dd23`) | subagent | | 0 B production (no core hook); 22/22 failing-first; `t.explain` (stretch) done; `inspect({ actions })` opt-in (G-210); 'behavior' cause hook = `isBehaviorAction` in `checks/actionLog.ts` |
| 2-T | Types | folded into 2-A, 2-B, 2-C (each types its own surface) | | | | D119 |
| 1-F | Follow-ups: dialog `close`/`cancel` delegation (G-204), SYG124/125 `reportedBy`, G-203, D116 `h` type test, stale Vite plugin comments | ✅ merged | `p4-1f-followups` (`555eeb2`) | subagent | | +30 B (non-bubbling list incl. media events); mock DOM no longer bubbles non-bubbling events; browser 143 |
| 2-A2 | Follow-ups: Astro hook (D120), G-206, G-207, 'behavior' cause, `simulateAction` of behavior actions, SSR with behaviors | ✅ merged | `p4-2a2-followups` (`27b5753`) | subagent | | +13 B (`run(…, { uid })`); Astro `onError` integration option via a virtual module; Astro `uid` island prop; Vike shells/Page get `id` props (`w0`/`l0`/`p`) |
| 2-D | a11y checker (GS-3) | ✅ merged `5e9c1e5` | `p4-2d-a11y` (`e7af5d7`) | subagent | `5e9c1e5` | 18/31 failing-first; sygnal-check 343; FP review 0/100 on p4-final2 + p3-final, 0/498 elsewhere; examples/templates/doc samples a11y-clean; 5 pending in llms.txt/SKILL.md (4-A) |
| P-3 | Performance baseline (GS-16) | ✅ merged (non-gating) | `p4-p3-perf` (`88f0b2f`) | subagent | | `benchmarks/RESULTS.md`; `npm --prefix browser-tests run perf`; proposes "Collection O(1) item lookups" (+28 B) → user |
| P-1 | View Transitions spike (GS-12) | ✅ decided (D129) | `exp/p4-view-transitions` (`bbdc43a`) | subagent | not merged | `dev-plans/research/p1-view-transitions.md` on the exp branch |
| P-2b | `sygnal/element` + per-instance `run()` (G-212) | ✅ merged | `p4-p2b-element` (`bf36b39`) | subagent | | core **−72 B** (page-wide HMR persisted state removed); entry 1,554 B gz (1,951 B at es2020 because of `#private`); doc draft in `research/p2b-element-doc-draft.md` for PLAN-5 |
| PF-1 | Collection O(1) item lookups (D128) | ✅ merged | `p4-pf1-collection` (`007e8ff`) | subagent | | +42 B (est. 28; accepted within D125); Collection edit 16.2 → 8.3 ms, swap 10.7 → 5.5 ms; identity kept for unchanged items; duplicate-id behaviour pinned |
| P-1b | View Transitions, form B (D129) + G-213 | ✅ merged | `p4-p1b-vt` (`c44709d`); G-213 fix `exp/p4-g213` (`baecc34`) merged (D137) | subagent | | +30 B core; `makeViewTransitionDOMDriver` +354 B per app; form A ≥ +139 B over B (stays on `exp/p4-vt-slim`); SYG645; G-213 fix +148 B |
| 2-R | Review fixes (G-214), G-216, G-218, D131, togglePopover, `t.explain` original fn, Vike `onError` check | ✅ merged | `p4-2r-fixes` (`c2188b6`) | subagent | | +26 B net (uid encoding +28, togglePopover +17, per-app HMR −37); tags `plan4-phase1`, `plan4-phase2` |
| 3-B | Persist (GS-5) | ✅ merged | `p4-3b-persist` (`38b4ec0`) | subagent | | +16 B core; helper ≈ 830 B per app; PERSIST handled by the helper (rewritten to EFFECT); RESTORE built-in entry; `{ version, state }` format; G-224/225/226 done |
| 3-B2 | Persist follow-ups: automatic hydration, Astro statics forwarding, Vike SYG224 note, drop `'A \| PERSIST'` rewrite | ✅ merged | `p4-3b2-persist` (`dd23f87`) | subagent | | +5 B (`__m` mount-point source); helper 865 B per app; G-227 fixed |
| 3-A | Element commands (GS-2) | ✅ merged | `p4-3a-element` (`9176436`) | subagent | | +222 B; any element method runs (D133); SYG640/641 dev-only; commands run after the next patch where the target exists, else 16 ms checks, give up after ~1 s |
| 3-K | Checker: GS-2, GS-7 (GS-5 after 3-B) | ✅ merged (GS-5 part pending) | `p4-3k-checker` (`3da16ee`) | subagent | | sygnal-check 434; static SYG422/640/641/643; timer actions are triggers (SYG112 family); no new findings on hidden solutions/examples; G-215 frame browser test |
| 4-B2 | Site docs, part 2 (element commands, timers, DevTools, API reference) | ✅ merged | `p4-4b2-docs` (`7c2c001`) | subagent | | 2 new pages; 33 samples in `test/p4-4b2-doc-samples.test.js`; check-doc-samples 511; G-219, G-223 closed |
| 3-R | Phase 3 review fixes (G-231) | ✅ merged; tag `plan4-phase3` | `p4-3r-fixes` (`036d380`) | subagent | | **−31 B** core (pickCombine simplified); Collection clear 70.7 → 17.1 ms; SSR marker `data-sygnal-ssr` (D139) |
| 4-A1 | Agent docs, part 1 (all but controls) | ✅ merged | `p4-4a1-agentdocs` (`30fd99b`) | subagent | | llms.txt 285 → 290 (+11, −5 trims; cap test raised to 315 per D115); SKILL.md 34,996 → 38,889 B (23 B under the 38 KB cap: CT-1 guidance will need trims); templates synced; A11Y_PENDING empty; 74 samples in `test/p4-4a1-agent-doc-samples.test.js` |
| 4-D1 | CHANGELOG, ROADMAP, canonical-forms (all but controls) | ✅ merged | `p4-4d-changelog` (`03656b4`) | subagent | | `TODO(P4-D)` / `TODO(3-R)` / `TODO(4-E)` HTML comments mark what changes after the eval and 3-R |
| 4-X | Cleanup: G-230, G-232, G-233, G-234 | ✅ merged | `p4-4x-cleanup` (`c020419`) | subagent | | +3 B (ELEMENT skipped in the sinks reduce) |
| 3-C | Timers (GS-7) | ✅ merged | `p4-3c-timers` (`6ad12b1`) | subagent | | 0 B core; +579 B per app; driver key `TIMER` by convention (found by `__sygnalStatic`); SYG643 also covers `connections`/`resources`; hidden pages restart timers from scratch; recipe waits for 3-K (SYG102 on TICK) |
| 3-E | DevTools (GS-10) | ✅ merged | `p4-3e-devtools` (`7fa4c43`) | subagent | | 0 B production; devtools entry 3.9 → 16.5 KB gz (dev-only); Copy as test proven on kanban, todomvc, signup form (`test/copied/`); Redux bridge done (stretch) |
| 1-E prep | Controls A/B variants `p4-ct1-a`/`p4-ct1-b` | ✅ merged | `p4-1e-ab-variant` (`ef038e0`) | subagent | | controls skill +1,902 B (+5.4%); converted starters committed as overlays; task 16 normaliser ignores `data-control`; verify 55/55 on converted solutions |
| 1-E | Controls A/B eval (user's terminal) | ⬜ commands given | runs `p4-ct1-a`, `p4-ct1-b`, `-haiku` (5 trials) | user | | from the `p4-1e-ab-variant` worktree |
| P-2 | Custom elements spike (GS-13) | ✅ record done → user | `exp/p4-elements` (`7d1d67f`) | subagent | not merged | `dev-plans/research/p2-custom-elements.md` on the exp branch; 0 B core, entry 1,003 B gz; shadow DOM, React 19 (`ontask-picked` only), HMR work; recommends adopt + making `run()` per-instance (G-212) |
| 3-D | Behaviors complete (GS-1 checker, pager/selection/undoable, SYG226, G-210) | ✅ merged | `p4-3d-behaviors` (`03ce0e2`) | subagent | | 0 B core; app cost pager 951 B, selection 1,168 B, undoable 836 B, undo 1,624 B; sygnal-check 369; recipes in `test/p4-3d-recipes.test.js` |
| P-4 | Dev-context design note (GS-15) | ✅ merged, decided (D132) | `p4-p4-devcontext` (`1e4a73f`) | subagent | | `dev-plans/research/p4-dev-context.md` |
| 4-B1 | Site docs, part 1 (merged non-CT-1 features) | ✅ merged | `p4-4b1-docs` (`6c35ad4`) | subagent | | 3 new pages, 13 updated; 31 samples run verbatim in `test/p4-4b1-doc-samples.test.js`; check-doc-samples 478 |
| 3-A … 3-T | Phase 3 | ⬜ | | | | 3-A includes D102 |
| 4-A … 4-F | Phase 4 | ⬜ | | | | |


## 0-B size spikes (2026-10-03)

`exp/p4-spikes` `b752a14`, one commit per spike; `dev-plans/research/p4-spikes/measure.mjs` on that branch reproduces them. Gated kanban, gzip, whole-build differences. Spikes 2–6 measured on top of the CT-1 build (40,585 B).

| Spike | Form | Core Δ (kanban not using it) | Added to an app using it | Threshold | Outcome |
|---|---|---|---|---|---|
| CT-1 controls | pragma flag calls the control's render; `MainDOMSource.select` stringifies a control; `controls()` in `src/extra/controls.ts` | **+49 B** | +122 B | ≤ 120 B | Adopt |
| GS-1 | (a) `uses` merge in core | +253 B | +50 B | ≤ 100 B | No |
| GS-1 | (a') `uses`; each behavior carries its own `.merge`, core loops | **+30 B** | +286 B | ≤ 100 B | **Adopted (D114)** |
| GS-1 | (b) `withBehaviors` | 0 B | +321 B | — | Fallback |
| GS-2 | (a) built-in `ELEMENT` sink (D102 lookup +19 B of it) | **+238 B** | 0 B | ≤ 300 B | **Adopted (D114)** |
| GS-2 | (b) registered driver | +85 B | +227 B | — | No |
| GS-5 | (a) plain-object static | +415 B | 0 B | ≤ 150 B | No |
| GS-5 | (b) `persist({...})` helper, core calls `.setup` on root | **+26 B** | +443 B | — | **Adopted (D114)** |
| GS-7 | (a) built in | +240 B | 0 B | ≤ 200 B | No |
| GS-7 | (b) registered `makeTimerDriver()` on `__sygnalStatic` + replies | **0 B** | +375 B (incl. `makeReplies`) | — | **Adopted (D114)**, SYG643 in dev |
| GS-4 | same object = ABORT | +5 B | — | ~15 B | Adopt |
| GS-6 | `STATE.watch` | +29 B | — | ~70 B | Adopt |
| GS-9 | `uid` | +68 B | — | ~50 B | Adopt (over estimate) |
| GS-11 | `run(…, { onError })` | +89 B | — | ~40 B | Adopt (over estimate) |
| Group GS-4/6/9/11 | together | +192 B | — | ~175 B | — |

**Total with the adopted forms ≈ 535 B** (cap 650 B, D115). Unused helper modules add exactly 0 B.

Spike findings carried into the briefs:
- The JSX runtime has its own pragma copy; `controls.ts` must not import `createElement` (that cost +735 B per app). The pragma passes its own `h` to the control hook (~18 B core, included).
- GS-2: the **first key** of a command object is the method, the rest are options (string options like `block: 'center'` are otherwise indistinguishable from selectors). `close` takes `returnValue` as a plain argument. "After the next patch" needs a real hook: an action that only sends a command causes no patch, so 3-A must run commands after the patch if one is pending, else on the next tick.
- GS-1 (a') and GS-5 (b) both use "the static's value carries its own setup/merge". 2-B and 3-B should share one call-site hook if that saves bytes.
- GS-11: no single place where driver errors surface; the view phase must fire after the component's `onError` picks its fallback; the hook must be per app, not module-global.
- GS-9: spike uids are long path strings; 2-A should shorten them and must run the SSR/hydration check.
- GS-4: the strict SYG502 tests must be retired; the "no re-render" check needs a test that the view's dropRepeats doesn't already hide.


## GS-16 performance baseline (P-3, 2026-10-03)

Median DOM-settled ms over 10 runs (Apple M3 Max, Chromium 145 headless). Full table, method and profile in `benchmarks/RESULTS.md`.

| Op | Sygnal Collection | Sygnal mapped rows | React 19 | Vue 3.5 |
|---|---:|---:|---:|---:|
| create 1,000 | 68.3 | 22.3 | 12.3 | 10.7 |
| edit one row | 16.4 | 9.5 | 0.7 | 1.3 |
| swap two rows | 11.0 | 9.5 | 10.5 | 1.4 |
| append 1,000 | 94.4 | 25.1 | 14.2 | 12.7 |
| clear 2,000 | 15.0 (+~287 ms teardown) | 7.0 | 4.0 | 3.4 |

Proposal from the record: **Collection O(1) item lookups** (index hint + Map by id in `instanceLens().get` and `instantiateCollection`'s `fieldLense`; no new API), measured edit 16.7 → 8.2 ms, swap 11.6 → 5.7 ms, +28 B. Not proposed: Elm-style `lazy` (≈ 250–400 B). Pending the user's decision (§10: memoization work only with approval).

## Interfaces promised to PLAN-5

PLAN-5's W-1 (`defineWidget`) builds on these, so they are frozen once 1-A merges. Any change needs the user and a note to the PLAN-5 session.

| Interface | Plan section | Promised |
|---|---|---|
| Control spec contract `ControlSpec<P>`: a tag string or `{ kind, vnode(props, children, h), commands?, __props? }`; the pragma calls `vnode()` with its own `h` (createElement) and stamps `data-control`, keeping hooks and copying `key` onto the returned vnode when it has none | PLAN-4 §2 CT-1 | D101, amended D116 |
| Kind-blind acceptance: `DOM.*`, `simulateEvent`, `query`/`queryAll` and element commands resolve any control to `[data-control="<Key>"]` | CT-1 | D101 |
| Props type from the spec (`__props` phantom) | CT-1 Types | D101 |
| Element commands consult `spec.commands[name](hostElement, options)` before native methods, and only then raise SYG641. Only when the target is the control itself (a template-string selector has no spec) | GS-2 | D102 |
| `onError` phase `'widget'` in the type union (emitted by PLAN-5 only) | GS-11 | D105 |

If 1-A finds that any of these can't fit (size, or the pragma path), record it here as a G- item and tell the user. PLAN-5 then falls back to its 0 B function form (`widget(DatePicker, props)`).

## Code reservations

| Plan | Ranges |
|---|---|
| PLAN-4 (§5) | SYG124–129, 222–226, 422–423, 510 (if P4-D), 640–649, 701–719; SYG502 retired |
| PLAN-5 (`PLAN-5.md` §4) | SYG140–149, 230–239, 430–439, 660–669, 720–729 |

They don't overlap (checked 2026-10-02). 0-A confirmed on 2026-10-03 that none of these codes exists in `codes.ts` on `main`.

## Decisions

| ID | Date | Decision | By | Context |
|---|---|---|---|---|
| D100 | 2026-10-02 | P4-Q1: PLAN-4 (controls and core ergonomics) runs before PLAN-5 (ecosystem), and plans are renumbered in run order. The ecosystem plan, drafted as PLAN-4, is now PLAN-5 and rebases onto `plan4-integration`. | User | `HANDOFF-to-PLAN-5.md` §1; the PLAN-5 session applied its rename (`cbef7c8`) |
| D101 | 2026-10-02 | S-1 accepted: a widget is a kind of control (`controls({ DueDate: datePicker })`). PLAN-4 1-A provides the control spec contract, kind-blind acceptance and the spec-provided props type; PLAN-4 ships no widget code. | User (via the PLAN-5 session) | PLAN-5 §0.3 "Early answer"; settles PLAN-5's P5-Q1 (no `<Widget>` marker) |
| D102 | 2026-10-02 | Widget-declared commands through `ELEMENT`: element commands look up `spec.commands` before native methods; SYG641 only after both fail. | User (PLAN-5 P5-Q7) | S-1 item 4 |
| D103 | 2026-10-02 | Gap-study G-17 (deferred loading triggers, `lazy(…, { when: 'visible' \| 'idle' })`) moves to PLAN-5 as B-4, after its browser-sources pack. | User (PLAN-5 P5-Q9) | PLAN-4 §10 updated |
| D104 | 2026-10-02 | Both names stay: `defineWidget` (foreign widget into Sygnal, PLAN-5) and `defineElement` (Sygnal component out as a custom element, GS-13 if adopted). PLAN-5 owns the shared "Web components" guide. | User (PLAN-5 P5-Q8) | S-11 |
| D105 | 2026-10-02 | GS-11 `onError` phase union includes `'widget'`, reserved for PLAN-5. | Author of PLAN-4 | PLAN-5 W-1 asked "if PLAN-4 accepts the extra phase name"; zero cost |
| D106 | 2026-10-02 | Controls (view-intent linking option D) is the chosen direction for linking views to intents. Canonical status is still decided by the 1-E eval (P4-D). | User | `research/view-intent-linking.html`; the user called it "elegant, minimal, and intuitive" |
| D107 | 2026-10-02 | `DOM.click(Component)` is not supported. A component passed where a control or selector is expected is SYG124 (error), pointing to `CHILD.select` + `PARENT` or a parent-owned control around the child. | User (accepted the recommendation and had it added to the report) | view-intent-linking follow-up |
| D108 | 2026-10-03 | P4-Q3: `controls()`, marker attribute `data-control`, capitalised keys. | User | Matches what PLAN-5 already writes |
| D109 | 2026-10-03 | P4-Q5: behavior actions are namespaced `<key>.<ACTION>` (`pager.NEXT`). | User | |
| D110 | 2026-10-03 | P4-Q9: GS-4 adopted (a STATE reducer returning the identical object is "no change"), SYG502 retired, SYG222 added (dev). | User | Breaking; CHANGELOG entry in 4-D |
| D111 | 2026-10-03 | P4-Q11: the 7xx a11y lane is warn by default, error under `--strict`, and on in the Vite dev checker. | User | |
| D112 | 2026-10-03 | Duplicate control keys across `controls()` calls in one file are **SYG128** (error, static), taken from the spare 1xx reservation. | Coordinator | 1-D |
| D113 | 2026-10-03 | The `--fix` control conversion is opt-in (`--fix --controls`, `--keep-classes`) until P4-D. If controls become canonical, 4-C makes it the default (one line). The fixer also skips elements whose markup a project string asserts, and keeps classes that other source files select. | Coordinator | 1-D deviations 1–3 |
| D114 | 2026-10-03 | P4-Q4/Q6/Q7/Q8 forms: GS-1 static `uses`, each `defineBehavior` value carrying its own merge (+30 B core); GS-2 `ELEMENT` sink built in (+238 B); GS-5 `persist({...})` helper (+26 B core); GS-7 registered `makeTimerDriver()` (0 B core) with SYG643 when missing. | User | 0-B table |
| D115 | 2026-10-03 | P4-Q2 budgets: PLAN-4 core cap **650 B** gated (measured ≈ 535 B), leaving ≈ 1.1 KB for PLAN-5; `llms.txt` cap **315** lines with a −5 trim target in 4-A; SKILL.md cap **38 KB**; doc caps conditional on the 4-E learn-time check (D76 rule). | User | |
| D116 | 2026-10-03 | D101 amended: `vnode(props, children, h)`, where the pragma passes its own createElement (a widget importing it would duplicate the pragma, ~600 B, under the automatic runtime), and the control copies `key` onto the returned vnode when it has none. Backward compatible; noted for PLAN-5 in `HANDOFF-to-PLAN-5.md`. | User | 0-B finding |
| D117 | 2026-10-03 | P4-Q12: eval spend about $180 (0-E ~$15, 1-E ~$55, 4-E ~$110); ask before more. | User | |
| D118 | 2026-10-03 | GS-2 command object rule: the first key is the method, the remaining keys are options; `close`'s `returnValue` is passed as the argument. | Coordinator | 0-B finding |
| D119 | 2026-10-03 | 2-T is folded into the workstreams that own each surface (2-A, 2-B, 2-C type their own API and add type tests). | Coordinator | Fewer index.d.ts conflicts |
| D120 | 2026-10-03 | Astro app-level error hook: an integration option pointing at a module (`sygnal({ onError: './src/onError.js' })`, loaded through a virtual module) replaces 2-A's island static `onAppError`, which isn't public yet (2-A2). | Coordinator | 2-A QUESTION 1; recommendation (b) |
| D121 | 2026-10-03 | The 0-E ergo baseline runs from the 0-C worktree (`main` + eval commits only), so it measures the PLAN-3 build even though `plan4-integration` already has PLAN-4 features. Task 29 keeps its Escape-reopen test (known framework issue 10): the baseline measures the gap GS-2 closes, and the task is solvable today. | Coordinator | 0-C QUESTION, option A |
| D122 | 2026-10-03 | Retiring the SYG502 static rule also drops static detection of a bare `return;` / falling off a reducer; SYG202 still reports `undefined` at runtime. Accepted. | Coordinator | 2-A deviation |
| D123 | 2026-10-03 | GS-1 merge rules (2-B): the slice lives at `state[key]` with calculated fields on the slice; a host entry for a behavior action runs after the behavior's (host STATE on the full state, host EFFECT after, host value sinks replace the behavior's); a host intent action of the same name replaces the behavior's trigger. Behavior reply actions are not namespaced. | Coordinator | 2-B report |
| D124 | 2026-10-03 | Budget watch: PLAN-4 is at +389 B; GS-2 (spike 238 B) + GS-5 (26 B) would reach ≈ 653 B, over the 650 B cap (D115). 3-A's target is ≤ 225 B; if PLAN-4 still exceeds 650 B, the coordinator asks the user before merging. | Coordinator | |
| D125 | 2026-10-03 | PLAN-4 core cap raised from 650 B to **775 B** gated (projection ≈ 750 B); anything beyond comes back to the user. ≈ 990 B left for PLAN-5 under 42,300 B. | User | Budget question after 2-B |
| D126 | 2026-10-03 | 1-E runs Haiku at 5 trials too: ≈ $69 instead of $55 (eval total ≈ $194). | User | 1-E prep cost estimate |
| D127 | 2026-10-03 | GS-13 adopted (P-2b): a polished `sygnal/element` entry (0 B core), plus making `run()` per-instance (G-212, est. 20–40 B core). Docs in PLAN-5's "Web components" guide (D104). | User | P-2 record |
| D128 | 2026-10-03 | "Collection O(1) item lookups" (P-3 record) approved as a separate item, ≈ +28 B within PLAN-4's cap. | User | GS-16 |
| D129 | 2026-10-03 | GS-12 form B: `viewTransitions` static in core (+29 B), the transition hook as an opt-in helper DOM driver, `App.viewTransitions = ['ROUTE']` for routes (no router option), a dev diagnostic when the static is set without the driver. P-1b also tries a slimmer core hook; if form A fits in ≤ ~60 B more, back to the user to fold it in. PLAN-5 A-1 shrinks to item naming + a CSS recipe + a FLIP fallback for drag/rapid reorder. | User | P-1 record and coordinator's answers on core vs helper, framework expectations, agent risk |
| D130 | 2026-10-03 | Accepted 2-A2's surface: Astro `uid` island prop; Vike Layout/Wrapper/Page views receive `id` props (`w0`, `l0`, `p`) so uids match SSR. | Coordinator | 2-A2 QUESTION |
| D131 | 2026-10-03 | SYG644 (warn, dev) for a `defineElement` prop that hides an `HTMLElement` member, from PLAN-4's spare 6xx range; done in 2-R. | Coordinator | P-2b QUESTION 2 |
| D132 | 2026-10-03 | GS-15 deferred past 6.0 (no code). 4-A adds a one-line skill pointer to `t.actions` / `t.inspect()`, measured in 4-E. The note's eval design (≈ $44, live-app harness mode) stays on file for a 6.x minor. | User | P-4 note |
| D133 | 2026-10-03 | GS-2: the core runs any method the element has (no whitelist, +222 B instead of +294 B); the 11 methods stay the documented, typed set (others via `ElementCommandRegistry`); dev SYG641 still flags typos, missing methods and DOM-mutating methods at send. | Coordinator | 3-A QUESTION 1 |
| D134 | 2026-10-03 | uid parts use an injective encoding: letters and digits stay, every other character (including `_` and `-`) becomes `_<code>_` (`'0.2'` → `0_46_2`); the root `uid` option keeps the readable form. uids are opaque ids, so injectivity wins over readability. | Coordinator | 2-R QUESTION |
| D135 | 2026-10-03 | Vike: Sygnal's app-level hook config is `sygnalOnError` (`pages/+sygnalOnError.js`), because Vike 0.4.267 has its own global `onError` hook with a different signature. | Coordinator | 2-R item 15 |
| D136 | 2026-10-03 | Persist follow-ups (3-B2): hydration restore becomes automatic (per-app signal from run()/wrappers; `hydrate` stays an override); Astro roots forward `persist`/`uses`/`timers`/`viewTransitions`; Vike pages don't support persist in 6.0 (SYG224 names Vike, docs say where persist works); the non-canonical `'A \| PERSIST'` shorthand rewrite is dropped. | Coordinator | 3-B QUESTIONs |
| D137 | 2026-10-03 | G-213 fixed in PLAN-4 (`pickCombine` holds a removal while a moved item's new instance is still rendering, ≤ 100 ms; +148 B) and PLAN-4's core cap raised to **850 B** (≈ 880 B left for PLAN-5 under 42,300 B). Form A of View Transitions stays out (≥ +139 B over B, beyond D129's 60 B). | User (G-213, cap); coordinator (form A, per D129) | P-1b report |
| D138 | 2026-10-03 | G-213 hold (3-R): a removal waits only for new items of the current batch; a plain delete is synchronous when its Collection is the only one alive, and one task late when several are (a delete can't be told from the first half of a move then). | Coordinator | 3-R QUESTION 1 |
| D139 | 2026-10-03 | `renderToString` marks its root element with `data-sygnal-ssr=""` (removed by the first client render), so persist under plain `run()` detects hydration reliably. Changes SSR output for every app; CHANGELOG under Changed. | User | 3-R QUESTION 2 |

## Open questions (PLAN-4 §11)

| # | Question | Status |
|---|---|---|
| P4-Q1 | Order relative to PLAN-5 | ✅ D100 |
| P4-Q2 | Budgets | ✅ D115 |
| P4-Q3 | Controls naming (`controls`, `data-control`) | ✅ D108 |
| P4-Q4 | Behaviors form | ✅ D114: `uses` |
| P4-Q5 | Behavior action separator | ✅ D109 |
| P4-Q6 | Element commands | ✅ D114: `ELEMENT`, built in |
| P4-Q7 | Persist form | ✅ D114: `persist()` helper; `PERSIST: { clear: true }` sink as recommended |
| P4-Q8 | Timers | ✅ D114: registered driver; shape shared with B-3 |
| P4-Q9 | GS-4 breaking change and SYG502 retirement | ✅ D110 |
| P4-Q10 | CT-1 canonical bar → P4-D | Open (after 1-E) |
| P4-Q11 | a11y default severity | ✅ D111 |
| P4-Q12 | Eval spend | ✅ D117 |
| P4-Q13 | Bubbling semantics | ✅ Settled in #12 (G-145): native bubbling in both drivers |

## Gaps

| ID | Found | Sev | Area | Description | Status |
|---|---|---|---|---|---|
| G-200 | gap study | high | DOM | B-0 (controlled inputs drop keystrokes under ~5 ms apart), B-1 (fragment-root components lose isolation in the real DOM) and the mock/real bubbling mismatch. A separate session ("Fix DOM isolation and keystroke bugs") is fixing them on a branch off `main`. | ✅ Fixed on `main` in #12 (`2cef7ee`) as G-144…G-146 (PLAN-2 tracker) |
| G-201 | PLAN-5 §0.3 S-7 | info | GS-2 | `scrollToIndex` isn't an element command, because the target row of a virtual list usually isn't rendered. PLAN-5 uses `createCommand()` for it. Nothing changes in GS-2. | Note |
| G-202 | 1-D | low | diagnostics | Runtime `inspect()` (dev entry) doesn't list controls yet; only the static `--graph` does. The schema fields are optional. | ✅ 1-A |
| G-203 | 1-D | low | checker | SYG111 (controlled input) doesn't look through controls, so `<Draft value=…>` misses findings (never adds false ones). | ✅ 1-F |
| G-204 | 0-C | high | DOM | Dialog `close`/`cancel` don't bubble and aren't in `eventTypesThatDontBubble`, so `DOM.close(x)` / `.events('close')` never fires (eval known issue 10). | ✅ 1-F |
| G-205 | 2-D | info | evals | Nine eval starters (01, 02, 07, 09, 12, 18, 20, 21, 25) now produce SYG702 warnings from the vendored sygnal-check. Same for both 1-E variants; differs from PLAN-3 runs, which 4-E's comparison must note. | Note |
| G-206 | 2-A | low | GS-9 | The root uid is always `u`, so two apps on one page produce the same ids. | 2-A2 |
| G-207 | 2-A | medium | GS-9 / Vike | With a Vike Layout/Wrapper, the server renders the Page as its own root while the client nests it in the shell, so the Page's uids differ between server and client. | 2-A2 |
| G-208 | 2-A | info | GS-11 | The `'driver'` phase covers only drivers that throw synchronously from a sink listener (not errors inside a driver's operators or error events on its sources). | Note; docs in 4-B |
| G-209 | 2-A, 2-D | — | docs | Lines now false after GS-4/GS-9 (`return state` rule, SYG502, reserved props without `uid`) in llms.txt, SKILL.md, guide/model, alternative-forms, strict-mode, testing, components, sygnal-check README, SYG106 explanation; 5 a11y findings in llms.txt/SKILL.md samples (`A11Y_PENDING`). | 4-A / 4-B (SYG106 explanation and the sygnal-check README in 3-D) |
| G-210 | 2-C | low | inspect | `inspect()` lists recent actions only with `{ actions }`, because `sygnal-check/schema/inspect.schema.json` has no `recentActions` (additionalProperties false). Add the schema entry (2-C's proposed JSON) in 3-D, then decide on default. | 3-D |
| G-211 | 2-C merge | low | tests | `p4-2c-inspect-actions` relied on 30 × 1 ms ticks in a fixed 120 ms window; flaky under load. Fixed to wait for the ticks. Browser headless timeout raised 30 → 90 s (suite ~27 s). | ✅ coordinator |
| G-212 | P-2 | medium | run | `run()` writes page-wide globals (`__SYGNAL_HMR_PERSISTED_STATE`, `__SYGNAL_DEVTOOLS_APP__`) and resets the diagnostics config, so two apps (or a host app plus custom elements) on one page interfere: HMR may restore another app's state, diagnostics mode is reset. Related to G-206. | ✅ P-2b (residual in G-216) |
| G-213 | P-1 | medium | Collection | Moving an item across Collections paints a frame without it (0–1 frames per move, 4–8 in rapid runs), even with no animation. | ✅ D137 (`exp/p4-g213`) |
| G-214 | review (Phase 1+2, high) | — | core | Review findings: (1) behaviors.ts calls constant sink values (`{ PARENT: 'x' }`, `true`) as functions; (2) the parent mutates its received `sources.__uid` for each child (root: Cycle's sources), so a remount reads a stale base; (3) uid sanitizing isn't injective ('a.b' vs 'a_b'); (4) `STATE.select(...).watch()` doesn't end on dispose (select drops `end`); (5) Collection/Switchable uids become 'undefined-…' without a `__uid`; (6) SYG222 misses in-place mutation of a behavior slice; (7) statics errors reported with phase 'reducer'; (8) `isAbort` duplicated in 4 modules; (9) stale objIsEqual depth comment. | ✅ 2-R |
| G-215 | 3-C | low | GS-7 | No real-browser test for `frame` timers (rAF). Add one in 3-K or 4-x. | ✅ 3-K |
| G-216 | P-2b | low | HMR | `component.ts` still reads page-wide `__SYGNAL_HMR_UPDATING` / `__SYGNAL_HMR_STATE`, so an app constructed during another app's ~100 ms hot swap can take its state. Fix: scope per app through a `__hmr` source (+10–20 B). | ✅ 2-R |
| G-217 | P-2b | — | docs | `integration/hmr.md:67` mentions the removed `__SYGNAL_HMR_PERSISTED_STATE`; `diagnostics/index.ts` comment (lines 55–58) says every run() is authoritative ("unless another app is live"). | ✅ 2-R / 4-B1 |
| G-218 | 3-E | medium | testing | `t.simulateAction('A'); t.simulateAction('SUBMIT'); await t.fail('HTTP', …)` throws "The component sent none": with two queued simulateActions, the request leaves after the harness's queued-input wait. One simulateAction works. Copy as test emits `await t.settle()` as a workaround. | ✅ 2-R |
| G-219 | 3-E | — | docs | Document `copyAsTest`, `getActions`, `connectReduxDevtools`, `sygnal({ devtools: { redux: true } })`, `configureCopyAsTest`. | ✅ 4-B2 |
| G-220 | 3-A merge | high | browser-tests | `run-headless.mjs` passed `{ timeout }` as `waitForFunction`'s page argument, so Playwright's 30 s default always applied (the 90 s raise in G-211 did nothing). With 163 tests (~32 s) the suite failed as "timed out after 90000 ms". Fixed: options as the third argument; the runner now prints the real error and the page console. | ✅ coordinator |
| G-221 | 3-A | low | GS-2 | `togglePopover` gets `{}` when no `force`, which boolean-only browsers read as `true`. | ✅ 2-R |
| G-222 | 4-B1 | low | testing | `t.explain().reducer.fn/.source` is SYG222's dev wrapper when the dev entry is loaded. | ✅ 2-R |
| G-223 | 4-B1 | — | docs | `reference/api.md` and `reference/utilities.md` not updated for PLAN-4 APIs; the `benchmarks/RESULTS.md` link targets `main` (404 until merged). | ✅ 4-B2 |
| G-224 | 3-K | low | diagnostics | Runtime SYG102 heuristic (`replyNamesOf` in `checks/shared.ts`) doesn't read the `timers` static, so the dev entry may report a timer action as SYG102 info under `run()`; `InspectComponent` (public.d.ts) lacks the schema's static-only `commands`/`timers`. | ✅ 3-B |
| G-225 | 3-K, 4-B2 | low | tests | Timing flakes: `p4-3a-element-commands` "after 1 s" SYG640 and `p4-3a-element-run` "reports SYG641 and SYG640" each failed once (SYG640 after ~1 s). | ✅ 3-B |
| G-226 | 4-B2 | low | types | `SygnalDevTools` (from `getDevTools()` in `sygnal`) lacks `configureCopyAsTest` / `getSession`; only the `sygnal/devtools` type has them. | ✅ 3-B |
| G-227 | 3-B | medium | Astro | `src/astro/client.ts` copies a fixed list of statics into its root wrapper; `persist`, `uses`, `timers` are missing, so behaviors, timers and persist don't work on Astro islands. | ✅ 3-B2 |
| G-228 | P-1b merge | low | GS-12 | A non-array `viewTransitions` static (e.g. `true`) throws inside every STATE reducer (`.includes`), surfacing as SYG216. Add a dev check (SYG645's module) for a non-array value; types already require an array. | ✅ 3-R |
| G-229 | 3-B2 | low | Astro | Astro islands get no drivers (only `__hydrate`), so forwarded `timers`/`resources`/`connections` can't run there. Possible `drivers` integration option (like `onError`). | 6.x candidate; docs note in 4-B |
| G-230 | 3-B2 | — | docs | `reference/api.md` ~940/951 still say restore-after-first-render happens "with `hydrate: true`" (now automatic). | ✅ 4-X |
| G-231 | review (Phase 3, high) | — | core | (1) G-213's pending-item set is module-global (one slow item holds every Collection's removals page-wide; flush clears all); (2) every removal is now a task late even with no move; (3) non-array `viewTransitions` throws in every reducer (G-228); (4) persist SYG642 repeats on every failed write (prints in production); (5) persist hydration heuristic treats a placeholder in #root as server markup; (6) View Transition request expires after 100 ms wall time, so slow renders don't animate. | ✅ 3-R |
| G-232 | 4-D1 | low | GS-2 | The core subscribes to the model's `ELEMENT` sink but doesn't remove it from the sinks, so a user driver registered as `ELEMENT` also receives the command objects (both run). The CHANGELOG migration says to rename such a driver; decide whether to delete the sink like EFFECT (0–5 B). | ✅ 4-X |
| G-233 | 4-A1 | low | tests | `test/devtools-actions.test.js` and `test/devtools-copy-as-test.test.js` use fixed `tick(50)` waits and fail occasionally under full-suite load. | ✅ 4-X |
| G-234 | 3-R | — | docs | `integration/ssr.md` and the JSDoc in `src/extra/ssr.ts` / `index.d.ts` show renderToString output without the `data-sygnal-ssr` marker; CHANGELOG `TODO(3-R)` entry (Collection removal timing) and a Changed entry for the marker. G-213 browser test: ~1 in 60 loops shows a duplicate frame (destination debounce merges two rapid moves; pre-existing rate). | ✅ 4-X |
| G-235 | 4-X | low | docs | `integration/ssr.md` ~172 shows `run(App, '#app', { initialState })`, not the current `run(App, drivers, { mountPoint })` form. | 4-C/4-B docs pass after P4-D |

## Log

- 2026-10-02 — Plan written as PLAN-5 and renamed to PLAN-4 in run order (D100); `HANDOFF-to-PLAN-5.md` sent (`aac8ccd`).
- 2026-10-02 — PLAN-5 session answered the handoff (`claude/sygnal-component-research-b1873e` `cbef7c8`, `acc9b12`): S-1…S-14 all accepted (S-2, S-3, S-4, S-7 with changes; S-9 and S-10 to be investigated). Its requests are recorded as D101–D105. PLAN-4 §0.5, §2 CT-1, GS-2, GS-11, GS-13, §5 and §10 are updated. Tracker created early to hold them.
- 2026-10-03 — Updated for the state of `main`. PLAN-3 is merged (#14; its last IDs are D95 and G-189, so D100/G-200 still leave a gap), and the bug fixes are merged (#12, G-144…G-146), which closes G-200 and P4-Q13. `plan4-integration` will be cut from `main`. The PLAN-4 plan and tracker were merged to `main` so that all plans live in one place.
- 2026-10-03 — 0-A: `plan4-integration` cut from `main` (`3214ed9`); fresh-worktree setup; baseline gates green (above). P4-Q3, Q5, Q9, Q11 answered (D108–D111). 0-B spikes (`exp/p4-spikes`) and 0-C ergo tier (`p4-0c-ergo-tier`) started. Gap-study experiments re-run (12/15; X1 expected, X7 stale assertion).
- 2026-10-03 — 1-T done (`p4-1t-types`), held until 1-A. 1-D merged (`6565844`); all gates green, size unchanged (40,536 B). D112, D113; G-202, G-203.
- 2026-10-03 — 0-B done (table above). P4-Q2, Q4, Q6, Q7, Q8, Q12 answered and D101 amended (D114–D117); D118. 1-A, 2-A and 2-D started.
- 2026-10-03 — Merged 1-A + 1-T (`3b32e04`), 2-D (`5e9c1e5`), 0-C (`284a648`) and 2-A; gates green after each. Size 40,817 B gated (PLAN-4 +281 B of 650). Library vitest 1,623, browser 139, sygnal-check 343. 0-E command handed to the user. Started 1-F, 2-C, P-3, 2-B. D119–D122; G-204…G-209.
- 2026-10-03 — Merged 2-C and 1-F; gates green (vitest 1,655, browser 143, sygnal-check 346; 40,846 B gated, PLAN-4 +310 B). Started 1-E variant prep and P-1.
- 2026-10-03 — Merged P-3 (non-gating perf suite); gates green. Started P-2.
- 2026-10-03 — Merged 2-B; gates green (vitest 1,678, sygnal-check 347; 40,925 B gated, PLAN-4 +389 B). Started 2-A2. D123, D124.
- 2026-10-03 — P-2 decision record done (pending user, batched with P-1). Started 3-D. G-212.
- 2026-10-03 — Merged 1-E prep, 2-A2, 3-D; gates green (vitest 1,740, sygnal-check 369, browser 143; 40,938 B gated, PLAN-4 +402 B). Decisions D125–D130; G-213. 1-E commands handed to the user.
- 2026-10-03 — Started 3-A, 3-C, 3-E, P-2b. Phase 1+2 code review (high): 9 findings (G-214) → 2-R after 3-A.
- 2026-10-03 — Merged 3-C; gates green (vitest 1,766, sygnal-check 371; size unchanged 40,938 B). Started P-4.
- 2026-10-03 — Merged P-2b; gates green (vitest 1,797, browser 154; 40,866 B gated, PLAN-4 +330 B). D131; G-216, G-217.
- 2026-10-03 — P-4 note merged; GS-15 deferred (D132). Started 4-B part 1.
- 2026-10-03 — Merged 3-E; gates green (vitest 1,823, browser 154; size unchanged). G-218, G-219.
- 2026-10-03 — Merged 3-A (conflicts with 3-C/P-2b in codes/explanations/check hooks/browser main: kept both, regenerated) and 4-B part 1. Found and fixed G-220 (browser runner timeout). Gates green: vitest 1,965 (+1 skipped), browser 163, sygnal-check 373, doc samples 478; 41,103 B gated (PLAN-4 +567 B of 775). D133. Started 2-R and 3-K.
- 2026-10-03 — Merged 3-K; gates green (sygnal-check 434, browser 164). G-224, G-225.
- 2026-10-03 — Merged 4-B part 2. CLAUDE.md setup adds `examples/todomvc`. G-226.
- 2026-10-03 — Merged 2-R; fixed the debugging page's copied test (2-R removed the settle workaround). Gates green: vitest 2,082 (+1 skipped), browser 165, sygnal-check 435, doc samples 511; 41,129 B gated (PLAN-4 +593 B of 775). Review findings all fixed. Tagged `plan4-phase1` and `plan4-phase2`. D134, D135. Started 3-B.
- 2026-10-03 — Merged PF-1 (+42 B; 41,171 B gated, PLAN-4 +635 B of 775). 3-B and P-1b running in parallel (each with a few localized `component.ts` lines).
- 2026-10-03 — Merged 3-B; gates green (vitest 2,153, browser 167, sygnal-check 447, doc samples 520; 41,187 B gated, PLAN-4 +651 B). D136; G-227. Started 3-B2.
- 2026-10-03 — Merged P-1b (conflicts with 3-B in statics lists/d.ts/check registry/browser main: kept both), 3-B2, and the G-213 fix (D137). Fixed an island test that set `viewTransitions = true` (G-228). Gates green: vitest 2,189 (+1 skipped), browser 177, sygnal-check 448, doc samples 529; **41,371 B gated, PLAN-4 +835 B of 850**. Phase 3 implementation complete.
- 2026-10-03 — Phase 3 code review (high): 6 findings (G-231) → 3-R. Started 4-A part 1 and 4-D part 1 (everything except controls, pending P4-D).
- 2026-10-03 — Merged 4-D part 1. Gave the user the 0-E and 1-E commands again. G-232.
- 2026-10-03 — Merged 4-A part 1; llms.txt cap test → 315. Gates green: vitest 2,263 (+1 skipped), browser 177, doc samples 529 with 0 a11y pending; llms.txt 290 lines, SKILL.md 38,889 B. G-233.
- 2026-10-03 — Merged 3-R; gates green (vitest 2,282 +1 skipped, browser 177, sygnal-check 448; **41,340 B gated, PLAN-4 +804 B of 850**). Phase 3 review findings all fixed; tagged `plan4-phase3`. D138, D139; G-234.
- 2026-10-03 — Merged 4-X; gates green (vitest 2,283 +1 skipped, browser 177; 41,343 B gated, PLAN-4 +807 B of 850). Waiting on 0-E/1-E. G-235.
