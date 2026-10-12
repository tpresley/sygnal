import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createForecastServer } from './server.js'

// The server, called by an MCP client in memory: the tool links its view, and returns the
// structured result the view renders.
let client
afterEach(() => client?.close())

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createForecastServer().connect(a)
  client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(b)
  return client
}

describe('MCP server', () => {
  it('get_forecast names its view (an MCP App resource)', async () => {
    const c = await connect()
    const { tools } = await c.listTools()
    const tool = tools.find((t) => t.name === 'get_forecast')
    expect(tool._meta.ui.resourceUri).toBe('ui://forecast/view.html')
    const { resources } = await c.listResources()
    expect(resources).toContainEqual(expect.objectContaining({ uri: 'ui://forecast/view.html', mimeType: 'text/html;profile=mcp-app' }))
  })

  it('get_forecast returns five days as structuredContent', async () => {
    const c = await connect()
    const result = await c.callTool({ name: 'get_forecast', arguments: { city: 'Lisbon' } })
    expect(result.structuredContent.city).toBe('Lisbon')
    expect(result.structuredContent.days).toHaveLength(5)
    expect(result.content[0].text).toMatch(/^Lisbon: Mon /)
  })

  it('the view records a selection with select_day (app-only), and the model reads it with get_selected_day', async () => {
    const c = await connect()
    const { tools } = await c.listTools()
    expect(tools.find((t) => t.name === 'select_day')._meta.ui.visibility).toEqual(['app'])
    expect(tools.find((t) => t.name === 'get_selected_day')._meta?.ui?.visibility).toBeUndefined()

    await c.callTool({ name: 'get_forecast', arguments: { city: 'Lisbon' } })
    expect((await c.callTool({ name: 'get_selected_day', arguments: {} })).content[0].text).toMatch(/has not selected/)

    const day = { date: 'Fri', sky: 'Cloudy', high: 29, low: 25 }
    await c.callTool({ name: 'select_day', arguments: { city: 'Lisbon', day } })
    const result = await c.callTool({ name: 'get_selected_day', arguments: {} })
    expect(result.structuredContent).toEqual({ city: 'Lisbon', day })
    expect(result.content[0].text).toBe('The user selected Fri in the Lisbon forecast: Cloudy, 29°/25°.')
  })
})
