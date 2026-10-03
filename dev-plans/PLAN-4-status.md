# PLAN-4 Status Tracker

Tracks progress for [PLAN-4.md](PLAN-4.md) (controls and core ergonomics). The coordinator maintains it.

**Numbering:**
- Decisions start at **D100** and gaps at **G-200**. D92–D99 and G-184–G-199 are left for PLAN-3, which is still recording its final eval.
- PLAN-5 (ecosystem) continues after PLAN-4's last number.
- "P4-D" with no number is the CT-1 canonical-form decision made after 1-E (P4-Q10).

**Integration branch:** `plan4-integration`. It doesn't exist yet: 0-A cuts it from `main` once the PLAN-4 and PLAN-5 plans are merged there. The release stays held (D56): no version bumps, tags, PR to main or publish.

**State:** pre-Phase 0. The plan is merged to `main` together with this tracker. PLAN-3 is done on `main` (#14), and the DOM bug fixes are on `main` (#12). P4-Q1 is decided (D100); P4-Q2…Q13 are open (below). This tracker was created early so PLAN-5's requests have a place to land; 0-A completes it.

## Baseline (0-A)

To be measured in 0-A on `plan4-integration`. PLAN-3's last recorded figures, from the end of its Phase 5. The #12 fixes added about 145 B to the core afterwards, so re-measure on `main`:

| Measure | Value |
|---|---|
| Size gate, kanban gated | 40,403 B / 42,300 B (1,897 B left for PLAN-4 + PLAN-5) |
| `llms.txt` | 283 lines / 300 |
| SKILL.md | 34,343 B / 36,000 B |
| Eval reference | PLAN-3 4-C and Phase 6 runs (`results/REPORT-v3.md`) |

## Workstreams

| ID | Workstream | Status | Branch | Owner | Merge | Notes |
|---|---|---|---|---|---|---|
| 0-A | Setup, baseline, §11 answers | ⬜ | `plan4-integration` | coordinator | | |
| 0-B | Size spikes (CT-1 incl. spec objects, GS-1, GS-2, GS-5, GS-7, small core group) | ⬜ | `exp/p4-spikes` | subagent | not merged | CT-1 spike includes the D101 spec path and D102 command lookup |
| 0-C | Eval prep: `ergo` tier 26–29, CT-1 A/B variant | ⬜ | | subagent | | |
| 0-D | Bug fixes (B-0, B-1, bubbling) | ✅ before PLAN-4 | `main` | other session | #12 (`2cef7ee`) | Recorded as G-144…G-146 in `PLAN-2-status.md`; 0-A re-runs X2, X2b, X7, X8 |
| 0-E | `ergo` baseline eval (user's terminal) | ⬜ | | user | | |
| 1-A / 1-T / 1-D / 1-E | Controls | ⬜ | | | | Includes the D101 contract |
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

They don't overlap (checked 2026-10-02). 0-A confirms both against `codes.ts` on `main`.

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

## Open questions (PLAN-4 §11)

| # | Question | Status |
|---|---|---|
| P4-Q1 | Order relative to PLAN-5 | ✅ D100 |
| P4-Q2 | Budgets | Open. Note: PLAN-5 handles its own budgets "as they come up" (its P5-Q6), so P4-Q2 only needs PLAN-4's caps. |
| P4-Q3 | Controls naming (`controls`, `data-control`) | Open. PLAN-5 already writes `controls` and `data-control` in its plan, so a rename after this point needs a note to PLAN-5. |
| P4-Q4 | Behaviors form (`uses` vs `withBehaviors`) | Open (after 0-B). PLAN-5's `form` behavior and `sygnal-ui` parts depend on the answer. |
| P4-Q5 | Behavior action separator | Open |
| P4-Q6 | Element commands: sink name, built in or registered | Open (after 0-B). PLAN-5 assumes the name `ELEMENT`. |
| P4-Q7 | Persist form; `PERSIST` sink for `{ clear }` | Open (after 0-B) |
| P4-Q8 | Timers: built in or registered; shape shared with PLAN-5 B-3 | Open (after 0-B). PLAN-5 accepted the shared shape (S-8). |
| P4-Q9 | GS-4 breaking change and SYG502 retirement | Open |
| P4-Q10 | CT-1 canonical bar → P4-D | Open (after 1-E) |
| P4-Q11 | a11y default severity | Open |
| P4-Q12 | Eval spend | Open |
| P4-Q13 | Bubbling semantics | ✅ Settled in #12 (G-145): native bubbling in both drivers |

## Gaps

| ID | Found | Sev | Area | Description | Status |
|---|---|---|---|---|---|
| G-200 | gap study | high | DOM | B-0 (controlled inputs drop keystrokes under ~5 ms apart), B-1 (fragment-root components lose isolation in the real DOM) and the mock/real bubbling mismatch. A separate session ("Fix DOM isolation and keystroke bugs") is fixing them on a branch off `main`. | ✅ Fixed on `main` in #12 (`2cef7ee`) as G-144…G-146 (PLAN-2 tracker) |
| G-201 | PLAN-5 §0.3 S-7 | info | GS-2 | `scrollToIndex` isn't an element command, because the target row of a virtual list usually isn't rendered. PLAN-5 uses `createCommand()` for it. Nothing changes in GS-2. | Note |

## Log

- 2026-10-02 — Plan written as PLAN-5 and renamed to PLAN-4 in run order (D100); `HANDOFF-to-PLAN-5.md` sent (`aac8ccd`).
- 2026-10-02 — PLAN-5 session answered the handoff (`claude/sygnal-component-research-b1873e` `cbef7c8`, `acc9b12`): S-1…S-14 all accepted (S-2, S-3, S-4, S-7 with changes; S-9 and S-10 to be investigated). Its requests are recorded as D101–D105. PLAN-4 §0.5, §2 CT-1, GS-2, GS-11, GS-13, §5 and §10 are updated. Tracker created early to hold them.
- 2026-10-03 — Updated for the state of `main`. PLAN-3 is merged (#14; its last IDs are D95 and G-189, so D100/G-200 still leave a gap), and the bug fixes are merged (#12, G-144…G-146), which closes G-200 and P4-Q13. `plan4-integration` will be cut from `main`. The PLAN-4 plan and tracker were merged to `main` so that all plans live in one place.
