import { ABORT, classes } from 'sygnal'
import { PARTS, TASKS, EXAMPLES } from './parts.js'
import { selectRequest, layoutRequest, readSelection, readLayout, previewLayout } from './compose.js'
import { OLLAMA_URL, DECIDE_URL } from './config.js'
import { Kpi, RevenueChart, OrdersTable, TicketList, Weather } from './widgets/static.jsx'
import Checklist from './widgets/Checklist.jsx'
import FeedbackForm from './widgets/FeedbackForm.jsx'
import DecisionLog from './DecisionLog.jsx'

const title = (id) => PARTS.find((p) => p.id === id).title

// a part by id: the app's own component, with the app's own data
function part(id) {
  if (id === 'revenue' || id === 'signups' || id === 'churn') return <Kpi metric={id} />
  if (id === 'revenueChart') return <RevenueChart />
  if (id === 'orders') return <OrdersTable />
  if (id === 'tickets') return <TicketList />
  if (id === 'weather') return <Weather />
  if (id === 'tasks') return <Checklist state="tasks" />
  return <FeedbackForm state="feedback" />
}

const card = (id) => (
  <section key={id} className={`card part-${id}`}>
    <h3>{title(id)}</h3>
    {part(id)}
  </section>
)

const STATUS = {
  idle: () => 'Describe the page you want. The decision model picks and arranges parts; it writes nothing.',
  selecting: (s) => `${s.model} is picking parts…`,
  arranging: (s) => `${s.model} is arranging ${s.selection.ids.length} parts…`,
  done: (s) => `Composed by ${s.model} in ${s.layoutAnswers ? 2 : 1} decision${s.layoutAnswers ? 's' : ''}.`,
  unavailable: () => 'Nothing in the catalog fits that request.',
  error: (s) => s.error,
}

function App({ state, context }) {
  const busy = state.phase === 'selecting' || state.phase === 'arranging'
  return (
    <div className="app">
      <header>
        <h1>Compose a workspace</h1>
        <p className="muted">A local decision model builds the page from {PARTS.length} prepared parts.</p>
      </header>

      <form className="prompt-form">
        <input className="prompt" value={state.prompt} placeholder="e.g. My morning: the weather and my tasks" />
        <select className="model" title="Decision model">
          {context.decisionModels.length === 0 && <option value="">no decision model found</option>}
          {context.decisionModels.map((m) => <option value={m} selected={m === state.model}>{m}</option>)}
        </select>
        <button type="submit" className="compose" disabled={busy || !state.model}>Compose</button>
      </form>
      <div className="examples">
        {EXAMPLES.map((p) => <button className="example" data={{ prompt: p }} disabled={busy || !state.model}>{p}</button>)}
      </div>

      <p className={classes('status', state.phase)}>{STATUS[state.phase](state)}</p>

      <main className="layout">
        <div className={classes('canvas', { preview: state.phase === 'arranging' })}>
          {state.blocks.map((b) => (b.row
            ? <div key={`row-${b.row.join('-')}`} className="row">{b.row.map(card)}</div>
            : card(b.id)))}
        </div>
        <DecisionLog selectAnswers={state.selectAnswers} layoutAnswers={state.layoutAnswers} usage={state.usage} />
      </main>
    </div>
  )
}

App.initialState = {
  prompt: '',
  model: null,             // the decision model (the first installed one, until the user picks)
  phase: 'idle',           // idle | selecting | arranging | done | unavailable | error
  composing: '',           // the prompt being composed
  selection: null,         // { ids, row } from the select step
  blocks: [],              // what the canvas shows: [{ id } | { row: [ids] }]
  selectAnswers: null,
  layoutAnswers: null,
  usage: 0,                // input tokens, both steps
  error: null,
  tasks: TASKS,
  feedback: { draft: '', sent: [] },
}

// the decision models installed in Ollama (GET /api/tags: capability 'decision', e.g. nimble)
App.resources = {
  models: () => ({ url: `${OLLAMA_URL}/api/tags`, ok: 'MODELS_LOADED', error: 'MODELS_FAILED' }),
}

App.context = {
  decisionModels: (state) => (state.models?.data?.models || [])
    .filter((m) => m.capabilities?.includes('decision'))
    .map((m) => m.name),
}

App.intent = ({ DOM }) => ({
  PROMPT: DOM.input('.prompt').value(),
  PICK_MODEL: DOM.change('.model').value(),
  COMPOSE: DOM.select('.prompt-form').events('submit', { preventDefault: true }),
  EXAMPLE: DOM.click('.example').data('prompt'),
})

// a new composition: the select step goes out, the canvas clears
const start = (state, prompt) => ({
  ...state,
  prompt,
  composing: prompt,
  phase: 'selecting',
  selection: null,
  blocks: [],
  selectAnswers: null,
  layoutAnswers: null,
  usage: 0,
  error: null,
})

const ask = (state, prompt) => selectRequest({ url: DECIDE_URL, model: state.model, prompt, parts: PARTS })

const tokens = (reply) => reply.usage?.input_tokens || 0

App.model = {
  MODELS_LOADED: (state, tags) => {
    const names = (tags?.models || []).filter((m) => m.capabilities?.includes('decision')).map((m) => m.name)
    const model = names.includes(state.model) ? state.model : (names[0] || null)
    return model === state.model ? ABORT : { ...state, model }
  },
  MODELS_FAILED: (state) => ({ ...state, phase: 'error', error: `Can't reach Ollama at ${OLLAMA_URL}. Is it running?` }),

  PROMPT: (state, prompt) => ({ ...state, prompt }),
  PICK_MODEL: (state, model) => ({ ...state, model }),

  COMPOSE: {
    STATE: (state) => (state.prompt.trim() && state.model ? start(state, state.prompt.trim()) : ABORT),
    HTTP: (state) => (state.prompt.trim() && state.model ? ask(state, state.prompt.trim()) : ABORT),
  },
  EXAMPLE: {
    STATE: (state, prompt) => (state.model ? start(state, prompt) : ABORT),
    HTTP: (state, prompt) => (state.model ? ask(state, prompt) : ABORT),
  },

  // step 1 answered: show the chosen parts at once (catalog order), then ask for the layout
  SELECTED: {
    STATE: (state, reply) => {
      const selection = readSelection(PARTS, reply.answers)
      const phase = selection.ids.length === 0 ? 'unavailable' : selection.ids.length === 1 ? 'done' : 'arranging'
      return { ...state, phase, selection, blocks: previewLayout(selection), selectAnswers: reply.answers, usage: tokens(reply) }
    },
    HTTP: (state, reply) => {
      const selection = readSelection(PARTS, reply.answers)
      return selection.ids.length > 1
        ? layoutRequest({ url: DECIDE_URL, model: state.model, prompt: state.composing, parts: PARTS, selection })
        : ABORT
    },
  },

  // step 2 answered: the final order, and the row if the request asked for one
  ARRANGED: (state, reply) => ({
    ...state,
    phase: 'done',
    blocks: readLayout(state.selection, reply.answers),
    layoutAnswers: reply.answers,
    usage: state.usage + tokens(reply),
  }),

  // keep what is on the canvas (the preview, if the layout step failed)
  COMPOSE_FAILED: (state, { error }) => ({ ...state, phase: 'error', error: `The decision model failed: ${error.message}` }),
}

export default App
