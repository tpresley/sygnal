// The board and its command bar. The `agent` static says what an agent may do with the board
// (ADD a card, CLEAR_DONE), Card.jsx what it may do with a card; commandBar() reads both and asks
// a decision model one question per command: which action, and which card.
//
// commandBar's `decide` (the model and URL) is fixed when the behavior is defined, so boardFor()
// makes one Board per decision model (once each), and CommandBar.jsx shows the picked one. A Board
// has no state of its own: it shares the app's, so the cards and the log stay when you switch.
import { z } from 'zod'
import { ABORT, Collection, classes } from 'sygnal'
import { commandBar } from 'sygnal/ai'
import Card, { COLUMNS } from './Card.jsx'
import { OLLAMA } from '../../shared/providers.js'

export const EXAMPLES = [
  'move "write docs" to done',
  'I finished the login bug',
  'add a card to call the bank',
  'mark the launch party as important',
  'delete the card about the logo',
  'clear the done column',
  "what's left?",
]

const pct = (x) => `${Math.round(x * 100)}%`
const busy = (cmd) => cmd.status === 'deciding' || cmd.status === 'running'

/** why nothing ran, in words */
function unsureLine({ command, reason, description, label, confidence }) {
  if (reason === 'no-action') return `"${command}" matches no action on the board.`
  if (reason === 'target') return `Not sure which card "${command}" means${label ? ` (best guess: ${label}, ${pct(confidence)})` : ''}.`
  if (reason === 'input') return `"${command}" needs an argument the command bar can't fill.`
  return `Not sure what "${command}" means (best guess: ${description?.toLowerCase() ?? 'none'}, ${pct(confidence)}).`
}

function outcome(cmd) {
  if (cmd.status === 'deciding') return <><span className="spinner" /> Deciding what "{cmd.command}" means…</>
  if (cmd.pending) return <span className="badge warn">Waiting for you</span>
  if (cmd.unsure) return <><span className="badge bad">Nothing ran</span> {unsureLine(cmd.unsure)}</>
  if (cmd.error) return <span className="error-text">The decision failed: {cmd.error}</span>
  if (cmd.result?.ok) return <><span className="badge ok">Ran</span> <code>{cmd.result.tool}</code> for "{cmd.result.command}"</>
  if (cmd.result) return <><span className="badge bad">Not run</span> {cmd.result.error}</>
  return 'Type a command, or pick one below.'
}

/** one log row: the command, the action and the card it picked, each with its confidence */
function logRow(entry, state) {
  const outcomeNow = entry.outcome === 'running' && state.cmd.pending ? 'asking' : entry.outcome
  const card = entry.target && state.cards.find((c) => String(c.id) === entry.target.choice)
  const gauge = (p) => <span className="mini"><span style={{ width: pct(p) }} /></span>
  return (
    <li className={classes('entry', outcomeNow)}>
      <span className="said">{entry.command}</span>
      <span className="picked">
        <code>{entry.action.choice}</code>{gauge(entry.action.confidence)}<span className="p">{pct(entry.action.confidence)}</span>
      </span>
      <span className="picked">
        {entry.target && entry.target.choice !== 'none' ? <>{card?.title ?? entry.target.choice}{gauge(entry.target.confidence)}<span className="p">{pct(entry.target.confidence)}</span></> : <span className="none">no card</span>}
      </span>
      <span className="verdict">{outcomeNow}</span>
    </li>
  )
}

