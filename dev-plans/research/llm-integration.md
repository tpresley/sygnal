# LLM integration research: inference in Sygnal apps, and Sygnal apps for agents

Research and local experiments, 2026-10-08. Status: proposal, nothing implemented in `src/`.
Experiment code: [`llm-experiments/`](llm-experiments/) (prototypes, not library code).

Two questions:

1. **Inference from apps.** How should a Sygnal app call LLMs, given the API shapes in use
   today, and should Sygnal ship a native driver, factories over existing libraries, or
   something else?
2. **Apps for agents.** How do we make Sygnal apps easy for LLM agents to understand and
   operate?

The short answer to both is the same idea: **Sygnal already knows each component's actions by
name, owns the only dispatch path, and its reducers are pure.** Most of what other frameworks
build with hooks and wrappers, Sygnal can derive from one declaration per component. That one
declaration feeds an in-app chat model's tools, the browser's WebMCP tools, a decision-model
command bar and tests.

The experiments' main result: when an agent operated a running Sygnal app through tools
generated from its actions, success went from **0% to 100% on two local models** once the
framework put the projected current state into the agent's context. Descriptions, schemas and
validation alone did not get there. Schemas still matter: without them the agent corrupted the
app's state.

---

## Summary of recommendations

| # | Proposal | Value | Effort | Depends on outside churn? |
|---|---|---|---|---|
| A1 | `makeChatDriver({ transport })`: the streaming chat driver, built on the reply-action pattern | High | M | No (the transports carry the churn) |
| A2 | Transports, each a small optional module: `uiMessageStream` (AI SDK servers), `openResponses` (OpenAI, Ollama, OpenRouter, vLLM), `anthropicMessages`, `agui`, `chromePrompt` (on device) | High | S each | Yes, isolated per transport |
| A3 | A `chat` behavior (`uses = { chat: chat(...) }`) that owns messages, status, the tool loop and approvals | High | M | No |
| A4 | Decisions (Jev and similar): **no new driver.** Add `decide()`, `choice()`, `noul()` and `score()` request helpers over `makeFetchDriver`, typed answers, and a documented confidence-escalation pattern | High | S | Low |
| A5 | Testing fakes: `t.stream(sink, chunks)`, `t.respond` for decisions, `t.tools()` / `t.callTool()` | High | S | No |
| B1 | `Component.agent` static + `experimentalExposeWebMcp` in `sygnal/ai`: model actions become WebMCP tools (registered while mounted), projected state published as agent context, validation and no-op detection | High | M | Yes (WebMCP is in origin trial): experimental export |
| B2 | Extend `sygnal-check`'s existing 7xx accessibility rules with the agent-specific gaps (hover-only paths, toggled state without ARIA state) | Medium | S | No |
| B3 | `form` behavior emits declarative WebMCP attributes | Medium | S | Yes |
| B4 | A dev MCP endpoint in `sygnal/vite` for runtime state, dispatch, diagnostics and recent actions | High (for coding agents) | M | No |
| B5 | Agent safety defaults: `consequential` → in-app confirmation, `cause: 'agent'` on every action, untrusted-content marking | High | S | No |
| B6 | MCP Apps adapter + `create-sygnal-app` template | Medium | M | Low (stable spec) |
| — | llms.txt / markdown alternates for *apps* | Low | — | Skip for apps; Sygnal's docs already have llms.txt |

Suggested order: A4 and A5 first (small, no risk), then A1–A3 together, then B1/B5 as an
experimental subpath, with B2 and B4 in parallel because they pay off with or without WebMCP.

---

## Part 1: LLM inference in Sygnal apps

### 1.1 The API shapes in use (October 2026)

There are three distinct shapes, not one.

**Conversational, streaming** (messages/items in, a stream of deltas and tool calls out):

