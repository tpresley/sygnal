import { useState } from 'react'

export default function App() {
  const [status, setStatus] = useState('idle')
  const [quote, setQuote] = useState(null)

  const load = async () => {
    setStatus('loading')
    try {
      const response = await fetch('/api/quote')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setQuote(await response.json())
      setStatus('idle')
    } catch {
      setQuote(null)
      setStatus('error')
    }
  }

  let message = 'No quote yet.'
  if (status === 'loading') message = 'Loading…'
  else if (status === 'error') message = 'Could not load a quote.'
  else if (quote) message = `${quote.text} — ${quote.author}`

  return (
    <div className="app">
      <h1>Quote of the day</h1>
      <button className="get-quote" onClick={load}>
        Get a quote
      </button>
      <blockquote className="quote">{message}</blockquote>
    </div>
  )
}
