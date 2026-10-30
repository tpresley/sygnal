### react-konva — Chromium 153.0.8010.12, 1440x900 @1x, Intel(R) Xeon(R) Processor @ 2.80GHz (4 cores)

Per input step. **busy** = renderer main-thread time (handlers, framework, canvas draw); **wall** = input sent until two frames drawn (60 Hz, so multiples of ~16.7 ms). Loop overhead (hover step): busy 2.54 ms, wall 45.79 ms.

| shapes | dragged | busy median | busy p95 | busy max | wall median | wall p95 | drop |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1000 | 1 | 11.42 | 13.85 | 31.64 | 45.96 | 47.53 | 81.2 |
| 1000 | 100 | 11.43 | 13.36 | 36.35 | 45.88 | 47.26 | 82.2 |
| 1000 | all | 25.01 | 34.56 | 56.59 | 62.22 | 67.39 | 164.9 |
| 5000 | 1 | 11.65 | 16.83 | 33.44 | 45.98 | 63.44 | 127.1 |
| 5000 | 100 | 11.82 | 16.37 | 20.74 | 45.67 | 59.32 | 100.3 |
| 5000 | all | 72.67 | 103.39 | 115.67 | 110.75 | 137.02 | 411.2 |
| 10000 | 1 | 11.35 | 12.79 | 21.19 | 46.18 | 60.96 | 179.9 |
| 10000 | 100 | 12.63 | 15.47 | 18.59 | 46.03 | 49.36 | 228.2 |
| 10000 | all | 143.67 | 257.75 | 352.08 | 178.87 | 279.46 | 915.8 |

| shapes | pan busy median | pan busy p95 | pan wall median | zoom busy median | zoom busy p95 | zoom wall median |
|---:|---:|---:|---:|---:|---:|---:|
| 1000 | 22.57 | 34.03 | 77.96 | 20.91 | 29.73 | 78.62 |
| 5000 | 58.87 | 88.21 | 112.88 | 55.43 | 85.39 | 111.93 |
| 10000 | 134.17 | 239.85 | 179.68 | 96.63 | 157.48 | 146.68 |

Startup (bench ready + first frame): median 369.2 ms, FCP 248 ms.

JS heap after GC: initial: 3.2 MB, 1000: 6.9 MB, 5000: 23.8 MB, 10000: 50.1 MB.

Generate + paint: 1000: 145.9 ms, 5000: 409.8 ms, 10000: 496.9 ms.