| API | Model of a turn | Streaming | Tools | Server-side state |
|---|---|---|---|---|
| OpenAI Chat Completions | `messages[]` with roles | SSE raw `delta` chunks, `[DONE]` | `tool_calls` + `tool` role | none |
| OpenAI Responses / **Open Responses** spec (2026-04-24; OpenAI, Vercel, OpenRouter, HF, Ollama, vLLM, NVIDIA, AWS) | typed **items** | SSE semantic events (`response.output_text.delta`, `response.function_call_arguments.done`, …; 60+ types) and a WebSocket mode | `function_call` / `function_call_output` items, many hosted tools | optional `previous_response_id` / Conversations (compatible hosts are stateless) |
| Anthropic Messages | `messages[]` of content blocks, `system` param | SSE `message_start` / `content_block_delta` / `message_delta` … | `tool_use` / `tool_result` blocks, server tools | none |
| Gemini **Interactions** (GA June 2026; `generateContent` now "legacy") | interaction of steps | SSE `step.delta`, `interaction.*` | function calls | `previous_interaction_id` |
| Bedrock ConverseStream | blocks (Anthropic-like) | AWS event-stream | toolUse / toolResult | none |
| Chrome Prompt API (`LanguageModel`) | local session | `ReadableStream<string>` | in spec, not shipped | stateful session on device |

They share ordered turns, content parts, streamed text deltas, tool calls whose JSON is
finalized before use, results keyed by call id, a finish reason, usage, JSON Schema structured
output, and cancel-by-closing-the-stream. They differ in where the system prompt goes, how tool
results are carried, reasoning round-tripping, server-side state, and transport.

**Decision** (state + typed questions in, calibrated answers out; no text generation, no
streaming). This is the shape behind "Jev":

- **TypeSafe Jev** ("System One" decision model, early access 2026-09-15).
  `POST /v1/systemone {state, model, questions: {name: {type, instructions, criteria}}}` →
  `{answers: {name: {...}}, usage}`. Three question types: `noul` (yes/no probability), `choice`
  (pick from criteria, with `probabilities` and `confidence`), `score` (ordered levels, weighted).
  Questions are evaluated in parallel, so adding questions costs little latency. Vendor claims:
  70–500 ms, $0.042 / M input tokens, output free. JS SDK `@typesafe-ai/sdk` 0.6.0 (types inferred
  from the questions; `dangerouslyAllowBrowser` opt-in).
- The same dictionary shape is served by **Ollama ≥ 0.35** (`/v1/systemone`; models `nimble`,
  `Tev1`, `clef`, `clef-flash`), OpenRouter (`/api/alpha/decisions`), Vercel AI Gateway and
  (reportedly) Cloudflare's open-weight **Clef**. The AI SDK 7 has `experimental_decide` over a
  provider-neutral `DecisionModelV4`.
- **OpenAI Decisions** (public beta, `POST /v1/decisions`) is the same idea with an *array* of
  questions (`predicate` / `choice` / `score`) and per-question refusals.

**Realtime** (WebRTC / WebSocket audio sessions with ephemeral client secrets). Out of scope for
a first pass.

Client libraries: the **Vercel AI SDK 7** (`ai@7.0.x`, ESM only) is the de facto provider layer;
its UI layer is a framework-neutral `AbstractChat` + `ChatState` + `ChatTransport` with an SSE
"UI message stream" protocol (`text-start/delta/end`, `tool-input-*`, `tool-approval-request`,
`finish`, `abort`, …). Its Svelte binding is about 30 lines over `AbstractChat`. **TanStack AI**
(0.66, pre-1.0) streams **AG-UI** events (`TEXT_MESSAGE_CONTENT`, `TOOL_CALL_*`,
`STATE_SNAPSHOT/DELTA`). AG-UI is used by CopilotKit, LangGraph, Mastra and others.

Security: every official SDK refuses to run in a browser without an explicit opt-in. The standard
architecture is browser → the app's own server route → provider. Direct browser calls are only
safe with ephemeral tokens (Realtime, Gemini Live), keyless on-device models (Chrome), or a
local server (Ollama).

### 1.2 The options

**(a) Sygnal-native wire adapters.** Prototyped: `anthropic()` and `openaiResponses()` adapters
are about 40 lines each over fetch + an SSE parser. They work (Experiments 1–2, including against
real Ollama endpoints). But owning wire formats means chasing 60+ Responses event types,
Interactions, Bedrock framing and monthly additions. That is the maintenance D209 tells us not to
take on.

