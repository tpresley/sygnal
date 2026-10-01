# Friction analysis: `baseline-t2` → `phase3-t2`

Sygnal − React wall-time delta on shared tasks: 29 s → 44.5 s per trial.

## sygnal

Pass: 20/20 → 20/20

| Metric (mean) | baseline-t2 | phase3-t2 | Change |
|---|---|---|---|
| wall | 92.2 | 107.7 | +15.5 |
| peakContext | 79820.5 | 83157.3 | +3336.8 |
| cacheCreation | 47239.2 | 50539.3 | +3300.1 |
| iterations | 4.6 | 4.7 | +0.1 |
| effectiveIterations | 3.9 | 4.3 | +0.4 |
| editRounds | 2.1 | 2.3 | +0.2 |
| failedRuns | 1.7 | 1 | -0.7 |
| toolCalls | 17 | 17.7 | +0.7 |
| locAdded | 128.7 | 157.2 | +28.5 |

| Phase (s/trial) | baseline-t2 | phase3-t2 | Change |
|---|---|---|---|
| orient | 5 | 6.4 | +1.4 |
| learn | 11.9 | 9.2 | -2.7 |
| implement | 14 | 17 | +3 |
| test-authoring | 10.9 | 17.4 | +6.5 |
| verify | 7.7 | 20 | +12.3 |
| debug | 2.8 | 10.4 | +7.6 |
| tooling-friction | 28.7 | 15.5 | -13.2 |
| think | 0 | 0 | 0 |
| report | 11.1 | 11.8 | +0.7 |
| other | 0 | 0 | 0 |

## react

Pass: 20/20 → 20/20

| Metric (mean) | baseline-t2 | phase3-t2 | Change |
|---|---|---|---|
| wall | 63.2 | 63.2 | 0 |
| peakContext | 67682.2 | 67682.2 | 0 |
| cacheCreation | 35046.7 | 35046.7 | 0 |
| iterations | 2.6 | 2.6 | 0 |
| effectiveIterations | 1.9 | 1.9 | 0 |
| editRounds | 1.4 | 1.4 | 0 |
| failedRuns | 0.2 | 0.2 | 0 |
| toolCalls | 12.8 | 12.8 | 0 |
| locAdded | 104.2 | 104.2 | 0 |

| Phase (s/trial) | baseline-t2 | phase3-t2 | Change |
|---|---|---|---|
| orient | 9.4 | 9.4 | 0 |
| learn | 0 | 0 | 0 |
| implement | 13.8 | 13.8 | 0 |
| test-authoring | 9.6 | 9.6 | 0 |
| verify | 5 | 5 | 0 |
| debug | 1.1 | 1.1 | 0 |
| tooling-friction | 14.9 | 14.9 | 0 |
| think | 0 | 0 | 0 |
| report | 9.5 | 9.5 | 0 |
| other | 0 | 0 | 0 |

## Sygnal − React delta by item (s/trial)

| Item | baseline-t2 | phase3-t2 | Change |
|---|---|---|---|
| friction:B-007 | 11.9 | — | -11.9 |
| phase:verify | 2.8 | 15.1 | +12.3 |
| learn:run-mount-api | 2.3 | — | -2.3 |
| friction:HARNESS-GUARD | 1.9 | 0.6 | -1.3 |
| learn:dom-events | 1.8 | 0.7 | -1.1 |
| phase:debug | 1.7 | 9.3 | +7.6 |
| phase:report | 1.6 | 2.3 | +0.7 |
| learn:skill-load | 1.5 | 1.9 | +0.4 |
| phase:test-authoring | 1.4 | 7.8 | +6.4 |
| learn:abort-reducers | 1.2 | — | -1.2 |
| learn:framework-source | 0.9 | 2.1 | +1.2 |
| learn:testing-utility | 0.8 | 0.9 | +0.1 |
| learn:parent-child-props | 0.8 | — | -0.8 |
| learn:drivers | 0.8 | 2.4 | +1.6 |
| learn:context | 0.8 | — | -0.8 |
| learn:types | 0.7 | 0.2 | -0.5 |
| learn:events-bus | 0.4 | — | -0.4 |
| phase:implement | 0.2 | 3.2 | +3 |
| learn:skill-reference | 0 | — | 0 |
| learn:streams | — | 1 | +1 |
| phase:orient | -4.4 | -2.9 | +1.5 |

## Catalog friction (s per Sygnal trial)

| ID | baseline-t2 | phase3-t2 | Change | Trials affected |
|---|---|---|---|---|
| HARNESS-GUARD | 16.8 | 15.5 | -1.3 | 20/20 → 18/20 |
| B-007 | 11.9 | — | -11.9 | 18/20 → — |
| G-016 | 0 | 0 | 0 | 2/20 → 1/20 |
| B-011 | 0 | — | 0 | 1/20 → — |

## Canonical forms (Sygnal trials using each)

| Form | baseline-t2 | phase3-t2 |
|---|---|---|
| shorthandKeys | 14 | 0 |
| emitCalls | 0 | 0 |
| eventCalls | 0 | 8 |
| rawEventsObjects | 5 | 0 |
| childSelectString | 0 | 0 |
| childSelectFn | 3 | 7 |
| positionalView | 0 | 0 |
| abortReturns | 1 | 19 |
| effectSinks | 3 | 4 |
