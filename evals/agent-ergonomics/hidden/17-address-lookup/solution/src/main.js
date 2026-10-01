import { run, driverFromAsync } from 'sygnal'
import App from './App.jsx'

// Every reply names the ZIP it answers, so the app can drop stale ones.
// Failures are ordinary replies too.
async function lookupZip(zip) {
  try {
    const response = await fetch(`/api/zip/${zip}`)
    if (!response.ok) return { zip, ok: false, notFound: response.status === 404 }
    const place = await response.json()
    return { zip, ok: true, city: place.city, express: place.express }
  } catch {
    return { zip, ok: false, notFound: false }
  }
}

run(App, { ZIP: driverFromAsync(lookupZip) })
