import { useState } from 'react'
import { noteLabel } from './pipeline.js'

/**
 * A candidate's notes, a field to add one and a Delete button on each. The card owns the notes (they come
 * in as a prop and go back up as the new list); this keeps only the text being typed.
 */
export default function CandidateNotes({ notes, name, onChange }) {
  const [text, setText] = useState('')
  function handleSubmit(e) {
    e.preventDefault()
    const note = text.trim()
    if (!note) return
    onChange([...notes, note])
    setText('')
  }
  return (
    <div className="candidate-notes">
      <span className="note-count">{noteLabel(notes.length)}</span>
      {notes.length > 0 && (
        <ul className="notes">
          {notes.map((note, index) => (
            <li key={index} className="note">
              <span className="note-text">{note}</span>
              <button
                type="button"
                className="delete-note"
                data-index={index}
                aria-label={`Delete note: ${note}`}
                onClick={() => onChange(notes.filter((n, i) => i !== index))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="note-form" onSubmit={handleSubmit}>
        <input name="note" aria-label={`Note for ${name}`} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit">Add note</button>
      </form>
    </div>
  )
}
