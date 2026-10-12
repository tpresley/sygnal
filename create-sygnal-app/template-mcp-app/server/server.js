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

// The day the user selected in the card. Hosts differ in what they do with the view's model
// context (ui/update-model-context): Cursor adds it to the next turn, claude.ai and Claude Desktop's
// Code tab let the model read it with a tool, Claude Desktop's chat accepts it but its model never
// sees it (October 2026). So the view also stores the selection here, with the
// app-only select_day tool, and the model reads it with get_selected_day, an ordinary tool every
// host offers. Kept in the process: the stdio server runs one per host connection; a shared HTTP
// server would key it by user or session.
let selection = null

export function createForecastServer() {
  const server = new McpServer({ name: 'sygnal-forecast', version: '0.1.0' })

  server.registerTool('get_forecast', {
    title: 'Get forecast',
    description: 'A five-day weather forecast for a city, shown as an interactive card. The user can select a day in the card: '
      + 'call get_selected_day when they refer to the day they picked.',
    inputSchema: { city: z.string().describe('The city, e.g. "Lisbon"') },
    // the view the host shows for this tool's calls (the second key is for hosts that read the older flat form)
    _meta: { ui: { resourceUri: VIEW_URI }, 'ui/resourceUri': VIEW_URI },
  }, async ({ city }) => {
    const days = forecast(city)
    selection = null   // a new card: nothing selected yet
    return {
      content: [{ type: 'text', text: `${city}: ` + days.map((d) => `${d.date} ${d.sky} ${d.high}°/${d.low}°`).join(', ') }],
      structuredContent: { city, days },
    }
  })

  // called by the view when the user selects a day; visibility ['app'] keeps it out of the model's tool list
  server.registerTool('select_day', {
    title: 'Select a day',
    description: 'Records the day the user selected in the forecast card.',
    inputSchema: {
      city: z.string(),
      day: z.object({ date: z.string(), sky: z.string(), high: z.number(), low: z.number() }),
    },
    _meta: { ui: { resourceUri: VIEW_URI, visibility: ['app'] } },
  }, async ({ city, day }) => {
    selection = { city, day }
    return { content: [{ type: 'text', text: `Selected ${day.date} in ${city}` }], structuredContent: selection }
  })

  // what the model calls to learn the user's selection
  server.registerTool('get_selected_day', {
    title: 'Get the selected day',
    description: 'The day the user selected in the forecast card shown by get_forecast, if any.',
    inputSchema: {},
  }, async () => selection
    ? {
        content: [{ type: 'text', text: `The user selected ${selection.day.date} in the ${selection.city} forecast: ${selection.day.sky}, ${selection.day.high}°/${selection.day.low}°.` }],
        structuredContent: selection,
      }
    : { content: [{ type: 'text', text: 'The user has not selected a day in the forecast card.' }] })

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
