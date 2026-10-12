# Proposal: composing UI from prepared parts in `sygnal/ai`

Status: accepted with changes on 2026-10-11, and planned as [PLAN-9](../../PLAN-9.md). The changes:
the backends are `compose.decisions()` / `compose.llm()` (D451), and the `<Composed>` marker gets a
spike before a ship decision (D452). Nothing here is implemented in `src/` yet. The evidence is in
this folder: `structure/`, `params-edits/`, `llm/`, `json-render-proto/`, `api-prototype/` (each
with a REPORT.md), and the first example, `examples/ai-compose`.

## TL;DR

- **One catalog, two backends.** An app declares its parts once (`defineCatalog`). These are real
  Sygnal components with their own data and wording, plus a description, params, the places they may
  go, and how they reach app state. Either backend builds the same layout from that one declaration:
  a **decision model** (`decisions()`: Jev, nimble, via `decide()`) or a **GenAI LLM** (`llm()`:
  schema-constrained structured output through the chat driver).
- **The layout is plain state.** It is a node map with identity keys
  (`{ root, nodes: { tasks: { part: 'tasks' }, 'project:7': { part: 'project', params: { id: 7 } }, … } }`).
  It can be persisted, undone and tested, and a follow-up edit keeps the keys of the parts it doesn't
  touch, so their components keep their state.
- **Composed parts are ordinary children of the host.** State lenses into app state (including one
  per record), `CHILD.select`, EVENTS, context and drivers all work, and no core change is needed
  (tested). Containers are view functions, so parts stay the host's children.
- **Recommended API:** a `compose(catalog, { backend })` behavior for pages, and an "ask the user"
  card flow for agents in a chat. Both render with `catalog.render(...)`.
- **json-render:** no Sygnal renderer and no dependency on it. The reasons are 95 KB of zod, a 0.x
  experimental API, unchecked action bindings, and a prompt-based LLM contract that small models
  break. We keep a compatible shape and borrow its good ideas; interop, if ever wanted, goes in a
  separate package.

## What we measured

All scores are exact layouts. The case sets differ by column (see the reports), so compare within a
row with care.

| | Jev (TypeSafe) | nimble (Ollama, 9B) | qwen3:8b + schema (Ollama) | Claude, blind (frontier ref.) |
|---|---|---|---|---|
| Flat dashboard, 11 prompts | 9/11 | 9/11 | 11/11 | 10/11 |
| Nested structure: rows, sections, tabs, variants, repeats (5 catalogs) | 189/210 (90%) | 38/68 | dashboard 15/15, 50-part ops 14/15 | 14/15, 14/15 |
| Enum params | 54/60 | 19/20 | 20/20 | 20/20 |
| Parts from records (40 and 200 records) | 35–36/40 | 18/20 | — | — |
| Follow-up edits (keys kept) | 66/66 tuned, 43/48 held-out | 18/22, 10/16 | 27/31 | 31/31 |
| Free-text props | n/a (keeps the default) | n/a | 4/4 | 4/4 |
| Time per composition | ~0.35 s, 2 calls | ~3 s alone | ~3.4 s, 1 call | — |

What this says:
- **Jev** is the production default for decisions: fast, cheap, and strong on structure, params and
  edits. Its call latency stays flat from 5 to 51 questions.
- **nimble** is fine locally for first compositions on small catalogs (about 10 parts or fewer). It
  is weak on nesting and edits.
- **An 8B LLM with a schema the provider enforces** is the most accurate local option, but about 10x
  slower than Jev. It is the only backend that fills free text. A frontier LLM closes the remaining
  gap on edits.
- **The remaining errors are almost all part *selection*.** Arrangement from the right selection is
  62–63/65 on Jev. Selection quality depends mostly on descriptions; see the authoring rules below.

## 1. The catalog: one declaration for both backends

