# `p5-final-haiku:react` → `p5-final-haiku:sygnal`

Source: analysis.

## react → sygnal: `p5-final-haiku:react` → `p5-final-haiku:sygnal` (task-matched)

5 task(s) in both (25 → 25 trials). Matched mean = mean over the shared tasks of each task's mean; every task weighs the same.

| Metric (matched mean) | p5-final-haiku:react | p5-final-haiku:sygnal | Δ | ratio | tasks |
|---|---|---|---|---|---|
| pass rate | 36% | 20% | -16% | — | 5 |
| wall (s) | 256.7 | 315.2 | +58.5 | 1.23× | 5 |
| cost ($) | 0.418 | 0.548 | +0.129 | 1.31× | 5 |
| billed tokens (k) | 1929.7 | 2597.6 | +667.8 | 1.35× | 5 |
| output tokens (k) | 26.08 | 31.6 | +5.52 | 1.21× | 5 |
| iterations | 10.76 | 9.96 | -0.8 | 0.93× | 5 |
| edit rounds | 6.52 | 7.8 | +1.28 | 1.20× | 5 |
| tool calls | 44.3 | 40.8 | -3.5 | 0.92× | 5 |
| peak context (k) | 61.1 | 78.3 | +17.2 | 1.28× | 5 |
| failed runs | 5.24 | 5.4 | +0.16 | 1.03× | 5 |
| LOC added | 329.6 | 406.9 | +77.3 | 1.23× | 5 |
| wrote a test | 76% | 96% | +20% | — | 5 |
| learn (s) | 0.4 | 26.6 | +26.2 | 69.32× | 5 |
| test-authoring phase (s) | 15.7 | 27.3 | +11.6 | 1.74× | 5 |
| first test write → end (s) | 154.4 | 208.6 | +54.2 | 1.35× | 5 |
| test-tooling learn (s) | 0 | 0 | 0 | — | 5 |
| kept tests use Testing Library | 68% | 0% | -68% | — | 5 |

| Task | trials | pass rate | Δ | wall (s) | Δ | learn (s) | Δ | peak context (k) | Δ | cost ($) | Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 30-checkout-form | 5 → 5 | 0% → 0% | 0% | 240.4 → 352.9 | +112.4 | 1.5 → 9.3 | +7.8 | 52.7 → 86.8 | +34.1 | 0.327 → 0.616 | +0.289 |
| 31-command-menu | 5 → 5 | 60% → 60% | 0% | 218.5 → 130.7 | -87.8 | 0 → 16.6 | +16.6 | 54.4 → 50 | -4.4 | 0.403 → 0.229 | -0.174 |
| 32-sales-chart | 5 → 5 | 60% → 20% | -40% | 210.8 → 430.1 | +219.3 | 0 → 43.6 | +43.6 | 53.2 → 97.6 | +44.4 | 0.305 → 0.87 | +0.564 |
| 33-virtual-list | 5 → 5 | 0% → 20% | +20% | 235.3 → 270.1 | +34.8 | 0.4 → 42.1 | +41.7 | 59.3 → 70.1 | +10.8 | 0.387 → 0.411 | +0.024 |
| 34-sortable-playlist | 5 → 5 | 60% → 0% | -60% | 378.4 → 392.4 | +14 | 0 → 21.5 | +21.5 | 85.9 → 87.2 | +1.2 | 0.669 → 0.614 | -0.056 |
