import { useState } from 'react'
import StarRating from './StarRating.jsx'

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
      <StarRating name="food" label="Food" value={food} onChange={setFood} />
      <StarRating name="service" label="Service" value={service} onChange={setService} />
    </div>
  )
}
