// The API as a Fetch handler: oRPC's OpenAPIHandler (plain JSON on the wire) behind the contract
// skew check. Mount it anywhere that speaks Request → Response (Vite dev below, Hono, a Worker).
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { contractHash, contractSkew } from 'sygnal/api'
import { contract } from '../src/contract'
import { CONTRACT_HEADER } from '../src/api'
import { makeRouter } from './router'

export function makeHandler(router = makeRouter().router) {
  const handler = new OpenAPIHandler(router)
  const hash = contractHash(contract)
  return async (request: Request): Promise<Response> => {
    const skew = contractSkew(request, { hash, header: CONTRACT_HEADER })
    if (skew) return skew
    const { matched, response } = await handler.handle(request, { prefix: '/api' })
    return matched ? response : new Response('Not found', { status: 404 })
  }
}
