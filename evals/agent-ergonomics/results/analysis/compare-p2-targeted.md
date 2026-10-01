# Friction analysis: `v2-baseline` → `p2-targeted`

Sygnal − React wall-time delta on shared tasks: 14.3 s → — s per trial.

## sygnal

Pass: 85/85 → 15/15

| Metric (mean) | v2-baseline | p2-targeted | Change |
|---|---|---|---|
| wall | 44.9 | 47.4 | +2.5 |
| peakContext | 36313.8 | 37191.7 | +877.9 |
| cacheCreation | 30132.9 | 31038.9 | +906 |
| iterations | 1.8 | 1.9 | +0.1 |
| effectiveIterations | 1.8 | 1.9 | +0.1 |
| editRounds | 1.7 | 1.7 | 0 |
| failedRuns | 0.2 | 0.3 | +0.1 |
| toolCalls | 7.8 | 7.9 | +0.1 |
| locAdded | 107.5 | 119.7 | +12.2 |

| Phase (s/trial) | v2-baseline | p2-targeted | Change |
|---|---|---|---|
| orient | 4.3 | 4.4 | +0.1 |
| learn | 6.7 | 3.6 | -3.1 |
| implement | 12.7 | 14 | +1.3 |
| test-authoring | 9.6 | 10.4 | +0.8 |
| verify | 4.3 | 5.8 | +1.5 |
| debug | 1.1 | 2.2 | +1.1 |
| tooling-friction | 0 | 0 | 0 |
| think | 6.3 | 6.8 | +0.5 |
| report | 0 | 0 | 0 |
| other | 0 | 0 | 0 |

## react

Pass: 75/75 → —

| Metric (mean) | v2-baseline | p2-targeted | Change |
|---|---|---|---|
| wall | 34.1 | — | — |
| peakContext | 25116.7 | — | — |
| cacheCreation | 18797.3 | — | — |
| iterations | 1.4 | — | — |
| effectiveIterations | 1.4 | — | — |
| editRounds | 1.3 | — | — |
| failedRuns | 0.2 | — | — |
| toolCalls | 5.1 | — | — |
| locAdded | 94.7 | — | — |

| Phase (s/trial) | v2-baseline | p2-targeted | Change |
|---|---|---|---|
| orient | 5.6 | — | — |
| learn | 0 | — | — |
| implement | 11.7 | — | — |
| test-authoring | 8.2 | — | — |
| verify | 2.3 | — | — |
| debug | 0.7 | — | — |
| tooling-friction | 0 | — | — |
| think | 5.5 | — | — |
| report | 0 | — | — |
| other | 0 | — | — |

## Sygnal − React delta by item (s/trial)

| Item | v2-baseline | p2-targeted | Change |
|---|---|---|---|
| learn:framework-source | 3.9 | — | -3.9 |
| phase:test-authoring | 2.3 | — | -2.3 |
| phase:implement | 2.2 | — | -2.2 |
| phase:verify | 2.2 | — | -2.2 |
| learn:skill-load | 1.1 | — | -1.1 |
| phase:think | 1 | — | -1 |
| learn:dom-events | 0.6 | — | -0.6 |
| phase:debug | 0.5 | — | -0.5 |
| learn:context | 0.5 | — | -0.5 |
| learn:parent-child-props | 0.5 | — | -0.5 |
| learn:drivers | 0.3 | — | -0.3 |
| learn:dom-isolation | 0.3 | — | -0.3 |
| learn:types | 0.2 | — | -0.2 |
| learn:collections | 0.1 | — | -0.1 |
| phase:orient | -1.3 | — | +1.3 |

## Catalog friction (s per Sygnal trial)

| ID | v2-baseline | p2-targeted | Change | Trials affected |
|---|---|---|---|---|
| G-016 | 0 | 0 | 0 | 5/85 → 1/15 |
| B-005 | 0 | — | 0 | 1/85 → — |

## Canonical forms (Sygnal trials using each)

| Form | v2-baseline | p2-targeted |
|---|---|---|
| shorthandKeys | 0 | 0 |
| emitCalls | 0 | 0 |
| eventCalls | 18 | 0 |
| rawEventsObjects | 0 | 0 |
| childSelectString | 0 | 0 |
| childSelectFn | 22 | 10 |
| positionalView | 0 | 0 |
| abortReturns | 58 | 9 |
| effectSinks | 17 | 4 |
