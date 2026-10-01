import { useState } from 'react'

export default function App() {
  const [quote] = useState(null)

  return (
    <div className="app">
      <h1>Quote of the day</h1>
      <button className="get-quote">Get a quote</button>
      <blockquote className="quote">{quote || 'No quote yet.'}</blockquote>
    </div>
  )
}
