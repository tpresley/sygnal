# Friction analysis: `baseline` → `phase3`

Sygnal − React wall-time delta on shared tasks: 46.1 s → 15.8 s per trial.

## sygnal

Pass: 40/40 → 40/40

| Metric (mean) | baseline | phase3 | Change |
|---|---|---|---|
| wall | 74.8 | 50.3 | -24.5 |
| peakContext | 76158.2 | 73382 | -2776.2 |
| cacheCreation | 44349.4 | 45675.8 | +1326.4 |
| iterations | 4.8 | 3.2 | -1.6 |
| effectiveIterations | 4.1 | 2.3 | -1.8 |
| editRounds | 2.1 | 1.2 | -0.9 |
| failedRuns | 1.7 | 0.1 | -1.6 |
| toolCalls | 17.1 | 11.7 | -5.4 |
| locAdded | 43.1 | 56 | +12.9 |

| Phase (s/trial) | baseline | phase3 | Change |
|---|---|---|---|
| orient | 6.1 | 7.4 | +1.3 |
| learn | 8.8 | 2.2 | -6.6 |
| implement | 6.5 | 6.6 | +0.1 |
| test-authoring | 6.8 | 5.5 | -1.3 |
| verify | 10.3 | 9 | -1.3 |
| debug | 1.2 | 1 | -0.2 |
| tooling-friction | 24.6 | 9.6 | -15 |
| think | 0 | 0 | 0 |
| report | 10.4 | 9 | -1.4 |
| other | 0 | 0 | 0 |

## react

Pass: 30/30 → 30/30

| Metric (mean) | baseline | phase3 | Change |
|---|---|---|---|
| wall | 39.2 | 39.2 | 0 |
| peakContext | 62936.9 | 62936.9 | 0 |
| cacheCreation | 30330 | 30330 | 0 |
| iterations | 2.8 | 2.8 | 0 |
| effectiveIterations | 1.9 | 1.9 | 0 |
| editRounds | 1 | 1 | 0 |
| failedRuns | 0 | 0 | 0 |
| toolCalls | 9.3 | 9.3 | 0 |
| locAdded | 37.6 | 37.6 | 0 |

| Phase (s/trial) | baseline | phase3 | Change |
|---|---|---|---|
| orient | 8 | 8 | 0 |
| learn | 0 | 0 | 0 |
| implement | 5.3 | 5.3 | 0 |
| test-authoring | 4.1 | 4.1 | 0 |
| verify | 6 | 6 | 0 |
| debug | 0 | 0 | 0 |
| tooling-friction | 7.9 | 7.9 | 0 |
| think | 0 | 0 | 0 |
| report | 7.9 | 7.9 | 0 |
| other | 0 | 0 | 0 |

## Sygnal − React delta by item (s/trial)

| Item | baseline | phase3 | Change |
|---|---|---|---|
| friction:B-007 | 9.4 | — | -9.4 |
| phase:verify | 5.6 | 3.6 | -2 |
| friction:B-006 | 4.1 | — | -4.1 |
| phase:test-authoring | 3.7 | 2.5 | -1.2 |
| learn:parent-child-props | 3.6 | — | -3.6 |
| friction:HARNESS-GUARD | 3.1 | 3.3 | +0.2 |
| friction:G-016 | 3.1 | — | -3.1 |
| phase:implement | 2.9 | 2.4 | -0.5 |
| phase:report | 2.9 | 1.3 | -1.6 |
| learn:framework-source | 2 | 0.3 | -1.7 |
| phase:debug | 1.6 | 0.8 | -0.8 |
| learn:skill-load | 1.5 | 1.6 | +0.1 |
| learn:drivers | 1.2 | 0.5 | -0.7 |
| friction:G-018 | 0.9 | — | -0.9 |
| friction:G-015 | 0.7 | — | -0.7 |
| learn:types | 0.5 | — | -0.5 |
| learn:context | 0.5 | — | -0.5 |
| learn:testing-utility | 0.4 | — | -0.4 |
| learn:run-mount-api | 0.2 | — | -0.2 |
| learn:events-bus | 0.1 | — | -0.1 |
| learn:skill-reference | 0.1 | — | -0.1 |
| phase:orient | -2 | -0.5 | +1.5 |

## Catalog friction (s per Sygnal trial)

| ID | baseline | phase3 | Change | Trials affected |
|---|---|---|---|---|
| HARNESS-GUARD | 9.3 | 9.6 | +0.3 | 35/40 → 36/40 |
| B-007 | 8.7 | — | -8.7 | 25/40 → — |
| B-006 | 3.1 | — | -3.1 | 8/40 → — |
| G-016 | 2.3 | — | -2.3 | 7/40 → — |
| G-018 | 0.7 | — | -0.7 | 4/40 → — |
| G-015 | 0.5 | — | -0.5 | 7/40 → — |
| B-005 | 0 | — | 0 | 5/40 → — |
| ISOLATION | 0 | — | 0 | 2/40 → — |
| B-003 | 0 | — | 0 | 1/40 → — |
| NEW-TEST-RECIPE | 0 | — | 0 | 1/40 → — |

## Canonical forms (Sygnal trials using each)

| Form | baseline | phase3 |
|---|---|---|
| shorthandKeys | 14 | 0 |
| emitCalls | 0 | 0 |
| eventCalls | 0 | 5 |
| rawEventsObjects | 5 | 0 |
| childSelectString | 0 | 0 |
| childSelectFn | 14 | 10 |
| positionalView | 0 | 0 |
| abortReturns | 0 | 16 |
| effectSinks | 0 | 1 |
