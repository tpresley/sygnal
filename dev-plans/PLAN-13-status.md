# PLAN-13 Status Tracker

Tracks progress for [PLAN-13.md](PLAN-13.md) (feedback from building Temper on Sygnal 7.0).

**Numbering:** a reserved block, decisions **D600–D649**, gaps **G-900–G-949**.

**Integration branch:** `claude/plan-13-sygnal-29fa20` (this session's worktree branch; the plan's `claude/plan-13-temper-feedback` name was not used), cut from `main` 8e2c4600.

**State:** in progress (2026-10-19): R-1, N-1, C-1, C-2, T-1, X-1, D-1, S-1 done (Phase 2 complete); SP-F1 and SP-F3 run, F-1 and F-3 done (user's go-ahead, D603 / D604); all items done (Phase 3 with the user's go-ahead); full gate and PR next.

## Decisions

| # | Date | Decision |
|---|---|---|
| D600 | 2026-10-19 | Fix the confirmed feedback items except the "no change needed" group (user) |
| D601 | 2026-10-19 | Spikes allowed where design or cost is unclear; outcome recorded before production work (user) |
| D602 | 2026-10-19 | C-1: an object argument of a returned call is a request's options when it has a reply key, whatever the callee (a non-sygnal `decide({ ok })` included; g648's test updated). A real SYG102 hidden this way needs a returned call that takes `{ ok: 'X' }` and never sends a request: judged unlikely next to the helper pattern's false SYG102s |
| D603 | 2026-10-19 | F-1: variant A (re-run statics on a changed context object), after a benchmark showed no performance case for per-key tracking (user: "default to A unless the results strongly suggest B") |
| D604 | 2026-10-19 | F-3: build the per-page `state` map (user prefers it to the wrapper page); ask about the size budget if it doesn't fit |

## Items

| Item | Feedback | Phase | Spike | State | Notes |
|---|---|---|---|---|---|
| R-1 | #36 invalidation / navigation race | 1 | SP-R1 (optional) | done | `load()` stops when `R.q` changed or paused after its write; `test/p13-r1-invalidation-race.test.js` (lens / key / root × prefix / tag / refresh, two resources); SP-R1 probe below; core bytes: 0 (fetch driver only, see size gate) |
| N-1 | #45 `next()` with no entry here | 2 | — | done | SYG117 (warn): dev entry `onNext` in `checks/next.ts` (names the nearest ancestor with the entry, did-you-mean) and sygnal-check `rules/syg117-next-without-entry.js` (render-graph ancestors, rename fix); 0 production bytes; tests `test/diagnostics/p13-n1-next-without-entry.test.js`, `sygnal-check/test/p13-n1-next.vtest.js` |
| C-1 | #25, #43 reply names via helpers / consts | 2 | — | done | `modelEntries.js`: `returnedObjects` follows returned identifiers and takes a returned call's object arguments with a reply key (any callee, D602); `connectionNames` follows consts in value position (specs, `events`, returns, spreads); `sygnal-check/test/p13-c1-reply-helpers.vtest.js` |
| C-2 | SYG256 missed the leave-guard | 2 | — | done | `writes()` allows calls / functions only inside a leaf object's plain property value (that field is UNKNOWN); tests, spreads, computed keys, assignments still abort; Temper shape + 8 cases in `p12-output-guard.vtest.js`; no new findings in examples or docs samples |
| T-1 | #44 Google Fonts, no `.gitignore` | 2 | — | done | fonts links removed (6 templates), `'Inter'` out of all font stacks (10 style files → system stack); `template-*/gitignore` renamed to `.gitignore` at the root by `copyDir`; tests in `test/create-sygnal-app-templates.test.js`; `release-smoke.mjs` checks both |
| X-1 | #34 `import xs from 'xstream'` | 2 | — | done | SYG302 (info, static only): `rules/syg302-xstream-default-import.js`, `--fix` into the file's sygnal import; accessibility.md sample fixed; custom-drivers note; llms.txt / skill line; `sygnal-check/test/p13-x1-xstream-import.vtest.js` (p9-d471's fix fixture now also loses its xstream import) |
| D-1 | #32 reply helpers for custom drivers | 2 | SP-D1 (optional, not run) | done | `makeReplies`, `senderOf` exported from `sygnal` (tree-shaken: 0 B in apps that don't import them), types `ReplySender` / `ReplyChannel` in `index.d.ts`, `type-tests/p13-d1-replies.ts`; guide section + API reference; `test/p13-d1-reply-helpers.test.js` (progress ×2 then ok, error, per-Collection-item delivery, onStop abort, SYG112). SP-D1 skipped: a `defineDriver({ replies })` wrapper only saves the spread, and declaring keys to sygnal-check is C-4's question (`replyKeys`) |
| S-1 | #41, #42, #28 SSE meta / resume / staleAfterMs | 2 | SP-S1 (optional, not run) | done | `socketDriver.ts`: per-entry `meta`, per-transport last id (`resume`: URL parameter for EventSource, `init.lastEventId` → `Last-Event-ID` in FetchEventSource), `staleAfterMs` timer (smallest over subscribers, re-armed by events, `onbeat` from the SSE parser's reads); fake: `t.push(…, { id })`, resumed URLs keyed to their connection; types `SseEvent`, `meta` / `resume` / `staleAfterMs`, `SocketClose.stale`; `test/p13-s1-sse-resume.test.js` (12). SP-S1 skipped: the behaviour rests on documented EventSource / fetch semantics; a real-proxy check is G-901 |
| F-1 | #37 statics see context | 3 | SP-F1 (done) | done | D603 (variant A): `checkStatics` passes `inst.context()` and re-runs on a changed context object; behaviors' timers accessor forwards it; SSR `contextOf()` for `resources` / `head`; types (second parameter of the five statics), `type-tests/p13-f1-statics-context.tsx`; sygnal-check `staticContextReads` → SYG170; docs (router, resources, timers, sockets, head), llms.txt / skill; `test/p13-f1-statics-context.test.js`, `sygnal-check/test/p13-f1-static-context.vtest.js`; core +19 B |
| F-2 | #38 deep-link tests start on the real route | 3 | SP-F2 (optional, not run) | done | tests only (`renderComponent`): with the router fake and a string `route`, the root's route entry's STATE reducer applies `url`'s route to the initial state before start (the first attempt dispatched the whole entry and doubled a guard's redirect); `test/p13-f2-route-seed.test.js`; testing guide, llms.txt / skill. The core-level variant for apps (SP-F2) is left out: apps already seed `router.current()` in `initialState` |
| C-3 | #26 `next()` in an imported helper | 3 | — | done | `modelEntries.js` `passOn`: a call that passes a `next` name maps it to the callee's parameter (resolved across files) and scans the callee's body in its own file, 3 calls deep; an unreadable callee adds a dynamic next (SYG102 → info); targets de-duplicated by node. The LSP rebuilds the folder's model per check (only parses are cached), so a helper edit re-checks its callers (tested). `sygnal-check/test/p13-c3-next-helpers.vtest.js` |
| C-4 | #33 custom reply keys (`replyKeys`) | 3 | — | done | `config.js` key (array or sink → array of key names, validated, SYG900 otherwise), passed to the project (`checkFiles`, graph, live/LSP); `replyNames` adds the sink's custom keys and collects UPPER_CASE values under unknown keys; SYG102 on such an entry is info with a `replyKeys` fix (never silent); editors guide, README, custom-drivers guide; `sygnal-check/test/p13-c4-reply-keys.vtest.js` (incl. the LSP) |
| F-3 | #35 per-page Switchable state | 3 | SP-F3 (done) | done | D604: the map (`mapOf`: an object with no `get`), a cell per listed page (`bind()`), per-page remake on `bindingChanged`, a deleted target disposed through the owner's own `watch()` / `notify()` (shared with tag children) and remade in `setProps`; SYG429 (dev `switchableMaps` on the owner's template, sygnal-check `rules/syg429-switchable-state-map.js`); types (`SwitchableProps<PROPS, OF>`, `NoInfer`, `ElementProps` keeps Switchable's `state`), `type-tests/p13-f3-switchable-map.tsx`; Switchable guide, llms.txt / skill; `test/p13-f3-switchable-map.test.js`, `sygnal-check/test/p13-f3-switchable-map.vtest.js`; core +126 B (42,982 B with F-1: 18 B headroom) |

