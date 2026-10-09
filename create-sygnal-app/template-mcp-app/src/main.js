import { run } from 'sygnal'
import { makeMcpAppDriver } from 'sygnal/ai'
import App from './App.jsx'
import './style.css'

// MCP: the bridge to the host. It does the ui/initialize handshake, then delivers the tool's
// input and result to MCP.select(...) and sends { callTool }, { updateModelContext }, { message },
// { openLink } and { displayMode } requests.
run(App, { MCP: makeMcpAppDriver({ appInfo: { name: 'sygnal-forecast', version: '0.1.0' }, availableDisplayModes: ['inline', 'fullscreen'] }) })
