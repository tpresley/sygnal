# PLAN-9: Composing UI from prepared parts (`sygnal/ai`: catalogs, `compose`, in-chat cards)

**Goal:**
- Let a model build an app's UI from parts the app prepared: real Sygnal components with their own
  data and wording. The model picks the parts, arranges them, sets their declared parameters, and
  edits the result on follow-ups. It never writes markup, state paths or action bindings.
- One catalog declaration drives both kinds of model:
  - **decision models** (TypeSafe Jev, Ollama `nimble`) through `decide()`;
  - **GenAI LLMs** through schema-constrained structured output on the chat driver.
- Composed parts work in the real app: state lenses into app state, `CHILD.select`, EVENTS, context
  and drivers.
- The same machinery lets an **agent in a chat show interactive cards** (options, a small form, a
  confirmation) and get the user's answer back as the tool result.

**Release:**
- **sygnal 6.3.0**: additive, with new exports in `sygnal/ai` (P9-Q1).
- **sygnal-check minor**, if the catalog rules (X-2) land.
- Core bytes: 0 unless the user approves 0-S1 / 0-S2 with numbers.

**Status:**
- Phase 0. The proposal this plan builds on is
  [`research/ai-compose/PROPOSAL.md`](research/ai-compose/PROPOSAL.md).
- The user accepted its recommendations on 2026-10-11 with two changes:
  - the `<Composed>` marker gets a spike, and shipping it depends on its impact on the core (D452);
  - the backends chain off `compose` (D451).
- Tracker: [`PLAN-9-status.md`](PLAN-9-status.md).

**Branches:**
- integration: `plan9-integration`, cut from `main` after the research branch
  (`claude/ai-ui-decision-models-1d866d`: the research folder, `examples/ai-compose`, this plan)
  is merged;
- subagent branches: `p9-*`;
- spikes: `exp/p9-*`.

**IDs:**
- items S- (spikes), K- (catalog and rendering), B- (backends), C- (the compose behavior),
  H- (chat cards), T- (testing), M- (the marker, gated), X- (diagnostics and checker), D- (docs),
  E- (examples and evals);
- questions P9-Q1…;
- decisions and gaps use a **reserved block, D450–D499 and G-750–G-799**. The global sequence ended
  at D319 / G-666 (PLAN-7), and PLAN-8 holds D400–D449 / G-700–G-749. A block keeps a parallel plan
  from colliding.

**Inputs** (subagents read the relevant ones before an item):
- [`research/ai-compose/PROPOSAL.md`](research/ai-compose/PROPOSAL.md): the API, code samples,
  numbers and decisions.
- [`research/ai-compose/structure/`](research/ai-compose/structure/): the decision encoding for
  structure. `composer.mjs` holds the exact question wording in `TEXT`, plus 5 labelled catalogs
  and `evals/`. Jev 189/210.
- [`research/ai-compose/params-edits/`](research/ai-compose/params-edits/): enum params, record
  parts, and edits in at most 2 calls (`params-edits.mjs`, `evals/cases.json`).
- [`research/ai-compose/llm/`](research/ai-compose/llm/): the LLM path. `llm-composer.mjs` covers
  the `tree+plan` schema and prompt, repair, the `ops2` edits and the partial-JSON preview; also the
  frontier pack and scorer, and the tool-call eval.
- [`research/ai-compose/api-prototype/`](research/ai-compose/api-prototype/): candidate A (the
  `compose` behavior), the catalog, both backends, `composeWith`, and the in-chat cards
  (`askUser`). 26 tests, with the core findings in `core.test.jsx`.
- [`research/ai-compose/json-render-proto/`](research/ai-compose/json-render-proto/): why we
  don't depend on json-render, and the ideas borrowed from it.
- `examples/ai-compose`: the first working example (flat page, `decide()`, nimble/Jev, an
  explain panel, `npm run try`).
