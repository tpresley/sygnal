import { useState } from 'react'

export default function App() {
  const [lastCommand] = useState(null)
  const [text, setText] = useState('')

  return (
    <main className="editor-page">
      <header>
        <h1>Untitled document</h1>
        <p className="last-command">{lastCommand ? `Ran: ${lastCommand}` : 'No command run yet.'}</p>
      </header>
      <section className="palette"></section>
      <textarea className="document" aria-label="Document" value={text} onChange={(e) => setText(e.target.value)}></textarea>
    </main>
  )
}