**(b) A driver factory over an existing library.** Prototyped: `fromAISDK({ streamText, model })`
is 25 lines and gives every AI SDK provider. But the AI SDK in the browser means an API key in
the browser. In a real app the provider library runs on the server, so the browser does not need
a provider library. It needs a client for whatever protocol the app's server speaks.

**(c) Recommended: a protocol-level driver with pluggable transports.** Split the problem where
the ecosystem already split it:

- **The driver (Sygnal's job, stable):** routing replies to the sending instance, `latest` and
  abort per key, delta coalescing, accumulating the assistant message as parts, dispose, testing
  fakes. This is the part no library does for Sygnal, and it is where all the framework-specific
  bugs are.
- **Transports (thin, optional, one module each):**
  - `uiMessageStream(url)`: an AI SDK server (`toUIMessageStreamResponse`). This is the default
    recommendation, because the user's server can then use any provider through the AI SDK.
  - `agui(url)`: TanStack AI, CopilotKit and LangGraph servers.
  - `openResponses({ baseURL })`: OpenAI, Ollama, OpenRouter and vLLM directly. Good for local
    and dev use, and for pass-through proxies.
  - `anthropicMessages({ baseURL })`, and `chatCompletions()` as the lowest common denominator.
  - `chromePrompt()`: on-device, keyless.
  - `fromAISDK(...)` for SSR / trusted environments.

  Per D209, transports needing a library take it as an optional peer behind a subpath; the
  SSE / JSON ones need no dependency.
- **Message model:** AI SDK `UIMessage`-compatible parts (`text`, `reasoning`, `tool-call`,
  `tool-result`, `data-*`), so messages round-trip to an AI SDK server unchanged
  (`convertToModelMessages`). Experiment 1 round-tripped tool calls and results through the
  Anthropic and Responses wire formats from one part model.

Sketch (this is what the prototype runs today):

```jsx
Chat.model = {
  SEND: {
    STATE: (s, text) => ({ ...s, messages: [...s.messages, { role: 'user', content: text }] }),
    LLM: (s, text) => ({ messages: [...s.messages, { role: 'user', content: text }],
      key: 'chat', delta: 'DELTA', ok: 'DONE', error: 'FAILED', tool: 'TOOL' }),
  },
  STOP: { LLM: () => ({ abort: 'chat' }) },
  DELTA: (s, { text }) => ({ ...s, draft: text }),
  DONE: (s, { message }) => ({ ...s, messages: [...s.messages, message], draft: '' }),
}
run(App, { LLM: makeChatDriver({ transport: uiMessageStream('/api/chat') }) })
```

**(d) A `chat` behavior on top (A3).** Experiment 2's tool loop showed why it's needed. Handlers
get the pre-action state, so the follow-up request after a tool call had to rebuild the message
list a second time. Every app would rewrite that bookkeeping. A behavior owning
`state.chat = { messages, status: 'ready'|'submitted'|'streaming'|'error', draft, error }` with
actions `chat.SEND`, `chat.STOP`, `chat.REGENERATE`, `chat.TOOL_RESULT` and `chat.APPROVE` is
the Sygnal equivalent of the AI SDK's `AbstractChat`/`ChatState` (deliberately the same status
names). Client-side tools then point at the component's **own actions**:

```jsx
App.uses = { chat: chat({ sink: 'LLM' }) }  // uses App.agent, the same declaration as B1
```

When the model calls a tool, the behavior dispatches the action, waits for the flush and sends
the projected state back as the result. One declaration serves the in-app copilot and external
agents (Part 2).

**(e) Decisions need no new driver (A4).** Experiment 4 ran local `nimble` through the
**existing** `makeFetchDriver` with reply actions, with zero new runtime code. What's worth
shipping is the helpers: `decide({ state, questions })` returning a fetch request,
`choice()` / `noul()` / `score()` builders whose answer types are inferred (as TypeSafe's SDK
does), a dictionary ↔ OpenAI-array adapter, and a documented confidence-escalation recipe
(below the threshold, ask a chat model). Decisions are also a natural `resources` entry:
re-decided when the state they read changes, cached and de-duplicated by the query cache.

### 1.3 Experiments (Part 1)

All run locally (Node 24, `sygnal` dist at 6.0.0, Ollama 0.40.2). The model's ability to do the
task was not under test. The point was whether the Sygnal side behaves.

