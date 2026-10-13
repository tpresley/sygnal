# Kindo agents in Claude (Sygnal MCP App example)

An [MCP App](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)
that runs your [Kindo](https://kindo.ai) agents from a conversation. Ask Claude (or another host
that shows MCP Apps) to run one: the model calls `run_kindo_agent` with the inputs it gathered
from the chat, and the host shows the **runner card**, written with [Sygnal](https://sygnal.js.org):

- pick the agent, review the inputs the model filled in, and press **Run agent**;
- watch the run: status, a live elapsed time, and the agent's step evaluations as they pass;
- read the result (Markdown) in the card, then **Discuss with Claude**, **Run again** or start over.

```
src/App.jsx          the view (a Sygnal component): the card, the run, the result
src/markdown.jsx     just enough Markdown for an agent's answer
src/main.js          run(App, { MCP: makeMcpAppDriver(), TIMER: makeTimerDriver() })
server/server.js     the MCP server: the tools and the ui:// resource that serves the view
server/kindo.js      a small client for Kindo's Agents API (list, read, run, poll, evals, restart)
```

## The API key

The view never sees the key: the MCP server calls Kindo. It reads `KINDO_API_KEY` from the
environment, or from a file outside the repository (the same file the AI showcase's dev server
reads):

```bash
mkdir -p ~/.config/kindo && echo 'KINDO_API_KEY=...' > ~/.config/kindo/env && chmod 600 ~/.config/kindo/env
```

`KINDO_ENV_FILE=/path/to/env` names another file.

## Run it

```bash
npm install
npm start            # builds dist/index.html (one file), then serves MCP on http://localhost:3002/mcp
npm test             # the view and the server against a fake Kindo, no host and no key needed
```

`node server/server.js --stdio` runs the same server over stdio.

### In Claude Desktop (macOS)

Run `npm run build`, then from macOS Terminal (not a terminal inside Claude, which quits with it):

```bash
bash scripts/add-to-claude-desktop.sh
```

Claude Desktop rewrites its config file while it runs, so the script quits Claude, adds the
`sygnal-kindo-agents` server (stdio) and opens Claude again. Then ask, for example:

> Use run_kindo_agent to run my security triage agent on CVE-2026-1234 for the acme/api repo.

After rebuilding the view, restart Claude (or toggle the server off and on): it keeps a server's
view for as long as the server is connected.

## How it works

**Tools.** The model sees three: `run_kindo_agent` (shows the card; `_meta.ui.resourceUri` names the
view), `list_kindo_agents`, and `get_agent_run` (a run's status and result). The view uses four
more that the model never sees (`_meta.ui.visibility: ['app']`): `kindo_agent` (an agent's input
labels), `kindo_start_run`, `kindo_wait_run` and `kindo_restart_run`.

**Following a run without timers in the view.** Kindo's runs are asynchronous: a trigger answers at
once with a `runId`, and the run is polled until it leaves `in_progress`. The server does the
polling: `kindo_wait_run` is a long poll that answers when the run's status or one of its steps
changed, or after about 20 seconds. The view asks again on every answer while the run is in
progress, so it is just a reply action that sends the next request:

```jsx
PROGRESS: {
  STATE: (state, result) => ({ ...state, ...fromRun(result) }),
  MCP: (state, result) => (result.structuredContent.run.status === 'in_progress'
    ? { callTool: 'kindo_wait_run', args: { runId, seen }, ok: 'PROGRESS' }
    : { updateModelContext: { content: … } }),
}
```

The elapsed time ticks with a `timers` static, only while a run is in progress.

**How the model learns the result.** When the run ends, the view sends `updateModelContext` (hosts
that pass it on add it to the model's next turn), and the server keeps the run, so `get_agent_run`
answers in every host (Claude Desktop's chat doesn't pass model context on, as of October 2026).
**Discuss with Claude** posts a message as the user, and the model reads the result with
`get_agent_run`.

**The view is one file.** The host loads it into a sandboxed iframe with no network access, so
`vite.config.js` inlines everything into `dist/index.html`, and all data comes through `callTool`.
