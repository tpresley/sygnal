---
title: Composing UI with a Model
description: Let a decision model or an LLM build a page from parts your app prepared — defineCatalog, the compose behavior and catalog.render, compose.decisions() and compose.llm(), parts wired into app state, and testing with composeWith
---

Some pages are better arranged by the user than by you: a dashboard, a workspace, a "show me what matters this morning" screen. With `sygnal/ai` the user describes the page in words ("urgent tickets first, then the pending orders"), and a model builds it from **parts your app prepared**: real Sygnal components with their own data, wording and actions.

The model only **chooses**. It picks parts, arranges them, and picks their params from the lists you declared. It never writes markup, state paths or action names, so every label, number and button on the composed page is the app's own, and every part is wired into app state the way you wired it.

One declaration, the **catalog**, works with two kinds of model:

- a **decision model** (TypeSafe Jev, Ollama's `nimble`) through [`decide()`](/guide/ai-decisions/): it answers multiple-choice questions ("is the revenue chart asked for?", "which comes first?") with probabilities, and code turns the answers into the layout;
- a **chat LLM** through the [chat driver](/guide/ai-chat/): it fills a JSON Schema of the catalog in one structured-output request, streamed as a preview.

Choosing the backend is the only difference. The app code, the rendering and the tests are the same.

Reach for it when the set of useful views is larger than the screens you want to design, and every view is made of parts you can build ahead of time. If the user needs text the app doesn't have (a summary, an answer), that's a [chat](/guide/ai-chat/); if the app needs one typed answer about some state, that's a [decision](/guide/ai-decisions/).

## The catalog

`defineCatalog()` declares the parts a model may place. Each part is a component plus a `description`, which is **all a model ever sees of it**. This catalog is the one every demo on this page composes from:

```jsx live-file=./catalog.jsx title="catalog.jsx"
import { defineCatalog } from 'sygnal/ai'

const KPIS = { revenue: ['Revenue', '$48.2k', '+6%'], signups: ['Signups', '312', '+12%'] }
const SERIES = { year: [31, 34, 33, 38, 41, 40, 44, 43, 46, 45, 47, 48], quarter: [45, 47, 48], month: [44, 46, 45, 47, 49, 48] }
const ORDERS = [
  { id: 'A-1041', customer: 'Northwind', amount: '$1,200', status: 'paid' },
  { id: 'A-1042', customer: 'Globex', amount: '$640', status: 'pending' },
  { id: 'A-1043', customer: 'Initech', amount: '$2,310', status: 'pending' },
  { id: 'A-1044', customer: 'Umbrella', amount: '$90', status: 'refunded' },
]
export const TICKETS = [
  { id: 1, title: 'Checkout fails on Safari', priority: 'high' },
  { id: 2, title: 'Invoice PDF is blank', priority: 'high' },
  { id: 3, title: 'Typo on the pricing page', priority: 'low' },
]
export const TASKS = [
  { id: 1, text: 'Reply to Globex', done: false },
  { id: 2, text: 'Review the Q3 numbers', done: true },
]

export function Kpi({ metric }) {
  const [label, value, delta] = KPIS[metric]
  return <section className="card kpi"><h3>{label}</h3><b>{value}</b> <span className="muted">{delta}</span></section>
}

export function RevenueChart({ range }) {
  const values = SERIES[range]
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 200},${60 - (v - 28) * 2.5}`).join(' ')
  return (
    <section className="card">
      <h3>Revenue, last {range}</h3>
      <svg viewBox="0 0 200 60" role="img" aria-label={`Revenue over the last ${range}`}><polyline points={points} /></svg>
    </section>
  )
}

export function OrdersTable({ status }) {
  const rows = ORDERS.filter((o) => status === 'any' || o.status === status)
  return (
    <section className="card">
      <h3>{status === 'any' ? 'Recent orders' : `Orders: ${status}`}</h3>
      <ul>{rows.map((o) => <li>{o.id} · {o.customer} · {o.amount}</li>)}</ul>
    </section>
  )
}

// a part that talks to its host: "Add to my tasks" goes to the PARENT sink
export function TicketList({ priority }) {
  const shown = TICKETS.filter((t) => priority === 'any' || t.priority === priority)
  return (
    <section className="card">
      <h3>{priority === 'high' ? 'Urgent tickets' : 'Open tickets'}</h3>
      <ul>{shown.map((t) => <li>{t.title} <button type="button" className="take" data={{ id: t.id }}>Add to my tasks</button></li>)}</ul>
    </section>
  )
}
TicketList.intent = ({ DOM }) => ({ TAKE: DOM.click('.take').data('id', Number) })
TicketList.model = { TAKE: { PARENT: (state, id) => TICKETS.find((t) => t.id === id) } }

