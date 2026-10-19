# PLAN-12 F1–F8 implementation

Status: F1–F8 complete. All release gates pass, including the explicitly approved 43,000 B size gate. Runtime built and both npm links refreshed and independently verified from a fresh consumer. This report supplements the preserved [original review](plan12-final-review/README.md), whose failing counts describe the pre-fix candidate. Nothing is published.

## Coordinated lifetime correction (F1/F6/F7)

Known binding owners participate in the existing post-action notification pass, before the next queued action runs. Presence loss ends the old child or host lifetime even when the owner is hidden, or deletion and reinsertion happen before a render. Disposed queued actions are skipped; old effects, replies and delayed next calls cannot write into the replacement. The deleting action itself still completes its sinks.

Cleanup reads the last owned state, including edits made since the previous render. Its STATE writes cannot resurrect an absent target. Whole Collection and VirtualCollection sources retain raw presence information before array normalization. False, zero and null remain present values. Initially missing bindings can still initialize normally. Hidden replacement instances start when their owner next reconciles; hidden views are not forced to render.

This uses the existing known path/byId contract and internal owner notifications. Arbitrary custom lenses still need explicit keys or conditional mounting to express a new lifetime. No public API was added.

Permanent regressions include `test/p12-hidden-binding.test.js`, `test/p12-queued-parent-loss.test.js`, `test/p12-between-render-loss.test.js`, and `test/p12-lifetime-cleanup.test.js`. Independent review additionally checked cleanup after an unrendered edit and whole-source path/byId loss.

## Timing, recipes and testing (F2/F3/F8)

The mixed-timing EFFECT adapter restores the runtime-owned signal after restoring before-snapshot props. Tests cover both contributor orders, the state snapshots and disposal cancellation, alongside existing grouped exception coverage.

The published tabs CLOSE recipe computes its neighboring tab from `previousState.files`. Four real-DOM tests execute the actual documented model and verify focus after closing first, middle and final positions, plus the empty result.

Testing timeouts from next/waitForState now include pending simulated-input counts, matching settle. Eight cases cover mock and real modes, both waits, exact held-queue counts and no-backlog behavior. Documentation distinguishes serialized simulated inputs from synchronous native bursts and explains timeoutMs/eventWaitMs without changing scheduling or adding an API.

## Conservative checker proof (F4/F5)

SYG256 keeps supported STATE branch preconditions and excludes impossible paths or output guards already rejecting the pre-state. The original idle-to-working self-blocking output still warns. Prototype-bearing option objects and their spreads cannot prove inherited timing. An adjacent spread-element crash in SYG255 is also covered and fixed.

Checker verification: 1,723 tests passed, four skipped; generated explanations and diagnostic docs refreshed. Installed-version and effective-timing behavior remains covered. VS Code type/unit/build, four installed-app smoke scenarios, extension packaging and Claude plugin tests pass with the current checker.

## Focused correctness and performance

The final source candidate passes 165 focused tests across 21 files. The original exact-source review runner passes all 12 regressions/controls; the checker/tabs probe now reports no false positives and emits the after-mode focus command.

Seven interleaved baseline/candidate runs of 150,000 operations give median changes of −0.23% for unchanged bindings, +4.29% for nested edits and +5.23% for target switches. Duplicate notifications at the same app state version are skipped; distinct queued writes still notify separately. The unchanged-binding acceptance guard passes. The switch-path overhead is measured and accepted as the cost of ending the old lifetime. Raw measurements and focused logs are in [the lifetime report](plan12-final-review/lifetime-fix.md).

The normal post-build size gate independently confirms **42,993 B gzip**. The user explicitly approved raising the limit from 42,950 B to **43,000 B** on 2026-10-19 (Pacific/Honolulu), after reviewing the overage; the normal gate now passes with **7 B headroom**. The initial approval question measured 42,977 B; the final notification-cache optimization measured 42,993 B and was disclosed before approval. Default bundle: **38,984 B**; core alone: **50,601 B minified / 18,816 B gzip**.

## Final acceptance

Standard 24-configuration runtime build and declaration bundle pass. The final library suite passes **5,099 tests**, 33 skipped, across 459 passing files; All 14 example suites and both source/public type checks pass. Main browser suite: **377/377 passed**; native/no-support/polyfill WebMCP and all six graph-page suites pass. Count/performance/retention gate passes: one DOM patch, one stream per item, two unmount timers, zero retained ScopeCheckers, and **0.93 MB** settled heap growth against the 1.00 MB limit. The complete `npm test` exits zero. All 854 strict documentation samples are clean (26 marker-skipped; zero strict/a11y/pattern/parser findings), generated diagnostic docs and offline guide freshness pass, skill validation and git diff whitespace checks pass.

The official `release-smoke.mjs --local` gate passes **all ten packed templates**, using Sygnal 7.0.0, sygnal-check 0.11.0 and create-sygnal-app 2.9.0 tarballs. Each passes tests, strict checker and build; all five TypeScript templates pass type checks. Both Vike templates pass browser hydration/navigation checks without reload or browser errors. Logs: `/private/tmp/sygnal-p11-final-release-smoke.log` and its matching directory.

Docs build passes 112 pages, checks links across 113 pages, and validates code titles. **117/117 live demos pass in each of Chromium, Firefox and WebKit**. Editor installed-app smoke passes all four scenarios; 18 unit tests and type/build/package gates pass; Claude plugin 12/12 pass. The VSIX contains the revised checker.

Both global npm module links were refreshed after approval: runtime **7.0.0** and checker **0.11.0** resolve to this checkout. Fresh consumer `/private/tmp/sygnal-p11-linked-final-0T4weo` successfully runs `npm link sygnal sygnal-check`, loads runtime run/renderComponent exports, and executes its local checker CLI. The original self-blocking guard reports exactly SYG256 using installed Sygnal 7 timing; no checker internal error appears. Checker is source JavaScript and has no build step. Its global module registration uses `--bin-links=false` because the global bin directory is not writable; consumer linking successfully creates the local executable used by npx. Link logs: `/private/tmp/sygnal-p11-final-link-{runtime,checker}.log`.

No implementation acceptance work remains. Nothing was published or committed. The changelog retains its Unreleased heading; date it during the maintainer’s actual release preparation.

Primary gate logs are `/private/tmp/sygnal-p11-final-{build,npm-test,size,doc-samples}.log`, `/private/tmp/sygnal-p11-final-docs-{build,chromium,firefox,webkit}.log`, `/private/tmp/sygnal-p11-f4f5-checker-final.log`, `/private/tmp/sygnal-p11-final-editor.log`, `/private/tmp/sygnal-p11-final-vsix.log` and `/private/tmp/sygnal-p11-final-claude-plugin.log`. The original runtime reproductions pass 12/12 in `/private/tmp/sygnal-p11-final-original-repros.log`. Keep actual measured results and any approval decision here before marking M-10 complete.

## Repository cleanup before commit

Temporary spike runners, prototype patches, duplicate review fixtures and raw logs were archived to `/private/tmp/sygnal-plan12-cleanup-twgoiuo7` and removed from the checkout. The generated 0.8.0 VSIX was archived there too. Reports and compact measurement JSON remain as design evidence; maintained regression tests live in the normal test suites. Runtime builds and local npm links remain available.
