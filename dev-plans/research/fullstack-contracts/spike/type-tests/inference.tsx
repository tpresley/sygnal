// Negative tests: the contract's types reach the call sites, the reducers and the server.
import type { Component, Resource } from 'sygnal'
import { api, replies, contract, type Quote } from '../app/api.ts'
import type { Output } from '../lib/contract.ts'
import type { Implementation as Impl } from '../lib/server.ts'

// input is checked
api.addQuote({ text: 'abc', tag: 'x' })
// @ts-expect-error missing tag
api.addQuote({ text: 'abc' })
// @ts-expect-error wrong type
api.listQuotes({ tag: 1 })
// @ts-expect-error unknown procedure
api.getQuote({ id: 1 })
// invalidates names queries only
api.addQuote({ text: 'abc', tag: 'x' }, { invalidates: ['listQuotes'] })
// @ts-expect-error a mutation is not a query to invalidate
api.addQuote({ text: 'abc', tag: 'x' }, { invalidates: ['addQuote'] })

// output types
const o: Output<typeof api.listQuotes> = [{ id: 1, text: 't', tag: 'x' }]
// @ts-expect-error output is Quote[]
const bad: Output<typeof api.listQuotes> = [{ id: '1' }]
const o2: Output<typeof contract.addQuote> = { id: 1, text: 't', tag: 'x' }
export { o, bad, o2 }

// typed reducers: data inferred from the contract
type S = { n: number; quotes: Resource<Quote[]> }
const C: Component<S> = () => <div />
C.model = {
  A: replies.addQuote((state, quote) => ({ ...state, n: quote.id })),
  // @ts-expect-error quote.id is a number, not a string
  B: replies.addQuote((state, quote) => ({ ...state, n: quote.id.toUpperCase() })),
  E: replies.error((state, { status }) => ({ ...state, n: status ?? 0 })),
  F: replies.quoteFeed((state, q) => ({ ...state, n: q.text.length })),
}

// the server implements exactly the contract
const impl: Impl<typeof contract> = {
  listQuotes: () => [],
  addQuote: ({ text, tag }) => ({ id: 1, text, tag }),
  quoteFeed: async function* () { yield { id: 1, text: 't', tag: 'x' } },
}
const badImpl: Impl<typeof contract> = {
  listQuotes: () => [],
  // @ts-expect-error returns the wrong shape (type drift is a compile error on the server)
  addQuote: ({ text }) => ({ id: 'one', text }),
  quoteFeed: async function* () {},
}
export { impl, badImpl }

// function-first: the server function's own signature types the client call and the reply
import { addQuote as addFn, listQuotes as listFn } from '../fnapp/quotes.server.ts'
import { reply } from '../lib/contract.ts'
addFn({ text: 'abc', tag: 'x' }, { ok: 'ADDED' })
// @ts-expect-error input checked against the server function's schema
addFn({ text: 'abc' })
const D: Component<S> = () => <div />
D.model = {
  A: reply(addFn, (state, quote) => ({ ...state, n: quote.id })),
  // @ts-expect-error the reply is Quote[] (inferred from the function's return), not a Quote
  B: reply(listFn, (state, quotes) => ({ ...state, n: quotes.id })),
}
