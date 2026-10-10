// Proof-of-concept Sygnal language server: zero dependencies, LSP over stdio.
// Wraps sygnal-check: diagnostics (incl. unsaved buffers), hover explanations, "did you mean" quick fixes.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SC = process.env.SYGNAL_CHECK_SRC
const { checkFiles } = await import(SC + '/index.js')
const { expandInputs } = await import(SC + '/files.js')
const { getExplanation } = await import(SC + '/explain.js')

// Unsaved editor buffers: the checker reads files with fs.readFileSync, so serve overlays there.
const overlays = new Map() // abs path -> text
const realRead = fs.readFileSync
fs.readFileSync = function (p, ...rest) {
  const abs = typeof p === 'string' ? path.resolve(p) : null
  if (abs && overlays.has(abs)) return overlays.get(abs)
  return realRead.call(this, p, ...rest)
}

let root = process.cwd()
let published = new Set()
let latest = new Map() // uri -> lsp diagnostics
let timer = null

const send = (msg) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...msg })
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}
const log = (s) => process.stderr.write(s + '\n')

const SEV = { error: 1, warn: 2, info: 3 }
function tokenEnd(line, col0) {
  // range covers the string literal or identifier starting at the reported column
  const q = line[col0]
  if (q === "'" || q === '"' || q === '`') { const e = line.indexOf(q, col0 + 1); return e < 0 ? line.length : e + 1 }
  const m = /^[\w$.-]+/.exec(line.slice(col0)); return col0 + (m ? m[0].length : 1)
}
function toLsp(d, text) {
  const line = d.line - 1, col = (d.column || 1) - 1
  const src = (text.split('\n')[line] || '')
  return {
    range: { start: { line, character: col }, end: { line, character: tokenEnd(src, col) } },
    severity: SEV[d.severity] || 2, code: d.code, source: 'sygnal',
    codeDescription: { href: d.docsUrl },
    message: `${d.component ? d.component + ': ' : ''}${d.message}${d.fix ? ` (${d.fix})` : ''}`,
    data: { fix: d.fix },
  }
}

function runCheck() {
  const t0 = performance.now()
  const { files } = expandInputs(['src'], { cwd: root })
  for (const f of overlays.keys()) if (!files.includes(f)) files.push(f)
  const diags = checkFiles(files, { cwd: root, strict: true })
  const ms = performance.now() - t0
  const byUri = new Map()
  for (const d of diags) {
    const abs = path.resolve(root, d.file)
    const text = overlays.get(abs) ?? realRead(abs, 'utf8')
    const uri = pathToFileURL(abs).href
    if (!byUri.has(uri)) byUri.set(uri, [])
    byUri.get(uri).push(toLsp(d, text))
  }
  for (const uri of published) if (!byUri.has(uri)) send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } })
  for (const [uri, list] of byUri) send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: list } })
  published = new Set(byUri.keys()); latest = byUri
  log(`checked ${files.length} files in ${ms.toFixed(0)} ms: ${diags.length} diagnostics`)
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(runCheck, 150) }

const inRange = (r, p) => (p.line > r.start.line || (p.line === r.start.line && p.character >= r.start.character)) &&
  (p.line < r.end.line || (p.line === r.end.line && p.character <= r.end.character))

function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      if (params.rootUri) root = fileURLToPath(params.rootUri)
      return send({ id, result: { capabilities: { textDocumentSync: 1, hoverProvider: true, codeActionProvider: { codeActionKinds: ['quickfix'] } }, serverInfo: { name: 'sygnal-ls-poc' } } })
    case 'initialized': return runCheck()
    case 'textDocument/didOpen': overlays.set(fileURLToPath(params.textDocument.uri), params.textDocument.text); return schedule()
    case 'textDocument/didChange': overlays.set(fileURLToPath(params.textDocument.uri), params.contentChanges.at(-1).text); return schedule()
    case 'textDocument/didClose': overlays.delete(fileURLToPath(params.textDocument.uri)); return schedule()
    case 'textDocument/hover': {
      const d = (latest.get(params.textDocument.uri) || []).find(d => inRange(d.range, params.position))
      if (!d) return send({ id, result: null })
      const e = getExplanation(d.code)
      const value = `**${d.code}: ${e.title}**\n\n${e.explanation}\n\n**Fix:** ${e.fix}\n\n[Docs](${e.docsUrl})`
      return send({ id, result: { contents: { kind: 'markdown', value }, range: d.range } })
    }
    case 'textDocument/codeAction': {
      const actions = []
      for (const d of params.context.diagnostics || []) {
        const m = /did you mean '([^']+)'/.exec(d.data?.fix || d.message)
        if (!m || d.source !== 'sygnal') continue
        actions.push({ title: `Change to '${m[1]}'`, kind: 'quickfix', diagnostics: [d], isPreferred: true,
          edit: { changes: { [params.textDocument.uri]: [{ range: d.range, newText: `'${m[1]}'` }] } } })
      }
      return send({ id, result: actions })
    }
    case 'shutdown': return send({ id, result: null })
    case 'exit': return process.exit(0)
    default: if (id !== undefined) send({ id, error: { code: -32601, message: 'method not found' } })
  }
}

let buf = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n'); if (sep < 0) return
    const len = +/Content-Length: (\d+)/i.exec(buf.slice(0, sep).toString())[1]
    if (buf.length < sep + 4 + len) return
    const msg = JSON.parse(buf.slice(sep + 4, sep + 4 + len).toString()); buf = buf.slice(sep + 4 + len)
    try { handle(msg) } catch (e) { log(String(e.stack)); if (msg.id !== undefined) send({ id: msg.id, error: { code: -32603, message: e.message } }) }
  }
})
