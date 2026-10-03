import { useEffect, useRef, useState } from 'react'

const KEY = 'note-draft'
const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0)

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(KEY))
    if (draft && typeof draft === 'object') {
      return {
        title: typeof draft.title === 'string' ? draft.title : '',
        body: typeof draft.body === 'string' ? draft.body : '',
      }
    }
  } catch {
    // not valid JSON: start empty
  }
  return { title: '', body: '' }
}

export default function App() {
  const [note, setNote] = useState(loadDraft)
  const [status, setStatus] = useState('')
  const timer = useRef(null)
  // Bumped on every edit and every save: a reply only counts if nothing happened since its save.
  const generation = useRef(0)

  useEffect(() => () => clearTimeout(timer.current), [])

  const save = async (draft) => {
    const mine = ++generation.current
    setStatus('Saving…')
    let ok = false
    try {
      const response = await fetch('/api/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      ok = response.ok
    } catch {
      ok = false
    }
    if (generation.current === mine) setStatus(ok ? 'Saved' : 'Save failed.')
  }

  const edit = (patch) => {
    const next = { ...note, ...patch }
    setNote(next)
    localStorage.setItem(KEY, JSON.stringify(next))
    generation.current++
    setStatus('Unsaved changes')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(next), 1000)
  }

  const words = countWords(note.body)
  return (
    <main className="note-editor">
      <h1>Note</h1>
      <label className="field">
        <span>Title</span>
        <input name="title" value={note.title} onChange={(e) => edit({ title: e.target.value })} />
      </label>
      <label className="field">
        <span>Body</span>
        <textarea name="body" rows="8" value={note.body} onChange={(e) => edit({ body: e.target.value })}></textarea>
      </label>
      <p className="word-count">{`${words} ${words === 1 ? 'word' : 'words'}`}</p>
      <p className="save-status">{status}</p>
    </main>
  )
}