**Experiment 1: the prototype chat driver against mock SSE servers** speaking the Anthropic and
Responses wire formats, and the AI SDK 7 mock model. 300-token replies, one SSE event per token:

| Coalescing of `delta` actions | Renders per 300-token reply |
|---|---|
| none (one action per token) | 302 |
| microtask | 302 (each token arrives in its own macrotask, so microtask batching does nothing) |
| **animation frame** | **23–25** (same wall time) |

→ **The driver must coalesce deltas per frame by default.** Each action is a full
run-to-completion flush and one DOM patch, so per-token actions cost 13× the renders for
nothing visible.

Also verified: tool calls arrive as one `TOOL` action with parsed input from all three sources;
tool results round-trip through both wire formats; `STOP` mid-stream aborts the fetch and
nothing arrives after it; a second `SEND` under the same key supersedes the first (one assistant
reply for two user messages). A decision-shaped adapter pushed through the chat driver lost its
answers, which confirms decisions need their own shape (they don't need their own driver).

**Experiment 2: the same component against a real model** (Ollama `llama3.2`, through its
Anthropic-compatible `/v1/messages` and OpenAI-compatible `/v1/responses`). Both did a full
client-side tool round trip (call `weather` → app answers → final text uses the result) in
300–460 ms, with 7–10 renders per turn.

**Experiment 4: decisions through `makeFetchDriver`** (local `nimble`, 10 support tickets):
labels 10/10, urgency 6/10 (the `noul` question had no criteria; criteria are the fix). Median
342 ms per decision on this Mac (511 ms cold). One ticket came back with confidence 0.35 and
would escalate under a 0.6 threshold.

---

## Part 2: making Sygnal apps friendly to LLM agents

Two audiences:

- **Coding agents building the app.** Sygnal is already strong here: `llms.txt`, the
  `sygnal-dev` skill, `sygnal-check` with an MCP server (`check`, `graph`, `explain`), and
  `inspect()`. The gap is *runtime* access while the app runs (B4).
- **Agents operating the running app.** These are browser agents (Claude in Chrome, Atlas,
  Gemini in Chrome, Playwright MCP, Stagehand, Browser Use) and in-page tool consumers (WebMCP).
  This is where the new work is.

### 2.1 What the ecosystem converged on

- **Agents read the accessibility tree.** Playwright MCP snapshots, Claude in Chrome's
  `read_page`, Stagehand and OpenAI's Atlas FAQ all work from ARIA roles, names and states.
  Google's web.dev "Build agent-friendly websites" and Lighthouse's new **Agentic Browsing**
  category (`accessibility-for-agents`, `layout-stability`, `registered-webmcp-tools`,
  `forms-missing-declarative-webmcp`, `llms-txt`) say the same thing: an agent-ready site is
  mostly an accessible one, with real controls, programmatic names, exposed state and stable
  layout.
- **WebMCP** (W3C WebML CG draft; Chrome origin trial 149–156):
  `document.modelContext.registerTool({ name, description, inputSchema, annotations, execute },
  { signal })`. Aborting the signal unregisters the tool; the `navigator.modelContext` form is
  deprecated. Annotations are `readOnlyHint`, `untrustedContentHint` and `consequentialHint`.
  There is also a declarative form API (`<form toolname tooldescription>`, `agentInvoked`,
  `respondWith`). Shopify already exposes WebMCP tools on every storefront. Chrome's guidance:
  one job per tool, register only while usable, validate in code, return descriptive errors so
  the model can retry, keep descriptions short (≤ 500 chars).
- **Framework precedents are all opt-in.** Angular v22 (experimental) has
  `provideExperimentalWebMcpTools` and **Signal Forms → tools automatically**, which is the
  closest precedent. Chrome Labs' `useWebMCP` (React), VueUse `useWebMCP`, CopilotKit
  `useFrontendTool` (with a `webmcp: true` bridge) and assistant-ui all follow the same pattern:
  a tool registry tied to mount and unmount, plus a separate lazy "readable context". **No
  framework exposes all actions automatically**, and Experiment 3 shows why it shouldn't.
- **MCP Apps** (SEP-1865, stable 2026-01-26) puts an app inside ChatGPT, Claude, VS Code and
  others: an HTML resource in a sandboxed iframe talking JSON-RPC over postMessage.
  `window.openai` is now an alias layer over it.
- **llms.txt** matters for docs sites read by coding agents, which Sygnal already has. It matters
  little for apps: a cited Ahrefs analysis found 97% of llms.txt files get no AI requests.
- **Security:** prompt injection is unsolved. Every vendor says to design tools so that a fooled
  model can't do much damage: keep tools narrow, validate in code, confirm consequential actions
  in the app, label untrusted content, and log calls.

### 2.2 Proposals

**B1. `Component.agent` + `experimentalExposeWebMcp` in `sygnal/ai`.** One static, read by a hook layer (the
`__SYGNAL_DIAGNOSTICS__.layers` / `addHooks` pattern, so it costs 0 B unless imported):

```jsx
TodoApp.agent = {
  description: 'the todo list',
  state: s => ({ todos: s.todos }),            // what agents may read (a read-only tool)
  actions: {
    ADD:    { description: 'Add a todo with this text', input: z.string() },
    TOGGLE: { description: 'Mark the todo with this id done or not done', input: z.number().int() },
    REMOVE: { description: 'Delete the todo with this id', input: z.number().int(), consequential: true },
  },
  available: s => true,                         // register only while usable (Chrome guidance)
}
```

- Registration follows the instance: `onCreate` registers and `onDispose` aborts. A hidden
  Switchable page has no tools. Collections get per-item tools, or a parameterized tool.
- `execute` validates with the Standard Schema (JSON Schema for `inputSchema` comes from the
  **Standard JSON Schema** extension: Zod 4.2+, ArkType 2.1.28+, Valibot via
  `@valibot/to-json-schema`), dispatches with `cause: 'agent'`, awaits `flushed()`, and returns
  the projected state.
- **Sygnal-only: no-op detection.** Reducers are pure and immutable, so if the state reference
  didn't change, the tool returns "TOGGLE changed nothing: check the input against the current
  state" instead of a false success. An `ABORT` returns its reason. Experiment 3's failure mode
  was exactly a silent no-op.
- **Publishes the projected state as context, not only as a tool** (Experiment 3's decisive
  factor): kept current after each flush, cheaply, because the core already knows when an
  instance's state changed. The channel depends on the consumer: the `chat` behavior's system
  context, MCP Apps' `ui/update-model-context`, and for WebMCP a read-only tool plus a short
  state summary in the tool descriptions, re-registered when it changes, within Chrome's size
  budgets.
- Not on by default for all actions: Experiment 3 measured bare tools corrupting state.
- The same declaration feeds the `chat` behavior's tools (A3), `t.tools()` / `t.callTool()`
  (A5), the MCP Apps adapter (B6) and the decision command bar (Experiment 5).

**B2. Extend the existing accessibility checks.** `sygnal-check` already has the 7xx rules
(clicked `div`, form field without a label, `<img>` without `alt`, nameless button), built on
the fact that intents name their event targets by selector, and they cover most of what
Lighthouse's `accessibility-for-agents` audit checks. What's left is agent-specific:
- an action reachable only through `mouseenter`/`mouseover` (hover-only, invisible to agents
  and keyboards);
- a click target whose class toggles with state (`className={{ done: state.done }}`) but has no
  `aria-pressed` / `aria-checked` / `aria-expanded`, so the accessibility tree never shows the
  state;
New codes in the 7xx range. Related: SYG102 ("a model entry needs a trigger") must count a
`agent` entry as a trigger, since agent-only actions (`ADD` called by an agent) are legitimate.

**B3. `form` → declarative WebMCP.** The `form` behavior already has a Standard Schema and
labels. It can emit `toolname`, `tooldescription` and `toolparamdescription`, and answer
`agentInvoked` submits through `respondWith(validation result)`. This is Angular's Signal Forms
→ tools, for free.

**B4. Dev MCP endpoint in `sygnal/vite`** (Next.js `/_next/mcp` and `vite-plugin-mcp` pattern):
`/__sygnal/mcp` with `get_state(path?)`, `dispatch(component, ACTION, data)`, `component_tree`
(`inspect()`), `get_diagnostics` (SYG codes with docs URLs), `recent_actions`,
`copy_as_test`, plus the existing static `check` / `graph` / `explain`. A coding agent can then
loop "change → check → read live state → dispatch → check", the way Svelte's autofixer loop
works.

**B5. Safety defaults.**
- `consequential: true` actions go through an in-app confirmation (a `sygnal/ui` Dialog) before
  the action is queued.
- Every agent action carries `cause: 'agent'` (a new `ActionCause`), visible in devtools,
  `t.actions` and the action log.
- A read tool returning user-entered strings gets `untrustedContentHint`.
- `exposedTo` is same-origin by default.
- A dev diagnostic enforces Chrome's size budgets.

**B6. MCP Apps.** The protocol maps onto drivers: an `MCP` source for `tool-input`,
`tool-result` and `host-context-changed`, and sinks for `tools/call`, `ui/update-model-context`
and `ui/message`. Add a single-file Vite build and a `create-sygnal-app` template.

### 2.3 Experiments (Part 2)

**Experiment 3: an agent operates a running Sygnal app through generated tools.**
`exposeToAgents(app)` walks `app.__runtime.root`, reads each instance's `def.handlers` (the
action table) and registers WebMCP-shaped tools (`registerTool(tool, { signal })` on a stand-in
`modelContext`). A local chat model, given only the tools, does: add two todos, mark an existing
one done, filter to active. Success is judged on the app's final state, and the jsdom DOM showed
the same result a person would see.

