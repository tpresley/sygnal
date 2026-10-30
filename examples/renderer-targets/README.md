# Groceries: one app, three renderer targets

One Sygnal component tree ([src/app.jsx](src/app.jsx)), with no platform code in it, running on:

| Target | Entry | Run |
|---|---|---|
| the browser (DOM driver) | [src/main.js](src/main.js) | `npm run dev` |
| a terminal (`sygnal/terminal`) | [src/terminal.jsx](src/terminal.jsx) | `npm run terminal` |
| an LLM agent over MCP (`sygnal/agent-ui`) | [src/mcp.jsx](src/mcp.jsx) | `npm run mcp` (or point an MCP client at `node dist-node/mcp.js` after `npm run build:node`) |

What makes it portable:

- **Intents select controls** (`DOM.change(Done)`, `processForm(DOM.select(AddForm))`), not CSS structure, so any target's layout can host them.
- **The views are plain HTML.** The terminal paints it as text. The agent UI reads it as an accessibility snapshot (roles, names, states, refs).
- **Platform styling is a stylesheet per target.** The browser uses [src/styles.css](src/styles.css); the terminal uses [src/styles.js](src/styles.js), a few selector rules.
- **Every target makes the same DOM events.** Typing in the terminal and an agent's `ui_type` call both produce `input` events, and the model never knows which target it's running on.

To use the MCP server from Claude Code:

```bash
npm run build:node
claude mcp add groceries -- node "$PWD/dist-node/mcp.js"
```

Tests ([src/app.test.js](src/app.test.js)) run the logic under `renderComponent`, then the same app in a terminal and under agent tool calls: `npm test`.

Guides: [Terminal apps](https://sygnal.js.org/renderers/terminal), [Agent UI](https://sygnal.js.org/renderers/agent-ui), [Writing a renderer target](https://sygnal.js.org/renderers/custom-targets).
