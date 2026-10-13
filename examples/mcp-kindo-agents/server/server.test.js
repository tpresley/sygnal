import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createKindoAgentsServer, newRunStore } from './server.js'
import { kindoClient, resultText } from './kindo.js'

// The server against a fake Kindo: the routes of the Agents API, with a run that finishes on its
// third poll.
function fakeKindo() {
  const calls = []
  let polls = 0
  const agents = [
    { agentId: 'a1', name: 'Security triage', description: 'Triage a CVE for our stack' },
    { agentId: 'a2', name: 'Release notes', description: 'Draft release notes from merged PRs' },
  ]
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    calls.push({ method: init.method ?? 'GET', path, body: init.body && JSON.parse(init.body), auth: init.headers?.authorization })
    if (path === '/v1/agents/list') return reply(200, { items: agents, total: 2 })
    if (path === '/v1/agents/a1') return reply(200, { ...agents[0], inputs: ['CVE id', 'Repository'] })
    if (path === '/v1/agents/runs') return reply(202, { runId: 'r1', conversationId: 'c1' })
    if (path === '/v1/runs/r1') {
      polls++
      const done = polls >= 3
      return reply(200, {
        runId: 'r1', agentId: 'a1', status: done ? 'success' : 'in_progress',
        createdAtUtc: '2026-10-12T10:00:00Z', endedAtUtc: done ? '2026-10-12T10:00:42Z' : null,
        result: done ? JSON.stringify({ role: 'assistant', parts: [{ type: 'text', text: '**Not affected**: we pin 2.4.1.' }] }) : null,
      })
    }
    if (path === '/v1/runs/r1/evals') return reply(200, { runId: 'r1', result: 'pending', steps: [{ stepNumber: 1, name: 'Find the CVE', result: polls >= 2 ? 'pass' : null }] })
    return reply(404, { error: 'not found' })
  }
  return { calls, client: kindoClient({ key: 'test-key', fetch, wait: async () => {} }) }
}

let client
afterEach(() => client?.close())

async function connect(kindo) {
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createKindoAgentsServer({ kindo, store: newRunStore() }).connect(a)
  client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(b)
  return client
}

describe('the Kindo agents MCP server', () => {
  it('run_kindo_agent has a view; the run tools are for the view only', async () => {
    const c = await connect(fakeKindo().client)
    const { tools } = await c.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    expect(byName.run_kindo_agent._meta.ui.resourceUri).toBe('ui://kindo-agents/runner.html')
    for (const name of ['kindo_agent', 'kindo_start_run', 'kindo_wait_run', 'kindo_restart_run']) expect(byName[name]._meta.ui.visibility).toEqual(['app'])
    for (const name of ['list_kindo_agents', 'get_agent_run']) expect(byName[name]._meta?.ui?.visibility).toBeUndefined()
  })

  it('finds the agent by name and passes the model\'s inputs to the view', async () => {
    const c = await connect(fakeKindo().client)
    const result = await c.callTool({ name: 'run_kindo_agent', arguments: { agent: 'security', inputs: { 'CVE id': 'CVE-2026-1234' } } })
    expect(result.structuredContent.agent).toEqual({ agentId: 'a1', name: 'Security triage', description: 'Triage a CVE for our stack', inputs: ['CVE id', 'Repository'] })
    expect(result.structuredContent.inputs).toEqual({ 'CVE id': 'CVE-2026-1234' })
    expect(result.structuredContent.agents).toHaveLength(2)
  })

  it('starts a run with the key, follows it to the end, and lets the model read the result', async () => {
    const kindo = fakeKindo()
    const c = await connect(kindo.client)
    const started = await c.callTool({ name: 'kindo_start_run', arguments: { agentId: 'a1', agentName: 'Security triage', inputs: [{ name: 'CVE id', value: 'CVE-2026-1234' }] } })
    expect(started.structuredContent.runId).toBe('r1')
    expect(kindo.calls.find((x) => x.path === '/v1/agents/runs')).toMatchObject({ method: 'POST', auth: 'Bearer test-key', body: { agentId: 'a1', inputs: [{ name: 'CVE id', value: 'CVE-2026-1234' }] } })

    // the long poll answers when a step changed, then when the run ended
    const first = await c.callTool({ name: 'kindo_wait_run', arguments: { runId: 'r1' } })
    expect(first.structuredContent.run.status).toBe('in_progress')
    expect(first.structuredContent.steps[0].result).toBe('pass')
    const last = await c.callTool({ name: 'kindo_wait_run', arguments: { runId: 'r1', seen: first.structuredContent.seen } })
    expect(last.structuredContent.run.status).toBe('success')
    expect(last.structuredContent.text).toBe('**Not affected**: we pin 2.4.1.')

    const read = await c.callTool({ name: 'get_agent_run', arguments: {} })
    expect(read.content[0].text).toMatch(/^The Security triage agent's run \(r1\) succeeded\.\n\nResult:\n\*\*Not affected\*\*/)
  })

  it('says what is missing without a key', async () => {
    const c = await connect(kindoClient({ key: null }))
    const result = await c.callTool({ name: 'list_kindo_agents', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/No Kindo API key/)
  })
})

describe('resultText', () => {
  it('reads the final message out of the JSON string', () => {
    expect(resultText(JSON.stringify({ role: 'assistant', parts: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }))).toBe('a\n\nb')
    expect(resultText(null)).toBe('')
    expect(resultText('not json')).toBe('not json')
  })
})
