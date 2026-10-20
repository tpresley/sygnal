# PLAN-11 Status Tracker

Tracks progress for [PLAN-11.md](PLAN-11.md) (friction fixes from building an app).

**Numbering:** a reserved block, decisions **D550–D599**, gaps **G-850–G-899**.

**Integration branch:** `claude/sygnal-friction-assessment-8ec6df`, cut from `main` 49c2f6d4.

**State:** **PLAN-11 complete. Released 2026-10-19 in sygnal 7.0.0** (sygnal-check 0.11.0, create-sygnal-app 2.9.0, VS Code extension 0.8.0, Claude Code plugin 0.2.0): merged in PR #50, moved to [PLAN-12](PLAN-12.md)'s timing contract when 7.0 merged it (PR #53). Open gaps: G-851, G-852.

## Decisions

| # | Date | Decision |
|---|---|---|
| D550 | 2026-10-17 | Fix the confirmed friction points as assessed (user) |
| D551 | 2026-10-17 | Full upload progress support, not only a recipe (user) |
| D552 | 2026-10-17 | Spike the progress API first (user) |
| D553 | 2026-10-17 | Sinks keep the pre-action state; a checker hint is G-850 (user). **Superseded** by PLAN-12 P12-D8 (7.0: outputs get the committed state, `props.previousState` the old one) |
| D554 | 2026-10-17 | sygnal-check stays type-free; templates and docs say to run tsc too (user) |
| D555 | 2026-10-17 | Progress over XHR, `progress: 'ACTION' \| true`, `HTTP.progress()`, throttled, `t.progress()` (coordinator, on S-1) |
| D556 | 2026-10-17 | E-1: SSE `headers` are data only (no function form): a token lives in state and a changed header reconnects; an explicit `EventSource` option still wins and gets the headers in its init (coordinator) |
| D557 | 2026-10-17 | T-1: one tip shows at a time; moving to another trigger while one shows switches at once; the tip is found by the trigger's `aria-describedby` (coordinator) |
| D558 | 2026-10-17 | F-1: a top-level field name not in the typed values is a type error (typos); a typed schema's input wins over `values` (coordinator, on the worker's proposal) |
| D559 | 2026-10-17 | `form.RESET` takes values only from a plain object, so `'form.RESET': DOM.click('.reset')` resets to the start values instead of to the event (coordinator; found by the F-1 worker) |
| D560 | 2026-10-18 | U-5: a `multipart` request field, the multipart counterpart of `json`, so a model never builds a FormData (imperative, opaque in t.requests); `body: formData` stays the escape hatch (user) |
| D561 | 2026-10-18 | F-2: native file fields in `form` (a file input named in `values`), `form.PROGRESS` / `state.form.progress`, and `state.form.resets` for keying file inputs (a reset can't clear one through state); a file input not in values stays ignored without SYG230 (user) |
| D562 | 2026-10-18 | F-3: a declarative `request` option on `form` is the canonical way to save a form to a URL; `submit` stays for submits that send nothing or need a custom entry (user) |

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
| U-5 | done | `multipart` on requests (`toFormData`), types `MultipartValue`; docs, demo, llms/skill, browser test switched to it |
| E-1 | done | `FetchEventSource` (fetch + the shared SSE parser with id/retry); `headers` on `sse` connections; browser test in 3 engines |
| F-1 | done | `StandardSchemaLike<IN, OUT>`, `SchemaInput`, `FormFields`, `FormOutput`, `FormServerErrors`; `form.RESET` ignores a click event (runtime fix) |
| F-2 | done | file fields in `form` (File values, schema validation), `form.PROGRESS` → `progress`, `resets` for keying the input; docs in forms-reference; browser test in 3 engines |
| F-3 | done | `request` option on `form` (auto json/multipart, form.DONE/ERRORS/PROGRESS); SYG234 skips it; types `FormRequest` (submit or request required); recipe, llms, skill switched; browser test via request |
| T-1 | done | `tooltips()` in sygnal/ui; docs live demo; browser test in 3 engines; SYG730 fix text |
| D-1…D-5 | done | widgets new array, ElementCommand annotation, Switchable scroll to router, UsesState, 2000 ms |

## Gaps

| # | Gap |
|---|---|
| G-850 | ~~sygnal-check hint when a sink handler reads a state field that the same action's STATE reducer writes~~ Closed by 7.0: PLAN-12's opt-in timing audit (SYG257) reports such reads at run time, and SYG256 a guard that blocks its own action |
| G-851 | `processForm` keeps only the last value of a repeated field name (several files, multi-select): changing it to arrays is breaking |
| G-852 | `initialState` of a host whose State includes `UsesState<typeof uses>` needs a cast (the behavior slices are missing from the literal) |