- Existing code: `src/extra/ai/decide.ts`, `answers.ts`, `commandBar.ts` (a behavior over
  `decide()`), `src/extra/ai/chat/` (the `chat` behavior: `pending`, APPROVE/DENY, the tool loop),
  `src/extra/ai/agent/`, `src/core/instance.ts` (`idOf`), `src/core/hosts/collection.ts` (the model
  for a marker host).

**Invariants:**
- **One catalog, one layout format, two backends.** Choosing a backend is the only difference
  between a decision model and an LLM. App code, rendering, edits and tests are the same, and every
  behavior test runs once per backend.
- **The model only chooses.**
  - Parts, places, enum params and records come from the catalog and app state.
  - Free text is allowed only where a param says `type: 'text'`; it is LLM-only, and a decision
    model keeps the default.
  - No model output becomes a state path, an action name or markup.
- **Composed parts are the host's children**, so `CHILD.select` works and their state lives where
  their lens points. Containers are view functions.
- **The layout is plain JSON state** with identity keys. A follow-up edit keeps the key, and so the
  instance and the state, of every part it doesn't change.
- **0 bytes for apps that don't import it.** The code lives in `sygnal` outside `src/core/` and is
  side-effect free (as with `sygnal/ai` in PLAN-6). Core changes come only from 0-S1 / 0-S2, with
  numbers for the user.
- **No new dependencies** (D209). No json-render, no zod. Schemas are plain JSON Schema through
  `jsonSchema()`.
- **Tests never call a model.** `composeWith` and `answers()` fakes cover everything. The live
  accuracy check (E-3) is opt-in, like `npm run try`.

**Words:**
- "a part": a catalog entry the model can place;
- "a container": a catalog entry with slots, rendered by a view function;
- "the layout": the node map `{ root, nodes }`;
- "a composition": the `compose` behavior's slice;
- "a card": a composition inside a chat message;
- "a result part": a part that answers a card (with `compose.answer()`);
- "a backend": `compose.decisions()` or `compose.llm()`.

---

## 0. Decisions already made (2026-10-11)

| # | Decision |
|---|---|
| D450 | **One catalog for both backends** (`defineCatalog`), and one layout format: a node map with identity keys (`tasks`, `project:7`, repeats `~2`) and optional `params` and `slots` (user, accepting the proposal) |
| D451 | **Backends chain off `compose`**: `compose.decisions({ url, model, … })` and `compose.llm({ model, … })`. The precedent is `decide.openai()` (user, 2026-10-11) |
| D452 | **`<Composed>` marker: spike first (0-S1).** Ship M-1 only if its core impact is acceptable; the user decides on 0-S1's numbers. `catalog.render()` ships regardless (user, 2026-10-11) |
| D453 | **The `compose` behavior** for pages: `uses = { page: compose(catalog, { backend, form, prompt }) }`, rendered with `catalog.render(state.page, state)`. The builder layer (`backend.start/reply`, `fromTree`/`toTree`) is documented; the `<Composed>` *component* (candidate C) is not shipped (user, accepting the proposal) |
| D454 | **In-chat cards are built into `chat`**: an `ask` option and client tools (`input-available` until answered, an ANSWER action, cancel on STOP/SEND). The card's layout and answer live on the tool part (user, accepting the proposal) |
| D455 | **The ask tool takes one sentence, `ask_user({ need })`,** and the configured backend composes the card. `direct: true` (the layout as tool arguments) is opt-in for providers that enforce tool schemas. Ollama doesn't: 0 calls were valid as emitted, against 5/5 for the two-step form (user, accepting the proposal) |
| D456 | **Core: instance identity from the vnode `key`,** falling back to `props.id` (0-S2 measures it first) (user, accepting the proposal) |
| D457 | **json-render:** no dependency, no `@json-render/sygnal`, and no wrapping of `experimental_composeSpec`. Keep the layout shape close to its candidates/Spec; an interop package only if users ask (user, accepting the proposal) |
| D458 | **Containers are view functions, and the model never chooses one.** A container exists when parts land in its slots (`in`). The built-in `row` is created when the request asks for things side by side. Measured: `in` gives 37/37 against 25/37 for parent choices over every slot |
| D459 | Names: `defineCatalog`, `compose` (+ `.decisions`, `.llm`, `.answer`: D462), `composeWith` (testing), `chat({ ask })`; `byId` in `sygnal` (D463) |
| D460 | Release **6.3.0** (additive), with a sygnal-check minor if X-2 ships (user, P9-Q1) |
| D461 | `llms.txt` limit raised to **322 lines** (+2): one line for catalogs and `compose`, one for `chat({ ask })` (user, P9-Q2) |
| D462 | The result helper is **`compose.answer(props, value)`** (user, P9-Q3) |
| D463 | **`byId(field, id)` lives in `sygnal`**, not `sygnal/ai` (user, P9-Q4) |
| D464 | Docs demos use the demo server's fixture replies (no key); `examples/ai-compose` gets an optional dev proxy route that reads the Jev key from an env file outside the repo, never `VITE_*` (user, P9-Q5) |
| D465 | E-4's eval spend is asked for with an estimate when Phase 4 starts (user, P9-Q6) |

