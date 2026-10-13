// An assistant that operates the app. The home's `agent` declaration (and each room's, in Room.jsx)
// says what a model may do and see; the `chat` behavior turns it into tools, sends them with the
// app state on every request, runs the model's calls through the same reducers as a click, and
// waits for Allow / Deny before a consequential one (UNLOCK).
//
// The right-hand panel is what the model gets: the tool list and the app state come from
// `agentTools(app)` (the AGENT source, wired in index.js), not from a copy of the declaration.
import { z } from 'zod'
import { xs, Collection, classes } from 'sygnal'
import { chat, messageText } from 'sygnal/ai'
import { pickerState, providersResource, pickerIntent, pickerModel, pickedModel, modelPicker } from '../../shared/picker.jsx'
import Room from './Room.jsx'
import { ROOMS, SCENES, MODES, TEMP, applyScene, energy } from './home.js'
import { modelSees } from './modelSees.jsx'

const PICK = { need: 'tools' }

const EXAMPLES = [
  'Movie night in the living room, and make it a bit warmer',
  'Turn off every light except the office',
  'Unlock the front door',
  'Which room uses the most power?',
]

const INSTRUCTIONS = [
  'You operate a smart home app for the user by calling its tools. The app state lists the rooms (by id), the thermostat and the front door: read it before acting.',
  'Do what the user asks with tool calls; never just describe what you would do. To change several rooms, call room_set_light once per room.',
  '"Warmer" or "cooler" without the word light is about temperature: set the thermostat target 1 °C up or down from its current target. A scene already sets its lights: don\'t change them after it unless asked.',
  'For questions about power or energy use, call home_energy and answer from its result.',
  'After the tools ran, reply in one or two short sentences.',
].join(' ')

export default function SmartHome({ state }) {
  const a = state.assistant
  const busy = a.status === 'submitted' || a.status === 'streaming'
  const model = pickedModel(state, PICK)
  const { thermostat: t, locked } = state
  return (
    <div className="w smart-home">
      <div className="w-toolbar">
        {modelPicker(state, PICK, { disabled: busy })}
        <span className="grow" />
        <span className="badge" title="qwen3:8b on Ollama runs every example; smaller or older models skip steps">Needs a model that calls tools well</span>
        <button type="button" className="btn ghost small clear" disabled={busy || a.messages.length === 0}>Clear chat</button>
      </div>

      <div className="w-grid">
        <div className="home-col">
          <section className="home panel" aria-label="The home">
            <h3 className="panel-title">
              Home
              <span className="watts" title="Estimated power use now">≈ {energy(state).total} W</span>
            </h3>
            <div className="scenes" role="group" aria-label="Scenes">
              {Object.entries(SCENES).map(([id, s]) => (
                <button type="button" className={classes('scene', { active: state.scene === id })} data={{ scene: id }}>
                  <span aria-hidden="true">{s.icon}</span> {s.label}
                </button>
              ))}
            </div>
            <ul className="rooms"><Collection of={Room} from="rooms" /></ul>
            <div className="fixtures">
              <div className={classes('thermostat', t.mode)}>
                <span className="fixture-label">Thermostat · {t.indoor} °C inside</span>
                <div className="temp-row">
                  <button type="button" className="temp" aria-label="Cooler" data={{ target: t.target - 0.5 }} disabled={t.target <= TEMP.min}>−</button>
                  <output className="target" aria-label="Target temperature">{t.target.toFixed(1)}°</output>
                  <button type="button" className="temp" aria-label="Warmer" data={{ target: t.target + 0.5 }} disabled={t.target >= TEMP.max}>+</button>
                </div>
                <div className="modes" role="group" aria-label="Mode">
                  {MODES.map((m) => <button type="button" className="mode" aria-pressed={m === t.mode ? 'true' : 'false'} data={{ mode: m }}>{m}</button>)}
                </div>
              </div>
              <div className={classes('door', { locked })}>
                <span className="fixture-label">Front door</span>
                <span className="lock-icon" aria-hidden="true">{locked ? '🔒' : '🔓'}</span>
                <button type="button" className={classes('btn', 'small', 'lock', { ghost: locked })}>{locked ? 'Unlock' : 'Lock'}</button>
              </div>
            </div>
          </section>

          {assistantPanel(a, { busy, model })}
        </div>

        {modelSees(state.seen, INSTRUCTIONS)}
      </div>
    </div>
  )
}

/** one tool call in the transcript */
function toolLine(p) {
  const name = p.type.slice(5)
  const outcome = p.state === 'input-available' ? 'running…'
    : p.state === 'output-error' ? `failed: ${p.errorText}`
    : p.output?.ok ? (p.output.unchanged ? 'ok (already so)' : 'ok')
    : `failed: ${p.output?.error}`
  return (
    <span className={classes('tool-line', { failed: p.state === 'output-error' || p.output?.ok === false })}>
      Used <code>{name}</code>{p.input && Object.keys(p.input).length > 0 && <span className="args"> {JSON.stringify(p.input)}</span>} → {outcome}
    </span>
  )
}

// a reply's parts in order: the text of each step, and the tools it used
function message(m) {
  if (!m.parts) return <li className={classes('msg', m.role)}>{messageText(m)}</li>
  return (
    <li className={classes('msg', m.role)}>
      {m.parts.map((p) => (p.type === 'text' ? (p.text.trim() && <span className="step-text">{p.text.trim()}</span>) : p.type.startsWith('tool-') ? toolLine(p) : null))}
    </li>
  )
}

