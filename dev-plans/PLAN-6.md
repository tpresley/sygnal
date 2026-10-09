# PLAN-6: `sygnal/ai`: LLM inference in apps, and apps that agents can operate

**Goal:** make the two AI tasks a Sygnal developer now meets as easy as anything else in Sygnal:

1. **Call LLMs from an app.** That covers streaming chat with tools, decision models (Jev and
   similar), and an in-app assistant, all through drivers and behaviors with testing fakes.
2. **Let agents operate the app.** That covers browser agents through WebMCP, the app's own
   assistant, and coding agents through a dev endpoint, all from one declaration per component.

**Release:** proposed **6.1.0** (additive: a new subpath, a new static, new diagnostics; WebMCP
experimental and outside semver). `sygnal-check` and `create-sygnal-app` get minor releases
with it. P6-Q1.

**Status:** plan only. Execution starts when the user approves this plan and answers the §5
questions. Phase 0 cuts `plan6-integration` from `main` and creates `dev-plans/PLAN-6-status.md`
in the PLAN-5 format.

**Branches:**
- integration: `plan6-integration`;
- subagent branches: `p6-*`;
- experiments and spikes: `exp/p6-*`.

**IDs:**
- items L- (LLM chat), M- (decision models), A- (agents), K- (checker), E- (dev endpoint),
  X- (MCP Apps);
- questions P6-Q1…;
- decisions and gaps continue the global numbering: **D240…** and **G-581…**.

**Inputs:**
- The research: [`research/llm-integration.md`](research/llm-integration.md) (the API
  landscape, options, experiments 1–5, the decisions below) and
  [`research/llm-integration-samples.md`](research/llm-integration-samples.md) (the proposed API
  in canonical forms). Subagents read both before starting an item.
- The prototypes: [`research/llm-experiments/`](research/llm-experiments/) (`llmDriver.js`,
  `adapters.js`, `exposeToAgents.js`, the mock SSE server, experiments 1–5; see its README).
- PLAN-3's reply-action machinery (`src/extra/replies.ts`), `makeFetchDriver`, `resources`
  and the HTTP/socket fakes in `src/extra/testing.ts`; PLAN-5's `form` behavior and
  `src/extra/standardSchema.ts`.
- The runtime API (`src/core/hooks.ts` `RuntimeAPI`, `InstanceView`, `Def.handlers`) and the
  hook-layer pattern used by `sygnal/diagnostics` and `sygnal/devtools`.

**Invariants:** MVI stays intact, as in PLAN-1…5.
- Every LLM call is a driver request from a model sink; no component calls `fetch` or a
  provider SDK.
- **An agent's tool call is an action.** It goes through the same queue, reducers and flush as
  a click, with `cause: 'agent'`. Nothing writes state around the model.
- Views have no event binding and never name an action.
- Nothing is exposed to an agent that a component didn't declare in `agent`.

**Words:**
- "agent" for an LLM that calls the app's tools: a browser agent, the in-app assistant, or a
  coding agent;
- "the `agent` declaration" or "the `agent` static" for `Component.agent`;
- "tool" only for what an agent sees, generated from the declaration;
- "transport" for the module that speaks one wire protocol to the chat driver;
- "decision" for a state-plus-questions request (Jev, Ollama `/v1/systemone`, OpenAI
  Decisions).

---

## 0. Decisions already made (2026-10-09)

0-A records these as D240–D243 in `PLAN-6-status.md`.

| # | Decision |
|---|---|
| D240 | **One subpath, `sygnal/ai`**, for everything in this plan: the chat driver, the transports, the `chat` behavior, the decision helpers, the command bar and the WebMCP layer. Transports that need a third-party library take it as an optional peer (D209). |
| D241 | **WebMCP ships experimental**, like Angular: the export says so (`experimentalExposeWebMcp(app)`), it tracks the draft spec, and it's outside semver until Chrome's origin trial ends (Chrome 156). |
| D242 | **The static is `agent`**: `Component.agent = { name, description, read, actions }`. A human reader recognizes it as the AI entry point, and the singular names an aspect of the component, like `route` and `head`. `sygnal-check` suggests `agent` for `agents` and `tools`. The `chat` behavior and the command bar use the host's `agent` by default. |
| D243 | **Docs transports split by guide.** Getting started, local development and the docs' live examples use `openResponses()` against Ollama. The production guides use an AI SDK server (`uiMessageStream()`), with a prominent open-relay warning. One page shows the same component with both. |

