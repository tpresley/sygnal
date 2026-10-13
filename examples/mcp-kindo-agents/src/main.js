import { run, makeTimerDriver } from 'sygnal'
import { makeMcpAppDriver } from 'sygnal/ai'
import App from './App.jsx'
import './style.css'

// MCP: the bridge to the host (the ui/initialize handshake, the tool's input and result as
// actions, { callTool } / { message } / { updateModelContext } / { displayMode } requests).
// TIMER: the one-second tick of the elapsed time while a run is in progress.
run(App, {
  MCP: makeMcpAppDriver({ appInfo: { name: 'sygnal-kindo-agents', version: '0.1.0' }, availableDisplayModes: ['inline', 'fullscreen'] }),
  TIMER: makeTimerDriver(),
})
