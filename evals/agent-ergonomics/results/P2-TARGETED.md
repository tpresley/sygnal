# Phase 2 targeted eval: `p2-targeted` vs `v2-baseline`

**Setup**
- Sygnal arm only, tasks 08, 10 and 11, 5 trials each, `claude-opus-5-5`, headless runner.
- Sygnal is the `plan2-integration` build after Phase 2 (2-A testing, 2-B docs, 2-C/2-D/2-R fixes), with the branch skill installed.
- React is unchanged, so the React numbers are the baseline's.
- 15/15 pass, $5.58.

| Task | Sygnal 5.4.0 (baseline) | Sygnal Phase 2 | Change | React | Gap before → after |
|---|---|---|---|---|---|
| 08 extract-rating | 41.8 s, 4.8 iterations | **27.0 s, 2.0 iterations** | −14.8 s (−35%) | 21.0 s | 20.8 → **6.0 s** |
| 10 signup-wizard | 64.6 s, 2.4 iterations | 57.1 s, 1.8 iterations | −7.5 s | 42.9 s | 21.7 → 14.2 s |
| 11 search-debounce | 57.4 s, 1.4 iterations | 58.2 s, 1.8 iterations | +0.8 s | 37.3 s | 20.1 → 20.9 s |
| Mean | 54.6 s | 47.4 s | −7.2 s | 33.7 s | 20.9 → 13.7 s |

**Reading** (n = 5 per task; differences under about 5 s are within noise):
- **Task 08:** the extract-component recipe (2-D2) works. Iterations fall from 4.8 to 2.0, and the gap to React shrinks by about 70%.
- **Task 10:** improved, probably from the 2-A testing changes and the D49 form semantics.
- **Task 11:** unchanged. The latest-only pattern doc (2-D3) did not shorten it. That leaves it to E3 (a latest-only helper) and E11 (fake timers for debounce tests).
- **Learn time** across the three tasks: 6.7 → 3.6 s per trial.
- **Debug time** rose slightly, from 1.1 to 2.2 s, mostly on task 11. It should be watched in Phase 3.

`analysis/compare.mjs` compared this 3-task run with the baseline's 17-task mean, which gives a misleading +2.5 s. The table above is task-matched (G-119).