**What the experiments settled** (research §1.3 and §2.3), as requirements:

| Finding | Requirement |
|---|---|
| One action per token gave 302 renders per 300-token reply; microtask batching changed nothing; frame batching gave 23 | L-1 coalesces `delta` per animation frame by default |
| Handlers see the pre-action state, so the tool loop rebuilt the message list twice | L-3 owns the conversation and the tool loop |
| Decisions ran through the existing `makeFetchDriver` with no new code | M-1 is request helpers, not a driver |
| Bare tools (every action, no schema) corrupted state (`{"text":"buy milk"}` stored as the text) | A-1 exposes only declared actions and validates their input |
| Agents went 0% → 100% (llama3.2 6/6, qwen3:8b 4/4) only when the projected state was in their context | A-1/A-2/L-3 publish `agent.read` as context after every flush, not only as a tool |
| A wrong argument the reducer ignores reported success | A-1's no-op detection (same state object → an error result) |
| A decision model picked action and target 8/8 at about 570 ms, flagging the ambiguous case at 0.43 confidence | M-3 command bar with confidence escalation |

**Budgets on `main` (PLAN-5's close, 2026-10-07):**
- size gate: kanban **42,690 / 42,700 B: 10 B headroom.** Everything in this plan is designed
  for **0 core bytes**. Anything in `src/core/` needs the user's approval, with numbers.
- `llms.txt`: **313 / 315 lines** (`test/llms-txt.test.js`). P6-Q2.
- SKILL.md: **42,100 B**.

---

## 1. Scope

### 1.1 LLM chat (L)

**L-1 `makeChatDriver({ transport, coalesce? })`** (P1)

A reply-action driver on `src/extra/replies.ts`, like `makeFetchDriver` and
`makeSocketDriver`. The prototype (`research/llm-experiments/llmDriver.js`) is the starting
point, not the code.
- **Request (sink value):** `{ messages, instructions?, tools?, model?, output?, key?, latest?, delta?, ok?, error?, tool?, coalesce?, ...transportOptions }`; `{ abort: key | true }`. A `then`/`catch` key is SYG610.
- **Reply actions,** to the sending instance only:
  - `delta` gets `{ key, text, delta, message }`, coalesced per frame (`coalesce: 'frame'` default; `'none'`, or a number of ms);
  - `ok` gets `{ key, message, text, toolCalls, finishReason, usage }`;
  - `tool` gets `{ key, call: { id, name, input } }`, once per completed call;
  - `error` gets `{ key, error, request }`.
- **Messages:** AI SDK `UIMessage`-compatible parts (`text`, `reasoning`, `tool-call`,
  `tool-result`, `file`, `data-*`); `messageText(m)` helper.
- **Cancellation:** `latest` defaults to true per `(sender, key ?? ok)`. The sender's dispose
  and app dispose abort everything. An aborted stream delivers nothing.
- **Isolation:** `isolateValue`/`isolateSink`, as `makeFetchDriver` does.
- **Structured output:** `output: schema` (Standard Schema) is validated on `ok`, as fetch's
  `validate` is; the transport sends the JSON Schema form.

**L-2 Transports** (P1 for the first wave, P2 for the second)

A transport is `{ stream(request, signal): AsyncIterable<ChatEvent> }`. It is public, so apps
can write their own. Each transport is its own module inside `sygnal/ai`, tree-shaken.

| Transport | Wave | Speaks | Notes |
|---|---|---|---|
| `uiMessageStream(url, opts?)` | 1 | the AI SDK UI message stream (SSE, `x-vercel-ai-ui-message-stream: v1`) | **production default** (D243); passes approvals and `data-*` parts through |
| `openResponses({ baseURL, model })` | 1 | Open Responses SSE | **getting started** (D243): Ollama, OpenRouter, vLLM, OpenAI; unknown events ignored, as the spec requires |
| `chatCompletions({ baseURL, model })` | 1 | Chat Completions SSE | the lowest common denominator (older local servers) |
| `chromePrompt(opts?)` | 1 | Chrome's `LanguageModel` | on device, no key; `availability()` drives a `status` |
| `anthropicMessages({ baseURL, model })` | 2 | Anthropic Messages SSE | through the app's proxy |
| `agui(url)` | 2 | AG-UI events | TanStack AI, CopilotKit, LangGraph servers |
| `fromAISDK({ streamText, model })` | 2 | the AI SDK in-process | SSR and trusted environments; `ai` as an optional peer |

**Hosted endpoints from the browser:** a transport pointed at a non-local origin with an
`Authorization`/`x-api-key` header needs `dangerouslyAllowBrowser: true`. Without it, the
request is refused (SYG670); local hosts (localhost, 127.0.0.1, `*.localhost`) are exempt.

**L-3 The `chat` behavior** (P1)

`uses = { assistant: chat({ sink, form, prompt, stop, approve, deny, instructions, model?, agent?, maxSteps? }) }`.
- **Slice:** `state.assistant = { messages, prompt, draft, status: 'ready'|'submitted'|'streaming'|'error', pending, error }`.
- **Actions:** `SEND`, `STOP`, `REGENERATE`, `APPROVE`, `DENY`, `DONE` (a host entry runs after
  it).
- **The tool loop.**
  - The behavior collects the tools from the host's `agent` declaration and its live
    descendants' (Collection items as one keyed tool), unless `agent: false`.
  - It sends `read` projections as context on every turn.
  - A tool call runs through A-1's rules. A `consequential` call sets `pending` and waits for
    `APPROVE`/`DENY`. The loop stops at `maxSteps` (default 8).
- **Selectors** are the host's own (SYG104 scoping): the docs show the markup as a function the
  host view calls.

**L-4 Testing** (P1, with L-1)

`renderComponent` gets an `LLM` fake that runs the real driver over an in-memory transport, as
the HTTP fake runs `makeFetchDriver`:
- `t.requests('LLM')`;
- `await t.stream('LLM', chunks, target?)`, where chunks are strings, or `{ toolCall }`, `{ reasoning }`, `{ data }`, `{ finish }` items;
- `await t.fail('LLM', error, target?)`.

The sink name is configurable (`llmSink`). No test in `npm test` touches the network.

### 1.2 Decision models (M)

**M-1 `decide()` and question builders** (P1)

`decide({ url?, model, state, questions, ...requestKeys })` returns a `makeFetchDriver` request
(POST JSON). It works as a reply-action request or as a `resources` entry.
- **Builders:** `choice(instructions, criteria)`, `noul(instructions, criteria?)` and
  `score(instructions, levels)`.
- **Answer types** are inferred from the questions in `src/ai.d.ts`.
- **`decide.openai(...)`** maps the same questions to OpenAI's array form (`predicate`/`choice`/`score`)
  and maps the answers back to the dictionary form.
- The default `url` is `/api/decide`, the app's proxy. The docs show TypeSafe, Ollama (`nimble`)
  and the AI Gateway as targets.

**M-2 Decision testing and recipes** (P2)

`t.respond('HTTP', { answers }, target)` already works. Add `answers()` fixtures typed from
the questions, and a recipe for confidence escalation (below a threshold, ask the chat model).

**M-3 `commandBar` behavior** (P2)

`uses = { cmd: commandBar({ input, decide, below, escalate }) }`.
- One decision call picks the action (a `choice` over the `agent` actions' descriptions) and the
  target (a `choice` over live Collection keys).
- It dispatches through A-1's rules.
- Below `below` confidence, it hands the text to the `chat` behavior named by `escalate`, or
  sets `state.cmd.unsure` for the view.

### 1.3 Agents (A)

**A-1 The `agent` static and the runtime rules** (P1)

```jsx
Comp.agent = {
  name, description,
  read: (state) => projection,
  actions: { ACTION: { description, input?, consequential?, when? } },
}
```

A shared module in `sygnal/ai` that every consumer (L-3, A-2, M-3, A-4) uses. It reaches apps
through `app.__runtime` (`root`, `children()`, `dispatch`, `flushed`, `addHooks`):
- **Discovery.** The module walks live instances. Registration follows `onCreate`/`onDispose`,
  so a hidden Switchable page has no tools.
- **Collection items.** An item's actions become one tool with an `id` parameter, an enum of
  the live keys, routed to that item.
- **Input.** `input` is a Standard Schema, validated before dispatch. The JSON Schema for the
  model comes from Standard JSON Schema (Zod 4.2+, ArkType 2.1.28+, Valibot via
  `@valibot/to-json-schema`). A non-object schema is wrapped as `{ value }`. An action without
  `input` takes no arguments.
- **Result.** The tool resolves after `flushed()` with `{ ok: true, state: read(state) }`.
  - Same state object → `{ ok: false, error: '<ACTION> changed nothing …' }` (no-op detection).
  - `ABORT` → the same, with the reason.
  - Invalid input → `{ ok: false, error, issues }`.
  - No such key → the list of live keys.
  - Declined → `{ ok: false, error: 'the user declined' }`.
- **Cause.** Actions run with `cause: 'agent'`: a new `ActionCause` member (types only). This
  needs checking for 0 core bytes. Devtools, `t.actions` and the action log show it.
- **`when`.** A tool is offered only while `when(state)` is true. Re-evaluation happens on
  flush, using the core's context read-tracking where available.
- **`consequential`.** The call waits for the consumer's `confirm` (L-3: `pending`; A-2: an
  option, by default a native `<dialog>` the layer renders outside the app's tree).

**A-2 `experimentalExposeWebMcp(app, { exposedTo?, confirm?, prefix? })`** (P1, experimental,
D241)
- Feature-detects `document.modelContext ?? navigator.modelContext`; a no-op without it.
- Calls `registerTool(tool, { signal })` per A-1 tool and unregisters by aborting the signal.
- Annotations: `readOnlyHint` on read tools, `untrustedContentHint` when `read` returns
  user-entered strings (declared as `untrusted: true`, or inferred from string fields under a
  dev warning), and `consequentialHint`.
- **Context.** A read-only tool per declaration, plus a short state summary in the declaration's
  tool descriptions, re-registered when it changes. All of it stays inside Chrome's budgets
  (description ≤ 500 chars, parameter description ≤ 150, name ≤ 30, output ≤ 1.5 K); going over
  is a dev diagnostic.
- Returns a `stop()` function.

**A-3 `form(…, { tool })` → declarative WebMCP** (P2)

The `form` behavior adds `toolname`/`tooldescription` to the `<form>` and `toolparamdescription`
(from labels) to fields. An `agentInvoked` submit runs the same validation, and
`respondWith(result)` returns field errors. A user's submit is unchanged. This is also
experimental, under D241.

**A-4 Testing agent paths** (P1, with A-1)

`t.tools()` lists name, description, input JSON Schema and hints. `await t.callTool(name, args, { confirm? })`
returns the A-1 result. `t.agentContext()` returns the `read` projections.

### 1.4 Checker (K)

**K-1 `sygnal-check` rules for `sygnal/ai`** (P2)
- **SYG102** counts an `agent.actions` entry as a trigger.
- An `agent.actions` key with no model entry (SYG150).
- A misspelled static: `agents` / `tools` → "did you mean `agent`?" (SYG151).
- `chat()` / `commandBar()` selectors not in the host's view (SYG104/SYG110 extended).
- A model that sends to an LLM sink a request without `ok` (SYG152).
- **New 7xx rules:**
  - an action reachable only through `mouseenter`/`mouseover` (SYG730);
  - a click target whose class toggles with state but has no `aria-pressed`/`aria-checked`/`aria-expanded` (SYG731).
- `--graph` includes `agent` declarations.
- The MCP server's `graph` tool returns them too.

### 1.5 Dev endpoint (E)

**E-1 `sygnal({ mcp: true })` in `sygnal/vite`** (P2, dev only)
- **Where:** `/__sygnal/mcp` (MCP streamable HTTP) on the dev server.
- **Tools:**
  - `get_state({ component?, path? })`;
  - `dispatch({ component, action, data })`, with `cause: 'agent'`;
  - `component_tree` (`inspect()`), `recent_actions({ limit })`, `get_diagnostics`;
  - `copy_as_test`;
  - `agent_tools`: the A-1 tools of the live page;
  - and, proxied, `sygnal-check`'s `check` / `graph` / `explain`.
- **How it reaches the page:** through the existing dev bridge (the HMR channel); nothing ships
  in builds.
- **Docs:** `integration/agents.md` gets the `.mcp.json` snippet.

### 1.6 MCP Apps (X)

**X-1 `makeMcpAppDriver()` + `create-sygnal-app --template mcp-app`** (P3; in or out per P6-Q4)
- **Sources:** `tool-input`, `tool-input-partial`, `tool-result`, `tool-cancelled` and
  `host-context-changed`.
- **Sinks:** `{ callTool, args, ok, error }`, `{ updateModelContext }`, `{ message }`,
  `{ openLink }` and `{ displayMode }`.
- The template ships a single-file Vite build and a minimal MCP server.

### 1.7 Not doing

- Sygnal-owned provider SDKs, or vendor wire formats beyond the transports listed above.
- Realtime voice (WebRTC sessions).
- Server-side agent frameworks: the server is the AI SDK's, TanStack's or the user's.
- Auto-exposing every action. Experiment 3 measured why not.
- llms.txt or markdown alternates for *apps*: low value, and Sygnal's docs already have them.
- Exposing state without `read`. Agents see projections only.

---

## 2. Phases

| Phase | Work | Detail |
|---|---|---|
| **0: Setup** (coordinator; spikes by subagents on `exp/p6-*`) | **0-A** baseline | Cut `plan6-integration` from `main`. Create `PLAN-6-status.md` and record D240–D243, the budgets above and the §4 reservations (checked against `codes.ts`). Answer P6-Q1…Q7. Re-run experiments 1, 4 and 5 on the current build. Estimate the eval spend for the user. |
| | **0-S1** streaming in the core | The prototype driver on the real reply machinery (`replies.ts`), under `run()` and `renderComponent`, in Chromium/Firefox/WebKit. Check: frame coalescing under a real rAF, dispose mid-stream, isolation, the `LLM` fake shape for L-4. Output: the driver's internal design, and a render-count assertion for the gate. |
| | **0-S2** the agent layer on the runtime API | Discovery, Collection item routing, `when`, no-op detection, Switchable pages, HMR, all through `addHooks` with **0 core bytes**. Output: a byte count (must be 0) or a minimal ask with numbers. |
| | **0-S3** WebMCP in a real browser | Chromium 1243 (Playwright) with the WebMCP testing flag (`--enable-features=…`; find the switch), and `@mcp-b/webmcp-polyfill` as the fallback in `browser-tests`. Output: how the gate tests A-2. |
| | **0-S4** schemas | Standard JSON Schema from Zod 4.2, Valibot and ArkType; what an `input` without JSON Schema support does (a dev error, SYG240). Output: the `input` contract. |
| | **0-S5** live examples | The docs' live examples need a chat demo without a network model. Either `js live-server` routes get SSE, or a scripted demo transport ships for docs only. Output: the approach, checked by `check-live` on three engines. |
| **1: Foundation** | L-1 + L-4; A-1 + A-4; M-1 (parallel, separate files) | L-1 and A-1 are independent; M-1 is small. |
| **2: Consumers** | L-2 wave 1; L-3 (needs L-1, A-1); A-2 (needs A-1) | A-2 is experimental from the start. |
| **3: Remaining** | L-2 wave 2; M-2; M-3; A-3; K-1; E-1; X-1 if in scope | Parallel where files don't overlap. |
| **4: Docs, agent context, measure** | Guides, `llms.txt`/SKILL sync, eval, report | Below. |

**Docs (Phase 4):**
- **Guides:**
  - `guide/ai-chat.md`: getting started on Ollama, then "shipping it" with an AI SDK server, the
    same component and transports side by side (D243), and the open-relay warning;
  - `guide/ai-decisions.md`;
  - `guide/agent.md`: the static, the in-app assistant and WebMCP (experimental banner);
  - `integration/agents.md`: the dev endpoint and the checker rules;
  - and, if X-1 is in scope, `guide/mcp-apps.md`.
- **Recipes:** a support inbox with triage and escalation, a copilot that operates a todo app,
  structured output into a form, and on-device summarise (`chromePrompt`).
- **Error reference:** regenerated for the new codes.

**Phase 4 eval:**
- **New tier, tasks from 35:**

  | Task | What it tests |
  |---|---|
  | 35 | Streaming chat with stop and error states, against the `LLM` fake |
  | 36 | An assistant that operates an existing app: the `agent` declaration + the `chat` behavior, consequential confirmation |
  | 37 | Ticket triage with a decision model, escalating low confidence to chat |
  | 38 | Make an existing app agent-operable: an `agent` declaration whose tools pass an operability check |

- **Operability check** (task 38, and a gate on every reference solution): the experiment 3
  harness against the app, with a local model (`qwen3:8b` on Ollama), opt-in and outside
  `npm test` (`TEST_OLLAMA=1`).
- **React arm:** AI SDK `useChat` + client tools, and CopilotKit `useFrontendTool` for 36/38.
- **Learn time and peak context** are checked against PLAN-5's S-14 numbers. More than about
  10% worse means trimming before release.
- **Spend** is estimated in 0-A and asked for before any run.

### Docs rules (agent context)

`llms.txt` has 2 lines left (313/315); P6-Q2 decides the budget. The ranking if it stays tight:

| Rank | Feature | Agent context |
|---|---|---|
| 1 | L-1/L-3 chat | one canonical line (driver request + reply actions, or the behavior) plus the guide link |
| 2 | A-1 `agent` | one line: the shape, and "only declared actions; `read` is what agents see" |
| 3 | M-1, M-3, A-2, A-3, E-1, X-1 | guide pages, reached from one `llms.txt` line listing them |

---

## 3. Gates

Every merge runs the existing gates:
- `npm run build:all`, `npm test` (vitest, examples, types, browser, perf gate),
  `npm --prefix sygnal-check test`;
- doc samples, error docs `--check`, the docs build, and `check-live` on Chromium, Firefox and
  WebKit;
- the size gate, the `llms.txt` and SKILL.md limits;
- 0 SYG7xx findings on examples, templates and doc samples.

PLAN-6 adds:
- **No network in `npm test`.** LLM, decision and agent tests use the fakes or the mock SSE
  server (moved from `llm-experiments/` into `test/helpers/`).
- **Tree-shaking:** an app that doesn't import `sygnal/ai` adds 0 B (kanban size unchanged).
  Each transport is absent unless imported.
- **Core bytes 0** (size gate unchanged), unless the user approves otherwise.
- **Render budget:** a 300-token stream at 1 token / 2 ms renders at most `ceil(duration / 16) + 2`
  times (0-S1's assertion), in vitest and in Chromium.
- **Browser tests:**
  - L-1 streaming with abort in three engines;
  - A-2 through the polyfill in three engines, and in Chromium with the real flag if 0-S3
    finds it;
  - `chromePrompt` behind availability (skipped where unavailable, never failing).
- **Opt-in local suite** (`TEST_OLLAMA=1 npm run test:ai-local`, not in `npm test`): the
  experiments 2–5 scenarios against Ollama (`llama3.2`, `qwen3:8b`, `nimble`) as a release
  check.
- **Type tests** for answer inference (M-1), the request and reply types (L-1) and the `agent`
  static's `actions` keys checked against the model.

## 4. Diagnostic code reservations

These are free in `codes.ts` today. Confirm them in 0-A.

| Range | Reserved for |
|---|---|
| 1xx wiring: **SYG150–159** | an `agent.actions` key with no model entry (150); `agents`/`tools` misspelling (151); an LLM request without `ok` (152); `chat()`/`commandBar()` selector problems beyond SYG104/110 |
| 2xx model/state: **SYG240–249** | an `input` that isn't a Standard Schema, or that has no JSON Schema form (240); `read` or `when` threw (241); a tool result over the size budget (242) |
| 4xx components: **SYG440–449** | two declarations with the same `name` (440); a Collection item `agent` whose items have no keys (441) |
| 6xx drivers/setup: **SYG670–679** | a hosted endpoint from the browser without `dangerouslyAllowBrowser` (670); an LLM request with no LLM driver (671); a transport's peer missing (672); a malformed stream event (673); WebMCP unavailable (info, dev, 674) |
| 7xx a11y: **SYG730–739** | a hover-only action path (730); toggled state with no ARIA state (731) |

Per CLAUDE.md, each code goes into both tables in `codes.ts` and gets an explanation in
`sygnal-check/src/explanations.js`. Then regenerate `explanations.json` and the errors doc.

## 5. Decisions needed before Phase 1 (recommendations first)

| # | Question | Recommendation |
|---|---|---|
| P6-Q1 | Release | **6.1.0**: additive. WebMCP is outside semver as experimental (D241). |
| P6-Q2 | `llms.txt` budget | **Raise the limit to 320 lines (+5)** for two canonical lines (chat, `agent`), one guide-list line and two wiring rules. The alternative is to fit 2 lines and trim elsewhere, which the PLAN-5 trims suggest is hard. |
| P6-Q3 | Eval | Tasks 35–38 with a React arm, with spend estimated in 0-A. The opt-in operability check (local model) is free. |
| P6-Q4 | MCP Apps (X-1) | **Phase 3 if time allows, otherwise 6.2.** The spec is stable, but it's the least connected item. |
| P6-Q5 | Transport waves | Wave 1: `uiMessageStream`, `openResponses`, `chatCompletions`, `chromePrompt`. Wave 2: `anthropicMessages`, `agui`, `fromAISDK`. |
| P6-Q6 | The `chat` behavior's tool scope | The host's `agent` **and its live descendants'** by default (the assistant can operate the whole subtree); `agent: false` or `agent: [Comp, …]` narrows it. |
| P6-Q7 | `read` context channel for WebMCP | A read-only tool plus a summary in the declaration's tool descriptions (re-registered on change), since WebMCP has no context API yet. Revisit if the spec adds one. |

## 6. Risks

| Risk | Mitigation |
|---|---|
| WebMCP changes (it already moved from `navigator` to `document` in July 2026) | Experimental export (D241); one module; feature detection; the polyfill in tests; recheck the spec at each phase start. |
| The AI SDK's UI protocol changes in a major | `uiMessageStream` pins the protocol version from the header and fails clearly on an unknown one; Open Responses is the vendor-neutral fallback. |
| Provider event churn (Responses has 60+ event types) | Transports ignore unknown events (the Open Responses rule); per-transport fixture tests from recorded streams. |
| 10 B of size-gate headroom | 0 core bytes by design (hook layers, statics read by `sygnal/ai`); 0-S2 measures it; any ask goes to the user with numbers. |
| Prompt injection through app content | Only declared actions; validation; `consequential` confirmation in the app; `untrustedContentHint`; `cause: 'agent'` in every log; docs state that a tool runs with the user's authority. |
| Docs readers ship an open relay | D243's split, plus the warning and SYG670 for hosted endpoints from the browser. |
| Small local models are unreliable in the eval and the operability check | `qwen3:8b` with `/no_think`, several runs, and success judged on final state. The check is a release signal, not a merge gate. |
| Streaming renders get expensive in big views | Frame coalescing by default; the render-budget gate; the guide shows the draft rendered in its own small component. |
| Standard JSON Schema support varies by library | 0-S4; plain JSON Schema accepted as `input` too; SYG240 when neither works. |
