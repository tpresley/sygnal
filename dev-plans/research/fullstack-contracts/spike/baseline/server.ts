// Baseline: hand-written Hono routes, each with its own path, method, parsing, validation,
// error shape and (for the feed) SSE framing.
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { AddQuoteBody, type Quote } from './types.ts'

export function makeStore() {
  const quotes: Quote[] = [{ id: 1, text: 'Start where you are.', tag: 'calm' }]
  const listeners = new Set<(q: Quote) => void>()
  return { quotes, listeners }
}

export function makeApp(store = makeStore()) {
  const { quotes, listeners } = store
  const app = new Hono()

  app.get('/api/quotes', (c) => {
    const tag = c.req.query('tag')
    return c.json(quotes.filter((q) => !tag || q.tag === tag))
  })

  app.post('/api/quotes', async (c) => {
    if (c.req.header('x-requested-with') !== 'fetch') return c.json({ message: 'Forbidden' }, 403)
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ message: 'Body is not JSON' }, 400) }
    const parsed = AddQuoteBody.safeParse(body)
    if (!parsed.success) return c.json({ message: 'Invalid input', issues: parsed.error.issues }, 400)
    const { text, tag } = parsed.data
    if (quotes.some((q) => q.text === text)) return c.json({ message: 'That quote is already here' }, 409)
    const quote = { id: quotes.length + 1, text, tag }
    quotes.push(quote)
    listeners.forEach((l) => l(quote))
    return c.json(quote, 201)
  })

  app.get('/api/quotes/feed', (c) => {
    const tag = c.req.query('tag')
    return streamSSE(c, async (stream) => {
      let id = 0
      const l = (q: Quote) => { if (!tag || q.tag === tag) stream.writeSSE({ id: String(++id), data: JSON.stringify(q) }) }
      listeners.add(l)
      const beat = setInterval(() => stream.write(': ping\n\n'), 15000)
      await new Promise<void>((r) => stream.onAbort(() => r()))
      clearInterval(beat)
      listeners.delete(l)
    })
  })
  return app
}
