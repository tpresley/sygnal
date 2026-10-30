Node v22.22.0, jsdom, median of 5 runs (2026-10-30). `npm run bench`.

### Cold start (ms): the layout reply → parts ready on the page

| parts | tier | first part ready | all ready | one part: create → ready (median / p95) | RSS growth (MB) | per part |
|---:|---|---:|---:|---:|---:|---:|
| 1 | worker | 177 | 177 | 151 / 176 | 21.6 | 21.6 |
| 3 | worker | 195 | 214 | 185 / 211 | 43.7 | 14.6 |
| 10 | worker | 390 | 534 | 427 / 469 | 141.4 | 14.1 |
| 1 | thread | 66 | 66 | 45 / 106 | 2.8 | 2.8 |
| 3 | thread | 157 | 157 | 91 / 135 | 5.2 | 1.7 |
| 10 | thread | 471 | 471 | 253 / 430 | 21.6 | 2.2 |

### Per event (ms)

| tier | click → validated emit → host action → host view patched (median / p95) | keystroke → the box re-rendered (median / p95) |
|---|---:|---:|
| worker | 1.48 / 1.99 | 2.07 / 2.96 |
| thread | 1.23 / 1.89 | 1.81 / 2.74 |

### Streaming

| generated parts | reply (chars) | ≈ tokens | model time at 100 / 50 tok/s (s) | first part complete at | compose delta at the end (ms) | all deltas, 1 per frame (ms CPU) |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 959 | 274 | 2.7 / 5.5 | 100 % of the reply | 0.10 | 8 over 165 frames |
| 3 | 2740 | 783 | 7.8 / 15.7 | 36 % of the reply | 0.25 | 58 over 470 frames |
| 10 | 9344 | 2670 | 26.7 / 53.4 | 12 % of the reply | 0.27 | 217 over 1602 frames |

### Request sizes (chars)

- compose request: instructions 4004 (of which the generated-part rules 2136), reply schema 1429
- an edit with 1 generated part(s) on the page: instructions 4380, current page 951 (the parts' code is in it)
- an edit with 3 generated part(s) on the page: instructions 4380, current page 2659 (the parts' code is in it)
- an edit with 10 generated part(s) on the page: instructions 4380, current page 9013 (the parts' code is in it)
