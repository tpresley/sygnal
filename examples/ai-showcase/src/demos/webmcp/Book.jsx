// One book, a Collection item: move it to another shelf, or remove it.
//
// As WebMCP tools: `book_move({ id, shelf })` and `book_remove({ id })`, one tool each for every
// book. The titles are text users typed, so the `id` parameter lists ids only (no labels), and the
// description sends the agent to `books_read` for them. REMOVE is consequential: the browser's
// agent gets it only after you allow it.
import { z } from 'zod'
import { classes } from 'sygnal'

export const SHELVES = { want: 'Want to read', reading: 'Reading', finished: 'Finished' }

export default function Book({ state }) {
  return (
    <li className={classes('book', state.shelf)}>
      <div className="book-text">
        <span className="title">{state.title}</span>
        <span className="author">{state.author}</span>
      </div>
      <div className="shelf-pick" role="group" aria-label={`Shelf for ${state.title}`}>
        {Object.entries(SHELVES).map(([id, label]) => (
          <button type="button" className="shelf" aria-pressed={id === state.shelf ? 'true' : 'false'} data={{ shelf: id }}>{label}</button>
        ))}
      </div>
      <button type="button" className="remove" aria-label={`Remove ${state.title}`}>×</button>
    </li>
  )
}

Book.intent = ({ DOM }) => ({
  MOVE: DOM.click('.shelf').data('shelf', (shelf) => ({ shelf })),
  REMOVE: DOM.click('.remove'),
})

Book.model = {
  MOVE: (state, { shelf }) => ({ ...state, shelf }),
  REMOVE: () => undefined,
}

Book.agent = {
  name: 'book',
  description: 'A book on the reading list',
  label: (state) => state.title,
  actions: {
    MOVE: {
      description: 'Move the book to another shelf',
      input: z.object({ shelf: z.enum(Object.keys(SHELVES)).describe('want, reading or finished') }),
      idempotent: true,
    },
    REMOVE: { description: 'Remove the book from the reading list', consequential: true },
  },
}
