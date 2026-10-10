// Made-up weather, the same for the same city (no API key, no network). Replace it with a real API.
const SKIES = ['Sunny', 'Partly cloudy', 'Cloudy', 'Showers', 'Windy']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

export function forecast(city) {
  let seed = [...city.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32
  return DAYS.map((date) => {
    const high = Math.round(12 + next() * 18)
    return { date, sky: SKIES[Math.floor(next() * SKIES.length)], high, low: high - Math.round(4 + next() * 6) }
  })
}
