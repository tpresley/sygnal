# PLAN-4 Status Tracker

Tracks progress for [PLAN-4.md](PLAN-4.md) (controls and core ergonomics). The coordinator maintains it.

**Numbering:**
- Decisions start at **D100** and gaps at **G-200**. D92–D99 and G-184–G-199 are left for PLAN-3, which is still recording its final eval.
- PLAN-5 (ecosystem) continues after PLAN-4's last number.
- "P4-D" with no number is the CT-1 canonical-form decision made after 1-E (P4-Q10).

**Integration branch:** `plan4-integration`, cut from `main` at `3214ed9` on 2026-10-03 (worktree `.claude/worktrees/plan-4-execution-7ae8e8`). The release stays held (D56): no version bumps, tags, PR to main or publish.

**State:** Phase 1 (with Phase 2 started in parallel). All §11 questions answered except Q10 (after 1-E). 0-C running.

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
| 0-C | Eval prep: `ergo` tier 26–29, CT-1 A/B variant | 🟡 ergo tier running (A/B variant after 1-D) | `p4-0c-ergo-tier` | subagent | | |
| 0-D | Bug fixes (B-0, B-1, bubbling) | ✅ before PLAN-4 | `main` | other session | #12 (`2cef7ee`) | Recorded as G-144…G-146 in `PLAN-2-status.md`; 0-A re-runs X2, X2b, X7, X8 |
| 0-E | `ergo` baseline eval (user's terminal) | ⬜ | | user | | |
| 1-A | Controls core | 🟡 running | `p4-1a-controls` | subagent | | Includes the D101 contract |
| 1-T | Controls types | ✅ done, merge held until 1-A | `p4-1t-types` (`c503914`) | subagent | | 19 failing-first; props from `HTMLElementTagNameMap` (Sygnal's `JSX.IntrinsicElements` is `any`); component in `DOM.click`/`query` is a type error |
| 1-D | Controls checker | ✅ merged | `p4-1d-checker` (`36b9d4d`) | subagent | `6565844` | sygnal-check 245 → 293; 33/38 failing-first; `--fix --controls` converts kanban 7/9, todomvc 6, tests unchanged, idempotent |
| 1-E | Controls A/B eval | ⬜ | | user | | |
| 2-A | Core I: GS-4, GS-11, GS-9 | 🟡 running | `p4-2a-core` | subagent | | started alongside 1-A (spike showed CT-1 needs no `component.ts` change) |
| 2-B, 2-C, 2-T | Phase 2 | ⬜ | | | | 2-C waits for 1-A (`testing.ts`); 2-T after 1-T merges |
| 2-D | a11y checker (GS-3) | 🟡 running | `p4-2d-a11y` | subagent | | sygnal-check free after 1-D |
| P-1 … P-4 | Prototypes | ⬜ | | | | |
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
| G-202 | 1-D | low | diagnostics | Runtime `inspect()` (dev entry) doesn't list controls yet; only the static `--graph` does. The schema fields are optional. | Open → after 1-A |
| G-203 | 1-D | low | checker | SYG111 (controlled input) doesn't look through controls, so `<Draft value=…>` misses findings (never adds false ones). | Open → after 1-A |

## Log

- 2026-10-02 — Plan written as PLAN-5 and renamed to PLAN-4 in run order (D100); `HANDOFF-to-PLAN-5.md` sent (`aac8ccd`).
- 2026-10-02 — PLAN-5 session answered the handoff (`claude/sygnal-component-research-b1873e` `cbef7c8`, `acc9b12`): S-1…S-14 all accepted (S-2, S-3, S-4, S-7 with changes; S-9 and S-10 to be investigated). Its requests are recorded as D101–D105. PLAN-4 §0.5, §2 CT-1, GS-2, GS-11, GS-13, §5 and §10 are updated. Tracker created early to hold them.
- 2026-10-03 — Updated for the state of `main`. PLAN-3 is merged (#14; its last IDs are D95 and G-189, so D100/G-200 still leave a gap), and the bug fixes are merged (#12, G-144…G-146), which closes G-200 and P4-Q13. `plan4-integration` will be cut from `main`. The PLAN-4 plan and tracker were merged to `main` so that all plans live in one place.
- 2026-10-03 — 0-A: `plan4-integration` cut from `main` (`3214ed9`); fresh-worktree setup; baseline gates green (above). P4-Q3, Q5, Q9, Q11 answered (D108–D111). 0-B spikes (`exp/p4-spikes`) and 0-C ergo tier (`p4-0c-ergo-tier`) started. Gap-study experiments re-run (12/15; X1 expected, X7 stale assertion).
- 2026-10-03 — 1-T done (`p4-1t-types`), held until 1-A. 1-D merged (`6565844`); all gates green, size unchanged (40,536 B). D112, D113; G-202, G-203.
- 2026-10-03 — 0-B done (table above). P4-Q2, Q4, Q6, Q7, Q8, Q12 answered and D101 amended (D114–D117); D118. 1-A, 2-A and 2-D started.
