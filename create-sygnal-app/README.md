# create-sygnal-app

Scaffold a new [Sygnal](https://sygnal.js.org) project.

```bash
npm create sygnal-app@latest my-app
```

With no options it asks for a template, a language and whether to install dependencies. To skip the prompts:

```bash
npx create-sygnal-app my-app --template vite --ts
```

## Options

| Option | Meaning |
|---|---|
| `-t, --template <name>` | `vite`, `vite-pwa`, `vike`, `astro` or `mcp-app` |
| `--ts`, `--typescript` / `--js`, `--javascript` | Language |
| `--install` / `--no-install` | Install dependencies (default: ask) |
| `-h, --help` | Show help |

## Templates

| Template | What you get |
|---|---|
| `vite` | Single-page app with Vite and HMR |
| `vite-pwa` | Single-page app with offline support and an install prompt |
| `vike` | File-based routing with SSR, layouts and data fetching |
| `astro` | Content-focused site with island hydration |
| `mcp-app` | An [MCP App](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp): an interactive view for an MCP tool, shown by hosts such as Claude, ChatGPT and VS Code. The view is a Sygnal app built as one HTML file (`makeMcpAppDriver()` from `sygnal/ai`); the project includes a minimal MCP server (`@modelcontextprotocol/sdk`). `npm start` builds and serves it; its README shows how to connect a host |

Every template comes in JavaScript and TypeScript and includes:

- `npm run dev`, `npm run build` and `npm test` (Vitest, with a starter test using `renderComponent`; `mcp-app` also has `npm start` and a test of its MCP server);
- [`sygnal-check`](https://www.npmjs.com/package/sygnal-check) as a dev dependency: `npx --no-install sygnal-check --strict` (use `pages` as the path in Vike projects);
- `AGENTS.md` and `CLAUDE.md`, which point AI coding agents to `node_modules/sygnal/llms.txt` and the project's commands.

## License

MIT
