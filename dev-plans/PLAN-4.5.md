# PLAN-4.5: Performance for 6.0.0

**Goal:** fix the structural performance problems found by the performance audit, so that small updates, Collections, nesting and unmounting stop costing work proportional to the whole app. **No public API changes** and no new canonical forms: every fix is internal.

**Release:** part of the held 6.0.0 major (D56), with PLAN-3, PLAN-4 and PLAN-5. Runs **after PLAN-4 closes (4-F) and before PLAN-5**, so PLAN-5's components are built on, and measured against, the faster core. No version bumps, tags, PR to main or publish.

**Status:** complete (2026-10-04). Approved as D146; tracker `PLAN-4.5-status.md` (close-out section). Next: PLAN-5 rebases onto `plan45-integration`.

**Inputs:**

| Input | Where | What it gives |
|---|---|---|
| Performance audit (against 5.4.0) | https://claude.ai/artifact/UNKyiALFXNmPk62Q71csF8; harness and raw results in `perf/` (copied from the audit worktree) | Findings 1–6, recommendations 1–10, what to avoid |
| Re-baseline on PLAN-4 | [`research/p45-perf-baseline.md`](research/p45-perf-baseline.md) (`exp/p45-perf-baseline`, merged into `plan4-integration`) | Each finding re-measured on `plan4-integration`, current file:line, byte and risk estimates per recommendation, gate proposal |
| PLAN-4 tracker | [`PLAN-4-status.md`](PLAN-4-status.md) | Decisions that constrain the fixes: GS-4, GS-2 timing, GS-12 View Transitions, G-213/D138 removal hold, D139 SSR marker, G-212/G-216 per-app state, budgets D115/D125/D137 |
| PLAN-4 perf work | `benchmarks/RESULTS.md`, `browser-tests/perf/` (P-3), PF-1 | The js-framework-benchmark entries and the earlier Collection numbers |

**Invariants (as in PLAN-1…4):** models return descriptions of effects, drivers perform them, every state change is an action, views never bind events. PLAN-4.5 adds one more: **observable behaviour stays the same**, except for timing that tests and docs never promised (see §4).

---

## 1. Where Sygnal stands (PLAN-4 build, `plan4-integration` at `a7efb5d`)

Median of 10 after 3 warmups, Chromium headless, production builds; React re-run in the same session. Full tables in the baseline write-up.

| Operation | Sygnal latency / CPU (ms) | React latency (ms) | Counted cause |
|---|---|---|---|
| Collection 1k: select row | 38.5 / 184.8 | 0.55 | **1,001 DOM patches** from the root |
| Collection 1k: clear after a select | 461 / 586 | 3.4 | 1,001 patches × tree size |
| Collection 1k: update 1 | 8.0 / 7.3 (was 13.3, PF-1) | 0.8 | `PickCombine.up()` per item |
| Mount 1k components | 110 / 157 | 9.7 | **151 streams per instance** |
| Unmount 1k components | 9.9 / 128 | 2.0 | **79,013 `setTimeout` calls** |
| Single component, select row 1k | 7.1 / 6.1 | 0.55 | pragma 45% of busy time |
| Leaf update 30 deep | 5.9 / 18.3 | 0.4 | 51 patches, 945 `setInterval` calls |
| Keystroke (1k list) | 4.4 / 2.9 | 0.5 | ≥ 2 debounce timers |
| Retained after 5×1k mount/unmount | 5,000 `ScopeChecker`s | 0 | delegator listeners never removed |

Bulk create in a single component is already competitive (10k rows: Sygnal 196 ms, React 273 ms). The gap is in updates, Collections, nesting, unmount and memory.

## 2. Workstreams

Order follows the audit's advice: small safe fixes first, then the pragma rewrite (which frees bytes), then the scheduler, then lazy wiring. Each workstream lands with failing-first tests, a bench A/B against the previous merge, and a lower gate limit (§3).

### P45-0 Harness and gate (S, low risk, 0 B)
- Move `perf/` to `benchmarks/audit/`; adopt P-3's quiet-page wait and paint/busy metrics; port P-3's clear-2k scenario; align Vite/React versions with `benchmarks/`. Keep the js-framework-benchmark entries. Retire `browser-tests/perf/` once ported.
- `scripts/perf-gate.mjs`: the **count gate** (§3). It needs only Chromium, which the browser suite already uses, and counts don't depend on the machine. It runs in `npm test` after `test:browser`. Timing ratios to React go in a nightly, warn-only report.