| Model | bare (every action, no metadata) | annotated (`agent` static) | validated (+ schema check, no-op detection) | **context** (validated + the projected state given up front) |
|---|---|---|---|---|
| llama3.2 3B | 0/6 | 0/6 | 0/6 | **6/6** (1.2 s) |
| qwen3 8B | 0/4 | 0/4 | 0/4 | **4/4** (24 s vs 43–81 s for the others) |

What the traces show:

- **bare:** with no schema, the model invented payload shapes and the reducers stored them as
  data: the todo text became `"{'text':'buy milk'}"` and the filter `"{'filter':'active'}"`. The
  app was corrupted, and nothing flagged it.
- **annotated (llama3.2):** ADD and SET_FILTER were correct. TOGGLE got `"water plants"` instead
  of the integer id. The reducer matched nothing, and the tool reported success.
- **validated (llama3.2):** the tool now returned "invalid input: expected integer (todo id)". But
  the 3B model sent all four calls in one parallel batch and stopped, so it never read the error.
- **qwen3 bare:** sent `{"data": {"text": "buy milk"}}`, so the reducer stored an *object* as the
  todo's text and as the filter (the DOM then rendered the todo as empty). Same corruption as above.
- **qwen3 annotated / validated:** every call well-formed, but `TOGGLE(3)` for "water plants" (the
  real id is 1). Like llama3.2, it sent all its calls in one parallel batch before reading any
  result, so it was guessing ids. A valid-but-wrong id passes validation and changes state, so
  no-op detection can't catch it either.
