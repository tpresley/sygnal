# `p4-final7-opus-ergo` → `p5-s14b-opus`

Source: analysis · arms sygnal · tasks ergo.

## sygnal: `p4-final7-opus-ergo:sygnal` → `p5-s14b-opus:sygnal` (task-matched)

4 task(s) in both (20 → 20 trials). Matched mean = mean over the shared tasks of each task's mean; every task weighs the same.

| Metric (matched mean) | p4-final7-opus-ergo:sygnal | p5-s14b-opus:sygnal | Δ | ratio | tasks |
|---|---|---|---|---|---|
| pass rate | 100% | 100% | 0% | — | 4 |
| wall (s) | 59.1 | 55.5 | -3.6 | 0.94× | 4 |
| cost ($) | 0.475 | 0.453 | -0.022 | 0.95× | 4 |
| billed tokens (k) | 286.6 | 259.8 | -26.9 | 0.91× | 4 |
| output tokens (k) | 6.2 | 5.97 | -0.23 | 0.96× | 4 |
| iterations | 2.45 | 2 | -0.45 | 0.82× | 4 |
| edit rounds | 1.75 | 1.55 | -0.2 | 0.89× | 4 |
| tool calls | 7.7 | 7.6 | -0.1 | 0.99× | 4 |
| peak context (k) | 43.1 | 42.8 | -0.3 | 0.99× | 4 |
| failed runs | 0.3 | 0.35 | +0.05 | 1.17× | 4 |
| LOC added | 170.8 | 163.1 | -7.7 | 0.95× | 4 |
| wrote a test | 100% | 100% | 0% | — | 4 |
| learn (s) | 9.8 | 9.7 | -0.1 | 0.99× | 4 |
| SYG104/110/124 hits | 0.05 | 0 | -0.05 | 0.00× | 4 |
| SYG104/110/124 in final code | 0% | 0% | 0% | — | 4 |
| wiring failures | 0% | 0% | 0% | — | 4 |
| test-authoring phase (s) | 15.8 | 15 | -0.8 | 0.95× | 4 |
| first test write → end (s) | 16.4 | 16.2 | -0.2 | 0.99× | 4 |
| test-tooling learn (s) | 0 | 0 | 0 | — | 4 |
| kept tests use Testing Library | 0% | 0% | 0% | — | 4 |
| SYG7xx in final code | 0 | 0 | 0 | — | 4 |
| used t.actions/inspect/explain | 0% | 0% | 0% | — | 4 |

| Task | trials | pass rate | Δ | wall (s) | Δ | learn (s) | Δ | peak context (k) | Δ | cost ($) | Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 26-autosave-draft | 5 → 5 | 100% → 100% | 0% | 52 → 52.4 | +0.4 | 14.4 → 14.8 | +0.5 | 43.2 → 43.1 | -0.2 | 0.486 → 0.45 | -0.037 |
| 27-undo-editor | 5 → 5 | 100% → 100% | 0% | 59.1 → 45.2 | -13.9 | 11.3 → 4.2 | -7.1 | 44.4 → 38.8 | -5.6 | 0.481 → 0.382 | -0.099 |
| 28-stopwatch | 5 → 5 | 100% → 100% | 0% | 53.8 → 45.3 | -8.5 | 2.5 → 2.7 | +0.2 | 39.3 → 37.9 | -1.3 | 0.407 → 0.382 | -0.025 |
| 29-accessible-signup | 5 → 5 | 100% → 100% | 0% | 71.4 → 79.1 | +7.7 | 11.2 → 17.3 | +6.1 | 45.5 → 51.3 | +5.7 | 0.525 → 0.599 | +0.073 |
