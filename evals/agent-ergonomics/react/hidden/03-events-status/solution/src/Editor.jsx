import { useState } from 'react'

export default function Editor({ onEdit, onSave }) {
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState('')

  return (
    <section className="editor" data-saved={saved}>
      <textarea
        className="draft"
        value={draft}
        placeholder="Write something..."
        onChange={(e) => {
          setDraft(e.target.value)
          onEdit()
        }}
      />
      <button
        className="save"
        onClick={() => {
          setSaved(draft)
          onSave(draft)
        }}
      >
        Save
      </button>
    </section>
  )
}
