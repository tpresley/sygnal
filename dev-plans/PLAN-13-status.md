# PLAN-13 Status Tracker

Tracks progress for [PLAN-13.md](PLAN-13.md) (feedback from building Temper on Sygnal 7.0).

**Numbering:** a reserved block, decisions **D600–D649**, gaps **G-900–G-949**.

**Integration branch:** `claude/plan-13-temper-feedback`, cut from `main` 97b7e285.

**State:** planned 2026-10-19; nothing started.

## Decisions

| # | Date | Decision |
|---|---|---|
| D600 | 2026-10-19 | Fix the confirmed feedback items except the "no change needed" group (user) |
| D601 | 2026-10-19 | Spikes allowed where design or cost is unclear; outcome recorded before production work (user) |

## Items

| Item | Feedback | Phase | Spike | State | Notes |
|---|---|---|---|---|---|
| R-1 | #36 invalidation / navigation race | 1 | SP-R1 (optional) | todo | fix verified in a scratch copy |
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

## Gaps

| # | Gap |
|---|---|
