// Section 10 is not a live widget: an MCP App runs inside a host (Claude, ChatGPT, VS Code), so
// the section shows it running in Claude, and its source from examples/mcp-kindo-agents.
import './mcp-app.css'
import appSrc from '../../../../mcp-kindo-agents/src/App.jsx?raw'
import mainSrc from '../../../../mcp-kindo-agents/src/main.js?raw'
import serverSrc from '../../../../mcp-kindo-agents/server/server.js?raw'
import kindoSrc from '../../../../mcp-kindo-agents/server/kindo.js?raw'

// the screenshots, in file-name order (a missing file must not break the page)
const shots = import.meta.glob('./*.png', { eager: true, query: '?url', import: 'default' })
const urls = Object.keys(shots).sort().map((k) => shots[k])

const STEPS = [
  { label: 'Before', text: 'The model called <code>run_kindo_agent</code>: the card shows the agent and its inputs, ready to run.', alt: 'Claude Desktop showing the Kindo agent runner card for the Food Recommender agent, with its Location input set to New Orleans and a Run agent button' },
  { label: 'After', text: 'The card started the run and followed it: the step evaluation, then the agent\'s answer.', alt: 'The same card after the run: Succeeded in 8 seconds, the step evaluation passed, and the agent\'s list of must-try New Orleans dishes' },
]

const html = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function start(mountPoint) {
  mountPoint.innerHTML = `
    <figure class="mcp-shot">
      ${urls.length
        ? `<div class="mcp-steps">${urls.map((url, i) => `
            <div class="mcp-step">
              <p><span class="badge blue">${STEPS[i]?.label ?? i + 1}</span> ${STEPS[i]?.text ?? ''}</p>
              <img src="${html(url)}" alt="${html(STEPS[i]?.alt ?? 'Claude Desktop showing the Kindo agent runner card')}" />
            </div>`).join('')}</div>`
        : `<div class="mcp-shot-missing"><b>Screenshots pending</b><span>Run <code>examples/mcp-kindo-agents</code> in Claude Desktop (see its README) to see it here.</span></div>`}
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
