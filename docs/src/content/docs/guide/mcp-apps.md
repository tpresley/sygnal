---
title: MCP Apps
description: A Sygnal app inside Claude, ChatGPT or VS Code — makeMcpAppDriver, the mcp-app starter, the view's own agent tools, and how to try it in a host
---

An [MCP App](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) is an MCP server tool that comes with an interactive view. When the model calls the tool, a host that supports MCP Apps (Claude, ChatGPT, VS Code, Goose, MCPJam, ...) shows the view in the conversation, in a sandboxed iframe. The view and the host talk JSON-RPC over `postMessage`: the host sends the tool's input and result, and the view can call the server's tools, tell the model what the user did, or post a message.

In Sygnal that bridge is a driver. The view is an ordinary component.

## The view

```jsx
// App.jsx: the view of the get_forecast tool
function App({ state }) {
  return (
    <main>
      <h1>{state.city ? `Forecast for ${state.city}` : 'Forecast'}</h1>
      <p role="status">{state.status === 'loading' ? 'Loading…' : ''}</p>
      <ul className="days">
        {state.days.map((day) => (
          <li key={day.date}>
            <button type="button" className="day" data={{ date: day.date }} aria-pressed={day.date === state.selected}>
              {day.date}: {day.sky}, {day.high}° / {day.low}°
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="refresh" disabled={!state.city}>Refresh</button>
      <button type="button" className="ask" disabled={!state.selected}>Ask about this day</button>
    </main>
  )
}

App.initialState = { city: '', days: [], selected: null, status: 'waiting' }

App.intent = ({ DOM, MCP }) => ({
  INPUT: MCP.select('tool-input'),     // the arguments the model called the tool with
  RESULT: MCP.select('tool-result'),   // the server tool's result
  REFRESH: DOM.click('.refresh'),
  PICK: DOM.click('.day').data('date'),
  ASK: DOM.click('.ask'),
})

App.model = {
  INPUT: (state, args) => ({ ...state, city: args.city ?? state.city, status: 'loading' }),
  RESULT: (state, result) => ({ ...state, status: 'ready', days: result.structuredContent?.days ?? [], selected: null }),
  // call the server's tool again from the view; the result comes back as RESULT
  REFRESH: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    MCP: (state) => ({ callTool: 'get_forecast', args: { city: state.city }, ok: 'RESULT' }),
  },
  // tell the model what the user picked: it reads it on its next turn
  PICK: {
    STATE: (state, date) => ({ ...state, selected: date }),
    MCP: (state, date) => ({ updateModelContext: { city: state.city, selectedDay: state.days.find((d) => d.date === date) } }),
  },
  // post a message to the conversation, as the user
  ASK: { MCP: (state) => ({ message: `What should I pack for ${state.city} on ${state.selected}?` }) },
}

export default App
```

```js
// main.js
import { run } from 'sygnal'
import { makeMcpAppDriver } from 'sygnal/ai'
import App from './App.jsx'

run(App, { MCP: makeMcpAppDriver({ appInfo: { name: 'forecast', version: '1.0.0' } }) })
```

The driver does the `ui/initialize` handshake with the host when the app starts. Requests made before it completes wait for it; with no host (the page opened directly, or server rendering) every request gets its `error` action.

## The driver

**Sources**, in the intent:

| `MCP.select(...)` | Delivers |
|---|---|
| `'tool-input'` | The arguments the model called the tool with |
| `'tool-input-partial'` | The same, while the model is still writing them (to show something early) |
| `'tool-result'` | The tool's result, an MCP `CallToolResult`: `{ content, structuredContent?, isError? }` |
| `'tool-cancelled'` | The call was cancelled: `{ reason? }` |
| `'host-context-changed'` | The host context: `theme`, `displayMode`, `availableDisplayModes`, `locale`, `timeZone`, `containerDimensions`, `styles`, ... First the handshake's, then after every change (merged) |
| `'teardown'` | The host is about to remove the view; it waits for the actions this causes |

The latest tool input, tool result and host context are replayed to a component that subscribes later, so a component that appears after they arrived still gets them.

**Sinks**, in the model. Reply actions (`ok`, `error`) go back to the component that sent the request, as with the [fetch driver](/guide/http/):

| Value | Does |
|---|---|
| `{ callTool: 'name', args, ok, error }` | Calls a tool on the MCP server through the host. `ok` gets the `CallToolResult`; `error` gets `{ error, code?, result?, request }` (a JSON-RPC error, or a result with `isError: true`) |
| `{ updateModelContext: value }` | Tells the model something, for its next turn: a string (one text block), content blocks, or an object (`structuredContent`) |
| `{ message: 'text' }` | Posts a message to the conversation as the user (a string or content blocks) |
| `{ openLink: 'https://…' }` | Asks the host to open a link |
| `{ displayMode: 'fullscreen' }` | Asks for `'inline'`, `'fullscreen'` or `'pip'`; `ok` gets `{ mode }`, the mode the host chose |

`makeMcpAppDriver(options)`:

| Option | Default | |
|---|---|---|
| `appInfo` | `{ name: document.title, version: '0.0.0' }` | The view's name and version in the handshake |
| `availableDisplayModes` | | The display modes the view supports |
| `autoResize` | `true` | Reports the document's size to the host when it changes, so the iframe fits the content |
| `tools` | | `agentTools`: offer the view's `agent` tools to the host ([below](#the-views-own-tools)) |
| `confirm` | declined | With `tools`: consequential calls run when this resolves `true` |
| `protocolVersion` | `'2026-01-26'` | The MCP Apps protocol version offered |

