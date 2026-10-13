// An MCP server with one MCP App: run your Kindo agents from a conversation. `npm run build`
// first (it writes dist/index.html, the view), then:
//   node server/server.js            Streamable HTTP on http://localhost:3002/mcp
//   node server/server.js --stdio    stdio (Claude Desktop, VS Code, ...)
//
// Tools the model sees:
//   run_kindo_agent   shows the runner card (the view) for an agent, with the inputs the model
//                     filled in; the user reviews them and starts the run in the card
//   list_kindo_agents the user's agents
//   get_agent_run     a run's status and result: how the model learns what the run produced
// Tools only the view calls (`_meta.ui.visibility: ['app']`):
//   kindo_agent       one agent's details (its input labels)
//   kindo_start_run   trigger a run
//   kindo_wait_run    a long poll: the run once its status or a step changed (or after 20 s)
//   kindo_restart_run run it again with the same inputs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { kindoClient, resultText } from './kindo.js'

const VIEW_URI = 'ui://kindo-agents/runner.html'
const MCP_APP_MIME = 'text/html;profile=mcp-app'
const html = new URL('../dist/index.html', import.meta.url)
const VIEW = { ui: { resourceUri: VIEW_URI }, 'ui/resourceUri': VIEW_URI }
const APP_ONLY = { ui: { resourceUri: VIEW_URI, visibility: ['app'] } }

const brief = (a) => ({ agentId: a.agentId, name: a.name, description: a.description ?? '' })
const ok = (text, structuredContent) => ({ content: [{ type: 'text', text }], ...(structuredContent && { structuredContent }) })
const failure = (e) => ({ isError: true, content: [{ type: 'text', text: e.message }] })

/** an agent by id, or by name (exact, then a case-insensitive substring) */
function findAgent(agents, wanted) {
  if (!wanted) return null
  const w = wanted.toLowerCase()
  return agents.find((a) => a.agentId === wanted)
    ?? agents.find((a) => a.name?.toLowerCase() === w)
    ?? agents.find((a) => a.name?.toLowerCase().includes(w))
    ?? null
}

function runSummary(run, text, agentName) {
  const who = agentName ? `The ${agentName} agent's run` : 'The run'
  if (run.status === 'in_progress') return `${who} (${run.runId}) is still running.`
  if (run.status === 'success') return `${who} (${run.runId}) succeeded.${text ? `\n\nResult:\n${text}` : ' It produced no message.'}`
  return `${who} (${run.runId}) ended with status ${run.status}.`
}

/**
 * The runs started from the view, so the model can ask about "the run". Kept in the process: the
 * stdio server runs one per host connection; a shared HTTP server would key it by user or session.
 */
export const newRunStore = () => ({ runs: new Map(), last: null })
const processRuns = newRunStore()