```jsx
import { defineCatalog, byId, answer } from 'sygnal/ai'

export const catalog = defineCatalog({
  guidance: 'Summaries before details; form fields before their buttons.',  // quoted in order questions and the LLM prompt
  limits: { maxParts: 12, maxDepth: 3 },
  parts: {
    revenue: {
      component: Kpi, props: { metric: 'revenue' },
      description: "Revenue (KPI card: this month's total, $48.2k)",          // all a model ever sees
    },
    revenueChart: {
      component: RevenueChart,
      description: 'Revenue chart (line chart of the revenue trend)',
      params: {                                                              // passed as props
        range: { label: 'time range', default: 'month',
          options: { week: 'the last 7 days (this week)', month: 'the last 30 days (this month)',
                     quarter: 'the last 3 months (this quarter)', year: 'the last 12 months (this year)' } },
      },
    },
    orders: {
      component: OrdersTable, in: ['page', 'tabs:billing'],                  // where it may go
      description: 'Orders (table of the most recent orders: customer, amount, status)',
      params: {
        limit: { type: 'number', label: 'how many rows', default: 10,       // LLM: a number; decisions: a bin
          bins: { 5: 'a few (top 3, top 5)', 10: 'ten (the default)', 25: 'many (all recent)' } },
      },
    },
    tickets: {
      component: TicketList,
      description: 'Tickets (open support tickets, by priority)',
      params: { search: { type: 'text', label: 'search terms', maxLength: 40, default: '' } },  // LLM fills it; decisions keep ''
    },
    tasks: { component: Checklist, state: 'tasks', description: "Tasks (the user's checklist for today)" },
    project: {                                                               // one node per record
      component: ProjectCard, group: 'projects', maxUses: 4,
      description: "Project (card: one project's status, owner and next milestone)",
      params: { id: { label: 'project', from: (state) => state.projects.map((p) => (
        { value: p.id, name: p.name, aliases: p.aliases, description: `${p.name}: ${p.status}, owner ${p.owner}` })) } },
      state: (node) => byId('projects', node.params.id),                     // a lens into app state
    },
    projectList: {                                                           // same group: cards OR the list
      component: ProjectList, group: 'projects', state: 'projects',
      description: 'Projects (a list, filtered by status)',
      params: { status: { label: 'status', default: 'any', options: { any: 'every project', blocked: 'blocked projects', late: 'late projects' } } },
    },
    note: {
      component: Note, local: { text: '' },                                  // state kept in the composition
      description: 'Note (a scratch note with a heading)',
      params: { title: { type: 'text', label: 'heading', maxLength: 40, required: true } },   // required free text: LLM only
    },
  },
  containers: {                                                              // views; the model never "chooses" one
    tabs: {
      slots: { overview: 'Overview tab: the summary', billing: 'Billing tab: money (subscription, invoices, payments)' },
      minSlots: 2,                                                           // fewer filled tabs: unwrapped
      render: ({ children, ui, control }) => <Tabs children={children} ui={ui} control={control} />,  // a view function
    },
  },
})
```

Field reference (each is measured in the reports):

| Field | Both backends | Notes |
|---|---|---|
| `component`, `props`, `description` | yes | `description`: lead with the noun the user says; don't mention other parts' content or param values |
| `state`: `'key'` / lens / `(node) => lens`, or `local: init` | n/a (wiring) | how the part reaches app state |
| `params` with `options` + `default` | yes | decisions: a choice with `not_stated` = default; LLM: an enum |
| `params` `type: 'number'` + `bins` | yes | LLM writes a number; decisions pick a bin |
| `params` `type: 'text'` (+ `default`) | LLM only | decisions keep `default`; `required` with no default makes the part LLM-only |
| `params` `from: state => records` | yes | decisions: prefilter by name/aliases, then pick (≤ 255 options; Ollama ≤ 26); LLM: an enum |
| `in`, `group`, `maxUses`, `required`, `pin`, `companions`, `category` | yes | `in` is the single most valuable field (layout 37/37 vs 25/37 without) |
| containers: `slots`, `minSlots`, `arranged`, `render` | yes | a built-in `row` is created when the request asks for side by side |
| `guidance`, `limits`, `examples` | yes / yes / LLM | `examples`: app-written few-shot cases (cheaper LLM prompt) |
| `result: true` (a part that answers) | yes | for cards that ask the user (§4) |

Authoring rules from the evals: write descriptions as "Noun (what it shows)". Put alternatives in a
`group`, never in overlapping descriptions; "monthly revenue" on both the KPI and the chart pulled
in the wrong part. Keep fixed structure in data (`required`, `pin`, `companions`, `guidance`) rather
than asking the model. A future `sygnal-check` lint could flag overlapping descriptions and option
wording.

## 2. Backends

```js
import { decisions, llm } from 'sygnal/ai'

decisions({ url: '/api/decide', model: 'jev-latest' })        // decide() on HTTP: 2 calls (select, layout); edits ≤ 2
decisions({ url: 'http://localhost:11434/v1/systemone', model: 'nimble', prefilter: true })
llm({ model: 'qwen3:8b' })                                     // the LLM sink: 1 structured-output request, streamed
llm({ model: 'claude-sonnet-5-5', examples: true })           // any chat transport the app's LLM driver has
```

- **The interface:** `{ sink, start, reply, delta? }`, with pending steps kept as plain state. The
  sink is the only driver the behavior declares, so an app without an LLM driver never declares one.
