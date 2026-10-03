# PLAN-4 Status Tracker

Tracks progress for [PLAN-4.md](PLAN-4.md) (controls and core ergonomics). The coordinator maintains it.

**Numbering:**
- Decisions start at **D100** and gaps at **G-200**. D92–D99 and G-184–G-199 are left for PLAN-3, which is still recording its final eval.
- PLAN-5 (ecosystem) continues after PLAN-4's last number.
- "P4-D" with no number is the CT-1 canonical-form decision made after 1-E (P4-Q10).

**Integration branch:** `plan4-integration`, cut from `main` at `3214ed9` on 2026-10-03 (worktree `.claude/worktrees/plan-4-execution-7ae8e8`). The release stays held (D56): no version bumps, tags, PR to main or publish.

**State:** Phase 0. 0-A baseline done; 0-B and 0-C running. P4-Q3, Q5, Q9 and Q11 answered (D108–D111); Q2, Q4, Q6, Q7, Q8 wait for 0-B; Q12 asked with them.

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
| 0-A | Setup, baseline, §11 answers | 🟡 baseline done; Q2/4/6/7/8/12 pending | `plan4-integration` | coordinator | | |
| 0-B | Size spikes (CT-1 incl. spec objects, GS-1, GS-2, GS-5, GS-7, small core group) | 🟡 running | `exp/p4-spikes` | subagent | not merged | CT-1 spike includes the D101 spec path and D102 command lookup |
| 0-C | Eval prep: `ergo` tier 26–29, CT-1 A/B variant | 🟡 ergo tier running (A/B variant after 1-D) | `p4-0c-ergo-tier` | subagent | | |
| 0-D | Bug fixes (B-0, B-1, bubbling) | ✅ before PLAN-4 | `main` | other session | #12 (`2cef7ee`) | Recorded as G-144…G-146 in `PLAN-2-status.md`; 0-A re-runs X2, X2b, X7, X8 |
| 0-E | `ergo` baseline eval (user's terminal) | ⬜ | | user | | |
| 1-A | Controls core | ⬜ waits for 0-B | `p4-1a-controls` | subagent | | Includes the D101 contract |
| 1-T | Controls types | ✅ done, merge held until 1-A | `p4-1t-types` (`c503914`) | subagent | | 19 failing-first; props from `HTMLElementTagNameMap` (Sygnal's `JSX.IntrinsicElements` is `any`); component in `DOM.click`/`query` is a type error |
| 1-D | Controls checker | ✅ merged | `p4-1d-checker` (`36b9d4d`) | subagent | `6565844` | sygnal-check 245 → 293; 33/38 failing-first; `--fix --controls` converts kanban 7/9, todomvc 6, tests unchanged, idempotent |
| 1-E | Controls A/B eval | ⬜ | | user | | |
| 2-A … 2-T, P-1 … P-4 | Phase 2 | ⬜ | | | | |
| 3-A … 3-T | Phase 3 | ⬜ | | | | 3-A includes D102 |
| 4-A … 4-F | Phase 4 | ⬜ | | | | |

## Interfaces promised to PLAN-5

PLAN-5's W-1 (`defineWidget`) builds on these, so they are frozen once 1-A merges. Any change needs the user and a note to the PLAN-5 session.

| Interface | Plan section | Promised |
|---|---|---|
| Control spec contract `ControlSpec<P>`: a tag string or `{ kind, vnode(props, children), commands?, __props? }`; the pragma calls `vnode()` and stamps `data-control`, keeping key and hooks | PLAN-4 §2 CT-1 | D101 |
| Kind-blind acceptance: `DOM.*`, `simulateEvent`, `query`/`queryAll` and element commands resolve any control to `[data-control="<Key>"]` | CT-1 | D101 |
| Props type from the spec (`__props` phantom) | CT-1 Types | D101 |
| Element commands consult `spec.commands[name](hostElement, options)` before native methods, and only then raise SYG641 | GS-2 | D102 |
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

## Open questions (PLAN-4 §11)

| # | Question | Status |
|---|---|---|
| P4-Q1 | Order relative to PLAN-5 | ✅ D100 |
| P4-Q2 | Budgets | Open. Note: PLAN-5 handles its own budgets "as they come up" (its P5-Q6), so P4-Q2 only needs PLAN-4's caps. |
| P4-Q3 | Controls naming (`controls`, `data-control`) | ✅ D108 |
| P4-Q4 | Behaviors form (`uses` vs `withBehaviors`) | Open (after 0-B). PLAN-5's `form` behavior and `sygnal-ui` parts depend on the answer. |
| P4-Q5 | Behavior action separator | ✅ D109 |
| P4-Q6 | Element commands: sink name, built in or registered | Open (after 0-B). PLAN-5 assumes the name `ELEMENT`. |
| P4-Q7 | Persist form; `PERSIST` sink for `{ clear }` | Open (after 0-B) |
| P4-Q8 | Timers: built in or registered; shape shared with PLAN-5 B-3 | Open (after 0-B). PLAN-5 accepted the shared shape (S-8). |
| P4-Q9 | GS-4 breaking change and SYG502 retirement | ✅ D110 |
| P4-Q10 | CT-1 canonical bar → P4-D | Open (after 1-E) |
| P4-Q11 | a11y default severity | ✅ D111 |
| P4-Q12 | Eval spend | Open |
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
