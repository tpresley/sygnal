// Throwaway VS Code client for the 0-S2 server. Starts ../server.mjs over stdio with vscode-languageclient.
const path = require('node:path')
const vscode = require('vscode')
const { LanguageClient, TransportKind } = require('vscode-languageclient/node')

let client
exports.activate = async function activate(context) {
  const server = path.join(__dirname, '..', 'server.mjs')
  const run = { command: process.env.NODE_BIN || 'node', args: [server], transport: TransportKind.stdio,
    options: { env: { ...process.env } } }
  client = new LanguageClient('sygnal', 'Sygnal (0-S2 probe)', { run, debug: run }, {
    documentSelector: ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].map(language => ({ scheme: 'file', language })),
    // No synchronize.fileEvents: we want to see whether the client honours the server's dynamic registration.
    initializationOptions: { strict: true, probe: 'initializationOptions arrived' },
  })
  await client.start()
  context.subscriptions.push(client)
  return { client }
}
exports.deactivate = () => client?.stop()
