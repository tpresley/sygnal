import { useState } from 'react'

export default function App() {
  const [zip, setZip] = useState('')
  const [city, setCity] = useState('')
  const [express, setExpress] = useState(false)
  const [saved, setSaved] = useState('')

  const save = () => setSaved(`Saved: ${city}, ${zip} (${express ? 'express' : 'standard'})`)

  return (
    <div className="delivery">
      <h1>Delivery address</h1>
      <label className="field">
        <span>ZIP code</span>
        <input name="zip" inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} />
      </label>
      <p className="zip-status"></p>
      <label className="field">
        <span>City</span>
        <input name="city" value={city} onChange={(e) => setCity(e.target.value)} />
      </label>
      <label className="option">
        <input type="checkbox" name="express" checked={express} onChange={(e) => setExpress(e.target.checked)} />
        <span>Express delivery</span>
      </label>
      <button className="save" onClick={save}>
        Save address
      </button>
      <p className="saved">{saved}</p>
    </div>
  )
}