## 1. Scope

### 1.0 Spikes (S), Phase 0

**0-S1 The `<Composed>` marker** (D452)
- **Goal:** `<Composed catalog={catalog} from="page" />` renders a composition with its parts as
  the **host's** children, as `Collection` does today, so `CHILD.select(Part)`, lenses, identity
  keys and container views behave exactly as with `catalog.render()`.
- **Build:** a throwaway core host on `exp/p9-composed`, modelled on `hosts/collection.ts` and
  registered on import (D157), plus `api-prototype`'s tests run against both renderings.
- **Measure:**
  - **Bytes:** the size gate with and without importing the marker, kanban (must stay 0 for apps
    that don't import it), and the marker module itself.
  - **Core changes:** the lines changed in `src/core/` and which invariants they touch (identity,
    teardown, flush). Does it need anything Collection doesn't have, such as named slots, nested
    containers, or the `ui`/`local` slices?
  - **Behaviour parity:** every candidate-A test passes under the marker, including moves between
    containers, hidden tabs, `frozen` cards and `persist`.
  - **Perf:** the `test:perf-gate` counts for a 12-part composition, marker against `render()`.
  - **Diagnostics and devtools:** what `inspect()` shows (parts under the host, not under a fake
    parent), and HMR.
- **Output:** `research/ai-compose/marker-spike.md` with the numbers and a ship / don't-ship
  recommendation. The user decides (it becomes a D-number). M-1 is gated on it.

**0-S2 Identity from the vnode `key`** (D456)
- **Goal:** `idOf` uses `vnode.key ?? props.id ?? path`, so `catalog.render` (and any app) can key
  a component instance without passing `id` as a prop.
- **Measure:**
  - bytes in the size gate;
  - whether the full gate passes unchanged;
  - whether anything relies on `key` being ignored for components (search `test/`, `examples/`,
    docs);
  - the parity tests in `test/parity/`.
- **Output:** a short note in the status tracker. If it costs more than ~30 B gzip or breaks
  parity, `render` keeps passing `id` and this becomes a gap.

**0-S3 Chat client tools** (D454; small, design only)
- Write the `chat` changes as a typed sketch, checked against `src/extra/ai/chat/`:
  - tool calls left `input-available` and answered by an action;
  - several open calls at once;
  - what STOP / SEND / REGENERATE do to an open card;
  - how `persist` stores the tool part's `ui`;
  - how the AI SDK's `addToolResult` maps onto it (the `uiMessageStream` transport sends client
    tool results back).
- **Output:** the H-1 design, recorded in the tracker.

### 1.1 Catalog and rendering (K)

**K-1 `defineCatalog`** (P1)
- Normalize and validate the declaration (proposal §1):
  - `parts`: `component`, `props`, `description`, `state` (key / lens / `(node) => lens`) or
    `local`, `params`, `in`, `group`, `maxUses`, `required`, `pin`, `companions`, `category`,
    `result`;
  - `containers`: `slots`, `minSlots`, `arranged`, `render`;
  - `guidance`, `limits`, `examples`.