/**
 * The assistant's markup: a plain function the view calls, so the chat behavior's selectors
 * (.ask, .prompt, .stop, .approve, .deny) are in the host's own view
 */
function assistantPanel(a, { busy, model }) {
  return (
    <section className="chat panel" aria-label="Assistant">
      <h3 className="panel-title">Assistant</h3>
      <ol className="transcript" aria-live="polite">
        {a.messages.map(message)}
        {busy && (
          <li className={classes('msg', 'assistant', { streaming: !!a.draft })}>
            {a.draft || <span className="thinking-dots"><i /><i /><i /></span>}
          </li>
        )}
      </ol>
      {a.pending && (
        <div className="confirm-box" role="alertdialog" aria-label="Confirm">
          <p>The assistant wants to: <b>{a.pending.description}</b>{a.pending.label ? ` (${a.pending.label})` : ''}</p>
          <button type="button" className="btn danger small approve">Allow</button>
          <button type="button" className="btn ghost small deny">Deny</button>
        </div>
      )}
      {a.messages.length === 0 && !busy && (
        <div className="examples">{EXAMPLES.map((e) => <button type="button" className="example" data={{ prompt: e }} disabled={!model}>{e}</button>)}</div>
      )}
      {a.error && <p className="status-line error" role="alert">{a.error}</p>}
      <form className="composer ask">
        <input className="prompt" aria-label="Message" placeholder={model ? 'Ask the home to do something…' : 'Pick a model first'} value={a.prompt} />
        {busy
          ? <button type="button" className="btn ghost stop">Stop</button>
          : <button type="submit" className="btn" disabled={!a.prompt.trim() || !model}>Send</button>}
      </form>
    </section>
  )
}

SmartHome.initialState = {
  ...pickerState,
  rooms: ROOMS,
  thermostat: { target: 20.5, mode: 'heat', indoor: 19.5 },
  locked: true,
  scene: null,
  seen: { tools: [], context: {} },   // what the agent layer offers the model (the AGENT source)
}

SmartHome.resources = providersResource

SmartHome.intent = ({ DOM, AGENT }) => ({
  ...pickerIntent(DOM),
  SEEN: AGENT.select(),
  EXAMPLE: DOM.click('.example').data('prompt'),
  CLEAR: DOM.click('.clear'),
  APPLY_SCENE: DOM.click('.scene').data('scene', (scene) => ({ scene })),
  SET_THERMOSTAT: xs.merge(
    DOM.click('.temp').data('target', (v) => ({ target: Number(v) })),
    DOM.click('.mode').data('mode', (mode) => ({ mode })),
  ),
  TOGGLE_LOCK: DOM.click('.lock'),
})

SmartHome.model = {
  ...pickerModel,
  SEEN: (state, seen) => ({ ...state, seen }),
  EXAMPLE: { EFFECT: (state, prompt, next) => next('assistant.SEND', prompt) },
  CLEAR: (state) => ({ ...state, assistant: { ...state.assistant, messages: [], error: null } }),

  APPLY_SCENE: (state, { scene }) => applyScene(state, scene),
  SET_THERMOSTAT: (state, change) => ({ ...state, thermostat: { ...state.thermostat, ...change } }),
  LOCK: (state) => ({ ...state, locked: true }),
  UNLOCK: (state) => ({ ...state, locked: false }),
  // by hand: the button you see; the assistant gets LOCK and UNLOCK, so unlocking can ask first
  TOGGLE_LOCK: (state) => ({ ...state, locked: !state.locked }),
}

SmartHome.agent = {
  name: 'home',
  description: 'The smart home: rooms with lights, a thermostat, the front door, scenes',
  untrusted: false,   // every string in `read` is the app's own
  // what the model sees of the home, with every request
  read: (state) => ({
    rooms: state.rooms.map(({ id, name, on, brightness, warmth }) => ({ id, name, on, brightness, warmth })),
    thermostat: state.thermostat,
    frontDoor: state.locked ? 'locked' : 'unlocked',
    lastScene: state.scene,
  }),
  actions: {
    APPLY_SCENE: {
      description: 'Apply a scene. movie_night: only the living room light, dim and warm. good_morning: kitchen, bedroom and living room lights on, heating to 21 °C. focus: only the office light, bright and cool. away: every light off, heating off, door locked.',
      input: z.strictObject({ scene: z.enum(Object.keys(SCENES)) }),
      idempotent: true,
    },
    SET_THERMOSTAT: {
      description: 'Make the home warmer or cooler: set the thermostat\'s target temperature in °C (its current target is in the app state), its mode, or both',
      input: z.strictObject({
        target: z.number().min(TEMP.min).max(TEMP.max).optional().describe(`Target temperature in °C, ${TEMP.min} to ${TEMP.max}`),
        mode: z.enum(MODES).optional().describe('heat, cool, or off'),
      }),
      idempotent: true,
    },
    LOCK: { description: 'Lock the front door', when: (state) => !state.locked },
    UNLOCK: { description: 'Unlock the front door', consequential: true, when: (state) => state.locked },
  },
  queries: {
    energy: {
      description: 'Estimated power use right now, in watts: each room\'s light, the heat pump, and the total',
      run: (state) => energy(state),
    },
  },
}

SmartHome.uses = {
  assistant: chat({
    form: '.ask', prompt: '.prompt', stop: '.stop', approve: '.approve', deny: '.deny',
    instructions: INSTRUCTIONS,
    model: (state) => pickedModel(state, PICK),
  }),
}
