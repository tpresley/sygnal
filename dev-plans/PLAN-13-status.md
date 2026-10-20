# PLAN-13 Status Tracker

Tracks progress for [PLAN-13.md](PLAN-13.md) (feedback from building Temper on Sygnal 7.0).

**Numbering:** a reserved block, decisions **D600–D649**, gaps **G-900–G-949**.

**Integration branch:** `claude/plan-13-sygnal-29fa20` (this session's worktree branch; the plan's `claude/plan-13-temper-feedback` name was not used), cut from `main` 8e2c4600.

**State:** in progress (2026-10-19): R-1 done.

## Decisions

| # | Date | Decision |
|---|---|---|
| D600 | 2026-10-19 | Fix the confirmed feedback items except the "no change needed" group (user) |
| D601 | 2026-10-19 | Spikes allowed where design or cost is unclear; outcome recorded before production work (user) |

## Items

| Item | Feedback | Phase | Spike | State | Notes |
|---|---|---|---|---|---|
| R-1 | #36 invalidation / navigation race | 1 | SP-R1 (optional) | done | `load()` stops when `R.q` changed or paused after its write; `test/p13-r1-invalidation-race.test.js` (lens / key / root × prefix / tag / refresh, two resources); SP-R1 probe below; core bytes: 0 (fetch driver only, see size gate) |
| N-1 | #45 `next()` with no entry here | 2 | — | todo | dev warning + checker rule |
| C-1 | #25, #43 reply names via helpers / consts | 2 | — | todo | |
| C-2 | SYG256 missed the leave-guard | 2 | — | todo | |
| T-1 | #44 Google Fonts, no `.gitignore` | 2 | — | todo | |
| X-1 | #34 `import xs from 'xstream'` | 2 | — | todo | docs + checker hint |
| D-1 | #32 reply helpers for custom drivers | 2 | SP-D1 (optional) | todo | |
| S-1 | #41, #42, #28 SSE meta / resume / staleAfterMs | 2 | SP-S1 (optional) | todo | |
| F-1 | #37 statics see context | 3 | SP-F1 (recommended) | todo | needs go-ahead after spike |
| F-2 | #38 deep-link tests start on the real route | 3 | SP-F2 (optional) | todo | |
| C-3 | #26 `next()` in an imported helper | 3 | — | todo | |
| C-4 | #33 custom reply keys (`replyKeys`) | 3 | — | todo | |
| F-3 | #35 per-page Switchable state | 3 | SP-F3 (recommended) | todo | after F-1 |

## Spikes

| Spike | Question | Report | Outcome |
|---|---|---|---|
| SP-R1 | other re-entrant paths in the fetch driver | inline (no branch): the driver was instrumented to log every stale `load()` and every `resources` declaration nested inside another's loop, then the whole library suite and the R-1 tests ran | the guard fires only in the lens / key invalidation cases; no nested `resources` loop anywhere; `inval` and the focus / reconnect loop read `R.q` per resource, so after a nested reload they refetch the *new* request (redundant at worst, G-900); `upd` writes data only (no send). No further fix |

## Gaps

| # | Gap |
|---|---|
| G-900 | A root-level page (and a resource reloaded before the invalidation loop reaches it) whose `ok` action navigates gets the new request twice: the navigation sends it, then the invalidation refetches it (same request, the first one cancelled). Correct but wasteful; skipping a resource whose read started after the write's reply would also need the cache's stale-marking of that fetch rethought. Not fixed |