- Params:
  - enum `options` + `default`;
  - `type: 'number'` + `bins`;
  - `type: 'text'` / `'list'` (LLM-only; `required` with no default makes the part LLM-only);
  - `from: state => records` (`value`, `name`, `aliases`, `description`).
- Errors through X-1. The types in `src/ai.d.ts` infer part ids and param types for layouts and
  `composeWith`.

**K-2 `catalog.render(slice, state, { scope?, frozen? })`** (P1)
- Vnodes for the layout, or the preview while composing. Each part gets:
  - its identity key (as `key` after 0-S2, else `id`);
  - its lens;
  - its params as props (or through `props(params, state)`);
  - the `node`, `scope`, `frozen` and `answer` props.
- Containers render through their view with `{ key, node, slots, children, ui, control }`.
  `control(name, value)` writes `ui[nodeKey]` through the behavior (e.g. tabs).
- `local` part state is kept at `slice.local[nodeKey]`.
- A frozen card renders inside `<fieldset disabled>`.

**K-3 Layout utilities** (P1)
- `fromTree(catalog, tree, previous)` and `toTree(layout)`: identity keys, with repeats getting
  `~n` and keys reused from `previous`.
- `removeNode`; `byId` in `sygnal` (D463).
- The deterministic finishing step, shared by both backends: required parts, companions, pins,
  `minSlots` unwrap, single-part rows, limits, cycle and depth guards.

### 1.2 Backends (B)

Both backends implement `{ sink, start, reply, delta? }` with pending steps as plain state.

**B-1 `compose.decisions()`: select and layout** (P1)
- `structure/composer.mjs`'s encoding, ported with its exact wording:
  - select: `use_` / `pick_` / `count_` and the row gate;
  - layout: `parent_` over `in`, `beside_` / `left_`, pairwise `first_`, and `gap_`;
  - reading: clustering (`rowMean` option, default 0.25), summed pairwise order.
- **Calls:** 1 when nothing fits or for a single part, otherwise 2.
- **Preview:** shown after the select step.
- **Options:** `url` (default `/api/decide`), `model`, `key`, `rowMean`, `prefilter` (B-5).
- **Gate:** the structure evals, run opt-in (E-3), reproduce the research numbers within noise.

**B-2 `compose.decisions()`: params and records** (P1)
- From `params-edits/`:
  - an enum param is a choice in the select call, with `not_stated` meaning the default;
  - number bins name the vague words they cover;
  - record params: a lexical prefilter on name/aliases, then K "which X does the request name"
    choices (≤ 254 options; ≤ 25 on Ollama, so prefilter);
  - `group` alternatives are one choice.

**B-3 `compose.llm()`** (P1)
- From `llm/llm-composer.mjs`:
  - **One request:** the `tree+plan` schema (`asked_for`, then a nested tree; closed objects per
    part with enum params; record enums from state; depth, `in` and slot limits in the schema) and
    the system prompt with the catalog's `guidance` and `examples`.
  - **Streaming:** a `delta` gives a partial-JSON preview of the complete nodes so far, with stable
    keys.
  - **Errors:** repair, then validation; a schema violation becomes `status: 'error'`, never an
    invalid layout.
  - **Options:** `model`, `sink` (default `LLM`), `key`, `stream`, `plan` (default true),
    `instructions`.

**B-4 Edits, both backends** (P2)
- When a layout exists, `page.COMPOSE` is an edit.
- **Decisions** (at most 2 calls, `params-edits/`):
  - per node: a remove gate, a param-change gate, and move slots;
  - adds;
  - a swap gate, then one `where` choice (top / bottom / above / below / beside a node).
- **LLM:** `ops2`, operations positioned by named places, without the plan field.
- **Both:** a param change keeps the node key, a replacement takes the old node's place, and a
  reference node never moves.
- **Gate:** keys kept in 100% of the labelled edits.

**B-5 Large catalogs** (P3)
- The `category` pre-filter (call 0) for catalogs above ~60 parts, or `prefilter: true`.
- `maxParts` defaults: 12 (Jev), 8 (local).

### 1.3 The `compose` behavior (C)

