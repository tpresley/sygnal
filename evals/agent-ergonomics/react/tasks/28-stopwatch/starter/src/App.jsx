import { useState } from 'react'
import Stopwatch from './Stopwatch.jsx'

export default function App() {
  const [show, setShow] = useState(true)

  return (
    <main className="app">
      <h1>Workout timer</h1>
      <label className="show">
        <input type="checkbox" name="show" checked={show} onChange={(e) => setShow(e.target.checked)} />
        <span>Show stopwatch</span>
      </label>
      {show && <Stopwatch />}
    </main>
  )
}
