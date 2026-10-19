# Sygnal 7: one timing contract instead of a switch (spike, 2026-10-19)

**Question:** does 7.0 need `sinkState: 'before' | 'after'` (per app, component and behavior, with
handler provenance), or can it ship one contract: STATE runs first, every other sink gets the
committed state, `props.previousState` is the state from before the action?

**Branch:** `exp/v7-single-contract` on top of `a54f4090` (the reviewed 7.0 commit).

## Spike 1: built-in behaviors on the new contract (commit aac4423d)

Removing the 14 `sinkState: 'before'` pins: 178 tests failed, all in form, chat, compose and
commandBar (their STATE and outputs share one memoized transition of the old slice) plus two
dialog focus tests. Fixes, all through the public contract:

- `was(s, props, key)` in `behaviors.ts`: a behavior output's slice before the action
  (`props.previousState[key]`); form's EFFECT / ELEMENT / http sinks pass it to the shared step.
- `fromPrevious(model)`: wraps a behavior model's outputs so they compute from the previous slice
  and host state (chat, compose, commandBar: dozens of outputs share their STATE's transition).
- dialog's CLOSED ELEMENT: "was it open before this close" reads `previousState`.
- pager, selection, sortable, undo, tabs, accordion, disclosure, popover, tooltip: no change.

Result: full vitest green except tests of the switch itself.

## Spike 2: remove the switch and its machinery (commit abc34f6a)

Deleted `src/extra/sinkTiming.ts` (snapshot masks, provenance, mixed EFFECT groups, the `[BEFORE]`
props symbol), the `sinkState` option plumbing (run, renderComponent, element, Vike, Astro, define
KEYS, inspect statics) and the runtime SYG255 check. `normalize` puts STATE first in each entry
(no per-action sorting); `handle` gives STATE `(pre, previousState: pre)` and outputs
`(post, previousState: pre)`.

| | 7.0 as reviewed | single contract |
|---|---|---|
| gated kanban gzip | 42,993 B (7 B headroom) | **42,812 B (188 B headroom)** |
| vitest | 5,099 pass | 5,060 pass; 39 fail, all in 11 files that opt into `sinkState: 'before'` (6.x fixtures pinned by 7.0, and the switch's own tests) |
| browser (Chromium) | 377 / 377 | **377 / 377** |
| ui / forms / zag / chat suites, Firefox + WebKit | — | all pass |
| perf / count gate | pass | pass |

## Spike 3: the migration safety net (commit abc34f6a)

An opt-in dev-only audit in the diagnostics entry (`wrapHandler` layer, 0 production bytes): an
output that reads a top-level field its action's STATE changed reports **SYG257** (info, once per
component / action / sink / field) with the `previousState` fix. On a 6.x-style counter
(`INC: { STATE: n + 1, PARENT: s => s.n + 1 }`) it flags exactly the silent double increment; an
unchanged field read in the same handler is not flagged. Opt-in because in a 7.0-native app
reading the new value is the intent.

## Recommendation

One contract. The switch costs 181 B and a second mental model ("before is a snapshot, not an
execution order" in mixed actions), every built-in would stay on the old contract forever, and an
app-level-only switch can't be cheap: built-ins that read new values via `state` break under it.
Gradual migration is served instead by the opt-in audit, SYG256, tests, and 6.x staying available.
Libraries that support 6 and 7 read old values as `props.previousState ?? state`.
