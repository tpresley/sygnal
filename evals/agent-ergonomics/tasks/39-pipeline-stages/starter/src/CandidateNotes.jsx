import { ABORT, set } from 'sygnal'
import { noteLabel } from './pipeline.js'

/**
 * A candidate's notes, a field to add one and a Delete button on each. The card owns the notes (they come
 * in as a prop and go back up as the new list); this keeps only the text being typed.
 */
function CandidateNotes({ state, notes, name }) {
  return (
    <div className="candidate-notes">
      <span className="note-count">{noteLabel(notes.length)}</span>
      {notes.length > 0 && (
        <ul className="notes">
          {notes.map((note, index) => (
            <li className="note">
              <span className="note-text">{note}</span>
              <button type="button" className="delete-note" data-index={index} aria-label={`Delete note: ${note}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="note-form">
        <input name="note" aria-label={`Note for ${name}`} value={state.text} />
        <button type="submit">Add note</button>
      </form>
    </div>
  )
}

CandidateNotes.isolatedState = true
CandidateNotes.initialState = { text: '' }

CandidateNotes.intent = ({ DOM }) => ({
  TYPE: DOM.input('[name="note"]').value(),
  SAVE: DOM.select('.note-form').events('submit', { preventDefault: true }),
  DELETE: DOM.click('.delete-note').data('index', Number),
})

CandidateNotes.model = {
  TYPE: set((state, text) => ({ text })),
  SAVE: {
    STATE: (state) => (state.text.trim() ? { ...state, text: '' } : ABORT),
    PARENT: (state, data, next, { notes }) => (state.text.trim() ? { notes: [...notes, state.text.trim()] } : ABORT),
  },
  DELETE: {
    PARENT: (state, index, next, { notes }) => ({ notes: notes.filter((note, i) => i !== index) }),
  },
}

export default CandidateNotes
