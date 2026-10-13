import { run, makeFetchDriver } from 'sygnal'
import { makeLLM } from '../../shared/providers.js'
import EventExtractor from './EventExtractor.jsx'
import './structured.css'
import src from './EventExtractor.jsx?raw'
import eventSrc from './event.js?raw'
import emailsSrc from './emails.js?raw'
import mainSrc from './index.js?raw'

export const start = (mountPoint, uid) => run(EventExtractor, {
  LLM: makeLLM(),             // the chat driver: it sends the schema, then parses and validates the reply
  HTTP: makeFetchDriver(),    // the model list (GET /api/providers)
}, { mountPoint, uid })

export const files = { 'EventExtractor.jsx': src, 'event.js': eventSrc, 'emails.js': emailsSrc, 'index.js': mainSrc }
