# Workstream `core`: size and hot paths of the component core

Branch `claude/sweep-core-932696`, from `f93ef2dd`. Only `src/core/**` changed (not `debug.ts`).
No API, behaviour or diagnostic call shape changed. No test was edited.

## Result

| Measure | Baseline | Now | Delta |
|---|---|---|---|
| (a) `nativeGlobalThis: false`, gzip | 43,630 B | 43,438 B | -192 B |
| (b) default, gzip (what apps ship) | 39,630 B | 39,444 B | -186 B |
| (c) `src/core/**` alone, gzip | 20,166 B | 20,003 B | -163 B |

Size only: the speed pass found nothing worth keeping (see "Speed").

## Changes (gzip delta, (a) / (b) / (c))

| Change | (a) | (b) | (c) |
|---|---|---|---|
| `defOf`: drop the `override` parameter no caller passes | -28 | -28 | -24 |
| Context skip: read `onContextSkip` at its call site, no `ctxSkip` field | -56 | -54 | -53 |
| `compose()`: one wrapper for the value-wrapping hooks, by argument position | -16 | -26 | -20 |
| `Inst.handle` removed: the queue calls `handle()` directly | -19 | -14 | -5 |
| `rootShim`: `nameOf` | -29 | -19 | -20 |
| `shownOf`: one copy, shared by the view and the statics | -11 | -12 | +1 |
| `present()`: one check for a slice being defined | -25 | -12 | -9 |
| Collection `items_`: early return instead of a block and a flag | -2 | -1 | -12 |
| `resolve()`: one copy of the view-resolver loop, in the registry | -1 | -16 | -11 |
| `scopeValue`: unused parameter; `commands()`: dead assignment | -5 | -2 | -10 |
| `pong` closure, committed then undone (under the 10 B bar) | 0 | -2 | 0 |

The last row is two commits that cancel out except for gzip's context effect; squash them when
merging. `items_` and the `scopeValue` cleanup clear the 10 B bar in (c) only, and `shownOf` in
(a) and (b) only.

## Gates

| Gate | Result |
|---|---|
| `npm run build` | OK |
| `npm test`, in one go | **vitest failed: 10 of 6,292 tests in 4 files, so the later stages did not run** |
| The 4 failing files, re-run serially | 82 of 82 pass |
| `test:examples`, `test:types`, `test:browser`, `test:perf-gate`, run separately | all exit 0; heap 0.97 MB (limit 1.00) |
| `node scripts/size-gate.mjs` | OK, 192 B headroom |

The 10 failures happened at a load average of about 200: 8 in `compose-generated-repair` and 1 in
`sandbox-render` (QuickJS CPU-budget timeouts), 1 in `vite-plugin-dev` (a timeout). A fifth problem,
`docs-live-server`, was a collection error because `docs/` wasn't installed in this worktree. So no
single uninterrupted `npm test` run has passed; every stage has passed separately. The coordinator's
gate after merging should be the first one. `sygnal-check`'s suite was not run: nothing it reads
changed.

## Speed

`perf-ab`, full runs against the frozen 7.4.0 build:

| Run | Load average | Latency geomean | CPU geomean | Marked `SLOWER` |
|---|---|---|---|---|
| 1 (overlapped this worktree's own gate stages) | up to ~200 | 1.194 | 1.224 | 19 |
| 2 (nothing else of this workstream running) | 4–15 | **1.032** | 1.097 | 3 |

Each op marked in run 2, re-run alone with `--rounds=4`:

| Op | Run 2 latency | Alone, 4 rounds | Marked? |
|---|---|---|---|
| `leaf update, 30 deep` | 1.467 | 0.864 | no |
| `keystroke (1k list)` | 1.800 | 1.077 | no |
| `create 1k rows [view]` | 1.059 | 0.969 | no |

The `create 1k rows` filter also matched `persist: create 1k rows, written`, which was marked at
1.057; alone with `--rounds=4` it was 1.046 and not marked.

**Not met as written:** the protocol asks for a latency geomean of at most 1.01, and the only
quiet full run gave 1.032. Most of that comes from the two sub-millisecond ops above: replacing the
three marked ops' ratios with their re-runs gives about 0.982, but that picks new numbers only for
the worst ops, so it flatters the result. A full run on a quiet machine after merging is the real
check. The CPU geomean of 1.097 is also not evidence by the protocol's noise note (per-op CPU moves
by up to 20%), but it hasn't been shown to be noise either.

The profiles (`benchmarks/audit/profile.mjs`) show why there were no speed changes: the core is 2–3%
of busy time in `create 1k rows` and `mount 1k components`, and 3% in `leaf update`; native layout
and DOM work dominate. It is 9% in `select row (1k)` (`render`, `same`, `context`), the one op where
core code could matter.

## Tried and rejected

| Attempt | (a) / (b) / (c) | Why not |
|---|---|---|
| Boolean `App` flags left unset until first written | -21 / -24 / -35 | Not kept, and not measured: the flags would appear one at a time during startup, so the `App` shape changes under the hot `dispatch` / `commit` / `flush` sites and risks megamorphic lookups. A speed risk `perf-ab` is too noisy to rule out |
| `Inst.spawn()` + `kidUid()` for the three places that make an owned instance | +1 / -2 / -21 | Nothing in an app bundle |
| `expand()` helper for `ext.xb ? ext.xb(v) : v` | -5 / -1 / +22 | (c) grows |
| Switchable `sameProps` through `shallowEq` | +4 / +4 / +1 | Grows |
| `actions.ts`: one branch per kind of result | -1 / -2 / -4 | Under the bar |
| `pong` as one arrow closure | -2 / -6 / -2 | Under the bar |
| `if (this.kids.size)` before the kids iterator (leaf instances, select row) | +3 / +3 / +1 | No measurable gain: 1.017 / 1.130 at `--rounds=2` under load, which is inconclusive and not a win |

## For the coordinator

`rootShim` (`runtime.ts`) exists only for `persist`, and every app pays for it. Stubbing it out
measures -141 / -132 / -141, an upper bound since the call site would remain. It needs
`src/extra/persist.ts` to build its own shim, and that file is outside this workstream.

## 8.0 idea

Drop the lowercase `<switchable>` tag and register the host on first use (`$reg`, as Portal does).
Removing the host from kanban, which doesn't use it, measures -807 / -808 B. The lowercase tags are
documented and pinned by tests (D471), which is why the host registers on import today. The same
applies to `<collection>`, but only for apps with no Collection (not measured; G-751's note
estimated about 3.2 KB for both hosts in a marker-free app).
