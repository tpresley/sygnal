import { driverFromAsync } from 'sygnal'

// driverFromAsync only logs rejected promises, so errors are turned into
// ordinary values the app can react to.
async function loadQuote(url) {
  try {
    const response = await fetch(url)
    if (!response.ok) return { ok: false }
    const quote = await response.json()
    return { ok: true, quote }
  } catch {
    return { ok: false }
  }
}

export const quoteDriver = driverFromAsync(loadQuote, {
  selector: 'category',
  args: (cmd) => cmd.url,
  return: 'result',
})
