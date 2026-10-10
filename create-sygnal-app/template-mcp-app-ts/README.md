# Sygnal MCP App

An [MCP App](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp): an MCP server whose `get_forecast` tool comes with an interactive view, written with [Sygnal](https://sygnal.js.org). Hosts that support MCP Apps (Claude, ChatGPT, VS Code, Goose, MCPJam, ...) show the view in the conversation when the model calls the tool.

```
src/App.tsx          the view (a Sygnal component)
src/main.ts          run(App, { MCP: makeMcpAppDriver() })
server/server.js     the MCP server: the tool and the ui:// resource that serves the view
server/forecast.js   made-up weather (replace it with a real API)
```

## Run it

```bash
npm install
npm start            # builds dist/index.html (one file), then serves MCP on http://localhost:3001/mcp
npm test             # the view and the server, no host needed
```

`node server/server.js --stdio` runs the same server over stdio. `PORT=4000 npm run serve` picks another port.

### Before Sygnal 6.1.0 is published

This project needs `sygnal` 6.1 (`makeMcpAppDriver` from `sygnal/ai`). Until 6.1.0 is on npm, `npm install` can't resolve `^6.1.0`; use a local build of a Sygnal checkout that has it (one where `src/extra/ai/mcpApp.ts` exists):

```bash
npm ci --prefix ../sygnal && npm run build --prefix ../sygnal
npm install ../sygnal          # a link to the checkout; or `npm pack` in it, then npm install ../sygnal/sygnal-<version>.tgz
```

`npm install <folder>` writes `"sygnal": "file:../sygnal"` into `package.json`; set it back to `"^6.1.0"` once the release is out.

## Try it in a host

Ask the model for a forecast ("What's the weather in Lisbon this week?") once the server is connected.

- **MCPJam Inspector** (no account needed): `npx @mcpjam/inspector@latest`, add the server as Streamable HTTP with the URL `http://localhost:3001/mcp`, then call `get_forecast` from the Tools tab or the chat.
- **The ext-apps basic host**: the reference host in [modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps) (`examples/basic-host`); its README shows how to point it at `http://localhost:3001/mcp`.
- **Claude Desktop**: add the server to `claude_desktop_config.json` over stdio (`npm run build` first):
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
| `{ updateModelContext: { ... } }` | tell the model what the user did (read on its next turn) |
| `{ message: 'text' }` | send a message to the conversation as the user |
| `{ openLink: 'https://...' }` | ask the host to open a link |
| `{ displayMode: 'fullscreen' }` | ask for another display mode (the `ok` action gets the mode the host chose) |

The host loads the view into a sandboxed iframe with no other files and no network access, so `vite.config.js` builds it as one HTML file (`vite-plugin-singlefile`) and the view gets its data through the tool's result and `callTool`. Rebuild after changing it.

`AGENTS.md` has the commands and rules for coding agents.