- **decisions():**
  - Select: one `use_<part>` choice per part (the request alone is the state), `pick_<group>`,
    `count_<part>`, enum params with `not_stated`, record picks, and a "side by side?" yes/no gate.
  - Layout: `parent_` over the places `in` allows, `beside_`/`left_` for rows, and pairwise
    `first_<a>_vs_<b>`.
  - Code does the rest: the order comes from summed probabilities, and required parts, companions,
    pins, `minSlots` and limits are applied.
  - Edits, in at most 2 calls: per-node remove / param change / move gates plus adds, then one
    `where` choice (top, bottom, above/below/beside a node) for each part being added or moved. The
    exact wording is in `structure/composer.mjs` (TEXT) and `params-edits/params-edits.mjs`.
- **llm():**
  - One request with `output: jsonSchema(layoutSchema(catalog, state))`. The model writes a nested
    tree with a short `asked_for` plan first. Parts are closed objects with enum params, and record
    ids are an enum taken from state.
  - Code converts the tree to the node map and repairs it: duplicate parts, single-part rows, limits.
  - Streaming gives a preview of the complete nodes so far, with stable keys.
  - Edits are `ops2`: operations positioned by named places ("above revenue"), never indexes.
- **Picking one is the only difference between backends.** The same app tests run against each
  (`composeWith`, §5).

## 3. Composing a page: the `compose` behavior (recommended)

```jsx
import { ABORT, persist } from 'sygnal'
import { compose, decisions, llm } from 'sygnal/ai'
import { catalog, ProjectCard } from './catalog.jsx'

function Workspace({ state }) {
  const page = state.page
  return (
    <div className="workspace">
      <form className="ask">
        <input className="prompt" aria-label="What do you want to see?" value={page.prompt} />
        <button type="submit" disabled={page.status === 'composing'}>Compose</button>
      </form>
      <p className="status">{page.status === 'unavailable' ? 'Nothing here fits that.' : page.error}</p>
      <main className={page.preview ? 'canvas preview' : 'canvas'}>{catalog.render(page, state)}</main>
    </div>
  )
}

Workspace.initialState = { tasks: [...], projects: [...], opened: null }

Workspace.uses = {
  page: compose(catalog, {
    backend: decisions({ url: '/api/decide', model: 'jev-latest' }),   // or llm({ model: 'qwen3:8b' })
    form: '.ask', prompt: '.prompt',
  }),
}

Workspace.persist = persist({ key: 'workspace', pick: ['page', 'tasks'] })   // the layout survives a reload, no model call

// composed parts are the host's own children
Workspace.intent = ({ CHILD }) => ({ OPENED: CHILD.select(ProjectCard) })

Workspace.model = {
  OPENED: (state, { id }) => ({ ...state, opened: id }),
  'page.DONE': (state, layout) => ABORT,                              // runs after the behavior's own DONE
}
```

- **The slice, `state.page`:**
  - `prompt` and `status`: `idle | composing | preview | done | unavailable | error`;
  - `layout`, the last finished one, kept on an error or a "nothing fits";
  - `preview`, `pending`, `decisions` (every probability, for an explain panel) and `error`;
  - `ui` (container state such as the open tab) and `local` (state for parts declared with `local`).
