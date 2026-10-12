# Compose a workspace

A model builds the page from parts the app prepared. You describe what you want ("urgent tickets
first, then the pending orders"); the model only **picks and arranges** working Sygnal components
and picks their params from fixed lists. It writes no text, props or markup, so every label, number
and action on the page is the app's own.

Two kinds of model, one catalog, the same app code:

- a **decision model** (`compose.decisions()`): Ollama's `nimble`, or TypeSafe's Jev. It answers
  multiple-choice questions (which parts? side by side? which comes first?) with probabilities;
  code turns the answers into the layout;
- a **chat model** (`compose.llm()`): Ollama's `qwen3:8b`. It fills a JSON Schema of the catalog
  (a short plan, then the layout tree) in one structured-output request, streamed as a preview.

This is the idea of [json-render](https://json-render.dev)'s experimental Jev composition done with
`defineCatalog` and the `compose` behavior from `sygnal/ai`.

## Run it

```bash
npm install
npm run dev        # Ollama on http://localhost:11434 with a decision model (ollama pull nimble)
                   # and/or a chat model (ollama pull qwen3:8b)
npm test           # no model needed: composeWith answers with each backend's own fake replies
npm run try        # the labelled prompts against nimble, scored (see below)
```

Pick the model in the dropdown next to the prompt: the decision models and the chat models Ollama
has installed (`GET /api/tags`), and Jev when the dev proxy has a key. Another Ollama host:
`VITE_OLLAMA_URL=http://host:11434 npm run dev` (and `OLLAMA_URL=` for `npm run try`).

### Jev (TypeSafe), through the dev proxy

The browser never holds the API key. `npm run dev` adds a route, `POST /api/decide`
([`server/decide-proxy.js`](server/decide-proxy.js), dev only), that forwards a `decide()` request
to `https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer <key>`. The key is read when
the dev server starts from a file outside the repo:

```bash
mkdir -p ~/.config/typesafe && echo 'TYPESAFE_API_KEY=...' > ~/.config/typesafe/env && chmod 600 ~/.config/typesafe/env
npm run dev                                  # or TYPESAFE_ENV_FILE=/path/to/env npm run dev
```

Without the file, "Jev (TypeSafe)" isn't offered (`GET /api/decide/available` says
`{ "available": false }`). The proxy:

- never takes the key from a `VITE_*` variable (Vite would put it in the client bundle), never logs
  it and never sends it back (not in a reply, not in an error);
- takes only `POST` with a JSON body of at most 512 kB, and only the model `jev-latest`;
- refuses cross-site requests (`Origin` / `Sec-Fetch-Site`), so another site open in your browser
  can't spend the key through it;
- exists only on the dev server (`apply: 'serve'`): `vite build` output has no such route. In
  production, the same route belongs on your server (the
  [decisions guide](https://sygnal.js.org/guide/ai-decisions/#keys-stay-on-the-server)).

## How it works

**The catalog** ([`src/catalog.js`](src/catalog.js)): nine working parts, each a component with the
app's own data. `description` is all a model sees of a part. Params are the only inputs a model
gives: the revenue chart's `range` (year / quarter / month), the orders table's `status` and `limit`
(a number; a decision model picks one of its `bins`), the tickets' `priority`. The checklist and the
feedback form keep their state in the app state through a lens (`state: 'tasks'`,
`state: 'feedback'`), so ticks and drafts survive any recomposition.

**The page** ([`src/Workspace.jsx`](src/Workspace.jsx)):

```jsx
Workspace.uses = { page: compose(catalog, { backend, form: '.prompt-form', prompt: '.prompt' }) }
// in the view
<div className={classes('canvas', { preview: !!state.page.preview })}>{catalog.render(state.page, state)}</div>
```

`state.page` holds the prompt, the `status` (`idle`, `composing`, `preview`, `done`, `unavailable`,
`error`), the `layout` (plain JSON with identity keys), the `preview` while composing, and
`decisions`: what the decision panel ([`src/DecisionLog.jsx`](src/DecisionLog.jsx)) shows. For a
decision model, every answer of each step with its probabilities; for a chat model, its
`asked_for` plan and anything the repair step fixed. An example chip dispatches `page.COMPOSE`
with its prompt. A follow-up prompt recomposes; a part that stays keeps its key, so its instance
and its state.

**Switching backends** ([`src/backends.js`](src/backends.js), [`src/App.jsx`](src/App.jsx)). A
compose behavior's backend, and with it its sink, is fixed when the behavior is defined:
`compose.decisions()` sends `decide()` requests on `HTTP`, `compose.llm()` sends chat requests on
`LLM`. So each kind is its own component, `DecisionsWorkspace` and `LlmWorkspace`, with the same view,
intent and model, and the app shows the one the picked model needs:

```jsx
<Switchable of={{ decisions: DecisionsWorkspace, llm: LlmWorkspace }} current={state.backend?.kind ?? 'decisions'} />
```

The pages share the app state (no `state=`), so the page, the ticks and the draft stay when you
switch. Which model of a kind composes is known only at run time, so the backend of each kind is a
small wrapper that makes `compose.decisions({ url, model })` / `compose.llm({ model })` for the
model in `state.backend` and keeps that choice in the pending step (a reply is read by the backend
that asked, even if you pick another model meanwhile).

**Drivers** ([`src/main.js`](src/main.js)): `HTTP` is `makeFetchDriver()`; `LLM` is
`makeChatDriver({ transport: chatCompletions({ baseURL: 'http://localhost:11434/v1', body: { temperature: 0, reasoning_effort: 'none' } }) })`.
Thinking off: on qwen3 it took 5–15x longer and made no better layouts.

## Tests

`npm test`, no network:

- [`src/App.test.js`](src/App.test.js): the model picker from `/api/tags` (Jev only with the proxy's
  key), then the same scenarios once per backend with `renderComponent` + `composeWith`: a row and a
  param, the preview while composing, nothing fits, an error that keeps the page, ticks and drafts
  surviving recompositions (and a kept part keeping its instance), a chip composing, and switching
  kind with the page kept.
- [`server/decide-proxy.test.js`](server/decide-proxy.test.js): the proxy with a mocked `fetch`: the
  key from a temp env file, the `Authorization` header, the body forwarded, a model outside the
  allowlist, a GET, a cross-site request, non-JSON or a large body refused, and the key never in a
  reply.

## Measured

`npm run try` runs the 11 labelled flat-dashboard prompts and 4 param prompts through the real
backends and scores exact layouts (parts, order, rows and params):

```bash
npm run try                                  # nimble (Ollama)
npm run try -- --model qwen3:8b              # qwen3:8b (Ollama), compose.llm()
node --env-file=$HOME/.config/typesafe/env scripts/try-prompts.mjs --jev   # jev-latest; the key stays in process.env
npm run try -- "Only the urgent tickets"     # your own prompts
```

TRY_RESULTS

The research baseline the backends were ported from (PLAN-9, 2026-10-11), and the Phase 1 checks
of the shipped backends:

| | Jev | nimble | qwen3:8b + schema |
|---|---|---|---|
| Flat dashboard (11 prompts) | 9/11 | 9/11 | 11/11 |
| Structure (5 catalogs) | 189/210; shipped: 191/210 | 38/68 | 15/15; shipped: 15/15 |
| Enum params | 54/60; shipped: 57/60 | 19/20 | 20/20; shipped: 20/20 |
| Records | 35–36/40; shipped: 57/60 | 18/20 | — |
| Time per composition | ~0.35 s | ~3 s | ~3.4 s |

## Writing parts a model picks well

From the research evals:

- **Descriptions are "Noun (what it shows)"**, leading with the word a user says: "Revenue chart
  (line chart of the revenue trend over time)". Don't mention another part's content: "monthly
  revenue" on both the KPI and the chart pulled in the KPI whenever the chart was asked for.
- **Alternatives go in a `group`** (the first one asked for wins), never in overlapping descriptions.
  This catalog has none: no two parts here show the same thing.
- **Params are enums with a default**, each option saying what it shows ("the last 3 months (this
  quarter)"); a number gets `bins` naming the vague words it covers ("a few (top 3)"). Free text
  (`type: 'text'`) is for chat models only: a decision model keeps the default.
- **Fixed structure goes in data** (`required`, `pin`, `companions`, `in`, the catalog's `guidance`),
  not in a question to the model.
