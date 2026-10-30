import { orpcClient, contractHash } from 'sygnal/api'
import { contract } from './contract.js'
import { search, save } from './notes.server.js'
const api = orpcClient(contract, { prefix: '/api', headers: { 'x-api-contract': contractHash(contract) } })
globalThis.__requests = [api.notes.list(), search({ q: 'a' }), save({ text: 'b' })]
