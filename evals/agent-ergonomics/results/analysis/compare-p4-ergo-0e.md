# `p4-ergo-baseline` → `p4-final6-opus`

Source: analysis · arms sygnal · tasks ergo.

## sygnal: `p4-ergo-baseline:sygnal` → `p4-final6-opus:sygnal` (task-matched)

4 task(s) in both (20 → 20 trials). Matched mean = mean over the shared tasks of each task's mean; every task weighs the same.

| Metric (matched mean) | p4-ergo-baseline:sygnal | p4-final6-opus:sygnal | Δ | ratio | tasks |
|---|---|---|---|---|---|
| pass rate | 95% | 90% | -5% | — | 4 |
| wall (s) | 76.8 | 72.5 | -4.3 | 0.94× | 4 |
| cost ($) | 0.519 | 0.533 | +0.014 | 1.03× | 4 |
| billed tokens (k) | 371 | 401.7 | +30.7 | 1.08× | 4 |
| output tokens (k) | 7.96 | 7.64 | -0.31 | 0.96× | 4 |
| iterations | 3.05 | 2.2 | -0.85 | 0.72× | 4 |
| edit rounds | 2.3 | 1.5 | -0.8 | 0.65× | 4 |
| tool calls | 10.8 | 11.5 | +0.7 | 1.06× | 4 |
| peak context (k) | 42.2 | 45.1 | +3 | 1.07× | 4 |
| failed runs | 0.65 | 0.1 | -0.55 | 0.15× | 4 |
| LOC added | 197.9 | 195.1 | -2.7 | 0.99× | 4 |
| wrote a test | 100% | 100% | 0% | — | 4 |
| learn (s) | 17.6 | 19.2 | +1.6 | 1.09× | 4 |
| SYG104/110/124 hits | 0.15 | 0.1 | -0.05 | 0.67× | 4 |
| SYG104/110/124 in final code | 0% | 0% | 0% | — | 4 |
| wiring failures | 0% | 0% | 0% | — | 4 |
| test-authoring phase (s) | 17.5 | 17.2 | -0.3 | 0.98× | 4 |
| first test write → end (s) | 21.8 | 16 | -5.9 | 0.73× | 4 |
| test-tooling learn (s) | 0 | 0 | 0 | — | 4 |
| kept tests use Testing Library | 0% | 0% | 0% | — | 4 |
| SYG7xx in final code | 0 | 0 | 0 | — | 4 |
| used t.actions/inspect/explain | 0% | 0% | 0% | — | 4 |

| Task | trials | pass rate | Δ | wall (s) | Δ | learn (s) | Δ | peak context (k) | Δ | iterations | Δ | used t.actions/inspect/explain | Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 26-autosave-draft | 5 → 5 | 100% → 100% | 0% | 66.6 → 71.2 | +4.7 | 21.3 → 30.1 | +8.8 | 41 → 43.4 | +2.4 | 2.4 → 2 | -0.4 | 0% → 0% | 0% |
| 27-undo-editor | 5 → 5 | 100% → 80% | -20% | 65.7 → 78 | +12.3 | 11.9 → 21 | +9.2 | 38.1 → 48.5 | +10.4 | 2.6 → 2.2 | -0.4 | 0% → 0% | 0% |
| 28-stopwatch | 5 → 5 | 80% → 80% | 0% | 81.5 → 64.4 | -17.1 | 11.4 → 15 | +3.6 | 39.7 → 44 | +4.3 | 5.2 → 2.2 | -3 | 0% → 0% | 0% |
| 29-accessible-signup | 5 → 5 | 100% → 100% | 0% | 93.6 → 76.5 | -17.1 | 26 → 10.6 | -15.4 | 50 → 44.7 | -5.4 | 2 → 2.4 | +0.4 | 0% → 0% | 0% |