- **context:** the same validated tools, plus the projected state (`tools.state`) in the agent's
  context before the first call. Both models then got everything right, every run.

**Conclusion.** For agents, the decisive thing a framework can supply is **the current state in
the agent's context, projected and with ids**, more than validation or descriptions. Schemas
still matter: without them the app's state gets corrupted. Validation and no-op detection
matter for agents that read results (frontier models and multi-turn loops do; these small
local models didn't). On the web this context channel exists in several forms: WebMCP read-only
tools whose descriptions can carry a summary; MCP Apps' `ui/update-model-context`; CopilotKit's
`useAgentContext`; and for the in-app `chat` behavior, the system prompt. B1 has to publish it
on every flush, not only offer a `read_state` tool.

**Experiment 5: a decision model as a command bar.** One `/v1/systemone` call to local `nimble`
picks the action (a `choice` over the component's action descriptions) and the target (a
`choice` over the current todos). Result: **8/8 correct, ~570 ms each.** The one ambiguous
command ("what have I finished?") came back with action confidence 0.43, the signal to escalate
to a chat model. For "do one thing in this app" requests, the action table + a decision model
was more reliable than a small chat model's tool calling, and needs no conversation loop. It
reads the same `agent` declaration.

---

## Decisions

- 2026-10-09: **one subpath, `sygnal/ai`**, for everything: the chat driver and transports, the
  `chat` behavior, the decision helpers, the command bar and the WebMCP layer. Transports or
  adapters that need a third-party library take it as an optional peer (D209).
- 2026-10-09: **WebMCP ships as experimental**, as Angular does: the export carries the word
  (`experimentalExposeWebMcp(app)`), it follows the draft spec as it changes, and it is exempt
  from semver until the origin trial ends (Chrome 156).
- 2026-10-09: **the static is `agent`** (`TodoApp.agent = { description, read, actions }`): a
  human reading the code recognizes the AI entry point, and the singular names an aspect of the
  component like `route` and `head` (`agents` read as a list of agents; `tools` was clear to
  agents but generic to humans and collided with the `chat()` option). `sygnal-check` suggests
  `agent` for `agents` and `tools`. The `chat` behavior and the command bar use the host's
  `agent` declaration by default, so they take no `tools` option.
- 2026-10-09: **docs transports split by guide.** Getting started, local development and the
  docs' live examples use `openResponses()` against Ollama (no server, no key). The production
  guides use an AI SDK server (`uiMessageStream()`), with a prominent warning that a
  pass-through proxy that only adds a key is an open relay, not a security boundary. One page
  shows the same component with both transports, so the move from demo to production is one
  line in `main.js` plus a server route. The reasons: the AI SDK is safe by default, works with
  any provider, and has the richer UI protocol (approvals, resumable streams, `data-*` parts);
  Open Responses is an open spec and needs no server locally, but a copied pass-through setup
  fails silently in production.

## Sources

Inference: [Open Responses spec](https://www.openresponses.org/specification) ·
[OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state) ·
[OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions) ·
[Gemini Interactions](https://ai.google.dev/gemini-api/docs/interactions) ·
[Bedrock ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStreamOutput.html) ·
[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) ·
[Ollama decision models](https://docs.ollama.com/capabilities/decision) ·
[TypeSafe: introducing Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) ·
[TypeSafe API](https://docs.typesafe.ai/api.md) · [TypeSafe primitives](https://docs.typesafe.ai/primitives.md) ·
[Jev on OpenRouter](https://openrouter.ai/docs/guides/community/jev) ·
[Vercel AI Gateway + Jev](https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev) ·
[AI SDK 7](https://vercel.com/changelog/ai-sdk-7) · [AI SDK stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) ·
[TanStack AI](https://tanstack.com/ai) · [Chrome built-in AI](https://developer.chrome.com/docs/ai/built-in-apis) ·
[Gemini ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens) ·
[Standard JSON Schema (TanStack)](https://tanstack.com/ai/latest/docs/reference/functions/convertSchemaToJsonSchema)

Agents: [WebMCP spec](https://webmachinelearning.github.io/webmcp/) ·
[WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) ·
[declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api) ·
[best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices) ·
[secure tools](https://developer.chrome.com/docs/ai/webmcp/secure-tools) ·
[origin trial](https://developer.chrome.com/blog/ai-webmcp-origin-trial) ·
[Angular WebMCP](https://angular.dev/ai/webmcp) · [use-webmcp-tool](https://github.com/GoogleChromeLabs/use-webmcp-tool) ·
[Shopify WebMCP](https://shopify.dev/docs/api/web-mcp) · [MCP Apps SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) ·
[MCP Apps in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt) ·
[web.dev agent-friendly sites](https://web.dev/articles/ai-agent-site-ux) ·
[Lighthouse Agentic Browsing](https://developer.chrome.com/docs/lighthouse/agentic-browsing/scoring) ·
[Playwright MCP snapshots](https://playwright.dev/mcp/snapshots) ·
[Atlas publisher FAQ](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq) ·
[CopilotKit useFrontendTool](https://docs.copilotkit.ai/reference/hooks/useFrontendTool) ·
[Next.js MCP](https://nextjs.org/docs/app/guides/mcp) · [Angular CLI MCP](https://angular.dev/ai/mcp) ·
[Svelte AI tools](https://svelte.dev/docs/ai/tools) · [llmstxt.org](https://llmstxt.org) ·
[llms.txt adoption (secondary)](https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/)
