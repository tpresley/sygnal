# AI Virtual Panel (Sygnal Example)

A moderated AI panel discussion on models running in your own [Ollama](https://ollama.com), built with `sygnal/ai`.

## What it does

- Lists the models installed in Ollama (`GET /api/tags`, a `resources` read) in two dropdowns: the **chat model** and what picks the **next speaker** (a decision model, or the moderator through the chat model).
- Designs a panel for the topic (1 moderator, 3–5 experts) with **structured output**: the chat driver validates the reply against a JSON Schema (`jsonSchema()` from `sygnal/ai`).
- Runs the discussion loop:
  - A **decision model** (`decide()` with a `choice` of panelists and a `noul` "ready to wrap up?") picks who speaks next in a second or two, never the one who just spoke, and says when the panel has covered the topic (after at least 3 turns; at most 8).
  - Without one (or if it fails), the moderator picks with a structured-output chat request.
  - The moderator hands off (structured output: a message to the audience and the speaker's prompt); the expert's reply **streams** in (`delta`), with a "Thinking…" line while a reasoning model thinks.
  - The moderator streams a final synthesis.
- **Stop** aborts what is streaming (`{ abort: true }` to the `LLM` sink, the pending decision on `HTTP`).
- Saves each discussion (`persist()`, with the chosen models) and titles it with the chat model. The history drawer reopens or deletes saved sessions.
- Follow-up questions run a few more turns in the same saved session; naming a panelist ("Sofia, how would you…") gives them the floor first.
- **Copy Markdown** writes the transcript to the clipboard (the browser driver's `clipboardSource`).

## Run

```bash
ollama pull llama3.2       # or any chat model
ollama pull nimble         # optional: a decision model (Ollama 0.35 or later)
cd examples/ai-panel-spa
npm install
npm run dev
```

Ollama on another host: `VITE_OLLAMA_URL=http://host:11434 npm run dev` (and set `OLLAMA_ORIGINS` on that host).

## Where things are

- `src/main.js`: the drivers: `LLM` (`makeChatDriver` over `openResponses` to Ollama), `HTTP` (`makeFetchDriver`: the model list and the decision requests), `BROWSER` (the clipboard)
- `src/panel.js`: the prompts, schemas and request builders (pure functions of the state)
- `src/RootComponent.jsx`: the discussion loop; it owns every request, so every reply action comes back to it
- `src/components/`: Setup (model pickers, start/stop), the roster, the transcript (follow-ups, copy), the history and log drawers

## Test

```bash
npm test   # the whole loop on renderComponent's fakes: t.respond / t.stream for LLM, answers() for the decision model
```
