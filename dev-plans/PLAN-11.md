# PLAN-11: Friction fixes from building an app (uploads, SSE auth, typing, a11y, testing)

**Goal:** fix the friction an agent session met building a real app on Sygnal 6.6 (assessed
2026-10-17; 14 reports, 12 confirmed). Most are small type, checker and test-helper fixes; four
are features: upload/download progress in `makeFetchDriver`, auth headers on SSE `connections`,
`form` types from the schema, and a multi-instance tooltip.

**Release:**
- **sygnal minor** (6.7.0): progress requests, SSE headers, `form` typing, `tooltips()`,
  `ViewProps` any-guard, the test timeout hint. Core bytes: 0 (all in `src/extra/`, `src/ui/` and
  types).
- **sygnal-check minor**: SYG731 exemptions, SYG609 for sources, the `progress` reply key.
- **create-sygnal-app minor**: TS templates run `tsc --noEmit` in their check script.

**Status:** planned 2026-10-17; S-1 done; all items implemented 2026-10-17 (D556–D559). Tracker: [`PLAN-11-status.md`](PLAN-11-status.md).

**Branches:** integration `claude/sygnal-friction-assessment-8ec6df` (cut from `main` 49c2f6d4);
spikes in `dev-plans/research/`.

**IDs:** items S- (spikes), Q- (quick fixes), U- (uploads), E- (SSE), F- (form), T- (tooltips),
D- (docs); decisions and gaps use a **reserved block, D550–D599 and G-850–G-899** (PLAN-10 holds
D500–D549 / G-800–G-849).

**Invariants:**
- No new runtime dependencies (D209). XHR and fetch are platform APIs.
- Request values stay data: no callbacks in sink values (the progress API is a reply action or
  a source, like `ok` / `select()`).
