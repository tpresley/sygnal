import { run } from 'sygnal'
import { experimentalExposeWebMcp } from 'sygnal/ai'
import ReadingList from './ReadingList.jsx'
import { recordingModelContext, makeWebMcpDriver, makeAgentCallDriver } from './agentConsole.js'
import './webmcp.css'
import listSrc from './ReadingList.jsx?raw'
import bookSrc from './Book.jsx?raw'
import goalSrc from './Goal.jsx?raw'
import consoleSrc from './consoleView.jsx?raw'
import plumbingSrc from './agentConsole.js?raw'
import mainSrc from './index.js?raw'

export function start(mountPoint, uid) {
  // records each registration for the console, and passes it on to document.modelContext when
  // the browser has WebMCP (Chrome with chrome://flags/#enable-webmcp-testing)
  const modelContext = recordingModelContext()
  const WEBMCP = makeWebMcpDriver(modelContext, mountPoint)
  const app = run(ReadingList, {
    WEBMCP,                                                    // what is registered, as it changes
    AGENT_CALL: makeAgentCallDriver(modelContext, mountPoint), // the console's "Call as agent"
  }, { mountPoint, uid })

  // the one line an app needs; without `modelContext` it registers with document.modelContext.
  // Consequential calls show Sygnal's confirmation dialog (styled in webmcp.css).
  WEBMCP.exposing(experimentalExposeWebMcp(app, { modelContext }))
  return app
}

export const files = {
  'ReadingList.jsx': listSrc, 'Book.jsx': bookSrc, 'Goal.jsx': goalSrc, 'consoleView.jsx': consoleSrc,
  'index.js': mainSrc, 'agentConsole.js': plumbingSrc,
}
