import { run, makeFetchDriver, xs } from 'sygnal'
import { agentTools } from 'sygnal/ai'
import { makeLLM } from '../../shared/providers.js'
import SmartHome from './SmartHome.jsx'
import './assistant.css'
import homeSrc from './SmartHome.jsx?raw'
import roomSrc from './Room.jsx?raw'
import dataSrc from './home.js?raw'
import seesSrc from './modelSees.jsx?raw'
import mainSrc from './index.js?raw'

/**
 * A driver whose source is what the agent layer offers a model: `{ tools, context }`, again after
 * every render that changed either. `agentTools()` needs the running app, so the driver is
 * attached to it once run() returns.
 */
function makeAgentViewDriver() {
  let listener = null, latest = null, tools = null
  const emit = (view) => { latest = view; listener?.next(view) }
  const view$ = xs.create({ start: (l) => { listener = l; if (latest) l.next(latest) }, stop: () => { listener = null } })
  const driver = () => ({ select: () => view$, dispose: () => tools?.stop() })
  driver.attach = (app) => {
    tools = agentTools(app)
    emit({ tools: tools.list(), context: tools.context() })
    tools.subscribe(emit)
    return app
  }
  return driver
}

export function start(mountPoint, uid) {
  const AGENT = makeAgentViewDriver()
  const app = run(SmartHome, {
    LLM: makeLLM(),             // the chat driver; the routed transport picks the provider per request
    HTTP: makeFetchDriver(),    // the model list (GET /api/providers)
    AGENT,
  }, { mountPoint, uid })
  return AGENT.attach(app)
}

export const files = { 'SmartHome.jsx': homeSrc, 'Room.jsx': roomSrc, 'home.js': dataSrc, 'modelSees.jsx': seesSrc, 'index.js': mainSrc }
