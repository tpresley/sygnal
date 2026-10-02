import { useState } from 'react'

export default function Editor() {
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState('')

  return (
    <section className="editor">
      <textarea
        className="draft"
        value={draft}
        placeholder="Write something..."
        onChange={(e) => setDraft(e.target.value)}
      />
      <button className="save" onClick={() => setSaved(draft)}>
        Save
      </button>
    </section>
  )
}
