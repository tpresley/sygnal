#!/usr/bin/env node
import module from 'node:module'

// Node >= 22.1: keep the compiled modules in Node's cache (the OS temp dir) between runs, about
// 10% off a small project's check (native-tooling round 2). Off with NODE_DISABLE_COMPILE_CACHE=1.
try { module.enableCompileCache?.() } catch { /* an unwritable cache dir: start without it */ }

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
  const { main } = await import('../src/cli.js')
  process.exitCode = await main(argv)
  if (argv.includes('--watch')) process.exit(process.exitCode)
}
