import { run, makeFetchDriver } from 'sygnal'
import { makeLLM } from '../../shared/providers.js'
import Compose from './Compose.jsx'
import './compose.css'
import src from './Compose.jsx?raw'
import catalogSrc from './catalog.js?raw'
import partsSrc from './parts.jsx?raw'
import backendsSrc from './backends.js?raw'
import decidedSrc from './HowItDecided.jsx?raw'
import mainSrc from './index.js?raw'

export const start = (mountPoint, uid) => run(Compose, {
  HTTP: makeFetchDriver(),   // the model list, and compose.decisions()' decide() requests
  LLM: makeLLM(),            // compose.llm()'s structured-output requests, routed to the picked model
}, { mountPoint, uid })

export const files = {
  'Compose.jsx': src,
  'catalog.js': catalogSrc,
  'parts.jsx': partsSrc,
  'backends.js': backendsSrc,
  'HowItDecided.jsx': decidedSrc,
  'index.js': mainSrc,
}
