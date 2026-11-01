// The server: the contract implemented with oRPC. Each handler's input and return type are
// checked against the contract (a wrong shape is a compile error).
import { implement } from '@orpc/server'
import { contract } from '../src/contract'

type Quote = { id: number; text: string; tag: string; addedAt: Date }

export function makeRouter(seed: Quote[] = [{ id: 1, text: 'Start where you are.', tag: 'calm', addedAt: new Date(0) }]) {
  const quotes = [...seed]
  let next = Math.max(0, ...quotes.map((q) => q.id)) + 1
  const listeners = new Set<(q: Quote) => void>()
  const os = implement(contract)

  const router = os.router({
    quotes: {
      list: os.quotes.list.handler(({ input }) => quotes.filter((q) => !input.tag || q.tag === input.tag)),
      add: os.quotes.add.handler(({ input, errors }) => {
        const dup = quotes.find((q) => q.text.toLowerCase() === input.text.toLowerCase())
        if (dup) throw errors.DUPLICATE({ data: { id: dup.id } })
        const quote = { id: next++, text: input.text, tag: input.tag, addedAt: new Date() }
        quotes.push(quote)
        listeners.forEach((l) => l(quote))
        return quote
      }),
      remove: os.quotes.remove.handler(({ input }) => {
        const i = quotes.findIndex((q) => q.id === input.id)
        if (i >= 0) quotes.splice(i, 1)
        return { removed: i >= 0 }
      }),
      // an async generator is the stream: one event per yield, until the client goes away
      feed: os.quotes.feed.handler(async function* ({ input, signal }) {
        const queue: Quote[] = []
        let wake = () => {}
        const l = (q: Quote) => { if (!input.tag || q.tag === input.tag) { queue.push(q); wake() } }
        listeners.add(l)
        try {
          while (!signal?.aborted) {
            if (!queue.length) await new Promise<void>((r) => { wake = r; signal?.addEventListener('abort', () => r(), { once: true }) })
            while (queue.length) yield queue.shift()!
          }
        } finally { listeners.delete(l) }
      }),
    },
  })
  return { router, quotes }
}