// a part with state: the catalog gives it the lens `state: 'tasks'`, so it edits the app's tasks
export function Checklist({ state }) {
  return (
    <section className="card">
      <h3>Today</h3>
      <ul>{state.map((task) => <li><label><input type="checkbox" className="toggle" checked={task.done} data={{ id: task.id }} /> {task.text}</label></li>)}</ul>
    </section>
  )
}
Checklist.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.toggle').data('id', Number) })
Checklist.model = { TOGGLE: (tasks, id) => tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }

export function Weather() {
  return <section className="card"><h3>Weather</h3><b>27°C</b> <span className="muted">sunny in Lisbon</span></section>
}

export const catalog = defineCatalog({
  parts: {
    revenue: { component: Kpi, props: { metric: 'revenue' }, description: "Revenue (KPI card: this month's revenue total as one number)" },
    signups: { component: Kpi, props: { metric: 'signups' }, description: 'Signups (KPI card: new signups this week)' },
    revenueChart: {
      component: RevenueChart,
      description: 'Revenue chart (line chart of the revenue trend over time)',
      params: {
        range: {
          label: 'time range', default: 'year',
          options: { year: 'the last 12 months (this year)', quarter: 'the last 3 months (this quarter)', month: 'the last 30 days (this month)' },
        },
      },
    },
    orders: {
      component: OrdersTable,
      description: 'Orders (table of the most recent orders: customer, amount, status)',
      params: { status: { label: 'order status', default: 'any', options: { any: 'orders of every status', paid: 'paid orders', pending: 'pending orders (not paid yet)', refunded: 'refunded orders' } } },
    },
    tickets: {
      component: TicketList,
      description: 'Tickets (list of open support tickets, by priority)',
      params: { priority: { label: 'priority', default: 'any', options: { any: 'every open ticket', high: 'only high-priority (urgent) tickets' } } },
    },
    tasks: { component: Checklist, state: 'tasks', description: "Tasks (checklist of the user's tasks for today)" },
    weather: { component: Weather, description: "Weather (today's weather forecast for the office city)" },
  },
})
```

(This block is a module the demos on this page import, `./catalog.jsx`.)

```css live
.composer { display: grid; gap: 0.6rem; }
.composer .ask { display: flex; gap: 0.5rem; }
.composer .ask input { flex: 1; }
.composer .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.composer .chip { font-size: 0.8rem; }
.composer .status { margin: 0; font-size: 0.85rem; opacity: 0.8; }
.compose-page { display: grid; gap: 0.6rem; }
.compose-row { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 0.6rem; }
.canvas.preview { opacity: 0.6; }
.card { border: 1px solid #8884; border-radius: 6px; padding: 0.5rem 0.75rem; }
.card h3 { margin: 0 0 0.3rem; font-size: 0.9rem; }
.card ul { margin: 0; padding-left: 1.1rem; }
.card svg { width: 100%; height: 60px; }
.card polyline { fill: none; stroke: currentColor; stroke-width: 2; }
.muted { opacity: 0.7; font-size: 0.85em; }
.explain { font-size: 0.8rem; }
.explain ul { margin: 0.2rem 0 0.5rem; padding-left: 1.1rem; }
```

### Parts

| Field | What it does |
|---|---|
| `component` | The Sygnal component. It renders as a child of the host, so lenses, `CHILD.select`, `EVENTS`, context and drivers work as for any child. (`render`, a view function, works for a part with no state of its own.) |
| `description` | All a model sees of the part: "Noun (what it shows)" ([below](#writing-descriptions-a-model-picks-well)) |
| `props` | Fixed props, or `(params, state) => props` |
| `params` | The inputs a model gives, passed as props ([below](#params)) |
| `state` | How the part reaches app state: a key of the host's state (`'tasks'`), a lens, or `(node) => lens` for a record part. Without it the part sees the host's state, as any child does |
| `local` | State kept in the composition instead (`local: { text: '' }`), per placed part |
| `in` | Where it may go: `'page'` (the default), a container, or `'container:slot'` |
| `group` | Alternatives: parts in one group are offered as one choice, and the first one in a layout wins |
| `maxUses` | How often one identity may appear (default 1) |
| `required`, `pin`, `companions` | Always on the page (never offered to the model); pinned to `'start'` or `'end'`; parts added right after it |

### Params

Params are the only inputs a model gives, and each kind says what a model may write:

| Param | Both backends? | Example |
|---|---|---|
| `{ options, default }` | yes: a decision model picks one option, with "not stated" meaning the default; an LLM fills an enum | `range: { default: 'year', options: { year: 'the last 12 months (this year)', quarter: '…' } }` |
| `{ type: 'number', bins }` | yes: an LLM writes a number; a decision model picks a bin, which names the vague words it covers | `limit: { type: 'number', default: 5, min: 1, max: 8, bins: { 3: 'a few (top 3)', 8: 'all of them' } }` |
| `{ type: 'text' }`, `{ type: 'list' }` | LLM only: a decision model keeps the `default`, and a `required` one with no default makes the part LLM-only | `title: { type: 'text', maxLength: 40, required: true }` |
| `{ from: (state) => records }` | yes: one node per record the request names, found by `name` and `aliases` | below |

A **record param** turns one part into a part per record: "Northwind and Globex" places the customer card twice, once per customer. The record's `value` becomes part of the node key (`customer:7`), and `byId()` from `sygnal` gives each card a lens to its own record, so what it edits lands in app state:

```js
import { byId } from 'sygnal'

const customer = {
  component: CustomerCard,
  description: "Customer (card: one customer's plan, contact and notes)",
  maxUses: 4,
  params: {
    id: { label: 'customer', from: (state) => state.customers.map((c) => ({ value: c.id, name: c.name, aliases: c.aliases })) },
  },
  state: (node) => byId('customers', node.params.id),
}
```

`byId(field, id)` is a `{ get, set }` lens to the element of `state[field]` whose `id` is `id` (a third argument names another key). It works for any child: `<TodoItem state={byId('todos', 3)} />`.

### Containers

A container is a **view function** with named slots; parts go into a slot when their `in` names it. The model never chooses a container: a container appears when parts land in its slots, and the built-in `row` appears when the request asks for things side by side.

```jsx
const catalog = defineCatalog({
  parts: {
    orders: { component: OrdersTable, description: 'Orders (table of recent orders)', in: ['page', 'tabs:billing'] },
    invoices: { component: Invoices, description: 'Invoices (list of unpaid invoices)', in: 'tabs:billing' },
    tasks: { component: Checklist, state: 'tasks', description: "Tasks (the user's checklist)", in: ['page', 'tabs:overview'] },
  },
  containers: {
    tabs: {
      slots: { overview: 'Overview tab: the summary', billing: 'Billing tab: money (orders, invoices, payments)' },
      minSlots: 2,
      render: ({ children, ui, control }) => (
        <div className="tabs">
          <div role="tablist">
            {children.map((c, i) => <button type="button" role="tab" aria-selected={String(i === (ui.tab ?? 0))} {...control('tab', i)}>{c.slot}</button>)}
          </div>
          {children.map((c, i) => <div role="tabpanel" hidden={i !== (ui.tab ?? 0)}>{c.vnode}</div>)}
        </div>
      ),
    },
  },
})
```

- The view gets `{ key, node, params, slots, children, ui, control, frozen }`: `slots` maps each slot to its rendered parts, `children` lists them in order with their slot.
- `control(name, value)` returns data attributes to spread on an element: a click on it sets `ui[name] = value` for this container (the behavior's `CONTROL` action), so the open tab is state too.
- `minSlots`: with fewer filled slots the container is unwrapped and its parts go where it was.
- A container is a view, never a component with a model ([SYG161](/reference/errors/#syg161)): its parts must stay the host's children.

`in` is the most valuable field a catalog has: with it, a decision model placed parts right in 37 of 37 cases, against 25 of 37 when it chose a parent among every slot.

### Guidance and limits

- `guidance`: a sentence the order questions and the LLM prompt quote, for what the request doesn't say: `guidance: 'Summaries before details.'`
- `limits`: `{ maxParts: 12, maxDepth: 4 }` by default.
- `examples`: few-shot cases for an LLM (`{ prompt, tree }`), written by you.
- `rows: false`: no built-in row.

Fixed structure belongs in data (`required`, `pin`, `companions`, `in`, `guidance`), not in a question to the model.

### Writing descriptions a model picks well

Most of the measured errors are part *selection*, not arrangement: from the right parts, Jev arranged 62–63 of 65 layouts right. Selection depends mostly on the descriptions:

- **"Noun (what it shows)"**, leading with the word a user says: "Revenue chart (line chart of the revenue trend over time)". The demo app's catalog went from 5 to 7 of 11 prompts right on `nimble` with this form alone.
- **Don't let descriptions overlap.** Don't mention another part's content: "monthly revenue" on both the KPI and the chart pulled in the KPI whenever the chart was asked for.
- **Alternatives go in a `group`** (cards per project or a project list), never in two similar descriptions.
- **Each option says what it shows** ("the last 3 months (this quarter)"), and a number's `bins` name the vague words they cover ("a few (top 3)").

## Composing a page

The `compose` behavior holds a composition in a slice of the host's state, and `catalog.render()` renders it in the host's view:

```jsx
import { compose } from 'sygnal/ai'
import { catalog } from './catalog.jsx'

function Dashboard({ state }) {
  return (
    <div>
      <form className="ask">
        <input className="prompt" aria-label="The page you want" value={state.page.prompt} />
        <button type="submit">Compose</button>
      </form>
      <div className="canvas">{catalog.render(state.page, state)}</div>
    </div>
  )
}

Dashboard.uses = {
  page: compose(catalog, { backend: compose.decisions({ model: 'jev-latest' }), form: '.ask', prompt: '.prompt' }),
}
```

`form` and `prompt` are selectors: typing in the prompt field sets `state.page.prompt`, and submitting the form composes.

In this demo, the demo server below stands in for both kinds of model. They only match words, which is enough to show the wiring: the decision route answers each question `decide()` sends, by name, and the chat route writes the layout JSON a chat model would. A real model reads the descriptions instead.

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

// how a request names each part, and each param value (a real model reads the descriptions)
const PARTS = {
  revenue: /revenue(?! (chart|trend))/i,
  signups: /sign-?ups?/i,
  revenueChart: /chart|trend/i,
  orders: /orders?\b/i,
  tickets: /tickets?|support/i,
  tasks: /tasks?|to-?dos?/i,
  weather: /weather|forecast/i,
}
const PARAMS = {
  revenueChart: { range: { quarter: /quarter/i, month: /month/i } },
  orders: { status: { pending: /pending|unpaid/i, paid: /\bpaid/i, refunded: /refund/i } },
  tickets: { priority: { high: /urgent|high/i } },
}
const SIDE = /side by side|beside|next to|in a row/i
const at = (text, id) => text.search(PARTS[id])
const clause = (text, id) => text.split(/,|\bthen\b/i).find((c) => PARTS[id].test(c)) ?? ''
const valueOf = (text, id, name) => Object.keys(PARAMS[id][name]).find((v) => PARAMS[id][name][v].test(text))
const sure = (choice, keys, p = 0.92) => ({
  type: 'choice', choice, confidence: p,
  probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? p : (1 - p) / (keys.length - 1)])),
})

// a decision model: one answer per question, by the question's name
function answer(name, question, text) {
  const keys = Object.keys(question.criteria ?? {})
  let m
  if (name === 'row') return { type: 'noul', noul: SIDE.test(text) ? 0.91 : 0.04 }
  if ((m = name.match(/^use_(\w+)$/))) return sure(at(text, m[1]) >= 0 ? 'use' : 'omit', keys)
  if ((m = name.match(/^param_(\w+?)__(\w+)$/))) return sure(valueOf(text, m[1], m[2]) ?? 'not_stated', keys)
  if ((m = name.match(/^beside_(\w+)$/))) {
    const c = clause(text, m[1])
    return sure((SIDE.test(c) && keys.find((k) => k !== 'none' && k !== m[1] && PARTS[k]?.test(c))) || 'none', keys)
  }
  if ((m = name.match(/^(?:first|left)_(\w+)_vs_(\w+)$/))) return sure(at(text, m[1]) <= at(text, m[2]) ? m[1] : m[2], keys)
  return sure(keys[0], keys)
}

// a chat model: the layout JSON, in the order the request names the parts
function layout(text) {
  const named = Object.keys(PARTS).filter((id) => at(text, id) >= 0).sort((a, b) => at(text, a) - at(text, b))
  const node = (id) => {
    const params = Object.fromEntries(Object.keys(PARAMS[id] ?? {}).map((n) => [n, valueOf(text, id, n)]).filter(([, v]) => v))
    return Object.keys(params).length ? { part: id, params } : { part: id }
  }
  const row = named.filter((id) => SIDE.test(clause(text, id)))
  const children = named.flatMap((id) => !row.includes(id) || row.length < 2 ? [node(id)] : id === row[0] ? [{ part: 'row', children: row.map(node) }] : [])
  return JSON.stringify({ asked_for: named.map((id) => text.match(PARTS[id])[0]), children })
}

export default {
  'POST /api/decide': ({ json }) => ({
    delayMs: 350,
    json: { model: json.model, answers: Object.fromEntries(Object.entries(json.questions).map(([name, q]) => [name, answer(name, q, json.state.user_request)])) },
  }),
  'POST /v1/responses': ({ json }) => ({
    delayMs: 300,
    chunkMs: 90,
    sse: encodeOpenResponses(layout(String(json.input.at(-1).content)).match(/[\s\S]{1,16}/g)),
  }),
}
```

The demo composes its first prompt on load. Try the other prompts, or your own with the words the stand-in knows (revenue, signups, chart, orders, tickets, tasks, weather; "side by side"; quarter, month, pending, urgent). Under the page, the model's answers: every question of each step, with the probability of the answer it chose.

```jsx live live-height=520 title="Dashboard.jsx"
import { compose } from 'sygnal/ai'
import { catalog, TASKS } from './catalog.jsx'

const EXAMPLES = [
  'Revenue and signups side by side, then the revenue chart for the quarter',
  'Urgent tickets first, then the pending orders',
  'The weather and my tasks',
  'The stock price of Apple',
]

const STATUS = {
  idle: () => 'Describe the page you want.',
  composing: () => 'Composing…',
  preview: () => 'Arranging the parts…',
  done: () => 'Done.',
  unavailable: () => 'Nothing in the catalog fits that request.',
  error: (page) => `The model failed: ${page.error}`,
}

const pct = (p) => `${Math.round((p ?? 1) * 100)}%`
const answerLine = ([name, a]) => (
  <li><code>{name}</code>: {a.type === 'noul' ? pct(a.noul) : <>{a.choice} <span className="muted">{pct(a.probabilities?.[a.choice])}</span></>}</li>
)

function Dashboard({ state }) {
  const page = state.page
  const busy = page.status === 'composing' || page.status === 'preview'
  return (
    <div className="composer">
      <form className="ask">
        <input className="prompt" aria-label="The page you want" value={page.prompt} />
        <button type="submit" disabled={busy}>Compose</button>
      </form>
      <div className="chips">
        {EXAMPLES.map((p) => <button type="button" className="chip" data={{ prompt: p }} disabled={busy}>{p}</button>)}
      </div>
      <p className="status" aria-live="polite">{STATUS[page.status](page)}</p>
      <div className={page.preview ? 'canvas preview' : 'canvas'}>{catalog.render(page, state)}</div>
      {page.decisions && (
        <details className="explain" open>
          <summary>The model's answers</summary>
          {Object.entries(page.decisions).map(([step, answers]) => (
            <>
              <b>{step}</b>
              <ul>{Object.entries(answers).map(answerLine)}</ul>
            </>
          ))}
        </details>
      )}
    </div>
  )
}

Dashboard.initialState = { tasks: TASKS }

Dashboard.uses = {
  page: compose(catalog, { backend: compose.decisions({ model: 'jev-latest' }), form: '.ask', prompt: '.prompt' }),
}

Dashboard.intent = ({ DOM }) => ({ EXAMPLE: DOM.click('.chip').data('prompt') })

Dashboard.model = {
  // the demo composes on load only to have something to show
  BOOTSTRAP: { EFFECT: (state, data, next) => next('page.COMPOSE', EXAMPLES[0]) },
  EXAMPLE: { EFFECT: (state, prompt, next) => next('page.COMPOSE', prompt) },
}

export default Dashboard
```

A decision model composes in at most two `decide()` calls (watch the demo server's notes): a **select** step (which parts, which params, "side by side?"), then, when there is something to arrange, a **layout** step (which comes first, what goes beside what). After the select step the chosen parts show as a preview while the layout step runs.

### The slice

`state.page` (the key you gave in `uses`):

| Field | |
|---|---|
| `prompt` | The request |
| `status` | `idle`, `composing` (a request is out), `preview` (a partial layout shows), `done`, `unavailable` (nothing in the catalog fits), `error` |
| `layout` | The last finished layout: plain JSON, `{ root: 'page', nodes }`. Kept on an error and when nothing fits |
| `preview` | The layout being built; `catalog.render` shows it instead while it is set |
| `decisions` | What the backend explains: a decision model's answers per step, or an LLM's plan (`asked_for`) and what its repair step fixed |
| `error` | Why the last composition failed |
| `ui`, `local` | Container state (the open tab) and `local` parts' state, per node |

The layout's node keys are **identities**: the part id (`orders`), `part:value` for a record (`customer:7`), `~2` for a repeat, `row` and `row~2` for rows. A part that stays in a new composition keeps its key, so its instance and its state.

- **Nothing fits** ("The stock price of Apple"): `status: 'unavailable'`, and the page keeps its layout.
- **Errors**: a failed request, or a reply the backend can't turn into a valid layout, is `status: 'error'` with `error` set. The page keeps its layout: a model's mistake never becomes an invalid page.
- A new prompt while one is composing aborts the old one's step in flight.

### Actions

The behavior's actions are the host's, under the slice's key:

| Action | Data |
|---|---|
| `page.COMPOSE` | A prompt, `{ prompt, fresh: true }` (start over), or nothing (the form's submit: the slice's prompt). From code: `next('page.COMPOSE', 'Show my tasks')`, as the demo's chips do |
| `page.SET_LAYOUT` | A layout to show without a model: restore, undo, your own edits. `null` clears |
| `page.REMOVE` | A node key: that part and anything inside it go |
| `page.CONTROL` | `{ key, name, value }`: a container control (what `control()` clicks send) |
| `page.DONE` | Sent when a composition finishes, with the layout. A host entry `'page.DONE'` runs after the behavior's |

When a layout exists, a new prompt composes from scratch and reuses the keys of the parts that stay. Editing the current page on a follow-up ("move the orders to the top") is planned for a later release.

### `catalog.render`

`catalog.render(slice, state)` returns the composition as vnodes for the host's view: `slice.preview ?? slice.layout`, each part a child of the host keyed by its node key, and containers through their views. Each part gets its params (defaults filled) as props, its lens, and the prop `node` (its key).

It renders anything with a `layout`, so a layout you keep elsewhere renders the same way: `catalog.render({ layout: state.saved }, state)`.

## Parts are real components

Composed parts are the host's children. A part with a lens edits app state, a part's `PARENT` value reaches the host through `CHILD.select`, and context and drivers work as for any child.

In this demo the checklist edits `state.tasks` (the summary line outside the composition reads it), and the ticket list's "Add to my tasks" goes to the host, which adds a task the checklist then shows. Recompose with "Only my tasks": the ticks stay, because they are app state, and the checklist keeps its instance, because its node key (`tasks`) is the same.

```jsx live live-height=300 title="Planner.jsx"
import { ABORT } from 'sygnal'
import { compose } from 'sygnal/ai'
import { catalog, TASKS, TicketList } from './catalog.jsx'

const PROMPTS = ['My tasks beside the urgent tickets', 'Only my tasks']

function Planner({ state }) {
  const done = state.tasks.filter((t) => t.done).length
  return (
    <div className="composer">
      <p className="summary">{done} of {state.tasks.length} tasks done</p>
      <div className="chips">{PROMPTS.map((p) => <button type="button" className="chip" data={{ prompt: p }}>{p}</button>)}</div>
      <div className="canvas">{catalog.render(state.page, state)}</div>
    </div>
  )
}

Planner.initialState = { tasks: TASKS }

Planner.uses = { page: compose(catalog, { backend: compose.decisions({ model: 'jev-latest' }) }) }

Planner.intent = ({ DOM, CHILD }) => ({
  EXAMPLE: DOM.click('.chip').data('prompt'),
  TAKE: CHILD.select(TicketList),
})

Planner.model = {
  BOOTSTRAP: { EFFECT: (state, data, next) => next('page.COMPOSE', PROMPTS[0]) },
  EXAMPLE: { EFFECT: (state, prompt, next) => next('page.COMPOSE', prompt) },
  TAKE: (state, ticket) => (state.tasks.some((t) => t.text === ticket.title)
    ? ABORT
    : { ...state, tasks: [...state.tasks, { id: state.tasks.length + 1, text: ticket.title, done: false }] }),
}

export default Planner
```

**Persisting a page.** The layout is plain state, so [`persist()`](/guide/persistence/) keeps it across reloads with no model call: pick the slice and the state the parts use.

```js
import { persist } from 'sygnal'

Planner.persist = persist({ key: 'planner', pick: ['page', 'tasks'] })
```

## Backends

### `compose.decisions()`

```js
compose.decisions({ model: 'jev-latest' })                                   // POST /api/decide, your server's route
compose.decisions({ url: 'http://localhost:11434/v1/systemone', model: 'nimble', rowMean: 0.5 })   // a local Ollama
```

It sends [`decide()`](/guide/ai-decisions/) requests on the `HTTP` sink (the [fetch driver](/guide/http/)): one when nothing fits or a single part is asked for, otherwise two. The model writes no text; code reads the probabilities, so the layout follows the answers it was most sure of. Options:

- `url`: the decision endpoint, `'/api/decide'` by default;
- `model`: required ([SYG681](/reference/errors/#syg681) without one);
- `rowMean`: how sure "side by side" answers must be to make a row (0.25, measured on Jev; 0.5 suits `nimble`);
- `prefilter: true`: one more call first, to narrow a large catalog (above about 60 parts) by the parts' `category`;
- `maxOptions`: the most options one question may have (255; 25 when `url` looks like Ollama).

### `compose.llm()`

```js
compose.llm({ model: 'gpt-5-mini' })    // the LLM sink: one structured-output request, streamed
```

It sends one chat request on the `LLM` sink ([`makeChatDriver()`](/guide/ai-chat/), any transport): a system prompt with the catalog as text and its `guidance`, and a JSON Schema of the catalog as the structured output. The model writes a short plan (`asked_for`: what the request asks for), then the layout tree. Parts are closed objects with enum params, so a schema the provider enforces keeps it to the catalog. While it streams, the complete parts so far show as the preview. The reply goes through a repair step (unknown parts dropped, duplicates removed, bad params set to their default); a reply still invalid after it is `status: 'error'` ([SYG683](/reference/errors/#syg683)), never a layout.

Options: `model`, `sink` (`'LLM'`), `stream` (true), `plan` (true; false when the catalog has `examples`), `instructions` (more rules, or a function of the system prompt), `examples`, and transport options such as `body: { temperature: 0 }`, sent on the request as is.

This demo is the first one with `compose.llm()`: its stand-in model streams the layout JSON from the demo server's `'POST /v1/responses'` route, so the page fills in part by part. Under it, the model's plan.

```jsx live live-height=360 title="LlmDashboard.jsx"
import { compose } from 'sygnal/ai'
import { catalog, TASKS } from './catalog.jsx'

const PROMPTS = ['Signups and revenue side by side, then the monthly revenue chart and the paid orders', 'The weather, then urgent tickets']

function LlmDashboard({ state }) {
  const page = state.page
  return (
    <div className="composer">
      <div className="chips">{PROMPTS.map((p) => <button type="button" className="chip" data={{ prompt: p }}>{p}</button>)}</div>
      <p className="status" aria-live="polite">{page.status === 'preview' ? 'Writing the layout…' : page.status}</p>
      <div className={page.preview ? 'canvas preview' : 'canvas'}>{catalog.render(page, state)}</div>
      {page.decisions?.asked_for && <p className="explain">Plan: {page.decisions.asked_for.join(' · ')}</p>}
    </div>
  )
}

LlmDashboard.initialState = { tasks: TASKS }

LlmDashboard.uses = { page: compose(catalog, { backend: compose.llm() }) }

LlmDashboard.intent = ({ DOM }) => ({ EXAMPLE: DOM.click('.chip').data('prompt') })

LlmDashboard.model = {
  BOOTSTRAP: { EFFECT: (state, data, next) => next('page.COMPOSE', PROMPTS[0]) },
  EXAMPLE: { EFFECT: (state, prompt, next) => next('page.COMPOSE', prompt) },
}

export default LlmDashboard
```

### Choosing one

Measured on the research catalogs (exact layouts; the case sets differ by column):

| | Jev (TypeSafe) | `nimble` (Ollama) | `qwen3:8b` + schema (Ollama) |
|---|---|---|---|
| Backend | `compose.decisions()` | `compose.decisions()` | `compose.llm()` |
| Flat dashboard (11 prompts) | 9/11 | 9/11 | 11/11 |
| Rows, sections, tabs, repeats (5 catalogs) | 191/210 | 38/68 | 15/15 |
| Enum params | 57/60 | 19/20 | 20/20 |
| Parts from records | 57/60 | 18/20 | — |
| Free-text params | keeps the default | keeps the default | yes |
| Time per composition | ~0.35 s, 2 calls | ~3 s | ~3.4 s, 1 call |

- **Jev** is the production default: fast, cheap, and strong on structure, params and records.
- **`nimble`** is fine on your machine for small catalogs (about 10 parts or fewer), and weak on nesting.
- **An LLM with a schema the provider enforces** is the most accurate local option and the only one that fills free text, about ten times slower than Jev.

Switching is one line: the catalog, the host and the tests stay the same. A backend sends on one sink, so a page that switches between kinds at run time uses one host per kind (the [`examples/ai-compose`](https://github.com/tpresley/sygnal/tree/main/examples/ai-compose) app shows both in a `Switchable`).

### Keys stay on the server

`compose.decisions()` posts to `/api/decide` by default, so the [server route from AI Decisions](/guide/ai-decisions/#keys-stay-on-the-server) serves it unchanged: it adds the key, fixes the model, requires a session and limits the size of the request. For Jev, point it at TypeSafe's endpoint:

```js
// server: POST /api/decide
import { currentUser } from './auth.js'      // your session check

const MODELS = new Set(['jev-latest'])
const DECIDE_URL = 'https://api.typesafe.ai/v1/systemone'

export async function POST(req) {
  if (!(await currentUser(req))) return new Response('Sign in first', { status: 401 })
  const body = await req.text()
  const { model } = JSON.parse(body)
  if (!MODELS.has(model) || body.length > 512_000) return new Response('Bad request', { status: 400 })
  const res = await fetch(DECIDE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` },
    body,
  })
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } })
}
```

A composition's requests are larger than a single decision (every part's description is in its questions), so allow more than a triage route would. `compose.llm()` goes through your chat driver's transport, which [ships behind your own route](/guide/ai-chat/#shipping-it) the same way.

## Testing

Tests never call a model. `composeWith(t, catalog, tree)` answers the pending composition so that it becomes `tree`, whichever backend is pending: it builds each step's reply with the backend's own `fake()` (the `decide()` answers, or the LLM's JSON) and sends it as the model would. So one test runs against both backends:

```js
import { describe, it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { compose, composeWith } from 'sygnal/ai'
import { catalog } from './catalog.jsx'
import { makeDashboard } from './Dashboard.jsx'

describe.each([
  ['decisions', compose.decisions({ model: 'jev-latest' })],
  ['llm', compose.llm()],
])('compose.%s()', (name, backend) => {
  it('puts revenue and signups in a row, then the chart for the quarter', async () => {
    const t = renderComponent(makeDashboard(backend))
    t.simulateAction('page.COMPOSE', 'Revenue and signups side by side, then the revenue chart for the quarter')
    await composeWith(t, catalog, [
      { part: 'row', children: [{ part: 'revenue' }, { part: 'signups' }] },
      { part: 'revenueChart', params: { range: 'quarter' } },
    ])
    await t.waitForState((s) => s.page.status === 'done')
    expect(t.query('.compose-row')).toBeTruthy()
    expect(t.html()).toContain('Revenue, last quarter')
    t.dispose()
  })

  it('keeps the page when nothing fits', async () => {
    const t = renderComponent(makeDashboard(backend))
    t.simulateAction('page.SET_LAYOUT', { root: 'page', nodes: { page: { part: 'page', slots: { default: ['weather'] } }, weather: { part: 'weather' } } })
    t.simulateAction('page.COMPOSE', 'The stock price of Apple')
    await composeWith(t, catalog, [])
    await t.waitForState((s) => s.page.status === 'unavailable')
    expect(t.html()).toContain('27°C')
    t.dispose()
  })
})
```

Here `makeDashboard(backend)` returns the first demo's component with that backend in its `uses` (and without its `BOOTSTRAP` entry: the demo composes on load only to have something to show).

- `composeWith` throws when the backend can't reach `tree` (a record the prompt doesn't name, for a decision model), so a test can't pass by accident.
- `{ stream: n }` streams an LLM reply in `n` chunks, through the preview.
- To test the preview or a failure, answer one step yourself: `t.respond('HTTP', backend.fake({ catalog, state: t.state, pending: t.state.page.pending, target }), 'page.REPLY')`, or `t.fail(backend.sink, 500, 'page.FAILED')`.
- A layout is plain JSON: `t.state.page.layout.nodes` holds the keys and params to assert on.

## Cards in a chat

An agent in a chat will be able to ask the user with a composed card (options, a small form, a confirmation) and get the answer back as its tool result; this section is written when that ships.

## Related

- [AI Decisions](/guide/ai-decisions/): `decide()`, the questions, and the server route that keeps the key
- [AI Chat](/guide/ai-chat/): the chat driver, transports and structured output
- [Agents](/guide/agent/): the `chat` behavior and the `agent` static
- [Parent-Child Communication](/guide/parent-child/): `PARENT` and `CHILD.select`
- [Persistence](/guide/persistence/): `persist()`
