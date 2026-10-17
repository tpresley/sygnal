#!/usr/bin/env node
import { main } from '../src/cli.js'

const argv = process.argv.slice(2)
if (argv[0] === 'mcp') {
  // MCP server on stdio (check, graph, explain); runs until stdin closes
  const { runMcpServer } = await import('../src/mcp.js')
  await runMcpServer()
} else if (argv[0] === 'lsp') {
  // language server on stdio (LSP framing); exits when stdin ends or on `exit`
  const { runLspServer } = await import('../src/lsp/server.js')
  process.exit(await runLspServer())
} else {
  // --graph=html --watch: a Promise, settled on Ctrl-C once the server and watchers are closed
  process.exitCode = await main(argv)
  if (argv.includes('--watch')) process.exit(process.exitCode)
}
