# `p4-final6-gs14-a` → `p4-final6-gs14-b`

Source: analysis · arms sygnal.

## sygnal: `p4-final6-gs14-a:sygnal` → `p4-final6-gs14-b:sygnal` (task-matched)

3 task(s) in both (15 → 15 trials). Matched mean = mean over the shared tasks of each task's mean; every task weighs the same.

| Metric (matched mean) | p4-final6-gs14-a:sygnal | p4-final6-gs14-b:sygnal | Δ | ratio | tasks |
|---|---|---|---|---|---|
| pass rate | 100% | 100% | 0% | — | 3 |
| wall (s) | 55.9 | 57.9 | +2 | 1.04× | 3 |
| cost ($) | 0.431 | 0.44 | +0.009 | 1.02× | 3 |
| billed tokens (k) | 263.8 | 291.3 | +27.4 | 1.10× | 3 |
| output tokens (k) | 5.74 | 6.16 | +0.41 | 1.07× | 3 |
| iterations | 2 | 1.93 | -0.07 | 0.97× | 3 |
| edit rounds | 1.4 | 1.6 | +0.2 | 1.14× | 3 |
| tool calls | 8.4 | 9.7 | +1.3 | 1.16× | 3 |
| peak context (k) | 38.8 | 39.9 | +1.1 | 1.03× | 3 |
| failed runs | 0.07 | 0.27 | +0.2 | 4.00× | 3 |
| LOC added | 151.8 | 161.2 | +9.4 | 1.06× | 3 |
| wrote a test | 100% | 100% | 0% | — | 3 |
| learn (s) | 7.7 | 7.5 | -0.1 | 0.98× | 3 |
| SYG104/110/124 hits | 0.13 | 0.13 | 0 | 1.00× | 3 |
| SYG104/110/124 in final code | 0% | 0% | 0% | — | 3 |
| wiring failures | 0% | 0% | 0% | — | 3 |
| test-authoring phase (s) | 12.6 | 14.4 | +1.9 | 1.15× | 3 |
| first test write → end (s) | 16.1 | 15.6 | -0.4 | 0.97× | 3 |
| test-tooling learn (s) | 0 | 0 | 0 | — | 3 |
| kept tests use Testing Library | 0% | 73.3% | +73.3% | — | 3 |
| SYG7xx in final code | 0 | 0 | 0 | — | 3 |
| used t.actions/inspect/explain | 0% | 0% | 0% | — | 3 |

| Task | trials | pass rate | Δ | wall (s) | Δ | first test write → end (s) | Δ | test-authoring phase (s) | Δ | test-tooling learn (s) | Δ | kept tests use Testing Library | Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 03-events-status | 5 → 5 | 100% → 100% | 0% | 24.5 → 23.5 | -1 | 7 → 7.3 | +0.3 | 4.1 → 4.5 | +0.4 | 0 → 0 | 0 | 0% → 20% | +20% |
| 10-signup-wizard | 5 → 5 | 100% → 100% | 0% | 52.8 → 62.3 | +9.5 | 11.3 → 18.9 | +7.6 | 13 → 13.8 | +0.8 | 0 → 0 | 0 | 0% → 100% | +100% |
| 29-accessible-signup | 5 → 5 | 100% → 100% | 0% | 90.4 → 87.7 | -2.6 | 29.9 → 20.7 | -9.2 | 20.6 → 25 | +4.4 | 0 → 0 | 0 | 0% → 100% | +100% |
