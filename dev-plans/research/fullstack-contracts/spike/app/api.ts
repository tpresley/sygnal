// The contract: the one file the client and the server share.
import { z } from 'zod'
import { defineApi, query, mutation, stream, createClient, repliesOf } from '../lib/contract.ts'

export const Quote = z.object({ id: z.number(), text: z.string(), tag: z.string() })
export type Quote = z.infer<typeof Quote>

export const contract = defineApi({
  listQuotes: query({ input: z.object({ tag: z.string().optional() }), output: z.array(Quote) }),
  addQuote:   mutation({ input: z.object({ text: z.string().min(3), tag: z.string() }), output: Quote, invalidates: ['listQuotes'] }),
  quoteFeed:  stream({ input: z.object({ tag: z.string().optional() }), output: Quote }),
})

export const api = createClient(contract)
export const replies = repliesOf(contract)
