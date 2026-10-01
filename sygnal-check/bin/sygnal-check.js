#!/usr/bin/env node
import { main } from '../src/cli.js'

const argv = process.argv.slice(2)
if (argv[0] === 'mcp') {
  // MCP server on stdio (check, graph, explain); runs until stdin closes
  const { runMcpServer } = await import('../src/mcp.js')
  await runMcpServer()
} else {
  process.exitCode = main(argv)
}
