// Lab 2: a board that arranges itself around what needs attention.
//
// - A simulated ops world moves one step per tick (world.js): a queue backs up, incidents open,
//   a deploy rolls back, things recover.
// - attention.js scores every part. When a part changes band (calm / watch / act), or the person
//   pins or snoozes one, the board is arranged again (STATE.watch on the signature):
//   - by the rules: a deterministic tree from the scores, through page.SET_LAYOUT (no model);
//   - or by the model: the app writes a brief of the situation and composes from it; the model
//     picks the order, the size of each card and writes why each card is where it is.
// - Pins and snoozes are the person's: the brief asks the model to honor them, and the app
//   enforces them on the model's layout as it lands (enforceChoices, in the page.DONE entry).
// - The board changes faster than the model arranges it (a tick is 3 s, an arrangement 15–20 s),
//   so compose runs with busy: 'queue': one arrangement in flight, the latest one waiting. With
//   the default ('abort'), each change would abort the arrangement in flight and, while the
//   morning keeps moving, none would finish.
// - Cards keep their instances across arrangements (node keys are identities): a note typed in
//   an incident card survives the board moving under it, also while the model's next arrangement
//   streams in (the preview merges over the current board).
import { xs } from 'sygnal'
import { compose } from 'sygnal/ai'
import { catalog } from './catalog.js'
import { IncidentCard } from './parts.jsx'
import { attention, brief, enforceChoices, rulesLayout, signature } from './attention.js'
import { LAST_TICK, START, step } from './world.js'
import { llm } from '../llm.js'
import { modelPlan } from '../plan.jsx'

const LOG = 6

export default function BoardLab({ state }) {
  const page = state.page
  const busy = page.status === 'composing' || page.status === 'preview'
  const items = attention(state)
  return (
    <section className="lab board-lab">
      <header>
        <h2>A board that arranges itself</h2>
        <p className="muted">A simulated morning on call. As things change, the board is arranged again around what needs you, by rules or by the model.</p>
      </header>

      <div className="controls">
        <span className="clock">09:{String(state.tick * 5).padStart(2, '0')}</span>
        <button type="button" className="play" disabled={state.tick >= LAST_TICK}>{state.playing ? 'Pause' : 'Play'}</button>
        <button type="button" className="step" disabled={state.playing || state.tick >= LAST_TICK}>Step 5 min</button>
        <button type="button" className="restart">Restart</button>
        <label>Arranged by
          <select className="arrange">
            <option value="rules" selected={state.arrange === 'rules'}>rules (no model)</option>
            <option value="model" selected={state.arrange === 'model'}>the model</option>
          </select>
        </label>
        <label>For
          <select className="role">
            <option value="oncall" selected={state.role === 'oncall'}>the on-call engineer</option>
            <option value="manager" selected={state.role === 'manager'}>the manager</option>
          </select>
        </label>
        <span className="status" aria-live="polite">{busy ? (page.queued ? 'Arranging… (the board changed: again after this one)' : 'Arranging…') : page.status === 'error' ? `Model failed (${page.error}); arranged by the rules` : ''}</span>
      </div>

      {state.snoozed.length > 0 && (
        <p className="snoozed">Snoozed: {state.snoozed.map((k) => <button type="button" className="unsnooze chip" data={{ node: k }}>{k} ✕</button>)}</p>
      )}

      <div className="board-grid">
        {/* While the model writes the next arrangement, the preview merges over the current board
            (compose's default preview: 'merge'): the cards it hasn't placed yet stay mounted */}
        <div className={page.preview ? 'board preview' : 'board'}>{catalog.render(page, state)}</div>
        <aside className="explain">
          <h3>Attention</h3>
          <ol className="scores">
            {items.map((i) => <li className={i.band}><b>{i.score}</b> {i.key} <span className="muted">{i.reason}</span></li>)}
          </ol>
          <h3>Arrangements</h3>
          <ol className="log">{state.log.map((l) => <li><span className="muted">09:{String(l.tick * 5).padStart(2, '0')}</span> {l.by}: {l.what}</li>)}</ol>
          {state.arrange === 'model' && modelPlan(page.decisions)}
          {state.arrange === 'model' && (
            <details>
              <summary>What the model is told</summary>
              <pre className="brief">{brief(state)}</pre>
            </details>
          )}
        </aside>
      </div>
    </section>
  )
}

