# LLM integration experiments

Prototypes behind [`../llm-integration.md`](../llm-integration.md). Not library code: no tests, no types.

Setup: `npm run build` at the repo root, then `npm install --prefix dev-plans/research/llm-experiments`.
Experiments 2–5 need a local [Ollama](https://ollama.com) (≥ 0.35 for `/v1/systemone`) with
`llama3.2`, `qwen3:8b` and `nimble` pulled. No API keys are used anywhere.

| File | What |
|---|---|
| `llmDriver.js` | `makeLLMDriver({ adapter, coalesce })`: the prototype streaming chat driver (reply actions `delta` / `ok` / `error` / `tool`, `latest` and abort per key, frame coalescing) |
| `adapters.js` | `anthropic()`, `openaiResponses()` wire adapters (fetch + SSE), `fromAISDK()` (AI SDK 7 `streamText`), `typesafeDecision()` |
| `mockServer.js` | SSE server speaking the Anthropic Messages and OpenAI Responses stream shapes |
| `exposeToAgents.js` | a running app's actions as WebMCP-shaped tools (`registerTool(tool, { signal })`), modes `bare` / `annotated` / `validated` |
| `exp1.js` | driver vs mock servers + AI SDK mock model: renders per reply by coalescing mode, tools, abort, latest |
| `exp2.js` | same component vs real Ollama (`/v1/messages`, `/v1/responses`), client-side tool round trip |
| `exp3.js` | a local chat model operates a running app (jsdom) through the generated tools: `node exp3.js <model> <runs> [modes]` |
| `exp4.js` | decision model (`nimble`) through the existing `makeFetchDriver` |
| `exp5.js` | decision model as a command bar over the action table |
