// A minimal MCP server with one MCP App: the `get_forecast` tool and the HTML resource that shows
// its result. `npm run build` first (it writes dist/index.html), then:
//   node server/server.js            Streamable HTTP on http://localhost:3001/mcp
//   node server/server.js --stdio    stdio (Claude Desktop, VS Code, ...)
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { forecast } from './forecast.js'

const VIEW_URI = 'ui://forecast/view.html'
// the MIME type that marks an HTML resource as an MCP App view
const MCP_APP_MIME = 'text/html;profile=mcp-app'
const html = new URL('../dist/index.html', import.meta.url)

export function createForecastServer() {
  const server = new McpServer({ name: 'sygnal-forecast', version: '0.1.0' })

  server.registerTool('get_forecast', {
    title: 'Get forecast',
    description: 'A five-day weather forecast for a city, shown as an interactive card.',
    inputSchema: { city: z.string().describe('The city, e.g. "Lisbon"') },
    // the view the host shows for this tool's calls (the second key is for hosts that read the older flat form)
    _meta: { ui: { resourceUri: VIEW_URI }, 'ui/resourceUri': VIEW_URI },
  }, async ({ city }) => {
    const days = forecast(city)
    return {
      content: [{ type: 'text', text: `${city}: ` + days.map((d) => `${d.date} ${d.sky} ${d.high}°/${d.low}°`).join(', ') }],
      structuredContent: { city, days },
    }
  })

  server.registerResource('forecast-view', VIEW_URI, { title: 'Forecast view', mimeType: MCP_APP_MIME }, async () => {
    let text
    try {
      text = await readFile(html, 'utf8')
    } catch {
      throw new Error('dist/index.html is missing: run `npm run build` first')
    }
    return { contents: [{ uri: VIEW_URI, mimeType: MCP_APP_MIME, text, _meta: { ui: { prefersBorder: true } } }] }
  })

  return server
}

async function main() {
  if (process.argv.includes('--stdio')) {
    await createForecastServer().connect(new StdioServerTransport())
    return
  }
  const port = Number(process.env.PORT) || 3001
  createServer(async (req, res) => {
    // CORS for browser-based hosts (MCPJam, the ext-apps basic-host)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    if (new URL(req.url, 'http://localhost').pathname !== '/mcp') return res.writeHead(404).end()
    // stateless: a server and a transport per request
    const server = createForecastServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { transport.close(); server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (e) {
      console.error(e)
      if (!res.headersSent) res.writeHead(500).end()
    }
  }).listen(port, () => console.log(`MCP server on http://localhost:${port}/mcp`))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