BoardLab.initialState = {
  ...START,
  role: 'oncall',
  arrange: 'rules',
  playing: false,
  pins: [],
  snoozed: [],
  log: [],
}

BoardLab.isolatedState = true

BoardLab.uses = {
  page: compose(catalog, { backend: llm(), key: 'board-compose', busy: 'queue' }),
}

BoardLab.timers = (state) => ({
  clock: state.playing && state.tick < LAST_TICK && { every: 3000, action: 'TICK' },
})

const fromCards = (CHILD, type) => CHILD.select(IncidentCard).filter((e) => e.type === type).map((e) => e.node)

BoardLab.intent = ({ DOM, CHILD, STATE }) => ({
  PLAY: DOM.click('.play'),
  STEP: DOM.click('.step'),
  RESTART: DOM.click('.restart'),
  MODE: DOM.change('.arrange').value(),
  ROLE: DOM.change('.role').value(),
  PIN: xs.merge(DOM.click('.pin').data('node'), fromCards(CHILD, 'pin')),
  SNOOZE: xs.merge(DOM.click('.snooze').data('node'), fromCards(CHILD, 'snooze')),
  UNSNOOZE: DOM.click('.unsnooze').data('node'),
  // arrange again when what needs attention changes (not on every number that moves), and when
  // the arranger or the audience changes
  ARRANGE: STATE.watch((s) => `${s.arrange} ${s.role} ${signature(s)}`, { immediate: true }),
  // the model failed: the rules arrange instead
  FALLBACK: STATE.watch((s) => s.page.status === 'error').filter(Boolean),
})

const logged = (state, by, what) => ({ ...state, log: [{ tick: state.tick, by, what }, ...state.log].slice(0, LOG) })
const toggle = (list, x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])

BoardLab.model = {
  TICK: (state) => ({ ...step(state), playing: state.playing && state.tick + 1 < LAST_TICK }),
  STEP: (state) => step(state),
  PLAY: (state) => ({ ...state, playing: !state.playing }),
  RESTART: (state) => ({ ...state, ...START, playing: false, pins: [], snoozed: [], log: [] }),
  MODE: (state, arrange) => ({ ...state, arrange }),
  ROLE: (state, role) => ({ ...state, role }),
  PIN: (state, node) => ({ ...state, pins: toggle(state.pins, node) }),
  SNOOZE: (state, node) => ({ ...state, snoozed: [...state.snoozed, node], pins: state.pins.filter((p) => p !== node) }),
  UNSNOOZE: (state, node) => ({ ...state, snoozed: state.snoozed.filter((s) => s !== node) }),

  ARRANGE: {
    STATE: (state) => logged(state, state.arrange === 'model' ? 'model' : 'rules', state.arrange === 'model' ? 'asked to arrange' : 'arranged'),
    EFFECT: (state, _, next) => {
      if (state.arrange === 'model') next('page.COMPOSE', { prompt: brief(state), fresh: true })
      else next('page.SET_LAYOUT', rulesLayout(catalog, state))
    },
  },
  FALLBACK: { EFFECT: (state, _, next) => next('page.SET_LAYOUT', rulesLayout(catalog, state)) },

  // the model's layout, held to the person's pins and snoozes. Written here rather than through
  // page.SET_LAYOUT, which would also drop the arrangement waiting behind this one (busy: 'queue')
  'page.DONE': (state, layout) => {
    const done = logged(state, 'model', `arranged ${Object.keys(layout.nodes).length - 1} nodes`)
    const fixed = enforceChoices(catalog, state, layout)
    if (!fixed) return done
    return logged({ ...done, page: { ...done.page, layout: catalog.finish(fixed, state) } }, 'app', 'put back what the model missed of your pins and snoozes')
  },
}
