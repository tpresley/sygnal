# Friction analysis: `baseline-t2` → `phase3b-t2`

Sygnal − React wall-time delta on shared tasks: 29 s → 15.4 s per trial.

## sygnal

Pass: 20/20 → 20/20

| Metric (mean) | baseline-t2 | phase3b-t2 | Change |
|---|---|---|---|
| wall | 92.2 | 78.5 | -13.7 |
| peakContext | 79820.5 | 78306.8 | -1513.7 |
| cacheCreation | 47239.2 | 55462.7 | +8223.5 |
| iterations | 4.6 | 2.4 | -2.2 |
| effectiveIterations | 3.9 | 2.1 | -1.8 |
| editRounds | 2.1 | 1.5 | -0.6 |
| failedRuns | 1.7 | 0.2 | -1.5 |
| toolCalls | 17 | 13.2 | -3.8 |
| locAdded | 128.7 | 145.5 | +16.8 |

| Phase (s/trial) | baseline-t2 | phase3b-t2 | Change |
|---|---|---|---|
| orient | 5 | 6.9 | +1.9 |
| learn | 11.9 | 4.1 | -7.8 |
| implement | 14 | 16.1 | +2.1 |
| test-authoring | 10.9 | 13.5 | +2.6 |
| verify | 7.7 | 9.5 | +1.8 |
| debug | 2.8 | 1.8 | -1 |
| tooling-friction | 28.7 | 16.1 | -12.6 |
| think | 0 | 0 | 0 |
| report | 11.1 | 10.6 | -0.5 |
| other | 0 | 0 | 0 |

## react

Pass: 20/20 → 20/20

| Metric (mean) | baseline-t2 | phase3b-t2 | Change |
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

| Phase (s/trial) | baseline-t2 | phase3b-t2 | Change |
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

| Item | baseline-t2 | phase3b-t2 | Change |
|---|---|---|---|
| friction:B-007 | 11.9 | — | -11.9 |
| phase:verify | 2.8 | 4.6 | +1.8 |
| learn:run-mount-api | 2.3 | — | -2.3 |
| friction:HARNESS-GUARD | 1.9 | 1.2 | -0.7 |
| learn:dom-events | 1.8 | — | -1.8 |
| phase:debug | 1.7 | 0.7 | -1 |
| phase:report | 1.6 | 1.1 | -0.5 |
| learn:skill-load | 1.5 | 2 | +0.5 |
| phase:test-authoring | 1.4 | 3.9 | +2.5 |
| learn:abort-reducers | 1.2 | — | -1.2 |
| learn:framework-source | 0.9 | 0.7 | -0.2 |
| learn:testing-utility | 0.8 | — | -0.8 |
| learn:parent-child-props | 0.8 | — | -0.8 |
| learn:drivers | 0.8 | 1.2 | +0.4 |
| learn:context | 0.8 | — | -0.8 |
| learn:types | 0.7 | — | -0.7 |
| learn:events-bus | 0.4 | — | -0.4 |
| phase:implement | 0.2 | 2.3 | +2.1 |
| learn:skill-reference | 0 | — | 0 |
| learn:streams | — | 0.2 | +0.2 |
| phase:orient | -4.4 | -2.5 | +1.9 |

## Catalog friction (s per Sygnal trial)

| ID | baseline-t2 | phase3b-t2 | Change | Trials affected |
|---|---|---|---|---|
| HARNESS-GUARD | 16.8 | 16.1 | -0.7 | 20/20 → 20/20 |
| B-007 | 11.9 | — | -11.9 | 18/20 → — |
| G-016 | 0 | 0 | 0 | 2/20 → 1/20 |
| B-011 | 0 | — | 0 | 1/20 → — |

## Canonical forms (Sygnal trials using each)

| Form | baseline-t2 | phase3b-t2 |
|---|---|---|
| shorthandKeys | 14 | 0 |
| emitCalls | 0 | 0 |
| eventCalls | 0 | 8 |
| rawEventsObjects | 5 | 0 |
| childSelectString | 0 | 0 |
| childSelectFn | 3 | 7 |
| positionalView | 0 | 0 |
| abortReturns | 1 | 20 |
| effectSinks | 3 | 4 |
