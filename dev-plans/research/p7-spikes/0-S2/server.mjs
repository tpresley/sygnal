// 0-S2: the PoC server (../../ide-tooling-poc/server.mjs) extended to probe real clients.
// Additions over the PoC: logs every LSP message (both directions) as JSON lines to $SYGNAL_LSP_LOG;
// pull diagnostics (textDocument/diagnostic) next to push; multi-root (one check per workspace folder);
// dynamic registration of workspace/didChangeWatchedFiles; workspace/configuration requests;
// initializationOptions; source.fixAll.sygnal; $/cancelRequest bookkeeping.
// Env:
//   SYGNAL_CHECK_SRC   path to sygnal-check/src (required)
//   SYGNAL_LSP_LOG     JSON-lines log file (default: none)
//   SYGNAL_LSP_DIAG    push | pull | both (default both): which diagnostic models to offer
//   SYGNAL_LSP_PULL_DELAY  ms to wait before answering a pull (to provoke $/cancelRequest)
//   SYGNAL_LSP_DEBOUNCE   ms between a change and the re-check (default 150)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SC = process.env.SYGNAL_CHECK_SRC
const { checkFiles } = await import(SC + '/index.js')
const { expandInputs } = await import(SC + '/files.js')
const { getExplanation } = await import(SC + '/explain.js')

const LOG = process.env.SYGNAL_LSP_LOG
const MODE = process.env.SYGNAL_LSP_DIAG || 'both'
const PULL_DELAY = +(process.env.SYGNAL_LSP_PULL_DELAY || 0)
const DEBOUNCE = +(process.env.SYGNAL_LSP_DEBOUNCE ?? 150)
const t0 = Date.now()
const logLine = (o) => { if (LOG) fs.appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + '\n') }
logLine({ event: 'start', pid: process.pid, argv: process.argv, cwd: process.cwd(), mode: MODE,
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(SYGNAL_|ENABLE_LSP|CLAUDE_PLUGIN_|CLAUDE_PROJECT_DIR$|CLAUDE_CODE_ENTRYPOINT$|CLAUDE_CODE_SIMPLE$|ELECTRON_RUN_AS_NODE$)/.test(k))) })

const overlays = new Map() // abs path -> text (unsaved editor buffers)
const realRead = fs.readFileSync
fs.readFileSync = function (p, ...rest) {
  const abs = typeof p === 'string' ? path.resolve(p) : null
  if (abs && overlays.has(abs)) return overlays.get(abs)
  return realRead.call(this, p, ...rest)
}

let folders = [] // abs paths
let clientCaps = {}
let initOptions = null
let settings = {} // folder -> settings from workspace/configuration
let published = new Set()
let latest = new Map() // uri -> diagnostics
let dirty = true
let timer = null
let nextId = 1
const pendingOut = new Map() // our requests to the client
const pendingIn = new Map() // client requests not yet answered (id -> {method, cancelled})

const send = (msg) => {
  const full = { jsonrpc: '2.0', ...msg }
  logLine({ dir: 'out', msg: full })
  const body = JSON.stringify(full)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}
const reply = (id, result) => { pendingIn.delete(id); send({ id, result }) }
const request = (method, params) => new Promise((resolve) => { const id = `s${nextId++}`; pendingOut.set(id, resolve); send({ id, method, params }) })
const log = (s) => { process.stderr.write(s + '\n'); logLine({ event: 'stderr', text: s }) }

const SEV = { error: 1, warn: 2, info: 3 }
function tokenEnd(line, col0) {
  const q = line[col0]
  if (q === "'" || q === '"' || q === '`') { const e = line.indexOf(q, col0 + 1); return e < 0 ? line.length : e + 1 }
  const m = /^[\w$.-]+/.exec(line.slice(col0)); return col0 + (m ? m[0].length : 1)
}
function toLsp(d, text) {
  const line = d.line - 1, col = (d.column || 1) - 1
  const src = (text.split('\n')[line] || '')
  const range = { start: { line, character: col }, end: { line, character: tokenEnd(src, col) } }
  const m = /did you mean '([^']+)'/.exec(d.fix || d.message)
  return {
    range, severity: SEV[d.severity] || 2, code: d.code, source: 'sygnal',
    codeDescription: { href: d.docsUrl },
    message: `${d.component ? d.component + ': ' : ''}${d.message}${d.fix ? ` (${d.fix})` : ''}`,
    // relatedInformation probe: point at the file itself (L-1 would point at the matching intent/model key)
    relatedInformation: [{ location: { uri: 'REPLACED', range }, message: 'probe: related information' }],
    data: { fix: d.fix, probe: 'data-roundtrip', replacement: m ? `'${m[1]}'` : null },
  }
}

