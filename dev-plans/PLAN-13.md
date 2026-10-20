# PLAN-13: Feedback from building Temper on Sygnal 7.0

**Goal:** fix what a session building a medium-sized app (Temper's Tune UI) found on Sygnal 7.0.0 /
sygnal-check 0.11.0, after the assessment of 2026-10-19 confirmed it against the released code:
one real bug (an invalidation / navigation race), a set of small fixes and additions, and five
larger features that need a decision or a spike first.

**Source:** `/Users/troy/kindo-temper/vault/Questions/Sygnal Upstream Feedback.md` (item numbers
#11–#45 below refer to its lines). The assessment's "no change needed" items are out of scope:
#14 (types are tsc's job, D554), #17 / #24 / #23 (settled in 7.0's docs), the suppression comment
in #33 (works; only a wrapped or blank-separated comment fails), #11 (the skill is current; the
plugin needs a local marketplace update), and #44's exact version pins (carets stay).

**Release:**
- **sygnal minor** (7.1.0): the race fix, the `next()` warning (dev entry), exported reply
  helpers, SSE `meta` / `resume` / `staleAfterMs`, statics with context, test route seeding. All
  additive; core bytes only for the race fix and context in statics (measured against the size gate).
- **sygnal-check minor** (0.12.0): reply names through helpers and consts, SYG256 precision, the
  `next()` rule, `replyKeys`, imported `next` helpers, an `xstream` default-import hint.
- **create-sygnal-app minor** (2.10.0): no Google Fonts, a `.gitignore`.
- VS Code extension / Claude Code plugin: bundle and skill updates only if their content changes.

**Status:** planned 2026-10-19. Tracker: [`PLAN-13-status.md`](PLAN-13-status.md).

**Branches:** integration `claude/plan-13-temper-feedback`, cut from `main` (97b7e285, after the
7.0.0 post-release PR #55); spikes as `exp/p13-*` with reports in `dev-plans/research/p13-*/`.

**IDs:** items R- (the race), N- (`next()`), C- (sygnal-check), T- (templates), X- (xstream), D-
(driver authoring), S- (SSE), F- (features), SP- (spikes); questions P13-Q1…; decisions and gaps use a
**reserved block, D600–D649 and G-900–G-949** (PLAN-11 holds D550–D599 / G-850–G-899; PLAN-12 used
plan-local P12-D IDs).

**Invariants:**
- One timing contract (7.0): every new example and test uses the committed state, with
  `props.previousState` for old values.
- No new runtime dependencies (D209). New public API gets types, docs, llms.txt / skill lines and
  a `renderComponent` path.
- Dev-only diagnostics stay out of production bundles; the size gate (43,000 B) holds, and any
  core byte cost is measured and reported per item.
- sygnal-check stays type-free (D554) and conservative: a change that can hide a real SYG102 / SYG112
  is a false negative to weigh, never a silent default.
- Docs, examples and templates stay strict-clean; llms.txt keeps its line cap.

**Spikes:** any item may start with a spike when its design or cost is unclear, the same way
earlier plans did (PLAN-10 S-1, PLAN-11 S-1, PLAN-12's single-contract spike): a branch
`exp/p13-<item>`, a short report in `dev-plans/research/p13-<item>/README.md` (question, what was
built, numbers, recommendation), and a decision recorded in the tracker before production work.
The suggested spikes are listed per item (SP-…); others can be added when an item turns out
harder than estimated.

---

## 0. Decisions already made (2026-10-19)

| # | Decision |
|---|---|
| D600 | **Fix the confirmed feedback items** except the assessment's "no change needed" group (user) |
| D601 | **Spikes are allowed** wherever an item's design or cost is unclear; their outcome is recorded before production work (user) |

## 1. Scope

### 1.1 The bug (R), Phase 1

**R-1 Invalidation / navigation race (#36).** A write whose `ok` action navigates, with an
`invalidates` prefix or tag matching a lens-bound child's resource, refetches the child's **old**
request after the new one was sent, superseding it: the new page shows the old record.
Reproduced on 7.0.0 (`/api/items/2`, then a stale `/api/items/1` that cancels it), with URL-prefix
**and** tag invalidation. Cause: `load()` in `src/extra/fetchDriver.ts` captures `R.q`, then
`write()` dispatches RESOURCE synchronously; that action recomputes the child's statics and a
nested `load()` sends the new request; the outer `load()` then sends its stale request in the same
lane. Fix: after the write, stop when the resource's request changed or it was paused
(`if (R.q !== q || R.p) return`), verified in a scratch copy; it also covers refresh and polling.
Regression tests for a lens child, a key child and a root resource, with prefix and tag
invalidation, plus a docs note if the workaround was documented anywhere.
- *SP-R1 (optional):* audit the driver for other re-entrant paths where a synchronous reply can
  change the state a caller already captured (`write` → `reply` inside loops: `inval`, `upd`, the
  focus / reconnect refetch).

### 1.2 Small fixes and additions, Phase 2

**N-1 `next()` to an action the component doesn't handle (#45).** A child's `next('ENTER')` for
an action only its parent handles silently does nothing (the P0 "Loading your Task Card…" hang).
A dev-only warning (a new 1xx code) on the core's `onNext` hook in `checks/next.ts`: the action has
no model entry in this component and isn't built in; did-you-mean, and the fix "send it up with
`PARENT` or `EVENTS`" when an ancestor handles it. Plus a sygnal-check rule for a literal
`next('X')` with no entry in the same component. 0 production bytes.

**C-1 Reply names through helpers and consts (#25, #43).** sygnal-check reads reply keys only in
object literals a sink returns directly. Also read object-literal arguments of a returned call
(`req('/a', { ok: 'GOT_A' })`, `api.get_run(args, { ok: 'RUN' })`), resolve a returned identifier
(`HTTP: () => SNAP`), and resolve `events` / spec values held in consts in `connections`
(`modelEntries.js`: `returnedObjects` / `collect`, `connectionNames`). Check SYG112, SYG152 and
the graph's request list with the wider set.

**C-2 SYG256 precision.** The Temper leave-guard (`EDIT: { STATE: … dirty: true, edit: { …,
[keyOf(state)]: … } }, ROUTER: (state) => state.dirty ? ABORT : …`) was missed on 7.0 because any
call in the STATE body aborts the proof. Only abort for calls that can affect the guarded fields
(a call nested in a non-literal property value is already UNKNOWN); calls in a test or guard
position and assignments still abort. Test with the Temper shape.

**T-1 create-sygnal-app templates (#44).** Six templates (vite, vite-pwa, astro; JS and TS) load
Google Fonts: use a system font stack (or self-host). No template writes a `.gitignore` (npm
strips it from the package): ship `template-*/gitignore` and rename it to `.gitignore` when
scaffolding (`node_modules`, `dist`, `.vite`, `.astro`, `*.local`, the mcp-app server build).
Release smoke covers both.

**X-1 `import xs from 'xstream'` (#34).** Under Vite 8 and Node ESM a default import of xstream
(CommonJS with `exports.default`) gives the module object in a `"type": "module"` package, so
`xs.create` is undefined; Sygnal's own code goes through `xstreamCompat`. Docs: driver authors use
`import { xs } from 'sygnal'` (custom-drivers guide, llms.txt, skill); fix the stray
`import xs from 'xstream'` in `guide/accessibility.md`. Plus a sygnal-check info hint for a default
import from `'xstream'` with the fix.

**D-1 Reply actions for custom drivers (#32).** The reply protocol (`makeReplies`, `senderOf`,
`__sygnalReplies`, `__emitterId`) isn't exported; a custom driver with progress or several replies
re-implements it from internals. Export `makeReplies` and `senderOf` from `sygnal`, typed and
documented as driver authoring (a guide section with a small driver that replies more than once).
- *SP-D1 (optional):* whether a `defineDriver({ replies: ['ok', 'error', 'progress'] })` helper is
  worth it on top, and whether it could also declare reply keys to sygnal-check (see C-4).

**S-1 SSE ids, resume and dead streams (#41, #42, #28).** The driver drops the SSE event id, and
after a hard reconnect (EventSource gave up, e.g. a proxy 502; also the `headers` path after a
non-2xx) it forgets it; nothing notices a silent half-open stream. On `SseConnection`:
`meta: true` (actions get `{ data, id, event }`), `resume: true | 'param'` (the driver keeps the
last id per transport; EventSource reconnects add it to the URL, the fetch path sends
`Last-Event-ID`), and `staleAfterMs` (reconnect when nothing arrives for N ms; fetch-path
heartbeat comments count, EventSource needs a real event; also for WebSocket). Socket fake, docs.
- *SP-S1 (optional):* real-browser check of half-open behaviour through a proxy (Vite dev proxy)
  in the three engines, and the URL-parameter convention for `resume`.

### 1.3 Larger features, Phase 3 (decide per item; spike first where marked)

**F-1 Statics see context (#37).** `resources` (and the other statics: `timers`, `connections`,
`head`, `route`…) get only the state, so route params are copied into each page's slice. Pass
`(state, context)`; the statics re-run when the context they read changes (the skip in
`statics.ts` compares state and visibility only); SSR's `withResources` too.
- *SP-F1 (recommended):* which statics, the skip condition (context read-tracking as views do,
  D168) and its cost; core bytes against the size gate.

**F-2 Deep-link tests start on the real route (#38).** `router.current()` in `initialState` runs at
module load, before `renderComponent({ router, url })` exists, so a test starts on `/` and sends a
wasted request. `renderComponent` delivers the root's `route` action with the test URL before the
first render (tests only); optionally the core seeds a declared `route` before the first render
for apps too (removing the need for `router.current()` in `initialState`).
- *SP-F2 (optional):* the core-level variant's interaction with SSR, Vike and hydration.

**C-3 `next()` inside an imported helper (#26).** sygnal-check follows same-file helpers only.
Follow a call that passes `next` (or the third parameter) into an imported function: resolve the
callee, map the parameter, scan its body (depth cap), report positions in the helper's file; the
language server re-checks dependants when the helper file changes.

**C-4 Custom reply keys (#33).** `cancelled: 'UP_CANCELLED'` on a custom driver request gives
SYG102. A `replyKeys` setting in `sygnal-check.config.json` (global, or per sink:
`{ "UPLOAD": ["progress", "cancelled"] }`), validated like the other settings, feeding SYG102 and
SYG112; optionally an UPPER_CASE value naming a model entry downgrades SYG102 to info with a fix
text pointing at `replyKeys` (never silences it).

**F-3 Per-page Switchable state (#35).** Switchable binds one `state` for every page, so per-page
slices need a lens host per page. Options: a per-page map (`state={{ projects: 'pages.projects' }}`,
each entry a key / path / lens / byId, its own cell and binding lifetime) and/or `share` of
read-only keys. Decide after F-1: if pages read `route` from context, most of the need for `share`
goes away.
- *SP-F3 (recommended):* the map's lifetime semantics with 7.0's binding rules (remake only the page
  whose target changed), types, sygnal-check, size.

### 1.4 Docs and release (alongside each item)

Each item updates its guide, llms.txt / skill lines, the CHANGELOG `[Unreleased]` entry and
tests. Error codes follow the usual steps (codes.ts, explanations, generated reference).

## 2. Order

1. **R-1**, then release it promptly if wanted (a patch, 7.0.1, is possible on its own).
2. Phase 2: N-1, C-1, C-2, T-1, X-1, D-1, S-1 (independent; C-1 and C-2 share sygnal-check's
   model code; spikes SP-D1 / SP-S1 only if needed).
3. Phase 3: SP-F1 → F-1; F-2; C-3; C-4; SP-F3 → F-3 (after F-1). Each needs the user's go-ahead
   on its spike's recommendation.
4. Full gate (library, examples, types, browsers ×3, perf, size, sygnal-check, docs + check-live
   ×3, editors, release smoke), PR(s) to `main`.

## 3. Outside Sygnal (for Temper)

- When the SP-5.3 router spike moves to 7.0, its leave-guard must read the old flag:
  `ROUTER: (state, data, next, { previousState }) => previousState.dirty ? ABORT : …`; run its tests
  with `renderComponent(C, { timingAudit: true })` to find other reads like it.
- Update the local Claude Code plugin to 0.2.0: `claude plugin marketplace update sygnal`, then
  `claude plugin update sygnal@sygnal`.
