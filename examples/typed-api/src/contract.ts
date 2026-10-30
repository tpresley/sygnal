// The API contract: the one module the client and the server share (oRPC, contract-first).
// GET procedures read their input from the query string, so non-string fields coerce.
import { oc, eventIterator } from '@orpc/contract'
import { z } from 'zod'

export const Quote = z.object({ id: z.number(), text: z.string(), tag: z.string(), addedAt: z.date() })

export const contract = {
  quotes: {
    list: oc.route({ method: 'GET', path: '/quotes' })
      .input(z.object({ tag: z.string().optional() }))
      .output(z.array(Quote)),
    add: oc.route({ method: 'POST', path: '/quotes' })
      .input(z.object({ text: z.string().trim().min(3, 'Write at least 3 characters'), tag: z.string() }))
      .output(Quote)
      .errors({ DUPLICATE: { status: 409, message: 'That quote is already here', data: z.object({ id: z.number() }) } }),
    remove: oc.route({ method: 'DELETE', path: '/quotes/{id}' })
      .input(z.object({ id: z.coerce.number() }))
      .output(z.object({ removed: z.boolean() })),
    // an event iterator is a stream: read as server-sent events, so it is a GET
    feed: oc.route({ method: 'GET', path: '/quotes/feed' })
      .input(z.object({ tag: z.string().optional() }))
      .output(eventIterator(Quote)),
  },
}
