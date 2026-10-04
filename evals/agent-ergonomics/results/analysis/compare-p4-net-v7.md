# `p3-v7` → `p4-final6-opus`

Source: analysis · arms sygnal · tasks 23-25.

## sygnal: `p3-v7:sygnal` → `p4-final6-opus:sygnal` (task-matched)

3 task(s) in both (15 → 15 trials). Matched mean = mean over the shared tasks of each task's mean; every task weighs the same.

| Metric (matched mean) | p3-v7:sygnal | p4-final6-opus:sygnal | Δ | ratio | tasks |
|---|---|---|---|---|---|
| pass rate | 100% | 100% | 0% | — | 3 |
| wall (s) | 80.3 | 74.7 | -5.7 | 0.93× | 3 |
| cost ($) | 0.553 | 0.524 | -0.029 | 0.95× | 3 |
| billed tokens (k) | 400.9 | 374.3 | -26.6 | 0.93× | 3 |
| output tokens (k) | 8.22 | 7.59 | -0.62 | 0.92× | 3 |
| iterations | 2.33 | 2.47 | +0.13 | 1.06× | 3 |
| edit rounds | 2.07 | 2.2 | +0.13 | 1.06× | 3 |
| tool calls | 10.1 | 9.1 | -1 | 0.90× | 3 |
| peak context (k) | 44.5 | 44.6 | +0.1 | 1.00× | 3 |
| failed runs | 0.47 | 0.33 | -0.13 | 0.71× | 3 |
| LOC added | 183.1 | 172.9 | -10.1 | 0.94× | 3 |
| wrote a test | 100% | 100% | 0% | — | 3 |
| learn (s) | 16.5 | 15.9 | -0.6 | 0.96× | 3 |
| test-authoring phase (s) | 17.2 | 17 | -0.2 | 0.99× | 3 |
| test-tooling learn (s) | 0 | 0 | 0 | — | 3 |
| kept tests use Testing Library | 0% | 0% | 0% | — | 3 |

| Task | trials | pass rate | Δ | wall (s) | Δ | learn (s) | Δ | peak context (k) | Δ | cost ($) | Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 23-quote-resource | 5 → 5 | 100% → 100% | 0% | 42.1 → 39.6 | -2.5 | 3.1 → 2.5 | -0.6 | 33.3 → 34.8 | +1.4 | 0.36 → 0.339 | -0.022 |
| 24-list-detail-cache | 5 → 5 | 100% → 100% | 0% | 116.2 → 107.2 | -9 | 30.8 → 30.6 | -0.2 | 55.7 → 54.3 | -1.4 | 0.74 → 0.701 | -0.039 |
| 25-router-spa | 5 → 5 | 100% → 100% | 0% | 82.7 → 77.3 | -5.5 | 15.6 → 14.5 | -1.1 | 44.5 → 44.7 | +0.2 | 0.558 → 0.531 | -0.027 |
