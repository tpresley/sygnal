# PLAN-6 Status Tracker

Tracks progress for [PLAN-6.md](PLAN-6.md) (`sygnal/ai`: LLM inference in apps, and apps that agents can operate). The coordinator maintains it.

**Numbering:** decisions continue from **D240** (D240–D250 below), gaps from **G-581**.

**Integration branch:** `plan6-integration`, cut from `plan6-plan` (`e3c86070`, = `main` `2d3569bf` + the research and the plan) on 2026-10-09, in the main checkout. Spikes run in agent worktrees on `exp/p6-s1` … `exp/p6-s5`.

**State:** Phase 0: 0-A and spikes 0-S1…0-S5 done (reports in `research/p6-spikes/` on each spike branch). P6-Q8…Q32 accepted as recommended (D251–D275); PLAN-6 updated with Phase 0's findings. Phase 1 next.

## Decisions

| # | Date | Decision |
|---|---|---|
| D240 | 2026-10-09 | One subpath, `sygnal/ai`, for everything in PLAN-6; transports needing a library take it as an optional peer (D209) |
| D241 | 2026-10-09 | WebMCP ships experimental (`experimentalExposeWebMcp`), tracks the draft, outside semver until the origin trial ends (Chrome 156) |
| D242 | 2026-10-09 | The static is `agent` (`{ name, description, read, actions }`); `sygnal-check` suggests it for `agents`/`tools`; `chat` and `commandBar` use the host's `agent` by default |
| D243 | 2026-10-09 | Docs transports split by guide: getting started / local / live examples on `openResponses()` + Ollama; production guides on an AI SDK server (`uiMessageStream()`) with an open-relay warning |
| D244 | 2026-10-09 | P6-Q1: release as 6.1.0 |
| D245 | 2026-10-09 | P6-Q2: `llms.txt` limit raised to 320 lines (+5) |
| D246 | 2026-10-09 | P6-Q3: eval tasks 35–38 with a React arm; spend asked for before any run |
| D247 | 2026-10-09 | P6-Q4: MCP Apps (X-1) in Phase 3 if time allows, otherwise 6.2 |
| D248 | 2026-10-09 | P6-Q5: transports wave 1 `uiMessageStream`, `openResponses`, `chatCompletions`, `chromePrompt`; wave 2 `anthropicMessages`, `agui`, `fromAISDK` |
| D249 | 2026-10-09 | P6-Q6: the `chat` behavior's tools are the host's and its live descendants' `agent` declarations by default; `agent: false` / `agent: [Comp, …]` narrows |
| D250 | 2026-10-09 | P6-Q7: WebMCP context = a read-only tool + a state summary in tool descriptions, re-registered on change |
| D251 | 2026-10-09 | P6-Q8: Reasoning chunks fire `delta` too (same frame limit; `delta` holds only the new text) |
| D252 | 2026-10-09 | P6-Q9: Messages use real AI SDK `UIMessage` parts (`tool-<name>` with `state`), so they round-trip to AI SDK servers |
| D253 | 2026-10-09 | P6-Q10: The L-1 driver and the A-1 layer live in `sygnal` (`src/extra/ai/`), re-exported by `sygnal/ai` (still the documented import): one copy (G-581), usable by `renderComponent`, tree-shaken from apps (0 B unused) |
| D254 | 2026-10-09 | P6-Q11: Only `coalesce` is public; the 15 ms floor and the 100 ms hidden-tab fallback stay internal |
| D255 | 2026-10-09 | P6-Q12: `t.stream` ends the stream by default (`{ end: false }` keeps it open); `t.respond('LLM', text)` is the one-chunk shorthand |
| D256 | 2026-10-09 | P6-Q13: An agent call that changes nothing is `ok: false` ("already so, or the input matched nothing"); `idempotent: true` makes it `{ ok: true, unchanged: true }` |
| D257 | 2026-10-09 | P6-Q14: Items hidden by a Collection filter have no tool: the error says so, and the docs show an owner-level by-id action |
| D258 | 2026-10-09 | P6-Q15: `agent.label(state)` labels Collection item keys for the model |
| D259 | 2026-10-09 | P6-Q16: `abort(reason)` is exported from `sygnal` (0 core bytes) so reducers don't import `sygnal/ai` |
| D260 | 2026-10-09 | P6-Q17: Agent tool calls run one at a time by default |
| D261 | 2026-10-09 | P6-Q18: `t.callTool` on a consequential action without `confirm` throws |
| D262 | 2026-10-09 | P6-Q19: Plain JSON Schema as `input` only through `jsonSchema(json[, { validate }])` |
| D263 | 2026-10-09 | P6-Q20: A lossy schema conversion sends what can be expressed, with a SYG243 warning; validation still enforces the rest |
| D264 | 2026-10-09 | P6-Q21: `repair` (numeric/boolean strings) on by default; `repair: false` turns it off |
| D265 | 2026-10-09 | P6-Q22: The Collection key parameter is `id`, or `item` when the input has its own `id` |
| D266 | 2026-10-09 | P6-Q23: Strict mode is a transport option, off by default |
| D267 | 2026-10-09 | P6-Q24: WebMCP gate: `--enable-features=WebMCP` on every Chromium run; the polyfill page in a second Chromium launch, Firefox and WebKit |
| D268 | 2026-10-09 | P6-Q25: `@mcp-b/webmcp-polyfill` exact-pinned, test-only; the experimental guide mentions it for other browsers; `sygnal` never depends on it |
| D269 | 2026-10-09 | P6-Q26: The `form` behavior emits WebMCP form attributes as `attrs-*` (0 core bytes), with a `sygnal-check` hint for a bare `toolname` |
| D270 | 2026-10-09 | P6-Q27: Form tools default to `autosubmit: false` |
| D271 | 2026-10-09 | P6-Q28: No CDP `WebMCP.invokeTool` path in the gate |
| D272 | 2026-10-09 | P6-Q29: Live AI demos stream through the real `openResponses()` transport against a streaming demo route (new item DX-1) |
| D273 | 2026-10-09 | P6-Q30: `sygnal/ai` ships an Open Responses event encoder shared by tests and docs |
| D274 | 2026-10-09 | P6-Q31: No `export const drivers` convention (and no scripted transport) in live blocks |
| D275 | 2026-10-09 | P6-Q32: No docs interaction scripts in the gate: stream-on-load demos plus L-1's browser tests |