- **Actions:**
  - `page.COMPOSE`: a follow-up **edit** when a layout exists. `{ prompt, fresh: true }` starts over,
    and `next('page.COMPOSE', 'Show my tasks')` composes from code or from an agent action.
  - `page.SET_LAYOUT` (restore, undo, the app's own edits), `page.REMOVE`, `page.CONTROL` (tabs),
    and `page.DONE`.
- **Rendering:** `catalog.render(slice, state, { scope?, frozen? })` returns vnodes. Each part gets
  `id={nodeKey}` (instance identity), its lens, params as props, and `node` and `scope` props.

**Alternative, nearly equal: rendering as a marker.** Instead of `{catalog.render(state.page, state)}`,
the view would use `<Composed catalog={catalog} from="page" />`, a marker the core hosts (like
`Collection`), so parts would still be the host's children. It reads better in JSX and matches
`Collection`/`Switchable`, but it needs a new core host. That is not prototyped; the "children stay
the host's" claim is by analogy with Collection. **Recommendation: ship `catalog.render()` first**
(no core change, tested) and add the marker later as sugar if JSX authors ask for it.

The **builder layer** (`backend.start/reply`, `catalog.render`, `fromTree`/`toTree`) stays
documented for apps that need control over each step. A ready-made `<Composed>` *component* (the
third candidate) was rejected: the parts become its children, so the host can't `CHILD.select` them.

## 4. In-chat agent UI: "ask the user" cards

The target use case: an agent in a chat shows a card (options, a small form, a confirmation, a pick
among cards, "does this look right?"). The user answers, the answer is the tool result, and the
conversation continues. It works in the prototype with both backends, with no core or `chat` change.

What the evidence settled:
- **The tool input should be one sentence, `ask_user({ need })`.** The configured backend then
  composes the card: a schema-enforced LLM call, or `decisions()` over prepared parts.
- Ollama doesn't enforce tool schemas. With the layout passed directly as tool arguments, 0 of the
  calls were valid as emitted; with the two-step form, every card was valid and fit (5/5).
- That makes the decision backend natural here: the chat LLM states the need, and Jev picks the card.
- `direct: true` (the layout as tool arguments) is an option for providers that do enforce tool
  schemas. It saves a round trip, and it's LLM only.

A result part:

```jsx
export function ChoiceCard({ question, options, answer: picked, frozen }) {
  return <div className="choice"><p>{question}</p>
    {options.map((o) => <button type="button" className={o === picked ? 'option picked' : 'option'} data={{ value: o }} disabled={frozen}>{o}</button>)}
  </div>
}
ChoiceCard.intent = ({ DOM }) => ({ PICK: DOM.click('.option').data('value') })
ChoiceCard.model = { PICK: { PARENT: (state, value, next, props) => answer(props, value) } }   // { scope, node, value }

export const cards = defineCatalog({ parts: {
  choice: { component: ChoiceCard, result: true, description: 'Question (the user picks one of 2 to 5 short options)',
    params: { question: { type: 'text', maxLength: 120, required: true },
              options: { type: 'list', items: { maxLength: 40 }, min: 2, max: 5, required: true } } },   // generated: LLM
  plans: { component: PlanPicker, result: true, description: 'Plans (the pricing plans to pick from)' },  // prepared: both backends
  contact: { component: ContactForm, result: true, local: { name: '', email: '' }, description: 'Contact form (a name and an email)' },
  confirm: { component: Confirm, result: true, description: 'Confirmation (yes / no)' },
} })
```

**Candidate 1 (recommended): `ask` built into `chat`.** This needs a small `chat` change. It is not
prototyped in this form; candidate 2 is.

```jsx
Assistant.uses = {
  assistant: chat({
    form: '.ask', prompt: '.prompt',
    ask: { catalog: cards, backend: decisions({ url: '/api/decide', model: 'jev-latest' }) },   // or llm(), or omit: the chat model writes it
  }),
}
function Assistant({ state }) {
  const a = state.assistant
  return <ol className="messages">{a.messages.map((m) => <li className={m.role}>{m.parts.map((p) =>
    p.type === 'text' ? <p>{p.text}</p> : p.type === 'tool-ask_user' ? cards.render(p.ui, state, { scope: p.toolCallId, frozen: p.state === 'output-available' }) : null)}</li>)}</ol>
}
```

- `chat` adds the `ask_user({ need })` tool and treats it as a **client tool**: the call stays
  `input-available` while the card is open (like `pending` for approvals today).
- The card's layout and answer live on the tool part itself (`p.ui`), so the conversation history
  *is* the persisted record.
- An answer becomes `assistant.ANSWER`, which sets the output and sends the next request. STOP or a
  new SEND cancels an open card, which fixes a gap found in the prototype.
- Several open cards are keyed by `toolCallId`.
- Pros: the smallest app code, and the conversation holds everything.
- Cons: `chat` grows a feature, and the client-tools machinery (the AI SDK's `addToolResult`) is new
  work.

**Candidate 2: an `askUser` behavior plus an agent action.** This works today and is prototyped and
tested (`api-prototype/src/lib/askUser.jsx`, 4 tests).

```jsx
App.uses = { assistant: chat({ form: '.ask', prompt: '.prompt' }), cards: askUser(cards, { backend }) }
App.agent = { name: 'ui', read: (s) => cardResult(s.cards),
  actions: { 'cards.ASK': askTool(cards, 'cards', { backend }) } }      // waits with `until` for the answer
// view: p.type === 'tool-ui_cards_ask' ? renderCard(cards, state, 'cards', p) : …
```

- Pros: no `chat` change.
- Cons: the cards live in a second slice, linked to the messages by id; there is bookkeeping for
  `open`/`last`; the agent timeout has to be overridden for human waits; and the tool result is
  the declaration's `read`, which is also sent as app state.

**Recommendation:** build candidate 1. Keep candidate 2's pieces (`result` parts, scoped
`render`) as the shared foundation, since both need them.

## 5. Testing

```js
import { composeWith } from 'sygnal/ai'

for (const backend of [decisions({ model: 'jev-latest' }), llm({ model: 'qwen3:8b' })]) {
  it(`composes and edits with ${backend.sink}`, async () => {
    t = renderComponent(makeWorkspace(backend), { strict: true })
    t.simulateEvent('.prompt', 'input', { value: 'Atlas and Borealis, and my tasks' })
    t.simulateEvent('.ask', 'submit')
    await composeWith(t, catalog, [{ part: 'project', params: { id: 7 } }, { part: 'project', params: { id: 9 } }, { part: 'tasks' }])
    await t.waitForState((s) => s.page.status === 'done')
    t.simulateEvent('.project[data-node="project:9"] .notes', 'input', { value: 'call back' })
    await t.next((s) => s.projects[1].notes === 'call back')            // the part writes app state

    t.simulateEvent('.prompt', 'input', { value: 'Tasks first, and drop Atlas' })
    t.simulateEvent('.ask', 'submit')                                   // an edit
    await composeWith(t, catalog, [{ part: 'tasks' }, { part: 'project', params: { id: 9 } }])
    expect(t.query('.project .notes').value).toBe('call back')          // same key, same instance
    t.expectNoDiagnostics()
  })
}
```

- `composeWith(t, catalog, tree)` answers whichever backend is pending. For decisions it builds
  `answers()` for each `decide()` step; for an LLM it uses `respond` / `stream` with the layout JSON.
- `answers()`, `t.respond` and `t.stream` remain available for step-level tests.

## 6. json-render

**Decision: don't build `@json-render/sygnal` and don't depend on `@json-render/core`.**

- A Sygnal renderer for its Spec is easy at the core: 160 lines, 15 tests passing. Full parity is
  about 3,000 lines per framework, with no shared conformance suite, and its component code
  (shadcn) is React-only.
- Its render helpers cost 95 KB gzip with zod; Sygnal's whole size gate is 42.7 KB. The API is 0.21,
  the composer is `experimental_`, and catalog validation accepted an invented action binding.
- Its LLM mode is a 12K-character prompt contract that `qwen3:8b` and `llama3.1` broke. Its
  decision composer gave a stray empty row and a wrong root on nimble, because it lets the model
  choose containers and the root.

Borrowed from it: the two-call select/layout batch, exclusive variants (`group`), `maxUses`, step
snapshots (our preview), and repair. Our node map maps nearly 1:1 onto its candidates and Spec, so an
interop package (Spec import/export plus a hardened renderer, about a week) stays cheap if users ask.

## 7. Changes outside the new module

| Change | Needed for | Size |
|---|---|---|
| `chat`: client tools (`input-available` until answered), `ask` option, `ANSWER`, cancel on STOP/SEND | §4 candidate 1 | medium |
| Agent layer: `timeout: false` for human waits | §4 candidate 2 | small |
| Core: instance identity from the vnode `key` (today `props.id` is both key and prop) | cleaner `render` | small, optional |
| Core: "creator-owned children" (stateful container components) | not needed (containers are views) | large, not proposed |

## 8. Plan

1. **Catalog, render and backends** (about 2 weeks):
   - `defineCatalog`, `catalog.render`, `fromTree`/`toTree`, `byId`, `answer`;
   - `decisions()` (select and layout, from `structure/`) and `llm()` (`tree+plan` schema, repair,
     streamed preview, from `llm/`);
   - the `compose` behavior, `composeWith`, types, docs, and `examples/ai-compose` rebuilt on it.
2. **Params, records and edits** (about 1 week): from `params-edits/` and `llm/` (`ops2`), with the
   labelled eval sets kept as an opt-in live check (like `npm run try`), not in `npm test`.
3. **Chat cards** (about 1 week): §4 candidate 1, plus a chat example.
4. **Later:** a pre-filter for catalogs above ~60 parts, a description lint in `sygnal-check`, the
   `<Composed>` marker, and a json-render interop package if requested.

Estimates are rough. The encodings and prototypes exist, so most of the work is hardening, types,
docs and tests.

## 9. Decisions for you

1. **Chat integration:** `ask` built into `chat` (recommended; needs client tools) or the separate
   `askUser` behavior (works today).
2. **Rendering:** `catalog.render()` now with an optional `<Composed>` marker later (recommended),
   or the marker from the start.
3. **The optional core change:** identity from the vnode `key` (recommended; small).
4. **Names:** `defineCatalog`, `compose`, `decisions`, `llm`, `composeWith`, `answer`, `ask`. Any
   preferences? `llm` and `decisions` are short but generic.
