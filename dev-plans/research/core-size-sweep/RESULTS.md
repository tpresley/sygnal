# Core size sweep: outcome (2026-11-09)

Kanban production bundle, gzip, Vite 8.3.6, against 7.4.0 on one machine.

| Measure | 7.4.0 | After the sweep |
|---|---|---|
| Size gate (a), gated | 43,630 B | 40,457 B (-3,173) |
| Size gate (b), what apps ship | 39,630 B | 35,680 B (-3,950, -10.0%) |
| `perf-ab` latency geometric mean | | 0.937, no op marked `SLOWER` |
| Count gate | | all within limits, heap 0.93 MB |

| Workstream | Decision | Saved on (b) alone |
|---|---|---|
| `dom-events` | Merged, with the 7.4.0 capture behaviour at the top of the walk restored | 1,039 B |
| `xstream` (compact build, Vite alias) | Merged | 797 B |
| `periphery` | Merged | 255 B |
| `prod-strip` | Merged | 219 B |
| `prod-strip` short messages | Merged (maintainer: overdue) | 1,665 B |
| `vdom` (own patch function) | Left out (maintainer) | 979 B |
| `core` | Left out: 186 B, its one quiet timing run was 1.032 | 186 B |
| `mangle` | No-go | 382 B |
| modulepreload polyfill off | Not done: the maintainer's bar is under 1% without support in developed nations; caniuse-lite 1.0.30001814 gives about 1 to 2.6% | 287 B |

The behaviour differences kept from `dom-events` are in `dom-events.md` on its branch's history, with
the fifth found in review (capture at the top of the walk) restored and pinned by `test/dom-event-path.test.js`.
Unmerged branches: `claude/sweep-vdom-3a732f`, `claude/sweep-core-932696`, `claude/sweep-xstream-native-spike`.

For 8.0: removing the deprecated lowercase `<collection>` and `<switchable>` tags saves 833 B on kanban and
2,982 B on an app using neither. Native xstream saves 371 B beyond the alias for Vite apps and 5.7 KB for
non-Vite apps, so on its own it doesn't earn a major.