**C-1 `compose(catalog, { backend, form?, prompt?, key? })`** (P1)
- Slice: `{ prompt, status, layout, preview, pending, decisions, error, ui, local }`. `status` is
  `idle | composing | preview | done | unavailable | error`; `layout` is kept on error and
  "nothing fits".
- Actions: `COMPOSE` (an edit when a layout exists; `{ prompt, fresh: true }` starts over),
  `SET_LAYOUT`, `REMOVE`, `CONTROL`, `DONE` (host entries run after), and internal
  `REPLY` / `DELTA` / `FAILED`.
- The backend's sink is the only sink it declares.
- Request lane: `key: 'compose'` with `latest`, so a new prompt aborts the old one's in-flight step
  (the race fixed in `examples/ai-compose`).

**C-2 Agents** (P2)
- `page.COMPOSE` works as an `agent` action (`{ prompt }` input), so a chat assistant can rearrange
  the page. Add a docs recipe and a test.

### 1.4 Chat cards (H), after 0-S3

**H-1 Client tools in `chat`** (P1 for H)
- A tool declared as a client tool isn't run by the agent layer. Its part stays `input-available`,
  and `'assistant.TOOL_RESULT' { toolCallId, output }` answers it; the next request goes once no
  call is open.
- STOP / SEND / REGENERATE cancel open calls, with a defined output.
- Works with `persist`. Also usable without `ask`, as a generic client tool.

**H-2 `chat({ ask: { catalog, backend?, instructions? } })`**
- Adds `ask_user({ need })`. On a call, the backend composes a card from `need`:
  - `compose.llm()` on the chat's own sink, as a structured-output request;
  - or `compose.decisions()`;
  - or, with no backend, the chat model's own `direct` layout.
- The card (`ui: { layout, status, answer, local, ui }`) is stored on the tool part. A result
  part's answer becomes `assistant.ANSWER`, which becomes the tool output `{ part, answer }`, and
  the conversation continues.
- Cards are keyed by `toolCallId`, so several can be open.
- Rendered with `catalog.render(part.ui, state, { scope: part.toolCallId, frozen })`.

**H-3 `direct: true`** (P2)
- The layout schema becomes the tool's input schema, with no compose round trip. LLM backends only;
  docs say which providers enforce tool schemas.

### 1.5 Testing (T)

**T-1 `composeWith(t, catalog, tree, { stream? })`** (P1)
- Answers whichever backend is pending: `answers()` for each `decide()` step, or
  `respond`/`stream` of the LLM JSON. Works for edits and for cards (it answers the card's compose
  step).
- Type tests for catalogs, layouts and `composeWith` trees.

**T-2 Per-backend test matrix** (P1)
- The behavior's test suite runs for both backends, as `api-prototype`'s tests do.

### 1.6 The marker (M), gated on 0-S1

**M-1 `<Composed catalog={catalog} from="page" />`**
- Only if the user approves after 0-S1. It ships as its own import (registered on import, D157),
  with docs that show both forms.

### 1.7 Diagnostics and checker (X)

**X-1 Runtime diagnostics** (P1; codes in §4)
- A layout naming an unknown part or slot: from `SET_LAYOUT`, `persist` or an old catalog. The
  node is dropped and reported.
- A container `render` that is a component with a model: its children would stop being the host's.
- A part with neither `component` nor `render`.
- `in` naming an unknown container or slot.
- A record `from` that doesn't return an array of `{ value }`.
- A `required` text param under a decision backend: info, "this part is LLM-only".
- A result part rendered outside a card.
- `compose.llm()` with no LLM driver (reuse SYG671).

**X-2 `sygnal-check` rules** (P2)
- Static catalog checks where the declaration is literal (as above).
- A **description lint**: overlapping descriptions within a catalog, and overlapping option wording
  within a part. These cause most of the measured selection errors. It could be an `explain` hint
  rather than a warning; decide in X-2.

### 1.8 Docs (D)

**D-1 `guide/ai-compose.md`**
- Concepts, the catalog, both backends, the behavior, edits, testing, and the authoring rules for
  descriptions.
