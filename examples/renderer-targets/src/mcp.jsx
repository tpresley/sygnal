// The agent target: an MCP server on stdio (npm run mcp builds it; add `node dist-node/mcp.js` to
// an MCP client). The agent reads the screen with ui_snapshot and acts with ui_click / ui_type /
// ui_select / ui_check, the same events a person's input makes.
import { runAgentUI, serveMcp } from 'sygnal/agent-ui'
import Groceries from './app.jsx'

const { ui } = runAgentUI(Groceries)
serveMcp(ui, { name: 'groceries', version: '1.0.0' })
