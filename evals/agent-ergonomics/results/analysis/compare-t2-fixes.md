# Friction analysis: `phase3-t2` → `phase3b-t2`

Sygnal − React wall-time delta on shared tasks: 44.5 s → 15.4 s per trial.

## sygnal

Pass: 20/20 → 20/20

| Metric (mean) | phase3-t2 | phase3b-t2 | Change |
|---|---|---|---|
| wall | 107.7 | 78.5 | -29.2 |
| peakContext | 83157.3 | 78306.8 | -4850.5 |
| cacheCreation | 50539.3 | 55462.7 | +4923.4 |
| iterations | 4.7 | 2.4 | -2.3 |
| effectiveIterations | 4.3 | 2.1 | -2.2 |
| editRounds | 2.3 | 1.5 | -0.8 |
| failedRuns | 1 | 0.2 | -0.8 |
| toolCalls | 17.7 | 13.2 | -4.5 |
| locAdded | 157.2 | 145.5 | -11.7 |

| Phase (s/trial) | phase3-t2 | phase3b-t2 | Change |
|---|---|---|---|
| orient | 6.4 | 6.9 | +0.5 |
| learn | 9.2 | 4.1 | -5.1 |
| implement | 17 | 16.1 | -0.9 |
| test-authoring | 17.4 | 13.5 | -3.9 |
| verify | 20 | 9.5 | -10.5 |
| debug | 10.4 | 1.8 | -8.6 |
| tooling-friction | 15.5 | 16.1 | +0.6 |
| think | 0 | 0 | 0 |
| report | 11.8 | 10.6 | -1.2 |
| other | 0 | 0 | 0 |

## react

Pass: 20/20 → 20/20

| Metric (mean) | phase3-t2 | phase3b-t2 | Change |
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

| Phase (s/trial) | phase3-t2 | phase3b-t2 | Change |
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

| Item | phase3-t2 | phase3b-t2 | Change |
|---|---|---|---|
| phase:verify | 15.1 | 4.6 | -10.5 |
| phase:debug | 9.3 | 0.7 | -8.6 |
| phase:test-authoring | 7.8 | 3.9 | -3.9 |
| phase:implement | 3.2 | 2.3 | -0.9 |
| learn:drivers | 2.4 | 1.2 | -1.2 |
| phase:report | 2.3 | 1.1 | -1.2 |
| learn:framework-source | 2.1 | 0.7 | -1.4 |
| learn:skill-load | 1.9 | 2 | +0.1 |
| learn:streams | 1 | 0.2 | -0.8 |
| learn:testing-utility | 0.9 | — | -0.9 |
| learn:dom-events | 0.7 | — | -0.7 |
| friction:HARNESS-GUARD | 0.6 | 1.2 | +0.6 |
| learn:types | 0.2 | — | -0.2 |
| phase:orient | -2.9 | -2.5 | +0.4 |

## Catalog friction (s per Sygnal trial)

| ID | phase3-t2 | phase3b-t2 | Change | Trials affected |
|---|---|---|---|---|
| HARNESS-GUARD | 15.5 | 16.1 | +0.6 | 18/20 → 20/20 |
| G-016 | 0 | 0 | 0 | 1/20 → 1/20 |

## Canonical forms (Sygnal trials using each)

| Form | phase3-t2 | phase3b-t2 |
|---|---|---|
| shorthandKeys | 0 | 0 |
| emitCalls | 0 | 0 |
| eventCalls | 8 | 8 |
| rawEventsObjects | 0 | 0 |
| childSelectString | 0 | 0 |
| childSelectFn | 7 | 7 |
| positionalView | 0 | 0 |
| abortReturns | 19 | 20 |
| effectSinks | 4 | 4 |
