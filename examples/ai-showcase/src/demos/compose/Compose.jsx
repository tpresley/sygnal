// A page composed by a model. The user describes a product analytics page; a model picks parts from
// the catalog (catalog.js) and their settings, and the app renders its own components. Then
// follow-ups edit the page: parts the edit doesn't touch keep their instance and their state.
//
// The `compose` behavior holds the composition in `state.page`; `catalog.render()` draws it. The
// backend is the only difference between a decision model and a chat model, so the view, intent
// and model are written once and used by two components, one per kind (backends.js).
import { ABORT, Switchable, classes } from 'sygnal'
import { compose } from 'sygnal/ai'
import { providersResource, pickerState, pickerIntent, pickerModel } from '../../shared/picker.jsx'
import { catalog } from './catalog.js'
import { LAUNCH } from './parts.jsx'
import { modelChoices, pickedChoice, decisionsBackend, llmBackend } from './backends.js'
import { howItDecided } from './HowItDecided.jsx'

const EXAMPLES = [
  'Active users, revenue and conversion side by side, then the traffic chart for the quarter',
  'Growth review: where visitors come from, the pages they visit most, and the signup funnel',
  'On call: critical incidents first, then the release notes and the launch checklist',
  "What's the weather in Paris?",
]

// follow-ups that make sense for the page on screen (`on`: the parts it has)
const FOLLOW_UPS = [
  { prompt: 'Show the chart for the last year', when: (on) => on.has('traffic') },
  { prompt: 'Move the funnel to the top', when: (on) => on.has('funnel') && on.size > 1 },
  { prompt: 'Remove the release notes', when: (on) => on.has('releases') },
  { prompt: 'Filter the incidents to critical ones', when: (on) => on.has('incidents') },
  { prompt: 'Add the countries beside the chart', when: (on) => on.has('traffic') && !on.has('countries') },
  { prompt: 'Add the incidents at the top', when: (on) => !on.has('incidents') },
  { prompt: 'Show all ten pages', when: (on) => on.has('pages') },
]

const partsOn = (layout) => new Set(Object.values(layout?.nodes ?? {}).map((n) => n.part))
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

function status(state) {
  const page = state.page
  const who = state.composer ?? 'The model'
  if (page.status === 'composing') return <><span className="spinner" />{who} is {page.layout ? 'editing the page' : 'composing'}…</>
  if (page.status === 'preview') return <><span className="spinner" />{who} is {pickedChoice(state)?.kind === 'llm' ? 'writing the layout' : 'arranging the parts'}…</>
  if (page.status === 'done') return <>Composed by <b>{who}</b>{state.took != null && ` in ${seconds(state.took)}`}.</>
  if (page.status === 'unavailable') return 'Nothing in the catalog fits that request: the page stays as it was.'
  if (page.status === 'error') return <span className="error-text">The model failed: {page.error}</span>
  return 'Describe a page, or pick an example. The model picks and arranges prepared parts; it writes no markup.'
}

function workspace({ state }) {
  const page = state.page
  const busy = page.status === 'composing' || page.status === 'preview'
  const ready = !!pickedChoice(state)
  const on = partsOn(page.layout)
  const followUps = FOLLOW_UPS.filter((f) => f.when(on)).slice(0, 4)
  return (
    <div className="compose-work">
      <form className="composer ask">
        <input className="prompt" aria-label="The page you want" placeholder={page.layout ? 'Change the page: “move the funnel to the top”…' : 'Describe the page you want…'} value={page.prompt} />
        <button type="submit" className="btn" disabled={busy || !ready || !page.prompt.trim()}>{page.layout ? 'Apply' : 'Compose'}</button>
      </form>
      <div className="examples">
        {EXAMPLES.map((p) => <button type="button" className="example fresh" data={{ prompt: p }} disabled={busy || !ready}>{p}</button>)}
      </div>
      {page.layout && followUps.length > 0 && (
        <div className="examples follow-ups">
          <span className="then">Then</span>
          {followUps.map((f) => <button type="button" className="example follow-up" data={{ prompt: f.prompt }} disabled={busy || !ready}>{f.prompt}</button>)}
        </div>
      )}
      <p className={classes('status-line', { error: page.status === 'error' })} aria-live="polite">{status(state)}</p>

      <div className="compose-stage">
        <div className={classes('canvas', { preview: !!page.preview, busy })}>
          {page.layout || page.preview ? catalog.render(page, state) : <div className="canvas-empty">Your page appears here.</div>}
        </div>
        {howItDecided(page)}
      </div>
    </div>
  )
}