### P45-A Leak, identity, module fast paths (S, low risk, ≈ +90…200 B)
- **Delegator listeners removed on stop** (audit rec 3): `EventDelegator.addEventListener` returns a stream whose `stop` removes its destination from the priority queue and prunes empty scopes. Shared destinations (controls, element-command lookups, a selector used twice) are reference-counted. Target: 0 retained `ScopeChecker`s.
- **Identity-preserving vnodes** (rec 2): `processSuspensePost` and `injectComponents` copy only the path to what changed and return their input when nothing changed, so snabbdom skips unchanged subtrees.
- **DOM module fast paths** (rec 7): `selectModule` and `controlledInputModule` act only on form fields; `classNameModule` keys on the prop (B-012), not the tag.

### P45-B Pragma hot path (M, low risk, ≈ −300…−500 B)
- Rec 6: one pass over JSX props into module buckets, no `mapObject`/`extend(true)`; skip focus, `omit` and SVG handling when they can't apply. Fuse `stampFields`, `preprocessVdom` and `getComponents` into one walk, skipped when the pragma saw no special nodes.
- `extend` leaves the bundle (a runtime dependency drops: `snabbdom`, `xstream` remain).
- Semantics question: nested prop objects (`style`, `attrs`, `props`, `hook`) are passed **by reference** instead of deep-copied (§8 Q3).

### P45-C One render scheduler (L, medium risk, ≈ +50…200 B net; may remove the G-213 hold, −150 B)
- Rec 1, with the rest of rec 4 and rec 9:
  - Components are marked dirty and flushed **once per tick, parents before children, with one DOM patch per flush**. The flush runs on a microtask after the reducer queue drains (MessageChannel fallback), **never on rAF** (the audit measured +7 ms per update with rAF).
  - Replaces the three per-component `debounce(1)` stages (`collectRenderParameters`, `renderVdom`, `instantiateCollection`) and the per-Collection `PickCombine.up()` per item emission.
  - The scheduler is **per app** (on the app's sources or IsolateModule), never module-global (G-231 lesson).
  - Rec 9: the DOM driver emits its root element from a snabbdom `post` hook instead of a subtree MutationObserver.
- PLAN-4 features to re-verify or simplify, each with its own tests kept green:
  - **GS-2 element commands** run after the patch: the flush must patch before the commands' microtask.
  - **G-213 / D138 removal hold** assumed one debounce task per Collection; with one flush per action, a cross-Collection move lands in one patch, so the hold may be removable. Its browser test (0 bad frames) decides.
  - **GS-12 View Transitions**: the 20 ms quiet window existed because a move was several patches; with one patch per action it shrinks to "the next flush". Its browser tests decide.
  - **G-146** input sequencing (`_inputSeq` captured at flush time), **B-003/B-013** state snapshots for non-STATE sinks, **GS-4** no-op, **D139** hydration, **persist** writes (debounced separately, unaffected).
  - **Testing**: `renderComponent`, `t.settle()`, `next()`, fake timers (`vi.useFakeTimers()`: E11). The waits must drive a microtask flush.
- Removes the per-update timer floor. Keystroke latency should approach CPU time.

### P45-D Lazy per-component wiring and synchronous teardown (L, medium-high risk, ≈ ±150 B)
- Rec 5:
  - Create the context, READY, children/slots, HMR, statics, peers, EFFECT and CHILD streams only when the component or a descendant uses them.
  - Isolate only the channels a Collection item uses (DOM, STATE, plus whatever its intent and model name).
  - Tear down a disposed subtree synchronously instead of one `setTimeout` per stream.
- Target ≤ 40 streams per simple item, ≤ 1,100 timers to unmount 1k.
- Touches DISPOSE timing, GS-1 `uses`, GS-5 persist setup and flush-on-dispose, GS-9 uid, reply actions (G-144), the devtools/diagnostics hooks and HMR.

### P45-E Optional: cheaper change detection (S)
- Rec 8, only if a profile after P45-C/D still shows `objIsEqual` above ~2%. GS-4 already made "same object = no change" the rule.

## 3. Gates

All PLAN-4 gates stay (§1.2 of PLAN-4: build, `npm test`, sygnal-check, doc samples, errors docs, docs build, size gate, a11y-clean, SSR determinism). Added:

| Count (hard gate; may only go down) | Now | After P45-A | After P45-C | After P45-D |
|---|---|---|---|---|
| DOM patches: select row, 1k Collection | 1,001 | 1,001 | ≤ 2 | ≤ 2 |
| DOM patches: update every 10th | 102 | 102 | ≤ 2 | ≤ 2 |
| DOM patches: leaf click 30 deep | 51 | 51 | ≤ 2 | ≤ 2 |
| Streams per Collection item | 151 | 151 | ≤ 151 | ≤ 40 |
| `setTimeout` calls, unmount 1k | 79,013 | 79,013 | ≤ 79,013 | ≤ 1,100 |
| Retained `ScopeChecker`s after 5×1k cycles | 5,000 | **0** | 0 | 0 |
| Heap after 5×1k Collection cycles minus ready (after teardown) | 8.8 MB | ≤ 2 MB | ≤ 2 MB | ≤ 1 MB |

Timing targets (warn-only, nightly; ratio to React in the same run): Collection select ≤ 5× (now 28×), mount 1k ≤ 3× (now 7×), leaf 30 deep ≤ 3× (now 13–16×), keystroke ≤ 2× (now 9×), single-component select ≤ 4× (now 16×). "Now" is P45-0's `perf-report` baseline, which waits for idle before each op (D150); the audit's no-wait figures were 70×, 11×, 15×, 9×, 13×.

**Size:** core at 41,343 B gated against 42,300 B. PLAN-4.5's net must be **≤ 0 B** (P45-B's savings pay for P45-A/C), so PLAN-5's ≈ 950 B headroom is preserved (§8 Q2).

