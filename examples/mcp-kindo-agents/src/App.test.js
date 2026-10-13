import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

// The view without a host: the MCP events are actions, t.requests('MCP') lists what the view
// sent, and t.respond('MCP', result, action) answers a { callTool }.
let t
afterEach(() => t?.dispose())

const agent = { agentId: 'a1', name: 'Security triage', description: 'Triage a CVE', inputs: ['CVE id', 'Repository'] }
const agents = [{ agentId: 'a1', name: 'Security triage', description: 'Triage a CVE' }, { agentId: 'a2', name: 'Release notes', description: '' }]
const toolResult = (structuredContent, text = '') => ({ content: [{ type: 'text', text }], structuredContent })
const run = (status, extra = {}) => ({ runId: 'r1', status, createdAtUtc: '2026-10-12T10:00:00Z', endedAtUtc: status === 'in_progress' ? null : '2026-10-12T10:01:05Z', ...extra })

async function shown() {
  t = renderComponent(App, { strict: true })
  t.simulateAction('INPUT', { agent: 'security', inputs: { 'CVE id': 'CVE-2026-1234' } })
  t.simulateAction('RESULT', toolResult({ agents, agent, inputs: { 'CVE id': 'CVE-2026-1234' } }))
  await t.waitForState((s) => s.status === 'ready')
  return t
}

describe('the runner card', () => {
  it('shows the agent with the inputs the model filled in', async () => {
    await shown()
    expect(t.state.values).toEqual({ 'CVE id': 'CVE-2026-1234', Repository: '' })
    expect(t.html()).toContain('Inputs filled in by the model')
    t.expectNoDiagnostics()
  })

  it('starts the run, follows it with the long poll, and tells the model when it ends', async () => {
    await shown()
    t.simulateEvent('.value', 'input', { value: 'acme/api', dataset: { name: 'Repository' } })
    t.simulateEvent('.run-form', 'submit')
    await t.waitForState((s) => s.phase === 'starting')
    expect(t.requests('MCP').at(-1)).toMatchObject({
      callTool: 'kindo_start_run',
      args: { agentId: 'a1', inputs: [{ name: 'CVE id', value: 'CVE-2026-1234' }, { name: 'Repository', value: 'acme/api' }] },
    })
    await t.respond('MCP', toolResult({ runId: 'r1' }), 'STARTED')
    expect(t.requests('MCP').at(-1)).toMatchObject({ callTool: 'kindo_wait_run', args: { runId: 'r1' }, ok: 'PROGRESS' })

    await t.respond('MCP', toolResult({ run: run('in_progress'), steps: [{ stepNumber: 1, name: 'Find the CVE', result: 'pass' }], text: '', seen: 's1', now: '2026-10-12T10:00:20Z' }), 'PROGRESS')
    expect(t.html()).toContain('Find the CVE')
    expect(t.html()).toContain('0:20')
    // in progress: wait again, from what it saw
    expect(t.requests('MCP').at(-1)).toMatchObject({ callTool: 'kindo_wait_run', args: { runId: 'r1', seen: 's1' } })

    await t.respond('MCP', toolResult({ run: run('success'), steps: [], text: '## Verdict\n- **Not affected**', seen: 's2', now: '2026-10-12T10:01:06Z' }, 'The run succeeded.'), 'PROGRESS')
    expect(t.state.phase).toBe('done')
    expect(t.html()).toContain('<strong>Not affected</strong>')
    expect(t.html()).toContain('1:05')
    expect(t.requests('MCP').at(-1)).toMatchObject({ updateModelContext: { structuredContent: { runId: 'r1', status: 'success' } } })

    t.simulateEvent('.discuss', 'click')
    await t.settle()
    expect(t.requests('MCP').at(-1).message).toMatch(/Security triage agent run/)
    t.expectNoDiagnostics()
  })

  it('reads another agent\'s inputs when the user picks it', async () => {
    await shown()
    t.simulateEvent('.agent-pick', 'change', { value: 'a2' })
    await t.waitForState((s) => s.agentId === 'a2')
    expect(t.requests('MCP').at(-1)).toMatchObject({ callTool: 'kindo_agent', args: { agentId: 'a2' }, ok: 'AGENT' })
    await t.respond('MCP', toolResult({ agent: { agentId: 'a2', name: 'Release notes', description: '', inputs: ['Since tag'] } }), 'AGENT')
    expect(t.state.values).toEqual({ 'Since tag': '' })
  })

  it('filters a long agent list by search', async () => {
    t = renderComponent(App, { strict: true })
    const many = Array.from({ length: 20 }, (_, i) => ({ agentId: `id${i}`, name: i === 7 ? 'Phishing triage' : `Agent ${i}`, description: '' }))
    t.simulateAction('RESULT', toolResult({ agents: many, agent: null, inputs: {} }))
    await t.waitForState((s) => s.status === 'ready')
    t.simulateEvent('.agent-search', 'input', { value: 'phish' })
    await t.waitForState((s) => s.search === 'phish')
    expect(t.html()).toContain('Phishing triage')
    expect(t.html()).not.toContain('Agent 3<')
  })

  it('shows a server error', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateAction('RESULT', { isError: true, content: [{ type: 'text', text: 'No Kindo API key' }] })
    await t.waitForState((s) => s.status === 'ready')
    expect(t.html()).toContain('No Kindo API key')
  })
})