function view({ state }) {
  const cmd = state.cmd
  return (
    <div className="board-app">
      <form className="command-form">
        <span className="prompt-icon" aria-hidden="true">⌘</span>
        <input className="command" aria-label="Command" placeholder="Tell the board what to do…" value={cmd.text} disabled={busy(cmd)} />
        <button type="submit" className="btn" disabled={busy(cmd) || !cmd.text.trim()}>Run</button>
      </form>
      <div className="examples">{EXAMPLES.map((e) => <button type="button" className="example" data={{ command: e }} disabled={busy(cmd) || !!cmd.pending}>{e}</button>)}</div>
      <p className="status-line outcome" aria-live="polite">{outcome(cmd)}</p>
      {cmd.pending && (
        <div className="confirm-box" role="alertdialog" aria-label="Confirm">
          <p>{cmd.pending.description}{cmd.pending.label ? `: "${cmd.pending.label}"` : ''}? This can't be undone.</p>
          <button type="button" className="btn danger small cmd-approve">Delete</button>
          <button type="button" className="btn ghost small cmd-deny">Cancel</button>
        </div>
      )}

      <div className="board">
        {COLUMNS.map((col) => (
          <section className={classes('column', col.id)}>
            <h4>{col.label}<span className="count">{state.cards.filter((c) => c.column === col.id).length}</span></h4>
            <ul className="cards">
              <Collection of={Card} from="cards" filter={(c) => c.column === col.id} />
            </ul>
          </section>
        ))}
      </div>

      {state.log.length > 0 && (
        <section className="panel log">
          <h3 className="panel-title">Decisions <span>action · card · outcome</span></h3>
          <ol>{state.log.map((e) => logRow(e, state))}</ol>
        </section>
      )}
    </div>
  )
}

const intent = ({ DOM }) => ({
  EXAMPLE: DOM.click('.example').data('command'),
})

const model = {
  ADD: (state, title) => ({ ...state, cards: [...state.cards, { id: state.nextId, title, column: 'todo', starred: false }], nextId: state.nextId + 1 }),
  CLEAR_DONE: (state) => ({ ...state, cards: state.cards.filter((c) => c.column !== 'done') }),
  EXAMPLE: { EFFECT: (state, command, next) => next('cmd.RUN', command) },
  // runs after the command bar's own entry: its decision is in, so log what the model picked
  'cmd.DECIDED': (state, { answers }) => {
    const { cmd } = state
    const command = cmd.unsure?.command ?? cmd.command
    if (!command || !answers?.action) return ABORT
    const entry = { command, action: answers.action, target: answers.target ?? null, outcome: cmd.unsure ? 'unsure' : 'running' }
    return { ...state, log: [entry, ...state.log].slice(0, 6) }
  },
  // the action ran (or was declined)
  'cmd.DONE': (state, result) => {
    const outcome = result.ok ? 'ran' : result.error === 'the user declined' ? 'declined' : 'failed'
    return { ...state, log: state.log.map((e, i) => (i === 0 && e.outcome === 'running' ? { ...e, outcome } : e)) }
  },
}

// What an agent may do with the board itself. No `read`: the command bar needs the card titles
// only (Card.jsx's labels), and a small decision model picks the card better without the whole
// board in front of it. A chat assistant would want one.
const agent = {
  name: 'board',
  description: 'A kanban board with Todo, Doing and Done columns',
  actions: {
    ADD: { description: 'Add a new card', input: z.string().min(1).describe('The card title') },
    CLEAR_DONE: { description: 'Delete every card in the Done column', consequential: true },
  },
}

const made = new Map()

/** the Board whose command bar asks this decision model ({ url, model }), made once per model */
export function boardFor({ url, model: decisionModel }) {
  const id = `${url} ${decisionModel}`
  if (!made.has(id)) {
    function Board(props) {
      return view(props)
    }
    Board.uses = {
      cmd: commandBar({
        input: '.command', form: '.command-form', approve: '.cmd-approve', deny: '.cmd-deny',
        decide: { url, model: decisionModel },
        below: 0.6,                    // below 60% on the action (or the card), nothing runs
      }),
    }
    Board.agent = agent
    Board.intent = intent
    Board.model = model
    made.set(id, Board)
  }
  return made.get(id)
}

// Made at load, before run(): the first commandBar() call links the sygnal/ai behaviors to the
// apps started after it (SYG442 otherwise: https://sygnal.js.org/reference/errors#syg442)
boardFor({ url: `${OLLAMA}/v1/systemone`, model: 'nimble:latest' })
