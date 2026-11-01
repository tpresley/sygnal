// The server: implement the contract, mount it on Hono.
import { Hono } from 'hono'
import { createHandler, ApiError, type Implementation } from '../lib/server.ts'
import { contract, type Quote } from './api.ts'

export function makeStore() {
  const quotes: Quote[] = [{ id: 1, text: 'Start where you are.', tag: 'calm' }]
  const listeners = new Set<(q: Quote) => void>()
  const impl: Implementation<typeof contract> = {
    listQuotes: ({ tag }) => quotes.filter((q) => !tag || q.tag === tag),
    addQuote: ({ text, tag }) => {
      if (quotes.some((q) => q.text === text)) throw new ApiError(409, 'That quote is already here')
      const quote = { id: quotes.length + 1, text, tag }
      quotes.push(quote)
      listeners.forEach((l) => l(quote))
      return quote
    },
    // an async generator is the stream: one SSE event per yield, ended by the client going away
    quoteFeed: async function* ({ tag }, { signal }) {
      const queue: Quote[] = []
      let wake = () => {}
      const l = (q: Quote) => { if (!tag || q.tag === tag) { queue.push(q); wake() } }
      listeners.add(l)
      try {
        while (!signal.aborted) {
          if (!queue.length) await new Promise<void>((r) => { wake = r; signal.addEventListener('abort', () => r(), { once: true }) })
          while (queue.length) yield queue.shift()!
        }
      } finally { listeners.delete(l) }
    },
  }
  return { quotes, impl }
}

export function makeApp(impl = makeStore().impl) {
  const rpc = createHandler(contract, impl, { validateOutput: true, sync: true })
  const app = new Hono()
  app.all('/rpc/*', (c) => rpc(c.req.raw))
  return app
}