- Live demos (remark-live):
  - a decision demo whose demo server answers `POST /v1/systemone` with `answers()` fixtures;
  - an LLM demo through the existing DX-1 `LLM` route (`encodeOpenResponses`);
  - an edit demo.
- After the docs change: `check-live` on all three browsers.

**D-2 Chat cards**
- A section in `guide/ai-chat.md` (or a page of its own), and `agent.md`'s client-tools note.

**D-3 Reference and agent context**
- `reference/api` entries.
- `llms.txt` lines (P9-Q2) and a `sygnal-dev` skill section (catalog, behavior, cards).
- `guide/ai-decisions.md` links.
- The errors reference regenerated for the new codes.

**D-4 Keys stay on the server**
- `compose.decisions()` defaults to `/api/decide`, so the guide's server route from
  `ai-decisions.md` applies unchanged. Show the Jev route.

### 1.9 Examples and evals (E)

**E-1 `examples/ai-compose` on the API** (P1)
- Rebuilt on `compose` with a backend picker: nimble / Jev (through a dev proxy route) /
  `qwen3:8b`.
- The explain panel reads `state.page.decisions`.
- `npm run try` becomes E-3's entry point.

**E-2 A chat-cards example** (P2)
- `examples/ai-ask`: an assistant on a local Ollama that asks with cards (choice, contact form,
  plans, confirm).
- Tests on fakes.

**E-3 Opt-in live accuracy check** (P2)
- `npm run test:compose-live` (not in `npm test`): the labelled sets from `research/ai-compose/`
  against Jev (with `--env-file`), nimble and `qwen3:8b`.
- Prints the research tables. It is a release signal, not a merge gate, with thresholds in §3.

**E-4 Agent-ergonomics eval** (P3, spend asked first)
- Can a coding agent add a part to a catalog and wire a result part using only `llms.txt` and the
  skill?

### 1.10 Not doing

- A json-render renderer, adapter or dependency (D457). An interop package is a later plan, if
  asked.
- Model-written free-form props beyond `type: 'text'` / `'list'` params, and model-written state
  paths or actions.
- Stateful container components ("creator-owned children": a large core change; containers are
  views, D458).
- Server-side composition and SSR of composed pages, beyond rendering a persisted layout (which
  works because the layout is state).

## 2. Phases

| Phase | Items | Exit |
|---|---|---|
| 0 | Merge the research branch; cut `plan9-integration`; `PLAN-9-status.md`; confirm the §4 reservations; 0-S1, 0-S2, 0-S3 (P9-Q1…Q6 answered: D460–D465) | The user's decisions on 0-S1 (marker) and 0-S2 (key) recorded as D-numbers |
| 1 | K-1, K-2, K-3, B-1, B-2, B-3, C-1, T-1, T-2, X-1, E-1; 0-S2's core change if approved | Full gate green; both backends pass the same behavior suite; E-3 (if built) reproduces the research numbers |
| 2 | B-4 edits, C-2, X-2, H-1, H-2, D-1 | Edits keep keys in 100% of labelled cases; cards round-trip on both backends |
| 3 | H-3, E-2, E-3, B-5, D-2, D-3, D-4, M-1 (if approved) | Docs build, `check-live` on 3 browsers, `check-doc-samples` clean |
| 4 | E-4 (if spend approved), release prep for 6.3.0 | The user approves the release |

## 3. Gates

- **The full `npm test` gate** (CLAUDE.md), plus `npm --prefix sygnal-check test` when X-2 lands.
- **Size gate:**
  - kanban stays ≤ 42,700 B gzip with `nativeGlobalThis: false`;
  - **0 B** from this plan's code for apps that don't import it;
  - core bytes only as approved for 0-S1 / 0-S2, with the measured number recorded.
- **Perf count gate:** unchanged for existing benchmarks. A 12-part composition benchmark is added
  if 0-S1 changes the core.
