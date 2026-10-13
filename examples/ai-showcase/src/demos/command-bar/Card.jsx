// One card: a Collection item. Its `agent` declaration says what an agent may do with a card;
// the command bar turns MOVE's one-value input into one option per column ("card_move=done"),
// and asks before REMOVE runs (consequential). A click on the star or the × runs the same reducers.
import { z } from 'zod'
import { classes } from 'sygnal'

export const COLUMNS = [
  { id: 'todo', label: 'Todo', means: 'Move the card back to Todo: not started yet' },
  { id: 'doing', label: 'Doing', means: 'Move the card to Doing: work on it has started' },
  { id: 'done', label: 'Done', means: 'Move the card to Done: it is finished' },
]

export default function Card({ state }) {
  return (
    <li className={classes('card', { starred: state.starred })}>
      <button type="button" className="star" aria-label={state.starred ? 'Unstar' : 'Star'} aria-pressed={state.starred}>{state.starred ? '★' : '☆'}</button>
      <span className="title">{state.title}</span>
      <button type="button" className="remove" aria-label={`Delete ${state.title}`}>×</button>
    </li>
  )
}

Card.intent = ({ DOM }) => ({
  STAR: DOM.click('.star'),
  REMOVE: DOM.click('.remove'),
})

Card.model = {
  MOVE: (state, column) => ({ ...state, column }),
  STAR: (state) => ({ ...state, starred: !state.starred }),
  REMOVE: () => undefined,
}

Card.agent = {
  name: 'card',
  description: 'A card on the board',
  label: (state) => state.title,       // how a command names a card ("the card about the logo")
  // the titles go into the decision's options as they are, which a small local model reads best;
  // leave this out when items hold text other people typed (they then travel as data, not criteria)
  untrusted: false,
  actions: {
    // one described literal per column: each becomes a command bar option with its own words
    MOVE: { description: 'Move the card to a column', input: z.union(COLUMNS.map((c) => z.literal(c.id).describe(c.means))) },
    STAR: { description: 'Star the card to mark it important, or unstar it' },
    REMOVE: { description: 'Delete the card', consequential: true },
  },
}
