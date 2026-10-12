# Sygnal MCP App (example)

An [MCP App](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp): an MCP server whose `get_forecast` tool comes with an interactive view, written with [Sygnal](https://sygnal.js.org). Hosts that support MCP Apps (Claude, ChatGPT, VS Code, Goose, MCPJam, ...) show the view in the conversation when the model calls the tool.

```
src/App.jsx          the view (a Sygnal component)
src/main.js          run(App, { MCP: makeMcpAppDriver() })
server/server.js     the MCP server: get_forecast, the ui:// resource that serves the view, and the
                     selection tools (select_day for the view, get_selected_day for the model)
server/forecast.js   made-up weather (replace it with a real API)
```

## Run it

```bash
npm install
npm start            # builds dist/index.html (one file), then serves MCP on http://localhost:3001/mcp
npm test             # the view and the server, no host needed
```

`node server/server.js --stdio` runs the same server over stdio. `PORT=4000 npm run serve` picks another port.

### The local Sygnal build

This example is scaffolded from `create-sygnal-app --template mcp-app` and linked to this checkout (`"sygnal": "file:../.."`), so it runs against the Sygnal in this repository: run `npm run build` at the repository root after changing Sygnal, then `npm run build` here.

## Try it in a host

Ask the model for a forecast once the server is connected. Name the tool ("Use get_forecast to show the weather in Lisbon this week"): hosts with their own weather feature (Claude has one) answer a plain weather question with it instead.

- **MCPJam Inspector** (no account needed): `npx @mcpjam/inspector@latest`, add the server as Streamable HTTP with the URL `http://localhost:3001/mcp`, then call `get_forecast` from the Tools tab or the chat.
- **The ext-apps basic host**: the reference host in [modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps) (`examples/basic-host`); its README shows how to point it at `http://localhost:3001/mcp`.
- **Claude Desktop** (macOS): run `bash scripts/add-to-claude-desktop.sh` from Terminal (`npm run build` first). Claude rewrites its config file while it runs, so the script quits Claude, adds the entry and reopens it. By hand, with Claude quit, add the server to `claude_desktop_config.json` over stdio:
  ```json
  { "mcpServers": { "forecast": { "command": "node", "args": ["/absolute/path/to/this/project/server/server.js", "--stdio"] } } }
  ```
  On claude.ai, add it as a custom connector; that needs the HTTP server at a public HTTPS URL (a tunnel such as `cloudflared tunnel --url http://localhost:3001`, then `https://<tunnel>/mcp`).
- **VS Code** (GitHub Copilot agent mode): add it to `.vscode/mcp.json`:
  ```json
  { "servers": { "forecast": { "type": "http", "url": "http://localhost:3001/mcp" } } }
  ```

## How the view talks to the host

`makeMcpAppDriver()` (from `sygnal/ai`) is the bridge: it does the `ui/initialize` handshake with the host and turns the protocol into a source and a sink.

| In the intent (host → view) | |
|---|---|
| `MCP.select('tool-input')` | the arguments the model called the tool with (`'tool-input-partial'`: while it writes them) |
| `MCP.select('tool-result')` | the tool's result: `{ content, structuredContent, isError? }` |
| `MCP.select('tool-cancelled')` | the call was cancelled |
| `MCP.select('host-context-changed')` | theme, display mode, locale, container size, ... |
| `MCP.select('teardown')` | the host is about to remove the view |

| In the model (view → host) | |
|---|---|
| `{ callTool: 'get_forecast', args, ok: 'RESULT', error: 'FAILED' }` | call a tool on this server; the result comes back as the `ok` action |
| `{ updateModelContext: { content, structuredContent } }` | tell the model what the user did, for its next turn, if the host passes it on (Claude Desktop doesn't, as of October 2026) |
| `{ message: 'text' }` | send a message to the conversation as the user |
| `{ openLink: 'https://...' }` | ask the host to open a link |
| `{ displayMode: 'fullscreen' }` | ask for another display mode (the `ok` action gets the mode the host chose) |

**How the model learns what the user picked.** Hosts differ in what they do with `updateModelContext`: some add it to the model's next turn, Claude Desktop doesn't (as of October 2026). So the view also stores the selection on the server with `select_day`, a tool only the view can call (`_meta.ui.visibility: ['app']`), and the model reads it with `get_selected_day`, an ordinary tool every host offers. For a click that is a question, the view posts a `{ message }` instead (**Ask about this day**).

The host loads the view into a sandboxed iframe with no other files and no network access, so `vite.config.js` builds it as one HTML file (`vite-plugin-singlefile`) and the view gets its data through the tool's result and `callTool`. Rebuild after changing it, then reconnect the server in the host: a host may keep the view for as long as the server is connected (Claude Desktop does).

`AGENTS.md` has the commands and rules for coding agents.
