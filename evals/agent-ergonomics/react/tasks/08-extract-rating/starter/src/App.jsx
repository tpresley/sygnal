import { useState } from 'react'

const STARS = [1, 2, 3, 4, 5]

export default function App() {
  const [food, setFood] = useState(0)
  const [service, setService] = useState(0)
  const show = (value) => (value ? `${value}/5` : 'not rated')

  return (
    <div className="app">
      <h1>Rate your visit</h1>
      <p className="summary">
        Food: {show(food)} · Service: {show(service)}
      </p>

      <div className="rating food">
        <span className="label">Food</span>
        {STARS.map((n) => (
          <button key={n} className={n <= food ? 'star filled' : 'star'} onClick={() => setFood(n)}>
            ★
          </button>
        ))}
      </div>

      <div className="rating service">
        <span className="label">Service</span>
        {STARS.map((n) => (
          <button key={n} className={n <= service ? 'star filled' : 'star'} onClick={() => setService(n)}>
            ★
          </button>
        ))}
      </div>
    </div>
  )
}
