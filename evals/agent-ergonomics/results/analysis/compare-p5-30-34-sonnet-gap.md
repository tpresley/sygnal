# `p5-final-sonnet:react` → `p5-final-sonnet:sygnal`

Source: analysis.

## react → sygnal: `p5-final-sonnet:react` → `p5-final-sonnet:sygnal` (task-matched)

5 task(s) in both (25 → 25 trials). Matched mean = mean over the shared tasks of each task's mean; every task weighs the same.

| Metric (matched mean) | p5-final-sonnet:react | p5-final-sonnet:sygnal | Δ | ratio | tasks |
|---|---|---|---|---|---|
| pass rate | 92% | 96% | +4% | — | 5 |
| wall (s) | 26.5 | 37.9 | +11.4 | 1.43× | 5 |
| cost ($) | 0.085 | 0.217 | +0.132 | 2.56× | 5 |
| billed tokens (k) | 61.7 | 193.2 | +131.5 | 3.13× | 5 |
| output tokens (k) | 3.46 | 4.53 | +1.07 | 1.31× | 5 |
| iterations | 1.44 | 2.4 | +0.96 | 1.67× | 5 |
| edit rounds | 1.36 | 2.36 | +1 | 1.74× | 5 |
| tool calls | 3.4 | 5.8 | +2.4 | 1.72× | 5 |
| peak context (k) | 16.6 | 40.8 | +24.2 | 2.46× | 5 |
| failed runs | 0.2 | 0.6 | +0.4 | 3.00× | 5 |
| LOC added | 113.8 | 105 | -8.8 | 0.92× | 5 |
| wrote a test | 16% | 100% | +84% | — | 5 |
| learn (s) | 0 | 4.9 | +4.9 | — | 5 |
| test-authoring phase (s) | 0.8 | 2.6 | +1.8 | 3.23× | 5 |
| first test write → end (s) | 9.2 | 8 | -1.2 | 0.87× | 1 |
| test-tooling learn (s) | 0 | 0 | 0 | — | 5 |
| kept tests use Testing Library | 0% | 0% | 0% | — | 5 |

| Task | trials | pass rate | Δ | wall (s) | Δ | learn (s) | Δ | peak context (k) | Δ | cost ($) | Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 30-checkout-form | 5 → 5 | 100% → 80% | -20% | 32.1 → 62 | +29.9 | 0 → 11.4 | +11.4 | 17.9 → 41.5 | +23.6 | 0.1 → 0.266 | +0.166 |
| 31-command-menu | 5 → 5 | 100% → 100% | 0% | 14.8 → 34.9 | +20.1 | 0 → 0.7 | +0.7 | 14.2 → 35.7 | +21.5 | 0.057 → 0.186 | +0.129 |
| 32-sales-chart | 5 → 5 | 100% → 100% | 0% | 18.9 → 40.9 | +21.9 | 0 → 5.1 | +5.1 | 16.4 → 44.9 | +28.4 | 0.076 → 0.247 | +0.171 |
| 33-virtual-list | 5 → 5 | 100% → 100% | 0% | 26.2 → 30.8 | +4.6 | 0 → 3.4 | +3.4 | 16 → 40 | +23.9 | 0.08 → 0.19 | +0.11 |
| 34-sortable-playlist | 5 → 5 | 60% → 100% | +40% | 40.4 → 20.9 | -19.5 | 0 → 3.7 | +3.7 | 18.5 → 42.1 | +23.6 | 0.112 → 0.196 | +0.084 |
