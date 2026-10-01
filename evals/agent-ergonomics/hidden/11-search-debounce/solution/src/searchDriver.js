import { driverFromAsync } from 'sygnal'

// Every reply says which query it answers, so the app can drop stale ones.
// Failures become ordinary replies: driverFromAsync only logs rejections.
async function searchBooks(query) {
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
    if (!response.ok) return { query, ok: false }
    const body = await response.json()
    return { query, ok: true, results: body.results }
  } catch {
    return { query, ok: false }
  }
}

export const searchDriver = driverFromAsync(searchBooks, {
  selector: 'category',
  args: (cmd) => cmd.query,
  return: 'reply',
})