**Theme and size.** Follow `host-context-changed` for the host's `theme` (and its `styles.variables`, CSS custom properties the host suggests), so the view matches the conversation around it. Keep the view compact for `inline` mode; offer full screen with `{ displayMode: 'fullscreen' }` when `availableDisplayModes` includes it.

## The view's own tools

The model sees the server's tools. With `tools: agentTools`, the view also offers its components' [`agent` declarations](/guide/agent/) to the host as tools of its own, so the model can operate the view while it is shown: select a day, change units, open a detail. Calls go through the same [call rules](/guide/agent/#the-call-rules) as any agent's.

```js
// main.js
import { run } from 'sygnal'
import { makeMcpAppDriver, agentTools } from 'sygnal/ai'
import App from './App.jsx'

run(App, { MCP: makeMcpAppDriver({ tools: agentTools }) })
```

```jsx
// App.jsx: what the model may do in the view
import { z } from 'zod'

App.model = {
  // ...the entries above, plus:
  SELECT_DAY: (state, date) => ({ ...state, selected: date }),
}

App.agent = {
  name: 'forecast',
  description: 'The forecast card on screen',
  read: (state) => ({ city: state.city, days: state.days, selected: state.selected }),
  actions: {
    SELECT_DAY: { description: 'Highlight one day of the forecast', input: z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) },
  },
}
```

The driver answers the host's `tools/list` and `tools/call` with them and tells the host when the list changes (a `when`, a new Collection key). `agentTools` is passed in rather than switched on, so a view without tools doesn't carry the agent layer.

A consequential tool is declined unless you pass `confirm`, a function that asks the user in the view and resolves `true` to run the call. The host's own approval UI covers the server's tools, not the view's.

## The starter: `create-sygnal-app --template mcp-app`

```bash
npm create sygnal-app@latest my-tool -- --template mcp-app
```

(`--ts` for TypeScript.) The starter needs Sygnal 6.1 or later, so it installs once 6.1.0 is published.

```text
src/App.jsx          the view (the forecast card above, with theme and full screen)
src/main.js          run(App, { MCP: makeMcpAppDriver() })
server/server.js     the MCP server: the get_forecast tool and the ui:// resource that serves the view
server/forecast.js   made-up weather (replace it with a real API)
```

The host loads the view into a sandboxed iframe with no other files and no network access, so the view is built as **one HTML file** (`vite-plugin-singlefile`) and gets its data only through the tool's result and `callTool`. The server registers the tool with `_meta: { ui: { resourceUri: 'ui://forecast/view.html' } }` and serves that file as a resource of type `text/html;profile=mcp-app`.

| Command | |
|---|---|
| `npm start` | Build `dist/index.html`, then serve MCP on `http://localhost:3001/mcp` (Streamable HTTP) |
| `node server/server.js --stdio` | The same server over stdio |
| `npm test` | The view (with `renderComponent`) and the server, no host needed |

## Trying it in a host

Connect the server, then ask the model for a forecast ("What's the weather in Lisbon this week?"):

- **MCPJam Inspector**, no account needed: `npx @mcpjam/inspector@latest`, add the server as Streamable HTTP at `http://localhost:3001/mcp`, then call `get_forecast` from the Tools tab or the chat.
- **The ext-apps basic host**, the reference host in [modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps) (`examples/basic-host`).
- **Claude Desktop**: add the server over stdio to `claude_desktop_config.json` (`npm run build` first):

  ```json
  { "mcpServers": { "forecast": { "command": "node", "args": ["/absolute/path/to/my-tool/server/server.js", "--stdio"] } } }
  ```

  On claude.ai, add it as a custom connector; that needs the HTTP server at a public HTTPS URL (a tunnel to port 3001).
- **VS Code** (Copilot agent mode), in `.vscode/mcp.json`:

  ```json
  { "servers": { "forecast": { "type": "http", "url": "http://localhost:3001/mcp" } } }
  ```

Rebuild (`npm run build`) after changing the view; the server reads `dist/index.html` on each request.

## Testing

`renderComponent` runs the view with no host. The `MCP` source's events are actions you simulate, and the `MCP` sink is a fake: `t.requests('MCP')` lists what the view sent, and `t.respond('MCP', result, 'RESULT')` answers a `callTool`.

```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

let t
afterEach(() => t?.dispose())

const days = [{ date: 'Mon', sky: 'Sunny', high: 21, low: 14 }, { date: 'Tue', sky: 'Showers', high: 17, low: 12 }]

it('shows the result, refreshes, and tells the model what the user picked', async () => {
  t = renderComponent(App)
  t.simulateAction('INPUT', { city: 'Oslo' })
  t.simulateAction('RESULT', { content: [], structuredContent: { city: 'Oslo', days } })
  await t.waitForState((s) => s.status === 'ready')

  t.simulateEvent('.refresh', 'click')
  expect(t.requests('MCP').at(-1)).toMatchObject({ callTool: 'get_forecast', args: { city: 'Oslo' }, ok: 'RESULT' })
  await t.respond('MCP', { content: [], structuredContent: { city: 'Oslo', days: days.slice(1) } }, 'RESULT')
  expect(t.state.days).toEqual(days.slice(1))

  t.simulateEvent('.day', 'click', { data: { date: 'Tue' } })
  await t.waitForState((s) => s.selected === 'Tue')
  expect(t.requests('MCP').at(-1)).toEqual({ updateModelContext: { city: 'Oslo', selectedDay: days[1] } })
})
```

The starter's tests also run the server with the MCP SDK's in-memory client.

## Not covered yet

The driver wraps the parts of the protocol most views need. Not wrapped yet: `ui/download-file`, a view asking to be closed (`request-teardown`), reading server resources from the view, logging and sampling.
