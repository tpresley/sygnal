import { useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

const textOf = (m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('')

export default function App() {
  const [prompt, setPrompt] = useState('')
  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })
  const busy = status === 'submitted' || status === 'streaming'

  function onSubmit(e) {
    e.preventDefault()
    if (busy || !prompt.trim()) return
    sendMessage({ text: prompt })
    setPrompt('')
  }

  return (
    <main className="support">
      <header>
        <h1>Acme support</h1>
        <p className="intro">Ask us anything about your order, your account or our products.</p>
      </header>
      <section className="chat">
        <ol className="messages" aria-live="polite">
          {messages.map((m) => <li key={m.id} className={m.role}>{textOf(m)}</li>)}
        </ol>
        {error && (
          <div role="alert">
            <p>Something went wrong.</p>
            <button type="button" onClick={() => sendMessage({ text: textOf(messages.filter((m) => m.role === 'user').at(-1)) })}>Retry</button>
          </div>
        )}
        <form onSubmit={onSubmit}>
          <label>Message <input value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
          <button type="submit" disabled={busy}>Send</button>
          {busy && <button type="button" onClick={() => stop()}>Stop</button>}
        </form>
      </section>
    </main>
  )
}