const strictFor = (folder) => settings[folder]?.strict ?? initOptions?.strict ?? true

function runCheck() {
  const started = performance.now()
  const byUri = new Map()
  let nFiles = 0, nDiags = 0
  for (const root of folders) {
    let files = []
    try { files = expandInputs(['src'], { cwd: root }).files } catch { files = [] }
    for (const f of overlays.keys()) if (f.startsWith(root + path.sep) && !files.includes(f)) files.push(f)
    if (!files.length) continue
    nFiles += files.length
    const diags = checkFiles(files, { cwd: root, strict: strictFor(root) })
    nDiags += diags.length
    for (const d of diags) {
      const abs = path.resolve(root, d.file)
      const text = overlays.get(abs) ?? realRead(abs, 'utf8')
      const uri = pathToFileURL(abs).href
      if (!byUri.has(uri)) byUri.set(uri, [])
      const l = toLsp(d, text); l.relatedInformation[0].location.uri = uri
      byUri.get(uri).push(l)
    }
  }
  latest = byUri; dirty = false
  log(`checked ${nFiles} files in ${folders.length} folder(s) in ${(performance.now() - started).toFixed(0)} ms: ${nDiags} diagnostics`)
}
function publish() {
  if (MODE === 'pull') return
  for (const uri of published) if (!latest.has(uri)) send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } })
  for (const [uri, list] of latest) send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: list } })
  published = new Set(latest.keys())
}
function changed() {
  dirty = true
  clearTimeout(timer)
  timer = setTimeout(() => {
    runCheck(); publish()
    // pull clients: ask them to re-pull other files (their own file is re-pulled on change anyway)
    if (MODE !== 'push' && clientCaps.workspace?.diagnostics?.refreshSupport) request('workspace/diagnostic/refresh', null)
  }, DEBOUNCE)
}

const inRange = (r, p) => (p.line > r.start.line || (p.line === r.start.line && p.character >= r.start.character)) &&
  (p.line < r.end.line || (p.line === r.end.line && p.character <= r.end.character))

async function fetchConfiguration() {
  if (!clientCaps.workspace?.configuration) return logLine({ event: 'note', text: 'client has no workspace.configuration capability: not requesting' })
  const items = folders.map(f => ({ scopeUri: pathToFileURL(f).href, section: 'sygnal' }))
  const res = await request('workspace/configuration', { items })
  folders.forEach((f, i) => { settings[f] = res?.[i] || {} })
}

