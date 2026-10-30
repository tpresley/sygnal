// The client: every procedure of the contract as a function that builds a request (data).
import { orpcClient, contractHash } from 'sygnal/api'
import { contract } from './contract'

/** the header the server compares with its own contract hash (version skew after a deploy) */
export const CONTRACT_HEADER = 'x-api-contract'

export const api = orpcClient(contract, {
  prefix: '/api',
  headers: { [CONTRACT_HEADER]: contractHash(contract) },
})
