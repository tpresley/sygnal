import { run, makeFetchDriver } from 'sygnal'
import { makeLLM } from '../../shared/providers.js'
import KitchenHelper from './KitchenHelper.jsx'
import './tools.css'
import src from './KitchenHelper.jsx?raw'
import toolsSrc from './tools.js?raw'
import mainSrc from './index.js?raw'

export const start = (mountPoint, uid) => run(KitchenHelper, {
  LLM: makeLLM(),             // the chat driver: tool calls come back as TOOL actions
  HTTP: makeFetchDriver(),    // the model list (GET /api/providers)
}, { mountPoint, uid })

export const files = { 'KitchenHelper.jsx': src, 'tools.js': toolsSrc, 'index.js': mainSrc }
