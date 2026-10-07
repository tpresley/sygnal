# `p5-final-opus:react` → `p5-final-opus:sygnal`

Source: analysis.

## react → sygnal: `p5-final-opus:react` → `p5-final-opus:sygnal` (task-matched)

5 task(s) in both (25 → 25 trials). Matched mean = mean over the shared tasks of each task's mean; every task weighs the same.

| Metric (matched mean) | p5-final-opus:react | p5-final-opus:sygnal | Δ | ratio | tasks |
|---|---|---|---|---|---|
| pass rate | 100% | 92% | -8% | — | 5 |
| wall (s) | 64.1 | 82.1 | +17.9 | 1.28× | 5 |
| cost ($) | 0.28 | 0.582 | +0.302 | 2.08× | 5 |
| billed tokens (k) | 118 | 439.5 | +321.5 | 3.73× | 5 |
| output tokens (k) | 6.99 | 7.3 | +0.31 | 1.04× | 5 |
| iterations | 1.92 | 2.32 | +0.4 | 1.21× | 5 |
| edit rounds | 1.68 | 1.64 | -0.04 | 0.98× | 5 |
| tool calls | 5.9 | 10.6 | +4.7 | 1.79× | 5 |
| peak context (k) | 21.4 | 50.2 | +28.7 | 2.34× | 5 |
| failed runs | 0.48 | 0.24 | -0.24 | 0.50× | 5 |
| LOC added | 193.4 | 178.2 | -15.2 | 0.92× | 5 |
| wrote a test | 100% | 100% | 0% | — | 5 |
| learn (s) | 0 | 13.8 | +13.8 | — | 5 |
| test-authoring phase (s) | 10.7 | 15 | +4.3 | 1.40× | 5 |
| first test write → end (s) | 14.6 | 17.3 | +2.7 | 1.18× | 5 |
| test-tooling learn (s) | 0 | 0 | 0 | — | 5 |
| kept tests use Testing Library | 84% | 0% | -84% | — | 5 |

| Task | trials | pass rate | Δ | wall (s) | Δ | learn (s) | Δ | peak context (k) | Δ | cost ($) | Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 30-checkout-form | 5 → 5 | 100% → 100% | 0% | 73 → 121.9 | +48.9 | 0 → 29 | +29 | 21.9 → 69.8 | +47.9 | 0.31 → 0.941 | +0.631 |
| 31-command-menu | 5 → 5 | 100% → 100% | 0% | 36.2 → 60.2 | +24 | 0 → 13.8 | +13.8 | 17.5 → 43.8 | +26.3 | 0.184 → 0.482 | +0.298 |
| 32-sales-chart | 5 → 5 | 100% → 100% | 0% | 56.6 → 45.7 | -10.9 | 0 → 3.7 | +3.7 | 24.4 → 45.7 | +21.3 | 0.286 → 0.462 | +0.175 |
| 33-virtual-list | 5 → 5 | 100% → 60% | -40% | 52.1 → 71.3 | +19.2 | 0 → 13.4 | +13.4 | 18.6 → 45.1 | +26.5 | 0.222 → 0.516 | +0.295 |
| 34-sortable-playlist | 5 → 5 | 100% → 100% | 0% | 102.8 → 111.1 | +8.3 | 0 → 8.9 | +8.9 | 24.6 → 46.4 | +21.8 | 0.398 → 0.508 | +0.11 |