## 4. Behaviour changes (CHANGELOG `[Unreleased]`)

| Change | Breaking? | Note |
|---|---|---|
| Renders flush once per tick instead of through per-component 1 ms debounces | Timing only | Apps or tests that waited a fixed 1–2 ms for a render keep working (a flush is sooner); code that relied on two components rendering in separate patches no longer sees an in-between DOM |
| Nested JSX prop objects passed by reference (P45-B) | **Maybe** (§8 Q3) | Mutating a `style` object after rendering it now affects the next diff |
| DOM driver re-emits on patches, not on outside DOM mutations (P45-C rec 9) | **Maybe** (§8 Q4) | Code that mutates the app's DOM outside Sygnal and expected an emission |
| Synchronous teardown (P45-D) | Timing only | DISPOSE effects run before the parent's next render |

## 5. Process

- PLAN-4's coordinator model, worktree rules, brief template, failing-first tests, file ownership and phase-close `/code-review high` apply unchanged.
- **Branch:** `plan45-integration` cut from `plan4-integration` after PLAN-4's 4-F; workstream branches `p45-<id>`.
- **Tracker:** `dev-plans/PLAN-4.5-status.md`. Decisions continue from **D150** and gaps from **G-250**, leaving room after PLAN-4.
- **Serial on the hot files:** P45-A touches `EventDelegator`, `component.ts` (two functions) and the DOM modules; P45-B owns `src/pragma/**` plus the fused walk in `component.ts`; P45-C and P45-D each own `component.ts`, `src/cycle/state/**` and `src/cycle/dom/**` in turn. P45-0 runs alongside P45-A.
- **Every merge:** the bench A/B (`benchmarks/audit`, React in the same run) recorded in the tracker, next to the size number.
- **Evals:** no new agent eval needed (no API change). Optional regression check after P45-D: Sygnal tiers 1–2 + ergo on Opus, about $30 (§8 Q5).
- **PLAN-5 handoff:** a note in `HANDOFF-to-PLAN-5.md` that PLAN-5 rebases onto `plan45-integration` and inherits the count gate.

## 6. Out of scope

- Replacing xstream or snabbdom; signals; a user-facing `memo`/`lazy` view API (audit "what to avoid").
- rAF-throttled patching.
- Micro-tuning `objIsEqual` or the debounce operator alone.
- Bulk-create optimisation (already competitive).

## 7. Risks

| Risk | Mitigation |
|---|---|
| The scheduler changes timing that PLAN-1…4 features rely on | P45-C lists every dependent feature (§2); their tests and browser tests must stay green; failing-first scheduler tests; A/B bench at merge |
| Lazy wiring breaks a rarely used source (CHILD, peers, HMR) | Each lazily created stream gets a test that uses it first in a child, then in a Collection item, then after HMR |
| Pragma reference semantics surprise apps | §8 Q3; a dev-only freeze or warning on mutated prop objects if the user wants it |
| Perf gate flaky in CI | The hard gate uses counts, not timings; timings are warn-only |
| Size budget | P45-B lands before P45-C; each merge reports bytes; net ≤ 0 B |

## 8. Decisions needed (recommendation first)

| # | Question | Recommendation |
|---|---|---|
| P45-Q1 | Run PLAN-4.5 as its own plan after PLAN-4 and before PLAN-5 | Yes (the user asked for performance before PLAN-5) |
| P45-Q2 | Size budget | Net ≤ 0 B for PLAN-4.5 as a whole |
| P45-Q3 | Nested JSX prop objects passed by reference (P45-B) | Accept (React, Vue and snabbdom do the same); CHANGELOG entry; no dev check |
| P45-Q4 | DOM driver emits from a post-patch hook, not a MutationObserver (rec 9) | Accept; outside-DOM mutations were never documented to re-render |
| P45-Q5 | Agent regression eval after P45-D (~$30) | Yes, tiers 1–2 + ergo on Opus only |
| P45-Q6 | Count gate in `npm test` (hard) and timing ratios nightly (warn) | As in §3 |
