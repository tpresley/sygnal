// The API as a Fetch handler: oRPC's OpenAPIHandler (plain JSON on the wire) behind the skew
// checks. Mount it anywhere that speaks Request → Response (Hono, a Worker, Node); in dev,
// sygnal/vite serves the default export at /api (vite.config.ts: api.handler).
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { os } from '@orpc/server'
import { contractHash, contractSkew, serverFunctions } from 'sygnal/api'
import { contract } from '../src/contract'
import { CONTRACT_HEADER } from '../src/api'
import { makeRouter } from './router'

// function-first: every *.server.ts module under src/, named by its path (src/ideas.server.ts is
// `ideas`), mounted with oRPC next to the contract's router
export const functions = serverFunctions(import.meta.glob('../src/**/*.server.ts', { eager: true }), { os })

export function makeHandler(router = makeRouter().router) {
  const handler = new OpenAPIHandler({ ...router, ...functions.router })
  const hash = contractHash(contract)
  return async (request: Request): Promise<Response> => {
    const skew = contractSkew(request, { hash, header: CONTRACT_HEADER }) ?? functions.skew(request)
    if (skew) return skew
    const { matched, response } = await handler.handle(request, { prefix: '/api' })
    return matched ? response : new Response('Not found', { status: 404 })
  }
}

/** the dev server's (and a production server's) handler */
export default makeHandler()
