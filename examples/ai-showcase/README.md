# Sygnal AI showcase

One page, two tabs. **Features** has ten sections, each a small and complete Sygnal app showing
one part of `sygnal/ai` against real models: local ones on [Ollama](https://ollama.com), hosted
ones on [Kindo](https://kindo.ai) and [TypeSafe](https://typesafe.ai) (Jev), and Chrome's built-in
model. **Building Chat** builds one chat up in eight steps (below). Every section has a short
description and its source behind **Show code**.

| # | Section | What it shows |
|---|---|---|
| 1 | Any model, same component | `makeChatDriver` over Ollama, Kindo (Open Responses, Chat Completions, Anthropic Messages) and `chromePrompt()`, streaming, reasoning, Stop |
| 2 | Structured output | `output:` a zod schema; a validated value or the schema's issues |
| 3 | Tools | the raw tool loop: `tool` actions, `withToolResults`, a step limit |
| 4 | Decision models | `decide()` with `choice` / `noul` / `score` as a resource, confidence and routing |
| 5 | Command bar | the `agent` static and `commandBar()` on a decision model, confirmation |
| 6 | An assistant that operates the app | `chat()` with agent tools, queries, approvals, `agentTools()` |
| 7 | UI composed by a model | `defineCatalog`, `compose()` with `compose.decisions()` or `compose.llm()`, follow-up edits |
| 8 | Cards in a chat | `chat({ ask })`: the assistant asks with cards built from the app's parts |
| 9 | WebMCP | `experimentalExposeWebMcp` and `formTool`, with an in-page agent console |
| 10 | MCP App | [`examples/mcp-kindo-agents`](../mcp-kindo-agents): Kindo agent runs inside Claude |

### Building Chat

A second tab builds one chat up a feature at a time, all on one model (Kimi K3 on Kindo, so it
needs a Kindo key). Each step is a complete component, the step before's code plus one feature;
**Show code** marks the lines that are new since the step before.

| # | Step | What it adds |
|---|---|---|
| 1 | A streaming chat | `chat({ agent: false })`, `draft`, example chips that fill in the prompt |
| 2 | Stop, retry, start over | `stop`, `regenerate`, `status: 'error'`, a Clear reducer |
| 3 | Show the thinking, count the tokens | `draftReasoning`, reasoning parts, `'chat.DONE'` usage in a tally |
| 4 | Suggested follow-ups | a one-off request with an `output` schema after each reply |
| 5 | Remember the conversation | `persist()` of the chat slice |
| 6 | It sees the page | the `agent` static's `read`: an answer style set beside the chat |
| 7 | It changes the page | agent `actions` (a shopping list, the style), `consequential` with Allow / Deny |
| 8 | Answers with a click | `clientTools`: a question with a button per option, answered with `TOOL_OUTPUT` |

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # every widget and the dev server's routes, no model needed
```

The root `dist/` must be built first (`npm run build` at the repository root): the example links
to this checkout (`"sygnal": "file:../.."`, and `"sygnal-check": "file:../../sygnal-check"`).
`npm run dev` also serves the [app graph](https://sygnal.js.org/guide/app-graph/) at
`http://localhost:5173/__sygnal/graph`, with live data from the app's tab.

### Models

- **Ollama** (no key): `ollama pull qwen3:8b` (chat and tools) and `ollama pull nimble` (decisions).
  The page talks to `http://localhost:11434` directly; another host: `VITE_OLLAMA_URL=http://host:11434 npm run dev`
  (and `OLLAMA_URL=` for the dev server's model list).
- **Kindo**: Kimi K3 is the default model whenever a Kindo key is set. All three wire formats go to
  `https://api.kindo.ai/v1` through the dev server.
- **TypeSafe Jev**: a hosted decision model, offered next to `nimble` once a key is set.
- **Chrome's built-in AI**: offered in section 1 when `LanguageModel` is available (Chrome with the
  Prompt API).

### API keys

The page never holds a provider key. It talks only to its own dev server, which adds the key on
the way to Kindo or TypeSafe (`server/providers.js`, a Vite plugin with `apply: 'serve'`, so a
`vite build` has none of it). Two ways to give it one:

- **The Keys button** (top right): the key goes once, same-origin, to the dev server, which keeps
  it in memory until it stops. It is never written to disk or browser storage, never logged and
  never sent back: the page only learns whether a key is set.
- **A key file** outside the repository, read when the dev server starts:

  ```bash
  mkdir -p ~/.config/kindo && echo 'KINDO_API_KEY=...' > ~/.config/kindo/env && chmod 600 ~/.config/kindo/env
  mkdir -p ~/.config/typesafe && echo 'TYPESAFE_API_KEY=...' > ~/.config/typesafe/env && chmod 600 ~/.config/typesafe/env
  ```

  (`KINDO_ENV_FILE` / `TYPESAFE_ENV_FILE` name other files.) The MCP App example reads the same
  Kindo file.

The routes take only what the page needs: Kindo's `/v1/responses`, `/v1/chat/completions`,
`/v1/messages` and `/v1/models`, and Jev decisions with `model: 'jev-latest'`. Requests from
another site are refused, so a page open in another tab can't spend a key through them.

## How it is built

- `src/main.js`, `src/sections.js`, `src/shell/`: the page (plain DOM), the section list, the top bar
  (a Sygnal app: provider status and the Keys dialog), the styles.
- `src/shared/providers.js`: one chat driver for every provider. A model is picked as
  `route::model` (`ollama::qwen3:8b`, `kindo::kimi-k3`), and `routed()`, a ten-line custom transport,
  hands each request to the route's transport. `src/shared/picker.jsx`: the model picker every
  widget shares.
- `src/building/`: the Building Chat tab: `steps.js` (the list), `kimi.js` (the one chat driver),
  `01-…jsx` to `08-…jsx` (one component per step) and their tests in `steps.test.js`.
- `src/demos/<section>/`: one widget per section. Each `index.js` exports `start(mountPoint, uid)`
  and the `files` shown under **Show code**; each widget has its own tests.
- `server/providers.js`: the dev server's routes (provider status, keys, the Kindo and TypeSafe
  proxies), with tests in `server/providers.test.js`.
