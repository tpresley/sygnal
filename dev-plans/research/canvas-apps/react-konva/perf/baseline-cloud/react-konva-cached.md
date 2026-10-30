### react-konva — Chromium 153.0.8010.12, 1440x900 @1x, Intel(R) Xeon(R) Processor @ 2.80GHz (4 cores)

Per input step. **busy** = renderer main-thread time (handlers, framework, canvas draw); **wall** = input sent until two frames drawn (60 Hz, so multiples of ~16.7 ms). Loop overhead (hover step): busy 2.44 ms, wall 46.01 ms.

| shapes | dragged | busy median | busy p95 | busy max | wall median | wall p95 | drop |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1000 | 1 | 10.81 | 13.98 | 31.24 | 46.09 | 47.87 | 62.8 |
| 1000 | 100 | 11.5 | 14.03 | 26.75 | 46.08 | 54.44 | 64.5 |
| 1000 | all | 11.92 | 16.13 | 33.43 | 46.88 | 52.97 | 148 |
| 5000 | 1 | 10.79 | 13.41 | 33.6 | 46.42 | 47.73 | 98.4 |
| 5000 | 100 | 10.77 | 13.59 | 24.1 | 46.11 | 49.13 | 111 |
| 5000 | all | 15.03 | 20.6 | 25.17 | 46.76 | 64 | 377.5 |
| 10000 | 1 | 10.76 | 14.07 | 18.86 | 46.71 | 50.6 | 181.6 |
| 10000 | 100 | 11.57 | 14.76 | 17.15 | 46.84 | 51.92 | 171.9 |
| 10000 | all | 22.05 | 31.5 | 44.95 | 62.3 | 65.06 | 996.3 |

| shapes | pan busy median | pan busy p95 | pan wall median | zoom busy median | zoom busy p95 | zoom wall median |
|---:|---:|---:|---:|---:|---:|---:|
| 1000 | 10.09 | 13.22 | 62.78 | 14.28 | 18.44 | 63.2 |
| 5000 | 9.68 | 12.27 | 63.19 | 14.98 | 69.06 | 63.36 |
| 10000 | 9.79 | 12.1 | 62.95 | 14.12 | 19.62 | 63.38 |

Startup (bench ready + first frame): median 365.4 ms, FCP 232 ms.

JS heap after GC: initial: 3.2 MB, 1000: 6.7 MB, 5000: 23.9 MB, 10000: 50.1 MB.

Generate + paint: 1000: 130 ms, 5000: 359.7 ms, 10000: 727.1 ms.
