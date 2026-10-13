// Section 10 is not a live widget: an MCP App runs inside a host (Claude, ChatGPT, VS Code), so
// the section shows it running in Claude, and its source from examples/mcp-kindo-agents.
import './mcp-app.css'
import appSrc from '../../../../mcp-kindo-agents/src/App.jsx?raw'
import mainSrc from '../../../../mcp-kindo-agents/src/main.js?raw'
import serverSrc from '../../../../mcp-kindo-agents/server/server.js?raw'
import kindoSrc from '../../../../mcp-kindo-agents/server/kindo.js?raw'

// the screenshot, once there is one (a missing file must not break the page)
const shots = import.meta.glob('./*.png', { eager: true, query: '?url', import: 'default' })
const shot = Object.values(shots)[0]

const html = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function start(mountPoint) {
  mountPoint.innerHTML = `
    <figure class="mcp-shot">
      ${shot
        ? `<img src="${html(shot)}" alt="Claude Desktop showing the Kindo agent runner card in a conversation: the agent's inputs, a finished run with its step evaluations, and the result" />`
        : `<div class="mcp-shot-missing"><b>Screenshot pending</b><span>Run <code>examples/mcp-kindo-agents</code> in Claude Desktop (see its README) to see it here.</span></div>`}
      <figcaption>
        <span><b>examples/mcp-kindo-agents</b> in Claude Desktop: the model calls <code>run_kindo_agent</code> with the inputs from the chat; the card runs the agent and follows it.</span>
        <span class="mcp-run"><code>npm install &amp;&amp; npm run build &amp;&amp; bash scripts/add-to-claude-desktop.sh</code></span>
      </figcaption>
    </figure>`
  return null
}

export const files = {
  'mcp-kindo-agents/src/App.jsx': appSrc,
  'mcp-kindo-agents/src/main.js': mainSrc,
  'mcp-kindo-agents/server/server.js': serverSrc,
  'mcp-kindo-agents/server/kindo.js': kindoSrc,
}