const intent = ({ DOM }) => ({
  EXAMPLE: DOM.click('.example.fresh').data('prompt'),
  FOLLOW_UP: DOM.click('.follow-up').data('prompt'),
})

const model = {
  // an example starts a new page; a follow-up (or the field, with a page there) edits the one there
  EXAMPLE: { EFFECT: (state, prompt, next) => next('page.COMPOSE', { prompt, fresh: true }) },
  FOLLOW_UP: { EFFECT: (state, prompt, next) => next('page.COMPOSE', prompt) },
  // these run after the behavior's own entries: who composes, and how long it took
  'page.COMPOSE': (state, data, next, { now }) => (state.page.status === 'composing' ? { ...state, composer: pickedChoice(state).label, startedAt: now(), took: null } : ABORT),
  'page.DONE': (state, data, next, { now }) => ({ ...state, took: state.startedAt ? now() - state.startedAt : null }),
}

/** composes with a decision model: decide() requests on HTTP */
export function DecisionsComposer(props) {
  return workspace(props)
}
DecisionsComposer.uses = { page: compose(catalog, { backend: decisionsBackend, form: '.ask', prompt: '.prompt' }) }
DecisionsComposer.intent = intent
DecisionsComposer.model = model

/** composes with a chat model: one structured-output request on the LLM driver */
export function LlmComposer(props) {
  return workspace(props)
}
LlmComposer.uses = { page: compose(catalog, { backend: llmBackend, form: '.ask', prompt: '.prompt' }) }
LlmComposer.intent = intent
LlmComposer.model = model

const groupOf = (c) => `${c.kind === 'decisions' ? 'Decision models' : 'Chat models'} · ${c.group}`

/** the picker: both kinds in one list, grouped */
function picker(state, disabled) {
  const choices = modelChoices(state)
  const picked = pickedChoice(state)
  const groups = [...new Set(choices.map(groupOf))]
  return (
    <label className="model-picker">
      <span>Model</span>
      <select className="model-pick" disabled={disabled || choices.length === 0}>
        {choices.length === 0 && <option value="">{state.providers?.status === 'loading' ? 'Loading…' : 'No model'}</option>}
        {groups.map((g) => (
          <optgroup label={g}>
            {choices.filter((c) => groupOf(c) === g).map((c) => <option value={c.id} selected={c.id === picked?.id}>{c.label}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

export default function Compose({ state }) {
  const choice = pickedChoice(state)
  const busy = state.page?.status === 'composing' || state.page?.status === 'preview'
  const done = state.launch.filter((t) => t.done).length
  return (
    <div className="w compose-demo">
      <div className="w-toolbar">
        {picker(state, busy)}
        {choice && (
          <span className={classes('badge', choice.kind === 'llm' ? 'blue' : 'ok')} title={choice.kind === 'llm' ? 'compose.llm(): fills a JSON Schema of the catalog' : 'compose.decisions(): answers multiple-choice questions'}>
            {choice.kind === 'llm' ? 'Chat model · fills a schema' : 'Decision model · from probabilities'}
          </span>
        )}
        <span className="grow" />
        <span className="badge" title="The checklist part edits this through a lens: state.launch">Launch checklist {done}/{state.launch.length}</span>
      </div>
      {/* one component per kind; both share this state, so the page and the ticks stay when you switch */}
      <Switchable of={{ decisions: DecisionsComposer, llm: LlmComposer }} current={choice?.kind ?? 'decisions'} />
      {choice?.kind === 'llm' && <p className="compose-note">A chat model needs to be capable (qwen3:8b or larger) to compose well; a small one may pick odd parts.</p>}
      {choice?.kind === 'decisions' && choice.model !== 'jev-latest' && <p className="compose-note">{choice.label} runs on this machine: a few seconds per step, and weaker than Jev on rows and edits.</p>}
    </div>
  )
}

Compose.initialState = {
  ...pickerState,
  launch: LAUNCH,   // the checklist part's state (its catalog entry: `state: 'launch'`)
  composer: null,   // who composed the page on screen
  startedAt: null,
  took: null,
}

Compose.resources = providersResource
Compose.intent = ({ DOM }) => pickerIntent(DOM)
Compose.model = pickerModel