- **No model calls in tests.** A test that reaches the network fails.
- **Live accuracy check** (E-3, a release signal, run before release with numbers in the tracker):
  - Jev, structure sets: ≥ 85% exact;
  - Jev, edits: ≥ 85% held-out, with keys kept 100%;
  - `qwen3:8b`, flat and dashboard sets: ≥ 90%, with 0 invalid outputs;
  - nimble: reported, not gated.
- **Docs:** `npm --prefix docs run build`; `check-live` on Chromium, Firefox and WebKit;
  `check-doc-samples` 0 strict findings; the errors doc regenerated.
- **`sygnal-check --strict`** is clean on every new example and docs sample.

## 4. Diagnostic code reservations

All free in `codes.ts` today; confirm them in Phase 0.

| Range | Reserved for |
|---|---|
| 1xx wiring: **SYG160–169** | a result part outside a card; a container `render` that is a component with a model; a catalog part with neither `component` nor `render` |
| 2xx model/state: **SYG250–259** | a layout naming an unknown part or slot (dropped); an invalid param value in a layout; a record `from` that isn't an array of `{ value }` |
| 4xx components: **SYG450–459** | `in` naming an unknown container or slot; `<Composed>` misuse (M-1, if shipped); duplicate node keys |
| 6xx drivers/setup: **SYG680–689** | a required text param under a decision backend (info, the part is LLM-only); a backend option problem (a missing `model`); a decision model returning a choice outside the criteria |

Per CLAUDE.md, each code goes into both tables in `codes.ts` and gets an explanation in
`sygnal-check/src/explanations.js`. Then regenerate `explanations.json` and the errors doc.

## 5. Questions before Phase 1

The user accepted every recommendation on 2026-10-11 (D460–D465).

| # | Question | Recommendation |
|---|---|---|
| P9-Q1 | Release | **User, 2026-10-11: accepted (D460).** **6.3.0**, additive, with a sygnal-check minor if X-2 ships |
| P9-Q2 | `llms.txt` budget (319 / 320 lines) | **User, 2026-10-11: accepted (D461).** **Raise the limit to 322 (+2)**: one canonical line for catalogs and `compose`, one for `chat({ ask })`. Details go in the guide and the skill |
| P9-Q3 | The result helper's name: `answer(props, value)` sits next to the existing `answers()` test fixture | **User, 2026-10-11: accepted (D462).** **`compose.answer(props, value)`**, chained like the backends (D451), so the two don't read as a pair |
| P9-Q4 | Where `byId(field, id)` (a lens to an array element by id) lives | **User, 2026-10-11: accepted (D463).** **In `sygnal`** (it's general; record parts are its first user), not `sygnal/ai` |
| P9-Q5 | Live demos and examples for Jev | **User, 2026-10-11: accepted (D464).** Docs demos use the demo server's fixture replies (no key). `examples/ai-compose` gets an optional dev proxy route that reads the key from an env file outside the repo (never `VITE_*`) |
| P9-Q6 | E-4 eval spend | **User, 2026-10-11: accepted (D465).** Ask with an estimate when Phase 4 starts; the opt-in live check (E-3) is near-free (Jev) |

## 6. Risks

| Risk | Mitigation |
|---|---|
| Decision-model APIs change (Ollama's `/v1/systemone`, TypeSafe's limits such as 255 options and Ollama's 2–26) | Encodings keep options under the smallest limit (prefilters); `decide()` stays the single transport; E-3 runs before each release |
| Selection quality depends on authors' descriptions | The authoring rules in D-1, the X-2 lint, and the explain data (`decisions`) for debugging a layout |
| Jev is slightly nondeterministic (±1–3 per 45 between repeats) | E-3 thresholds with margin; tests never call models |
| Small local LLMs ignore tool schemas | D455's two-step ask; schema-enforced structured output for the layout; repair before validation |
| The marker grows the core | Spike first, with the user's decision on numbers (D452); `render()` ships regardless |
| `chat` complexity grows with client tools | 0-S3 designs it first; H-1 is usable on its own and tested on its own |
| Prompt injection through app data in descriptions or records | Models only choose among app-defined options; free text only in `type: 'text'` params, rendered as text, never as markup or paths |
