// Function-first: no contract file. The exports are the API; their signatures are its types.
import { z } from 'zod'
import { query, mutation, stream } from '../lib/fn.ts'
import { ApiError } from '../lib/server.ts'

export type Quote = { id: number; text: string; tag: string }
const quotes: Quote[] = [{ id: 1, text: 'Start where you are.', tag: 'calm' }]
const listeners = new Set<(q: Quote) => void>()

export const listQuotes = query(z.object({ tag: z.string().optional() }), ({ tag }) =>
  quotes.filter((q) => !tag || q.tag === tag))

export const addQuote = mutation(z.object({ text: z.string().min(3), tag: z.string() }), ({ text, tag }) => {
  if (quotes.some((q) => q.text === text)) throw new ApiError(409, 'That quote is already here')
  const quote: Quote = { id: quotes.length + 1, text, tag }
  quotes.push(quote)
  listeners.forEach((l) => l(quote))
  return quote
})

export const quoteFeed = stream(z.object({ tag: z.string().optional() }), async function* ({ tag }, { signal }) {
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
})
