# `p3-v6-haiku` → `p4-final6-haiku`

Source: analysis · arms sygnal.

## sygnal: `p3-v6-haiku:sygnal` → `p4-final6-haiku:sygnal` (task-matched)

17 task(s) in both (105 → 85 trials). Only in p3-v6-haiku:sygnal: 22-chat-socket, 23-quote-resource, 24-list-detail-cache, 25-router-spa. Only in p4-final6-haiku:sygnal: 26-autosave-draft, 27-undo-editor, 28-stopwatch, 29-accessible-signup. Matched mean = mean over the shared tasks of each task's mean; every task weighs the same.

| Metric (matched mean) | p3-v6-haiku:sygnal | p4-final6-haiku:sygnal | Δ | ratio | tasks |
|---|---|---|---|---|---|
| pass rate | 79.4% | 77.6% | -1.8% | — | 17 |
| wall (s) | 160.8 | 150.8 | -9.9 | 0.94× | 17 |
| cost ($) | 0.301 | 0.293 | -0.008 | 0.97× | 17 |
| billed tokens (k) | 1396.5 | 1338.4 | -58.1 | 0.96× | 17 |
| output tokens (k) | 15.69 | 15.07 | -0.63 | 0.96× | 17 |
| iterations | 6.08 | 5.73 | -0.35 | 0.94× | 17 |
| edit rounds | 4.39 | 4 | -0.39 | 0.91× | 17 |
| tool calls | 30.3 | 28.2 | -2.1 | 0.93× | 17 |
| peak context (k) | 54 | 54.8 | +0.8 | 1.01× | 17 |
| failed runs | 2.34 | 1.79 | -0.55 | 0.77× | 17 |
| LOC added | 133.5 | 125.4 | -8.2 | 0.94× | 17 |
| wrote a test | 74.7% | 69.4% | -5.3% | — | 17 |
| learn (s) | 16.3 | 18.7 | +2.4 | 1.14× | 17 |
| test-authoring phase (s) | 9.8 | 9.7 | -0.1 | 0.99× | 17 |
| test-tooling learn (s) | 0 | 0 | 0 | — | 17 |
| kept tests use Testing Library | 0% | 0% | 0% | — | 17 |

| Task | trials | pass rate | Δ | wall (s) | Δ | learn (s) | Δ | peak context (k) | Δ |
|---|---|---|---|---|---|---|---|---|---|
| 01-clear-completed | 5 → 5 | 100% → 100% | 0% | 54.2 → 70.8 | +16.7 | 3.9 → 3.4 | -0.5 | 38.6 → 42.8 | +4.2 |
| 02-collection-pin | 10 → 5 | 70% → 60% | -10% | 60.7 → 79 | +18.3 | 5.9 → 7.6 | +1.8 | 41.3 → 44.4 | +3 |
| 03-events-status | 5 → 5 | 100% → 100% | 0% | 183.7 → 82.9 | -100.9 | 12.6 → 15.8 | +3.2 | 56.1 → 41.8 | -14.2 |
| 04-derived-total | 5 → 5 | 100% → 100% | 0% | 69.7 → 51.4 | -18.3 | 4.5 → 11.9 | +7.4 | 41.7 → 41.4 | -0.3 |
| 05-driver-quote | 5 → 5 | 100% → 100% | 0% | 71 → 67.5 | -3.4 | 10.7 → 10.4 | -0.3 | 41.5 → 43.3 | +1.9 |
| 06-fix-add-button | 5 → 5 | 100% → 100% | 0% | 46.5 → 26 | -20.5 | 4.3 → 2.4 | -1.9 | 37.2 → 34.1 | -3.1 |
| 07-fix-remove-button | 5 → 5 | 100% → 100% | 0% | 45.7 → 55.4 | +9.8 | 4.4 → 6.9 | +2.4 | 35.7 → 39.8 | +4.1 |
| 08-extract-rating | 5 → 5 | 80% → 100% | +20% | 67.3 → 59.2 | -8.1 | 24.7 → 7.1 | -17.6 | 39.7 → 40.3 | +0.5 |
| 09-board-moves | 5 → 5 | 100% → 100% | 0% | 136 → 188.3 | +52.3 | 16 → 27.1 | +11.1 | 55.9 → 65.6 | +9.7 |
| 10-signup-wizard | 10 → 5 | 50% → 60% | +10% | 283.4 → 259.3 | -24.1 | 16.9 → 18.4 | +1.5 | 65.4 → 68.9 | +3.5 |
| 11-search-debounce | 10 → 5 | 40% → 40% | 0% | 162.3 → 134.8 | -27.4 | 23.7 → 6.1 | -17.6 | 54.2 → 50.9 | -3.3 |
| 12-selection-panel | 5 → 5 | 100% → 80% | -20% | 363.4 → 313.7 | -49.7 | 29.8 → 41.8 | +12 | 79.9 → 77.1 | -2.8 |
| 13-course-portal | 5 → 5 | 80% → 20% | -60% | 344.3 → 324.2 | -20.1 | 31.7 → 28.6 | -3.1 | 80.9 → 84.5 | +3.6 |
| 14-fix-support-inbox | 5 → 5 | 40% → 60% | +20% | 90.5 → 145.4 | +54.8 | 3.4 → 12.3 | +8.9 | 43.9 → 52.5 | +8.6 |
| 15-fix-reading-list | 5 → 5 | 100% → 100% | 0% | 355.6 → 289.5 | -66.2 | 25.2 → 44 | +18.7 | 80.2 → 74.6 | -5.6 |
| 16-split-checkout | 5 → 5 | 60% → 100% | +40% | 194.1 → 215.5 | +21.4 | 17 → 37.3 | +20.3 | 64.4 → 65.1 | +0.7 |
| 17-address-lookup | 10 → 5 | 30% → 0% | -30% | 204.7 → 201.4 | -3.3 | 43.2 → 36.7 | -6.5 | 61.7 → 63.9 | +2.2 |