## 0-A baseline (2026-10-09)

**Budgets** (measured on `plan6-integration` after `npm run build`):

| Budget | Value | Left for PLAN-6 |
|---|---|---|
| Core (kanban gzip, nativeGlobalThis false; gate 42,700 B, D230) | 42,690 B | **10 B**: PLAN-6 is designed for 0 core bytes |
| `llms.txt` | 313 lines | **7 lines** (limit 315 → 320, D245; the test change lands with Phase 4's sync) |
| SKILL.md | 42,100 B | no gate in tests; PLAN-5 held it at 42,100 B (D238) |

**Code reservations (§4):** SYG150–159, 240–249, 440–449, 670–679, 730–739 are all free in `src/extra/diagnostics/codes.ts` (checked 2026-10-09). Highest codes per lane: 149, 238, 302, 435, 508, 669, 724, 903.

**Experiments re-run on this build** (`research/llm-experiments/`, against local Ollama 0.40.2):

| Experiment | Result | Same as the research |
|---|---|---|
| 1: renders per 300-token reply | none / microtask 302; frame 22–24 (Anthropic, Responses, AI SDK bridge); tools, round trip, abort, latest pass | yes |
| 4: decisions through `makeFetchDriver` (`nimble`) | labels 10/10, urgency 6/10, 1 below 0.6; median 340 ms (cold 2.6 s: the model was loading) | yes |
| 5: decision command bar | 8/8 | yes |

**Eval spend estimate (D246; to be asked for before Phase 4 runs):** about **$55** for tasks 35–38, both arms, Opus and Haiku, from PLAN-5's 0-A estimate (≈ $70 for five tasks plus the forms A/B), and about **$28** for the S-14 learn-time check (`p5-s14b-opus` cost $27.76). The local-model operability check (task 38 and the reference solutions) costs nothing.

## Phases

| ID | Work | Status | Branch | Merge | Notes |
|---|---|---|---|---|---|
| 0-A | Baseline, decisions, reservations, experiments re-run, eval estimate | ✅ done | `plan6-integration` | 2026-10-09 | Above |
| 0-S1 | Streaming in the core (L-1, L-4) | ✅ done (spike, not merged) | `exp/p6-s1` (`6fa74614`) | 2026-10-09 | Driver on `replies.ts`: sender routing, latest, abort, dispose mid-stream, Collection isolation; 27 vitest + 7 browser tests × 3 engines. Frame coalescing: 45–65 renders / 300 tokens over SSE; Firefox headless rAF is 120 Hz → cap at ≥ 15 ms between deltas (G-582); budget `ceil(duration/16)+2` holds (vitest fake timers: 39 / 40). Hidden tab: race rAF with a 100 ms timer. L-4 fake: real driver over an in-memory transport (`t.requests/stream/fail/respond`, `{ end: false }`). Driver 1,542 B gz + openResponses 1,001 B (both 2,161 B); kanban 42,690 B (0 B). **G-581**: a second diagnostics copy in a subpath bundle silences dev checks |
| 0-S2 | Agent layer on the runtime API (A-1, A-4), 0 core bytes | ✅ done (spike, not merged) | `exp/p6-s2` (`71f702bd`) | 2026-10-09 | 0 core bytes (42,690 B; only `'agent'` added to the `ActionCause` type). Hidden Switchable pages stay alive → filter on `iv.shown`, rescan per flush; HMR → take the `run()` result. Collection items: one tool per item type, `id` enum of live keys. No-op: structural compare per STATE handler via `wrapHandler`, plus "any sink fired" counts as an effect; `abort(reason)` at 0 B. `when`/`read` cached by state identity (1 call each per flush at 100 items). Confirm awaited before dispatch; calls serialized. `t.tools/callTool/agentContext` prototyped; 20 tests. Layer 3,149 B gz. Ollama via the layer: llama3.2 3/3, qwen3:8b 2/3 (1 timeout) with state in context; llama3.2 0/3 without |
| 0-S3 | WebMCP in a real browser (A-2, A-3) | ✅ done (spike, not merged) | `exp/p6-s3` (`db1d7e72`) | 2026-10-09 | chromium-1243 = Chrome 153.0.8010.12 with WebMCP built in; `--enable-features=WebMCP` (= `#enable-webmcp-testing`); `document.modelContext` only. Native: `registerTool(tool, { signal })` (Promise), `getTools()`/`executeTool(handle, json)`, `toolchange`; drops `consequentialHint`; enforces no schemas or budgets; declarative forms work. `@mcp-b/webmcp-polyfill@6.0.0` (exact pin, test-only) matches the draft with small differences. Todo round trip: native Chromium 20/20, polyfill Chromium/Firefox/WebKit 20/20; no-WebMCP no-op; Chromium suite 364/364 with the switch |
| 0-S4 | Schemas: `input` / `output` contract | ✅ done (spike, not merged) | `exp/p6-s4` (`72219289`) | 2026-10-09 | Zod 4.6.5, Valibot 1.5.0 (+ to-json-schema 1.8.0, via `toStandardJsonSchema()`), ArkType 2.2.8 × 21 cases: always send the **input-side** JSON Schema. Portable normalization (all consumers) + opt-in strict layer (transports); 63/63 pass Ajv and round-trip. `{ value }` wrapping + lenient unwrap; `repair` (numeric/boolean strings): llama3.2 9/15 → 15/15; Ollama doesn't enforce schemas. Plain JSON Schema via `jsonSchema()` (validator 885 B, 126/126 vs Ajv). Type sketch checks keys and data types (10/10). Helpers 1,145 B + repair 439 B + strict 1,366 B gz, 0 core |
| 0-S5 | Live examples for AI docs | ✅ done (spike, not merged) | `exp/p6-s5` (`04bf3ba7`) | 2026-10-09 | Live server streams (`{ sse }` / `{ stream }` routes as a real ReadableStream); live runtime provides `LLM` = the chat driver over the real `openResponses()` against the demo server. Spike page: streaming chat + Stop, stream-on-load, an `agent` tool call, `decide()`, scripted alternative. check-live: spike page 3/3 per engine; all 87 pages pass on Chromium/Firefox/WebKit; interaction script 8/8 × 3 runs × 3 engines. Stand-in `sygnal/ai` 2.7 KB gz |

## Gaps

| ID | Found in | Gap | Status |
|---|---|---|---|
| G-581 | 0-S1 | Bundling `replies.ts` into a subpath bundle brings a second diagnostics module that replaces `globalThis.__SYGNAL_DIAGNOSTICS__` and silences the app's dev checks (13 browser tests failed, suite hung). Fix: take internals from `sygnal`; gate: no subpath bundle contains a diagnostics copy | open (Phase 1) |
| G-582 | 0-S1 | Per-frame coalescing doubles renders above 60 Hz (Firefox headless rAF is 120 Hz): cap at ≥ 15 ms | open (L-1) |
| G-583 | 0-S1, 0-S3 | `browser-tests` runner: fixed 90 s limit (new suites push Chromium past it under load) and no way to pass launch args (`--enable-features=WebMCP`) | open (Phase 1) |
| G-584 | 0-S1 | A chat request without an `error` action loses failures silently: log them | open (L-1) |
| G-585 | 0-S1 | `t.fail` on such a request uses the HTTP fake's wording (points at `LLM.errors()`, which doesn't exist) | open (L-4) |
| G-586 | 0-S1 | A chat request sent from outside a component is dropped with no diagnostic | open (L-1) |
| G-587 | 0-S1 | `{ abort: true, key }` form not handled | open (L-1) |
| G-588 | 0-S1 | Hidden-tab behaviour is only testable by stubbing rAF / `visibilityState` | open (L-1 tests) |
| G-589 | 0-S1 | PLAN-6's "UIMessage-compatible" `tool-call` parts aren't real UIMessage parts (`tool-<name>` with `state`) | decided (D252); open (plan) |
| G-590 | 0-S2 | Items hidden by a Collection filter are disposed, so their tool can't reach them | decided (D257); open (impl) |
| G-591 | 0-S2 | The same key in two Collections of one item component (board columns) routes to the first | open (A-1, SYG441) |
| G-592 | 0-S2 | The Collection item key isn't on `InstanceView` (the layer reads `state.id`) | open (A-1) |
| G-593 | 0-S2 | Setting an already-set value is reported as a failure | decided (D256); open (impl) |
| G-594 | 0-S2 | Item id enums carry no labels | decided (D258); open (impl) |
| G-595 | 0-S2 | A `setState` on a hidden page's state isn't published until a later flush | open (A-1) |
| G-596 | 0-S2 | The layer's `wrapHandler` copies the core's constant-handler semantics (drift risk) | open (A-1 tests) |
| G-597 | 0-S2 | The action log relabelled `cause: 'agent'` as `'intent'` (one-token fix in the spike) | open (A-1) |
| G-598 | 0-S3 | `toolname` etc. written in JSX become DOM properties, not attributes | decided (D269); open (impl) |
| G-599 | 0-S3 | The polyfill can't be uninstalled: WebMCP tests need their own page | open (A-2 tests) |
| G-600 | 0-S3 | Native and polyfill differ (input as JSON string vs object, schema string vs object, result shapes, errors): an agent-side test helper must normalize | open (A-2 tests) |
| G-601 | 0-S3 | Chrome 153 drops `consequentialHint` and enforces neither schemas nor budgets: Sygnal enforces them | open (A-2) |
| G-602 | 0-S3 | Without `toolautosubmit` an agent's form call waits for the user | decided (D270); open (impl) |
| G-603 | 0-S3 | `aria-label` isn't used for `toolparamdescription` | open (A-3) |
| G-604 | 0-S4 | L-1's `ok` has no `value` for structured output | open (L-1) |
| G-605 | 0-S4 | PLAN-6 doesn't say which JSON Schema side is sent, or describe wrapping and the lenient unwrap | open (plan edit) |
| G-606 | 0-S4 | PLAN-6 §6 promises raw JSON Schema as `input` | decided (D262); open (impl) |
| G-607 | 0-S4 | No `repair` step | decided (D264); open (impl) |
| G-608 | 0-S4 | ArkType rebuilds `~standard` on each read: cache by schema object | open (A-1) |
| G-609 | 0-S4 | Anthropic caps strict tools per request | open (L-2 strict) |
| G-610 | 0-S4 | ArkType's `.describe()` replaces its own error messages | open (docs) |
| G-611 | 0-S4 | `sygnal-check` candidates: an unwrapped Valibot `input`; a `Date` `input` | open (K-1) |
| G-612 | 0-S5 | check-live never clicks: Stop / abort in demos unchecked | decided (D275); open (impl) |
| G-613 | 0-S5 | A scripted transport is invisible to check-live | decided (D272/D274); open (impl) |
| G-614 | 0-S5 | `sygnal-check` gives false SYG102 for `delta`/`tool` reply keys | open (K-1) |
| G-615 | 0-S5 | The live `LLM` default should apply page-wide, not only to demos importing `sygnal/ai` | open (docs infra) |
| G-616 | 0-S5 | The live demo server has no unit tests | open (docs infra) |

## Log

- 2026-10-09 — PLAN-6 approved; P6-Q1…Q7 accepted as recommended (D244–D250). `plan6-integration` cut. 0-A done. Spikes 0-S1…0-S5 started in parallel worktrees.
- 2026-10-09 — Spikes 0-S1…0-S5 done (0 core bytes everywhere). G-581…G-616 recorded. Questions P6-Q8…Q32 (consolidated from the five reports) sent to the user; PLAN-6 edits wait for the answers.
- 2026-10-09 — User accepted P6-Q8…Q32 (D251–D275). PLAN-6 §1–§6 updated with Phase 0's findings (L-1 location and coalescing, A-1 discovery/no-op/input contract, A-2/A-3 WebMCP facts, new DX-1, gates, SYG243/675/676).