## Spikes

| Spike | Question | Report | Outcome |
|---|---|---|---|
| SP-F1 | statics see context: which statics, skip condition, cost | [p13-f1](research/p13-f1/README.md), branch `exp/p13-f1` | all function statics get `(state, context)`; re-run on a changed context object (A, +19 B) vs per-key read tracking (B, +65 B); **recommend A**; decision pending (user) |
| SP-F3 | per-page Switchable state map: lifetime, cost | [p13-f3](research/p13-f3/README.md), branch `exp/p13-f3` | map works with 7.0's per-page remake, +94 B before presence handling / checks; a one-line wrapper page does the same at 0 B; **recommend docs only**; decision pending (user) |
| SP-R1 | other re-entrant paths in the fetch driver | inline (no branch): the driver was instrumented to log every stale `load()` and every `resources` declaration nested inside another's loop, then the whole library suite and the R-1 tests ran | the guard fires only in the lens / key invalidation cases; no nested `resources` loop anywhere; `inval` and the focus / reconnect loop read `R.q` per resource, so after a nested reload they refetch the *new* request (redundant at worst, G-900); `upd` writes data only (no send). No further fix |

## Gaps

| # | Gap |
|---|---|
| G-900 | A root-level page (and a resource reloaded before the invalidation loop reaches it) whose `ok` action navigates gets the new request twice: the navigation sends it, then the invalidation refetches it (same request, the first one cancelled). Correct but wasteful; skipping a resource whose read started after the write's reply would also need the cache's stale-marking of that fetch rethought. Not fixed |
| G-901 | S-1's half-open handling is tested with fakes only (SP-S1 not run): a real browser behind the Vite dev proxy, in the three engines, would confirm that `staleAfterMs` fires on a silent half-open stream and that each engine's EventSource gives up on a proxy 502 as the fakes do |
| G-902 | Temper's trial of the merged build (2026-10-20) found four follow-ups, fixed on `claude/plan-13-followups`: SYG106 on Switchable map pages (the props check now skips the `state` part for pages), the CLI ignoring `replyKeys` (four option objects in `cli.js`), `resume` duplicating an existing URL parameter (replaced now; the fake matches it), and `every` ticks stretching under a frozen `Date.now()` (a delay is capped at `every`) |