async function handle(msg) {
  const { id, method, params } = msg
  if (method === undefined && id !== undefined) { // response to our request
    const r = pendingOut.get(id); pendingOut.delete(id); return r?.(msg.result ?? null)
  }
  if (id !== undefined) pendingIn.set(id, { method, cancelled: false })
  switch (method) {
    case 'initialize': {
      clientCaps = params.capabilities || {}
      initOptions = params.initializationOptions ?? null
      if (params.workspaceFolders?.length) folders = params.workspaceFolders.map(f => fileURLToPath(f.uri))
      else if (params.rootUri) folders = [fileURLToPath(params.rootUri)]
      else if (params.rootPath) folders = [params.rootPath]
      else folders = [process.cwd()]
      const caps = {
        textDocumentSync: { openClose: true, change: 1, save: { includeText: false } },
        hoverProvider: true,
        codeActionProvider: { codeActionKinds: ['quickfix', 'source.fixAll.sygnal'], resolveProvider: false },
        workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
      }
      if (MODE !== 'push') caps.diagnosticProvider = { identifier: 'sygnal', interFileDependencies: true, workspaceDiagnostics: false }
      return reply(id, { capabilities: caps, serverInfo: { name: 'sygnal-ls-0s2', version: '0.0.0' } })
    }
    case 'initialized': {
      const w = clientCaps.workspace?.didChangeWatchedFiles
      if (w?.dynamicRegistration) {
        const res = await request('client/registerCapability', { registrations: [{ id: 'sygnal-watch', method: 'workspace/didChangeWatchedFiles',
          registerOptions: { watchers: [{ globPattern: '**/*.{js,jsx,ts,tsx}' }, { globPattern: '**/sygnal-check.config.json' }, { globPattern: '**/package.json' }] } }] })
        logLine({ event: 'note', text: 'registerCapability(didChangeWatchedFiles) answered', res })
      } else logLine({ event: 'note', text: 'client cannot register didChangeWatchedFiles dynamically', caps: w ?? null })
      if (clientCaps.workspace?.didChangeConfiguration?.dynamicRegistration && process.env.SYGNAL_LSP_REG_CONFIG !== '0') {
        const res = await request('client/registerCapability', { registrations: [{ id: 'sygnal-config', method: 'workspace/didChangeConfiguration', registerOptions: { section: 'sygnal' } }] })
        logLine({ event: 'note', text: 'registerCapability(didChangeConfiguration) answered', res })
      }
      await fetchConfiguration()
      runCheck(); publish()
      return
    }
    case 'workspace/didChangeConfiguration': await fetchConfiguration(); return changed()
    case 'workspace/didChangeWatchedFiles': return changed()
    case 'workspace/didChangeWorkspaceFolders': {
      for (const r of params.event.removed) folders = folders.filter(f => f !== fileURLToPath(r.uri))
      for (const a of params.event.added) folders.push(fileURLToPath(a.uri))
      return changed()
    }
    case 'textDocument/didOpen': overlays.set(fileURLToPath(params.textDocument.uri), params.textDocument.text); return changed()
    case 'textDocument/didChange': overlays.set(fileURLToPath(params.textDocument.uri), params.contentChanges.at(-1).text); return changed()
    case 'textDocument/didSave': return changed()
    case 'textDocument/didClose': overlays.delete(fileURLToPath(params.textDocument.uri)); return changed()
    case '$/cancelRequest': { const p = pendingIn.get(params.id); if (p) p.cancelled = true; logLine({ event: 'cancel', id: params.id, method: p?.method ?? '(already answered)' }); return }
    case 'textDocument/diagnostic': {
      if (PULL_DELAY) await new Promise(r => setTimeout(r, PULL_DELAY))
      if (pendingIn.get(id)?.cancelled) { pendingIn.delete(id); return send({ id, error: { code: -32800, message: 'cancelled' } }) }
      if (dirty) { clearTimeout(timer); runCheck(); publish() }
      return reply(id, { kind: 'full', items: latest.get(params.textDocument.uri) || [] })
    }
    case 'textDocument/hover': {
      if (dirty) { clearTimeout(timer); runCheck(); publish() }
      const d = (latest.get(params.textDocument.uri) || []).find(d => inRange(d.range, params.position))
      if (!d) return reply(id, null)
      const e = getExplanation(d.code)
      const md = clientCaps.textDocument?.hover?.contentFormat?.includes('markdown')
      const value = md ? `**${d.code}: ${e.title}**\n\n${e.explanation}\n\n**Fix:** ${e.fix}\n\n[Docs](${e.docsUrl})` : `${d.code}: ${e.title}\n\n${e.explanation}\n\nFix: ${e.fix}\n\n${e.docsUrl}`
      return reply(id, { contents: { kind: md ? 'markdown' : 'plaintext', value }, range: d.range })
    }
    case 'textDocument/codeAction': {
      const uri = params.textDocument.uri
      const only = params.context.only
      const actions = []
      if (!only || only.some(k => 'quickfix'.startsWith(k) || k.startsWith('quickfix'))) {
        for (const d of params.context.diagnostics || []) {
          if (d.source !== 'sygnal') continue
          const rep = d.data?.replacement ?? (/did you mean '([^']+)'/.exec(d.message)?.[1] ? `'${/did you mean '([^']+)'/.exec(d.message)[1]}'` : null)
          if (!rep) continue
          actions.push({ title: `Change to ${rep}${d.data ? '' : ' (no data)'}`, kind: 'quickfix', diagnostics: [d], isPreferred: true,
            edit: { changes: { [uri]: [{ range: d.range, newText: rep }] } } })
        }
      }
      if (only?.some(k => k === 'source' || k === 'source.fixAll' || k === 'source.fixAll.sygnal')) {
        const edits = (latest.get(uri) || []).filter(d => d.data?.replacement).map(d => ({ range: d.range, newText: d.data.replacement }))
        if (edits.length) actions.push({ title: 'Fix all Sygnal findings', kind: 'source.fixAll.sygnal', edit: { changes: { [uri]: edits } } })
      }
      return reply(id, actions)
    }
    case 'shutdown': return reply(id, null)
    case 'exit': logLine({ event: 'exit' }); return process.exit(0)
    default:
      logLine({ event: 'unhandled', method })
      if (id !== undefined) { pendingIn.delete(id); send({ id, error: { code: -32601, message: `method not found: ${method}` } }) }
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
    logLine({ dir: 'in', msg })
    handle(msg).catch((e) => { log(String(e.stack)); if (msg.id !== undefined && msg.method) send({ id: msg.id, error: { code: -32603, message: e.message } }) })
  }
})
process.stdin.on('end', () => { logLine({ event: 'stdin-end' }); process.exit(0) })
