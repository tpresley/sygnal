import { useRef, useState } from 'react'

const isZip = (zip) => /^\d{5}$/.test(zip)

export default function App() {
  const [zip, setZip] = useState('')
  const [city, setCity] = useState('')
  const [express, setExpress] = useState(false)
  const [expressAvailable, setExpressAvailable] = useState(true)
  const [status, setStatus] = useState('')
  const [saved, setSaved] = useState('')
  const cityRef = useRef(null)
  // The ZIP of the lookup whose response still counts; anything else is stale.
  const latest = useRef(null)

  const lookUp = async (value) => {
    latest.current = value
    setStatus('Looking up…')
    let outcome
    try {
      const response = await fetch(`/api/zip/${value}`)
      outcome = response.ok ? { ok: true, place: await response.json() } : { ok: false, notFound: response.status === 404 }
    } catch {
      outcome = { ok: false, notFound: false }
    }
    if (latest.current !== value) return
    latest.current = null
    if (outcome.ok) {
      setStatus('')
      setCity(outcome.place.city)
      setExpressAvailable(outcome.place.express)
      if (!outcome.place.express) setExpress(false)
    } else {
      setStatus(outcome.notFound ? 'Unknown ZIP code.' : 'Lookup failed.')
      cityRef.current?.focus()
    }
  }

  const changeZip = (value) => {
    setZip(value)
    if (isZip(value)) {
      lookUp(value)
    } else {
      latest.current = null
      setStatus('')
      setExpressAvailable(true)
    }
  }

  const save = () => setSaved(`Saved: ${city}, ${zip} (${express ? 'express' : 'standard'})`)

  return (
    <div className="delivery">
      <h1>Delivery address</h1>
      <label className="field">
        <span>ZIP code</span>
        <input name="zip" inputMode="numeric" value={zip} onChange={(e) => changeZip(e.target.value)} />
      </label>
      <p className="zip-status">{status}</p>
      <label className="field">
        <span>City</span>
        <input name="city" ref={cityRef} value={city} onChange={(e) => setCity(e.target.value)} />
      </label>
      <label className="option">
        <input
          type="checkbox"
          name="express"
          checked={express}
          disabled={!expressAvailable}
          onChange={(e) => setExpress(e.target.checked)}
        />
        <span>Express delivery</span>
      </label>
      <button className="save" onClick={save}>
        Save address
      </button>
      <p className="saved">{saved}</p>
    </div>
  )
}
