// Helpers for the language server tests (test/lsp*.vtest.js): an in-memory LSP client on
// createLspServer() over PassThrough streams, and temp-dir fixtures. Not a test file itself.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createLspServer } from '../src/index.js'
import { createReader, createWriter } from '../src/lsp/protocol.js'
import { applyEdits, lineStarts } from '../src/edits.js'

export const here = path.dirname(fileURLToPath(import.meta.url))
export const pkgRoot = path.resolve(here, '..')
export const repo = path.resolve(pkgRoot, '..')
export const pocFixture = path.join(repo, 'dev-plans/research/ide-tooling-poc/fixture')

export const uriOf = (abs) => pathToFileURL(abs).href
export const tick = () => new Promise(r => setImmediate(r))

/** A temp copy of a directory (plus a package.json so config discovery stops there). */
export function copyFixture(src, { packageJson = { name: 'fixture', private: true } } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-lsp-')))
  fs.cpSync(src, dir, { recursive: true })
  if (packageJson && !fs.existsSync(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson))
  return dir
}

export function tempDir(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-lsp-')))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

/** Apply LSP TextEdits (0-based) to a text. */
export function applyTextEdits(text, edits) {
  const starts = lineStarts(text)
  const off = (p) => (starts[p.line] ?? text.length) + p.character
  return applyEdits(text, edits.map(e => ({ start: off(e.range.start), end: off(e.range.end), text: e.newText })))
}

/**
 * Start a server with an in-memory client.
 *   opts.server       createLspServer options (default: in-thread checks, 10 ms debounce)
 *   opts.onRequest    (method, params) → result for the server's requests (workspace/configuration ...)
 */
export function startServer({ server: serverOpts = {}, onRequest } = {}) {
  const toServer = new PassThrough()
  const fromServer = new PassThrough()
  const server = createLspServer({ input: toServer, output: fromServer, worker: false, debounce: 10, ...serverOpts })
  const write = createWriter(toServer)
  const messages = []
  const publishes = []
  const diagnostics = new Map() // uri → last list
  const serverRequests = []
  const pending = new Map()
  let nextId = 1
  const waiters = []
  const check = () => { for (const w of [...waiters]) if (w.pred()) { waiters.splice(waiters.indexOf(w), 1); w.resolve() } }

  createReader(fromServer, {
    onMessage(msg) {
      messages.push(msg)
      if (msg.method && 'id' in msg) {
        serverRequests.push(msg)
        let result = null
        if (onRequest) result = onRequest(msg.method, msg.params)
        else if (msg.method === 'workspace/configuration') result = msg.params.items.map(() => null)
        Promise.resolve(result).then(r => write({ id: msg.id, result: r ?? null }))
      } else if (msg.method === 'textDocument/publishDiagnostics') {
        publishes.push(msg.params)
        diagnostics.set(msg.params.uri, msg.params.diagnostics)
      } else if ('id' in msg && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
      check()
    },
  })

  const client = {
    server,
    messages,
    publishes,
    diagnostics,
    serverRequests,
    write,
    /** End the server's stdin (the client went away). */
    endInput() { toServer.end() },
    /** Send a request; resolves with the whole response message ({ result } or { error }). */
    send(method, params, id = nextId++) {
      return new Promise(resolve => { pending.set(id, resolve); write({ id, method, params }) })
    },
    async request(method, params) {
      const r = await client.send(method, params)
      if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code })
      return r.result
    },
    notify(method, params) { write({ method, params }) },
    waitFor(pred, timeout = 10000) {
      if (pred()) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const w = { pred, resolve }
        waiters.push(w)
        setTimeout(() => { if (waiters.includes(w)) { waiters.splice(waiters.indexOf(w), 1); reject(new Error('waitFor timed out')) } }, timeout).unref()
      })
    },
    /** Wait until the server has no check running or pending, and its output is read. */
    async settle() {
      for (let i = 0; i < 3; i++) { await server.idle(); await tick(); await tick() }
    },
    async initialize(params = {}) {
      // advertise what VS Code does for diagnostics (G-663 strips unadvertised fields); a test's
      // own textDocument capabilities are merged over it
      const caps = params.capabilities || {}
      const capabilities = { ...caps, textDocument: { publishDiagnostics: { relatedInformation: true, codeDescriptionSupport: true }, ...caps.textDocument } }
      const result = await client.request('initialize', { processId: null, ...params, capabilities })
      client.notify('initialized', {})
      await client.settle()
      return result
    },
    open(abs, text = fs.readFileSync(abs, 'utf8'), version = 1) {
      const languageId = /\.tsx?$/.test(abs) ? 'typescriptreact' : 'javascriptreact'
      client.notify('textDocument/didOpen', { textDocument: { uri: uriOf(abs), languageId, version, text } })
    },
    change(abs, text, version = 2) {
      client.notify('textDocument/didChange', { textDocument: { uri: uriOf(abs), version }, contentChanges: [{ text }] })
    },
    save(abs) { client.notify('textDocument/didSave', { textDocument: { uri: uriOf(abs) } }) },
    close(abs) { client.notify('textDocument/didClose', { textDocument: { uri: uriOf(abs) } }) },
    diags(abs) { return diagnostics.get(uriOf(abs)) || [] },
    async shutdown() {
      await client.request('shutdown')
      client.notify('exit')
      return server.done
    },
  }
  return client
}

/** `line:col-line:col code` of an LSP diagnostic (1-based, as editors show them). */
export const where = (d) => `${d.range.start.line + 1}:${d.range.start.character + 1}-${d.range.end.line + 1}:${d.range.end.character + 1} ${d.code}`
