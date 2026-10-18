# PLAN-11 Status Tracker

Tracks progress for [PLAN-11.md](PLAN-11.md) (friction fixes from building an app).

**Numbering:** a reserved block, decisions **D550–D599**, gaps **G-850–G-899**.

**Integration branch:** `claude/sygnal-friction-assessment-8ec6df`, cut from `main` 49c2f6d4.

**State:** all items implemented on the integration branch (2026-10-17); the full gate and the PR to main are next.

## Decisions

| # | Date | Decision |
|---|---|---|
| D550 | 2026-10-17 | Fix the confirmed friction points as assessed (user) |
| D551 | 2026-10-17 | Full upload progress support, not only a recipe (user) |
| D552 | 2026-10-17 | Spike the progress API first (user) |
| D553 | 2026-10-17 | Sinks keep the pre-action state; a checker hint is G-850 (user) |
| D554 | 2026-10-17 | sygnal-check stays type-free; templates and docs say to run tsc too (user) |
| D555 | 2026-10-17 | Progress over XHR, `progress: 'ACTION' \| true`, `HTTP.progress()`, throttled, `t.progress()` (coordinator, on S-1) |
| D556 | 2026-10-17 | E-1: SSE `headers` are data only (no function form): a token lives in state and a changed header reconnects; an explicit `EventSource` option still wins and gets the headers in its init (coordinator) |
| D557 | 2026-10-17 | T-1: one tip shows at a time; moving to another trigger while one shows switches at once; the tip is found by the trigger's `aria-describedby` (coordinator) |
| D558 | 2026-10-17 | F-1: a top-level field name not in the typed values is a type error (typos); a typed schema's input wins over `values` (coordinator, on the worker's proposal) |
| D559 | 2026-10-17 | `form.RESET` takes values only from a plain object, so `'form.RESET': DOM.click('.reset')` resets to the start values instead of to the event (coordinator; found by the F-1 worker) |

## Items

| Item | State | Notes |
|---|---|---|
| S-1 | done | [`research/upload-progress/`](research/upload-progress/README.md) |
| Q-1 | done | `ViewProps` any-guard; type-test `p11-q1-any-props.tsx`; 2048 tile fixed |
| Q-2 | done | SYG731 skips state announced by text / aria-label / aria-live / role=status or alert; fix text by toggle vs value |
| Q-3 | done | timeout error names a pending fake timer; 2000 ms default in llms.txt, skill, testing guide |
| Q-4 | done | every template has `npm run check` (TS: + `tsc --noEmit`); AGENTS.md rows; TS guide note |
| Q-5 | done | user-local skill reduced to create-sygnal-app (backup in the session scratchpad); sygnal-dev names mcp-app and `npm run check` |
| Q-6 | done | sygnal-check SYG609 reports intent sources with no driver |
| U-1 | done | XHR transport (`xhrFetch`), `progress` as an action name or true, `HTTP.progress()`, throttle, SYG636 |
| U-2 | done | types (`FetchProgress`), fake `t.progress()` |
| U-3 | done | `progress` is a reply key for SYG102 / SYG112 and LSP completion |
| U-4 | done | http guide section with a live upload demo (demo XMLHttpRequest in the live runtime), testing guide, llms/skill; browser test in 3 engines |
| E-1 | done | `FetchEventSource` (fetch + the shared SSE parser with id/retry); `headers` on `sse` connections; browser test in 3 engines |
| F-1 | done | `StandardSchemaLike<IN, OUT>`, `SchemaInput`, `FormFields`, `FormOutput`, `FormServerErrors`; `form.RESET` ignores a click event (runtime fix) |
| T-1 | done | `tooltips()` in sygnal/ui; docs live demo; browser test in 3 engines; SYG730 fix text |
| D-1…D-5 | done | widgets new array, ElementCommand annotation, Switchable scroll to router, UsesState, 2000 ms |

## Gaps

| # | Gap |
|---|---|
| G-850 | sygnal-check hint when a sink handler reads a state field that the same action's STATE reducer writes (it sees the old value) |
| G-851 | `processForm` keeps only the last value of a repeated field name (several files, multi-select): changing it to arrays is breaking |
| G-852 | `initialState` of a host whose State includes `UsesState<typeof uses>` needs a cast (the behavior slices are missing from the literal) |
