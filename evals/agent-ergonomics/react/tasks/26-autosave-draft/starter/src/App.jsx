import { useState } from 'react'

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0)

export default function App() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const words = countWords(body)

  return (
    <main className="note-editor">
      <h1>Note</h1>
      <label className="field">
        <span>Title</span>
        <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Body</span>
        <textarea name="body" rows="8" value={body} onChange={(e) => setBody(e.target.value)}></textarea>
      </label>
      <p className="word-count">{`${words} ${words === 1 ? 'word' : 'words'}`}</p>
      <p className="save-status"></p>
    </main>
  )
}
