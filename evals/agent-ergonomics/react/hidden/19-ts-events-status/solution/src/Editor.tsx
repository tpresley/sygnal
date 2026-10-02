import { useState } from 'react'

type EditorProps = {
  onEdit: () => void
  onSave: (text: string) => void
}

export default function Editor({ onEdit, onSave }: EditorProps) {
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
