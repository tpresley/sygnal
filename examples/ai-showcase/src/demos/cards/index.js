import { run, makeFetchDriver } from 'sygnal'
import { makeLLM } from '../../shared/providers.js'
import Trips from './Trips.jsx'
import './cards.css'
import src from './Trips.jsx?raw'
import cardsSrc from './cards.jsx?raw'
import destinationsSrc from './destinations.js?raw'
import mainSrc from './index.js?raw'

export const start = (mountPoint, uid) => run(Trips, {
  LLM: makeLLM(),            // the chat, and the requests that compose its cards (compose.llm())
  HTTP: makeFetchDriver(),   // the model list (GET /api/providers)
}, { mountPoint, uid })

export const files = { 'Trips.jsx': src, 'cards.jsx': cardsSrc, 'destinations.js': destinationsSrc, 'index.js': mainSrc }