export function createKindoAgentsServer({ kindo = kindoClient(), store = processRuns } = {}) {
  const server = new McpServer({ name: 'sygnal-kindo-agents', version: '0.1.0' })
  const { runs } = store

  server.registerTool('run_kindo_agent', {
    title: 'Run a Kindo agent',
    description: 'Shows the Kindo agent runner card for one of the user\'s Kindo agents (by name or id), with its inputs filled in from the conversation. '
      + 'The user reviews the inputs and starts the run in the card, then watches it run. Leave out `agent` to let the user pick one. '
      + 'Runs take from seconds to minutes: when the user asks about the outcome, call get_agent_run.',
    inputSchema: {
      agent: z.string().optional().describe('The agent\'s name or id, e.g. "Security triage"'),
      inputs: z.record(z.string(), z.string()).optional().describe('Values for the agent\'s inputs, by input label'),
    },
    _meta: VIEW,
  }, async ({ agent: wanted, inputs = {} }) => {
    try {
      const agents = (await kindo.listAgents()).map(brief)
      const found = findAgent(agents, wanted)
      const agent = found ? await kindo.getAgent(found.agentId) : null
      const text = agent
        ? `Showing the runner for the "${agent.name}" agent (inputs: ${(agent.inputs ?? []).join(', ') || 'none'}). The user starts the run in the card.`
        : wanted
          ? `No agent matches "${wanted}". The card lists the user's ${agents.length} agents to pick from.`
          : `The card lists the user's ${agents.length} agents to pick from.`
      return ok(text, { agents, agent: agent && { ...brief(agent), inputs: agent.inputs ?? [] }, inputs })
    } catch (e) {
      return failure(e)
    }
  })

  server.registerTool('list_kindo_agents', {
    title: 'List Kindo agents',
    description: 'The user\'s Kindo agents: id, name and description.',
    inputSchema: {},
  }, async () => {
    try {
      const agents = (await kindo.listAgents()).map(brief)
      return ok(agents.length ? agents.map((a) => `- ${a.name} (${a.agentId})${a.description ? `: ${a.description}` : ''}`).join('\n') : 'The user has no Kindo agents.', { agents })
    } catch (e) {
      return failure(e)
    }
  })

  server.registerTool('get_agent_run', {
    title: 'Get a Kindo agent run',
    description: 'The status and result of a Kindo agent run started from the runner card (run_kindo_agent). Without runId: the latest run.',
    inputSchema: { runId: z.string().optional() },
  }, async ({ runId = store.last }) => {
    if (!runId) return ok('No run has been started from the runner card yet.')
    try {
      const run = await kindo.getRun(runId)
      const text = resultText(run.result)
      return ok(runSummary(run, text, runs.get(runId)?.agentName), { run: { ...run, result: undefined }, text })
    } catch (e) {
      return failure(e)
    }
  })

  server.registerTool('kindo_agent', {
    title: 'Agent details',
    description: 'One Kindo agent with its input labels (for the runner card).',
    inputSchema: { agentId: z.string() },
    _meta: APP_ONLY,
  }, async ({ agentId }) => {
    try {
      const agent = await kindo.getAgent(agentId)
      return ok(`Agent ${agent.name}`, { agent: { ...brief(agent), inputs: agent.inputs ?? [] } })
    } catch (e) {
      return failure(e)
    }
  })

  server.registerTool('kindo_start_run', {
    title: 'Start a run',
    description: 'Triggers a run of a Kindo agent with the inputs from the runner card.',
    inputSchema: { agentId: z.string(), agentName: z.string().optional(), inputs: z.array(z.object({ name: z.string(), value: z.string() })) },
    _meta: APP_ONLY,
  }, async ({ agentId, agentName, inputs }) => {
    try {
      const { runId, conversationId } = await kindo.startRun(agentId, inputs)
      runs.set(runId, { agentId, agentName })
      store.last = runId
      return ok(`Started run ${runId}`, { runId, conversationId })
    } catch (e) {
      return failure(e)
    }
  })

  server.registerTool('kindo_wait_run', {
    title: 'Follow a run',
    description: 'The run, once its status or a step changed since `seen`, or after about 20 seconds.',
    inputSchema: { runId: z.string(), seen: z.string().optional() },
    _meta: APP_ONLY,
  }, async ({ runId, seen }) => {
    try {
      const { run, evals, text, snapshot } = await kindo.waitForRun(runId, { seen: seen ?? null })
      return ok(runSummary(run, text, runs.get(runId)?.agentName), {
        run: { ...run, result: undefined },
        steps: evals?.steps ?? [],
        verdict: evals?.result ?? null,
        text,
        seen: snapshot,
        now: new Date().toISOString(),
      })
    } catch (e) {
      return failure(e)
    }
  })

  server.registerTool('kindo_restart_run', {
    title: 'Run again',
    description: 'Runs a finished run again, with the same inputs and the agent\'s latest version.',
    inputSchema: { runId: z.string() },
    _meta: APP_ONLY,
  }, async ({ runId }) => {
    try {
      const { runId: next, conversationId } = await kindo.restartRun(runId)
      runs.set(next, runs.get(runId) ?? {})
      store.last = next
      return ok(`Started run ${next}`, { runId: next, conversationId })
    } catch (e) {
      return failure(e)
    }
  })

  server.registerResource('kindo-agents-view', VIEW_URI, { title: 'Kindo agent runner', mimeType: MCP_APP_MIME }, async () => {
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
    await createKindoAgentsServer().connect(new StdioServerTransport())
    return
  }
  const port = Number(process.env.PORT) || 3002
  createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    if (new URL(req.url, 'http://localhost').pathname !== '/mcp') return res.writeHead(404).end()
    const server = createKindoAgentsServer()
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