- Every new runtime behaviour has a `renderComponent` path (the HTTP fake, the socket fake).
- Docs, llms.txt and the skill use canonical forms; all examples stay strict-clean.
- 0 core bytes; the size gate holds (kanban doesn't use any of this).

---

## 0. Decisions already made (2026-10-17)

| # | Decision |
|---|---|
| D550 | **Fix the confirmed friction points** as assessed: Q-1…Q-6, U-1, E-1, F-1, T-1 and the docs lines D-1…D-5 (user) |
| D551 | **Uploads get full progress support**, not only a recipe: the user hit it twice (user) |
| D552 | **Run a spike to pick the progress API** before building it (user) → S-1 |
| D553 | **Pre-action state for sinks stays** (PLAN-4.6); documentation already covers it. A sygnal-check hint for a sink reading a field its own STATE reducer writes is a later gap (G-850) (user, accepting the assessment) |
| D554 | **sygnal-check stays type-free** (AST only); types are tsc's job. The templates and docs say to run both (user, accepting the assessment) |
| D555 | **S-1 outcome: progress over XMLHttpRequest, `progress: 'ACTION' | true` on the request**: a reply action to the sender, or the plain path on a new `HTTP.progress(category?)` source; data `{ phase, loaded, total, fraction, request, category }`; throttled to ≥ 50 ms keeping the first and last event of each phase; not for resources or batch; never shares a fetch; `makeFetchDriver({ XMLHttpRequest })`; fetch fallback without events where there's no XHR; `t.progress()` in the fake. Record: [`research/upload-progress/`](research/upload-progress/README.md) (coordinator, on the spike) |

## 1. Scope

### 1.0 Spike (S)

**S-1 Upload progress API** — done 2026-10-17 (D555). XHR is the only engine-neutral upload
progress; streamed fetch bodies fail in Chromium/WebKit over HTTP/1.1 and send the wrong bytes in
Firefox.

### 1.1 Quick fixes (Q)

**Q-1 `PROPS = any` keeps `state` typed.** `ViewProps` (`src/index.d.ts`) gets the same
`0 extends (1 & PROPS)` guard `ElementProps` uses, so `Component<State, any>` still types `state`,
`context`, `children`. Type-test in `type-tests/`; fix `examples/ts-example-2048/src/tile.tsx`.

**Q-2 SYG731 false positives.** `sygnal-check/src/rules/a11y/syg731-toggle-state.js` also skips
an element when its state is announced another way: its text children or `aria-label` read a
field of the class condition, it has `aria-live`, or a literal `role="status" | "alert"`. The fix
text suggests `aria-pressed` only for a toggle (a `!field` flip), else says how to announce the
change. Tests: the Copy-button case, a real toggle still flagged.

**Q-3 Test wait timeout hint.** When `next` / `waitForState` / `settle` time out on the fake
clock and a fake timer is still pending after the deadline, the message names it ("a timer fires
N ms after the timeout") and how to wait longer (`t.next(pred, ms)` / `timeoutMs`). The 2000 ms
default goes into llms.txt and the skill's testing section.

**Q-4 Templates run tsc.** The TypeScript templates' check script runs `sygnal-check` and
`tsc --noEmit`; `integration/typescript.md` says sygnal-check doesn't check types.

**Q-5 The stale `init-sygnal-project` skill.** It's user-local (`~/.claude/skills/`, not shipped):
reduced to "run `npm create sygnal-app@latest`, then follow sygnal-dev". The shipped
`skills/sygnal-dev/SKILL.md` names create-sygnal-app for new projects.

**Q-6 SYG609 for intent sources.** sygnal-check reports an intent reading a driver source
(`HTTP.select(...)`) that `run()`'s literal drivers object doesn't have, as the runtime already does.

### 1.2 Upload and download progress (U, D555)

**U-1 The driver.** `src/extra/fetchDriver.ts`: a request with `progress` goes through an XHR
transport that returns a `Response` (so parse, status, retry, timeout, validate stay as they are),
reporting throttled progress per phase. `progress: 'ACTION'` replies to the sender (and counts as a
reply action for abort-on-dispose); `progress: true` (or a string with no sender) goes to
`HTTP.progress(category?)`, scoped like `select()`. Driver option `XMLHttpRequest`. Dev warning
for init keys XHR ignores (a new SYG code in the HTTP range).

**U-2 Types and the fake.** `index.d.ts`: `progress` on the request, `HttpProgress` event type,
`progress()` on the source. `renderComponent`: progress requests answered by the in-memory fetch;
`t.progress(target, { loaded, total, phase })`.

**U-3 sygnal-check.** `progress: 'X'` is a reply action name for SYG102 (reachable) and SYG112
(unknown action), like `ok` / `error`.

**U-4 Docs.** `guide/http.md` (progress), a file-upload recipe (file input in the intent →
`FormData` → `HTTP` with `progress`, plus how it sits next to `form()`), llms.txt and skill
lines; browser test in all three engines.

**U-5 `multipart` as data** (D560, added 2026-10-18 on the user's review of the U-4 example).
`multipart: { file: state.file, title }` on a request, the multipart counterpart of `json`: the
driver builds the FormData (a File/Blob a file part, arrays repeat the name, nulls skipped,
objects as JSON text), drops a `content-type` header (the browser's boundary), POST by default,
never cached. `new FormData()` in a model was imperative and opaque in `t.requests`. Docs, demo,
llms/skill and the browser test use it; `body: formData` stays the escape hatch.

### 1.3 SSE auth headers (E)

**E-1** `SseConnection` gets `headers` (an object or an async function returning one). A
connection with headers is read with `fetch` and the SSE parser from `src/extra/ai/transports/shared.ts`
(extended with `id` / `retry`; `Last-Event-ID` on reconnect), reconnecting with the connection's
`reconnect` policy. Without headers, native EventSource as now. Socket fake and docs updated.

### 1.4 `form` typing (F)

**F-1** `form()` infers the values type from the schema's Standard Schema `types` (input for
`values`, output for the submit payload) when `values` doesn't give one; `fields` keyed by the
values' keys; `SUBMIT` / `DONE` / `RESET` / `ERRORS` payloads typed. Type-tests with a zod-shaped
and a valibot-shaped schema stub. `UsesState` / `UsesActions` documented in llms.txt and the skill.

### 1.5 Multi-instance tooltips (T)

**T-1** `tooltips({ trigger: '[data-tip]', showDelay?, hideDelay? })` in `sygnal/ui`: one behavior
for every matching trigger on the component, one slice `{ openId, … }`, the tip found by the
trigger's `aria-describedby` / `data-tip` id. SYG730's fix text mentions it for repeated terms.
Docs page section and a browser test.

### 1.6 Docs only (D)

- **D-1** Widgets: pass a new array/object to redraw (llms.txt, skill).
- **D-2** ELEMENT commands built outside the return: annotate `: ElementCommand` or `satisfies`.
- **D-3** Switchable docs link `makeRouter`'s scroll handling.
- **D-4** `UsesState` / `UsesActions` (with F-1).
- **D-5** The 2000 ms wait default (with Q-3).

## 2. Order

1. Q-1…Q-6 and D-1…D-3, D-5 (independent, small).
2. U-1…U-4.
3. E-1, F-1, T-1.
4. Full gate (`npm test`, sygnal-check, docs build + check-live in three engines, size gate),
   then PR to main.
