/**
 * `sygnal-check lsp`: the Sygnal language server (PLAN-7 L-1), on stdio with LSP framing
 * (protocol.js). Hand-written like src/mcp.js (D298): no dependency beyond `@babel/parser`.
 *
 *   createLspServer({ input, output, worker?, debounce?, cwd?, configurationTimeout?, onExit?,
 *                     logStream? })
 *     → { done: Promise<exitCode>, idle(): Promise<void>, dispose(), usingWorker }
 *   runLspServer({ stdin, stdout, stderr })  → Promise<exitCode>   (what the CLI runs)
 *
 * Lifecycle: initialize / initialized / shutdown / exit. The server also exits when its input
 * ends (Claude Code sends `shutdown` and never `exit`, 0-S2). `$/cancelRequest` answers a pending
 * request with -32800; `$/setTrace` sets the trace level; other `$/` notifications are ignored.
 * Requests are answered in arrival order; a handler never throws out (failures become -32603 and
 * a log message).
 *
 * Workspace: one project per workspace folder, read from `workspaceFolders` even when the client
 * advertises `workspaceFolders: false` (Claude Code), else `rootUri`, `rootPath`, the cwd;
 * `workspace/didChangeWorkspaceFolders` adds and removes projects.
 *
 * Documents: full sync. Open documents are the checks' `sources` overlay (C-1); closing one drops
 * it and re-checks from disk. Checks run in the check worker (checker.js, core.js; G-657): at
 * once on didOpen / didSave / didClose / watched-file events / settings changes, ≈150 ms after
 * the last didChange without a save (D306). One check per folder at a time; a change while one
 * runs marks the folder dirty, and the newest state is checked next (no stale queue).
 *
 * Diagnostics are pushed, never pulled (D305): only the files whose list changed, and an empty
 * list for a file that cleared; each list sorted errors first. See convert.js for the shape.
 *
 * Settings (`sygnal.*`): strict, a11y, ignore, paths, verbose, trace.server, codeLens, from
 * `initializationOptions` (flat, or under `sygnal`) and, when the client supports it,
 * `workspace/configuration` per folder (section `sygnal`), which wins. Defined values override
 * the config file (sygnal-check.config.json / package.json); unset or null leave it in charge.
 * After any `workspace/didChangeConfiguration` the server asks for the configuration again and
 * ignores the notification's payload (VS Code's is window-scoped, 0-S2).
 *
 * Dynamic registration (when the client allows it): `workspace/didChangeWatchedFiles` for source
 * files, sygnal-check.config.json and package.json, and `workspace/didChangeConfiguration`.
 * Without watchers every check re-reads the disk anyway (the parse cache is keyed by content).
 *
 * Hover: the `explain` entry of the finding under the cursor. Code actions: the findings' C-4
 * fixes, "Suppress SYGnnn on this line", `source.fixAll.sygnal` (fixFiles, strict, like --fix)
 * and the --controls conversions as refactors (only when `context.only` asks for refactors).
 *
 * Definition / references (PLAN-7 N-2): actions and EVENTS types, from the occurrence index each
 * check returns, or from the worker when a document changed since (navigation.js).
 * Completions (N-2): Sygnal names in Sygnal contexts only, from the last check's completion index
 * and the document's current text, on the main thread (completion.js).
 *
 * Code lens (PLAN-7 P4-4, codelens.js): on intent keys, model keys and EVENTS selects / emits,
 * from the same index; `sygnal.codeLens: false` turns it off. `workspace/codeLens/refresh` after
 * a check that changed the lenses (when the client supports it); the jump command per client.
 *
 * Rename (PLAN-7 P4-5, rename.js): prepareRename / rename of actions, EVENTS types, class / id
 * tokens, state keys and context entries, always on the documents as they are (the worker's
 * `rename` call); refusals are errors with the reason; test files' mentions are offered as a
 * group that needs confirmation (change annotations), else left out with a warning.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReader, createWriter, uriToPath, pathToUri, ErrorCodes, ResponseError } from './protocol.js'
import { createChecker } from './checker.js'
import { getExplanation } from '../explain.js'
import { lineStarts } from '../edits.js'
import { textHash } from './convert.js'
import { createNavigation } from './navigation.js'
import { createRename } from './rename.js'
import { complete, completionList, indexState, TRIGGER_CHARACTERS } from './completion.js'
import { createCodeLens, GO_TO } from './codelens.js'

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'))

export const SETTINGS = ['strict', 'a11y', 'ignore', 'paths', 'verbose', 'trace.server', 'codeLens']
export const WATCHERS = ['**/*.{js,jsx,ts,tsx,mjs,cjs}', '**/sygnal-check.config.json', '**/package.json']
export const CODE_ACTION_KINDS = ['quickfix', 'refactor', 'refactor.rewrite', 'source.fixAll.sygnal']
const TRACE = ['off', 'messages', 'verbose']
const LOG_TYPE = { error: 1, warn: 2, info: 3, debug: 4 }
// the levels shown at each trace setting
const LOG_LEVELS = { off: ['error', 'warn'], messages: ['error', 'warn', 'info'], verbose: ['error', 'warn', 'info', 'debug'] }

const readText = (abs) => { try { return fs.readFileSync(abs, 'utf8') } catch { return null } }
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isStrings = (v) => Array.isArray(v) && v.every(s => typeof s === 'string')
const within = (abs, folder) => abs === folder || abs.startsWith(folder.endsWith(path.sep) ? folder : folder + path.sep)
const before = (a, b) => a.line < b.line || (a.line === b.line && a.character <= b.character)
const contains = (r, p) => before(r.start, p) && before(p, r.end)
const sameRange = (a, b) => a && b && a.start.line === b.start.line && a.start.character === b.start.character &&
  a.end.line === b.end.line && a.end.character === b.end.character
/** Whether a kind passes `context.only` (no `only`: everything does). */
const allows = (only, kind) => !only || only.some(k => kind === k || kind.startsWith(k + '.'))

/**
 * The `sygnal` settings in one source: an object with the keys at the top or under `sygnal`
 * (dotted `sygnal.strict` keys too). Only valid, non-null values are kept; `problems` names the
 * rest.
 */
export function readSettings(raw) {
  const out = {}
  const problems = []
  if (!isObj(raw)) return { settings: out, problems }
  let s = isObj(raw.sygnal) ? { ...raw.sygnal } : { ...raw }
  for (const [k, v] of Object.entries(raw)) if (k.startsWith('sygnal.')) s[k.slice(7)] = v
  const trace = isObj(s.trace) ? s.trace.server : s['trace.server']
  const bad = (key, v, want) => { if (v !== undefined && v !== null) problems.push(`sygnal.${key} must be ${want}, got ${JSON.stringify(v)}: ignored`) }
  if (typeof s.strict === 'boolean') out.strict = s.strict; else bad('strict', s.strict, 'a boolean')
  if (s.a11y === 'warn' || s.a11y === 'error') out.a11y = s.a11y; else bad('a11y', s.a11y, "'warn' or 'error'")
  if (isStrings(s.ignore)) out.ignore = [...s.ignore]; else bad('ignore', s.ignore, 'an array of codes')
  if (isStrings(s.paths) && s.paths.length) out.paths = [...s.paths]; else bad('paths', s.paths, 'a non-empty array of paths')
  if (typeof s.verbose === 'boolean') out.verbose = s.verbose; else bad('verbose', s.verbose, 'a boolean')
  if (TRACE.includes(trace)) out.trace = trace; else bad('trace.server', trace, "'off', 'messages' or 'verbose'")
  if (typeof s.codeLens === 'boolean') out.codeLens = s.codeLens; else bad('codeLens', s.codeLens, 'a boolean')
  return { settings: out, problems }
}

/** Apply full or ranged content changes to a text (a client that ignores the Full sync kind still works). */
function applyChanges(text, changes) {
  for (const c of changes) {
    if (!isObj(c) || typeof c.text !== 'string') continue
    if (!c.range) { text = c.text; continue }
    const starts = lineStarts(text)
    const offset = (p) => Math.min(text.length, (starts[p.line] ?? text.length) + p.character)
    text = text.slice(0, offset(c.range.start)) + c.text + text.slice(offset(c.range.end))
  }
  return text
}

export function createLspServer({
  input,
  output,
  worker = true,
  debounce = 150,
  cwd = process.cwd(),
  configurationTimeout = 2000,
  onExit,
  logStream,
} = {}) {
  const write = createWriter(output)
  let traceLevel = 'off'
  let connected = false // initialize received: logs go to window/logMessage
  const log = (level, message) => {
    if (!LOG_LEVELS[traceLevel].includes(level)) return
    if (connected) write({ method: 'window/logMessage', params: { type: LOG_TYPE[level], message: `[sygnal] ${message}` } })
    if (logStream && (!connected || level === 'error')) logStream.write(`[sygnal ${level}] ${message}\n`)
  }
  const checker = createChecker({ worker, onLog: (level, m) => log(level, m) })

  let initialized = false // initialize answered
  let ready = false // configuration read: checks may run
  let shutdown = false
  let exited = false
  let clientCaps = {}
  let initSettings = {}
  let initOptions = {}
  const folderSettings = new Map() // folder → settings from workspace/configuration
  const projects = new Map() // folder → { dirty, timer, uris: Set, checked: Map<absPath, textHash>, substituted: Set }
  const overlays = new Map() // absPath → text of an open document
  const docUris = new Map() // absPath → the URI the client opened it with
  const published = new Map() // uri → { key, list }
  let inFlight = null
  const slots = [] // requests in arrival order: { id, done, response }
  const slotById = new Map()
  const outRequests = new Map() // our request id → resolve
  let outId = 1
  let idleWaiters = []
  let resolveDone
  const done = new Promise(r => { resolveDone = r })

  // ---------------------------------------------------------------- wire

  function finish(slot, response) {
    if (slot.done) return
    slot.done = true
    slot.response = response
    while (slots.length && slots[0].done) {
      const s = slots.shift()
      if (slotById.get(s.id) === s) slotById.delete(s.id)
      write({ id: s.id, ...s.response })
    }
  }

  function errorOf(err, method) {
    if (err instanceof ResponseError) return { error: { code: err.code, message: err.message, ...(err.data !== undefined ? { data: err.data } : {}) } }
    log('error', `${method} failed: ${err?.stack || err}`)
    return { error: { code: ErrorCodes.InternalError, message: `Internal error: ${err?.message || err}` } }
  }

  /** Send a request to the client; resolves with its result, or null on an error or after `timeout` ms. */
  function requestClient(method, params, timeout) {
    return new Promise((resolve) => {
      const id = `sygnal-${outId++}`
      let timer = null
      outRequests.set(id, (v) => { clearTimeout(timer); resolve(v) })
      if (timeout) {
        timer = setTimeout(() => { outRequests.delete(id); resolve(null) }, timeout)
        timer.unref?.()
      }
      write({ id, method, params })
    })
  }

  function onMessage(msg) {
    if (exited) return
    if (!isObj(msg) || msg.jsonrpc !== '2.0') {
      if (isObj(msg) && 'id' in msg) write({ id: msg.id ?? null, error: { code: ErrorCodes.InvalidRequest, message: 'Invalid Request' } })
      return
    }
    if (typeof msg.method !== 'string') {
      // a response to one of our requests
      const r = outRequests.get(msg.id)
      if (r) { outRequests.delete(msg.id); r(msg.error ? null : msg.result ?? null) }
      return
    }
    if (traceLevel === 'verbose') log('debug', `<- ${msg.method}${'id' in msg ? ` #${msg.id}` : ''}`)
    const params = msg.params ?? {}
    if ('id' in msg && msg.id !== null) handleRequest(msg.id, msg.method, params)
    else {
      try {
        handleNotification(msg.method, params)
      } catch (err) {
        log('error', `${msg.method} failed: ${err?.stack || err}`)
      }
    }
  }

  function handleRequest(id, method, params) {
    const slot = { id, done: false, response: null }
    slots.push(slot)
    slotById.set(id, slot)
    let value
    try {
      if (shutdown) throw new ResponseError(ErrorCodes.InvalidRequest, 'the server is shutting down')
      if (!initialized && method !== 'initialize') throw new ResponseError(ErrorCodes.ServerNotInitialized, 'the server is not initialized')
      const handler = requests[method]
      if (!handler) throw new ResponseError(ErrorCodes.MethodNotFound, `Method not found: ${method}`)
      value = handler(isObj(params) ? params : {}, slot)
    } catch (err) {
      finish(slot, errorOf(err, method))
      return
    }
    if (value && typeof value.then === 'function') value.then(v => finish(slot, { result: v ?? null }), e => finish(slot, errorOf(e, method)))
    else finish(slot, { result: value ?? null })
  }

  function handleNotification(method, params) {
    if (method === 'exit') return exit(shutdown ? 0 : 1)
    if (method === '$/cancelRequest') {
      const slot = isObj(params) ? slotById.get(params.id) : undefined
      if (slot && !slot.done) finish(slot, { error: { code: ErrorCodes.RequestCancelled, message: 'Request cancelled' } })
      return
    }
    if (method === '$/setTrace') { if (TRACE.includes(params?.value)) traceLevel = params.value; return }
    if (!initialized || shutdown) return
    const handler = notifications[method]
    if (handler) handler(isObj(params) ? params : {})
    else if (!method.startsWith('$/')) log('debug', `ignored notification ${method}`)
  }

  function exit(code) {
    if (exited) return
    exited = true
    for (const p of projects.values()) clearTimeout(p.timer)
    checker.dispose()
    for (const w of idleWaiters) w()
    idleWaiters = []
    resolveDone(code)
    onExit?.(code)
  }

  // ---------------------------------------------------------------- projects and checks

  const folderList = () => [...projects.keys()]
  /** The innermost folder holding a path (for requests about one document). */
  const folderOf = (abs) => folderList().filter(f => within(abs, f)).sort((a, b) => b.length - a.length)[0] || null
  const uriFor = (abs) => docUris.get(abs) ?? pathToUri(abs)
  /** A URI from the worker, as the client spelled it when it opened the document. */
  const clientUri = (uri) => { const abs = uriToPath(uri); return (abs && docUris.get(abs)) || uri }

  function addFolder(folder) {
    if (!projects.has(folder)) projects.set(folder, { dirty: false, timer: null, uris: new Set(), checked: new Map(), substituted: new Set() })
  }

  function removeFolder(folder) {
    const p = projects.get(folder)
    if (!p) return
    clearTimeout(p.timer)
    projects.delete(folder)
    folderSettings.delete(folder)
    nav.drop(folder)
    lens.drop(folder)
    for (const uri of p.uris) publish(uri, [])
    checker.call('drop', { folder }).catch(() => {})
  }

  function settingsFor(folder) {
    const s = { ...initSettings, ...(folderSettings.get(folder) || {}) }
    const out = { verbose: !!s.verbose }
    for (const k of ['strict', 'a11y', 'ignore', 'paths']) if (s[k] !== undefined) out[k] = s[k]
    return out
  }

  function overlaysUnder(folder) {
    const out = new Map()
    for (const [abs, text] of overlays) if (within(abs, folder)) out.set(abs, text)
    return out
  }

  /** Check `folder` after `delay` ms (0: as soon as the worker is free). */
  function schedule(folder, delay) {
    const p = projects.get(folder)
    if (!p || exited) return
    clearTimeout(p.timer)
    p.timer = null
    if (delay > 0) {
      p.timer = setTimeout(() => { p.timer = null; p.dirty = true; pump() }, delay)
      p.timer.unref?.()
    } else {
      p.dirty = true
      pump()
    }
  }

  const nav = createNavigation({ checker, overlaysUnder, settingsFor, folderOf, uriFor, log })
  const lens = createCodeLens({
    nav, caps: () => clientCaps, initOptions: () => initOptions, folderOf, uriFor, requestClient, log,
    enabled: (folder) => ({ ...initSettings, ...(folderSettings.get(folder) || {}) }).codeLens !== false,
  })

  // PLAN-7 P4-5: rename (rename.js), always on the documents as they are now
  const renamer = createRename({
    checker, overlaysUnder, settingsFor, folderOf, uriFor, caps: () => clientCaps, log,
    notify: (type, message) => write({ method: 'window/showMessage', params: { type, message } }),
  })

  const scheduleFor = (abs, delay) => { for (const f of folderList()) if (within(abs, f)) schedule(f, delay) }

  function isIdle() {
    if (exited) return true
    if (!ready || inFlight) return false
    for (const p of projects.values()) if (p.dirty || p.timer) return false
    return true
  }

  function pump() {
    if (exited) return
    if (ready && !inFlight) {
      const folder = folderList().find(f => projects.get(f).dirty)
      if (folder) {
        const p = projects.get(folder)
        p.dirty = false
        const sources = overlaysUnder(folder)
        const snap = nav.snapshot(sources)
        inFlight = folder
        const checked = checker.call('check', { folder, settings: settingsFor(folder), sources })
          .then(res => { if (projects.has(folder) && !exited) lens.checked(folder, nav.accept(folder, snap, res)); apply(folder, res, sources) }, err => log('error', `check of ${folder} failed: ${err?.stack || err}`))
        nav.track(folder, snap, checked)
        checked.finally(() => { inFlight = null; pump() })
        return
      }
    }
    if (isIdle()) {
      const ws = idleWaiters
      idleWaiters = []
      for (const w of ws) w()
    }
  }

  function apply(folder, res, sources) {
    const p = projects.get(folder)
    if (!p || exited) return
    p.completion = indexState(res.completion, sources)
    p.checked = new Map(res.texts)
    p.substituted = new Set(res.substituted)
    for (const l of res.logs) log(l.level, l.message)
    const next = new Map()
    let count = 0
    // G-663: relatedInformation and codeDescription only for clients that advertise them
    const pd = clientCaps.textDocument?.publishDiagnostics || {}
    for (const [abs, list] of res.files) {
      for (const d of list) {
        count++
        if (!pd.relatedInformation) delete d.relatedInformation
        if (!pd.codeDescriptionSupport) delete d.codeDescription
        for (const r of d.relatedInformation || []) r.location.uri = clientUri(r.location.uri)
        for (const f of d.data?.fixes || []) for (const e of f.edits) e.uri = clientUri(e.uri)
      }
      next.set(uriFor(abs), list)
    }
    log('info', `checked ${folder}: ${count} finding(s) in ${next.size} file(s), ${Math.round(res.ms)} ms` +
      (res.substituted.length ? `; kept the last good findings of ${res.substituted.length} file(s) that don't parse` : ''))
    for (const uri of p.uris) if (!next.has(uri)) publish(uri, [])
    for (const [uri, list] of next) publish(uri, list)
    p.uris = new Set(next.keys())
  }

  /** Publish a file's list when it differs from what the client has (an empty list only to clear one). */
  function publish(uri, list) {
    const prev = published.get(uri)
    const key = JSON.stringify(list)
    if (!list.length) {
      if (!prev) return
      published.delete(uri)
    } else {
      if (prev?.key === key) return
      published.set(uri, { key, list })
    }
    write({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: list } })
  }

  async function refreshConfiguration() {
    if (!clientCaps.workspace?.configuration) return
    const folders = folderList()
    if (!folders.length) return
    const res = await requestClient('workspace/configuration', { items: folders.map(f => ({ scopeUri: pathToUri(f), section: 'sygnal' })) }, configurationTimeout)
    if (!Array.isArray(res)) return
    folders.forEach((f, i) => {
      const { settings, problems } = readSettings(res[i])
      for (const m of problems) log('warn', m)
      if (settings.trace) traceLevel = settings.trace
      folderSettings.set(f, settings)
    })
  }

  const recheckAll = () => { for (const f of folderList()) schedule(f, 0) }

  async function onInitialized() {
    const ws = clientCaps.workspace || {}
    const registrations = []
    if (ws.didChangeWatchedFiles?.dynamicRegistration) {
      registrations.push({ id: 'sygnal-watched-files', method: 'workspace/didChangeWatchedFiles', registerOptions: { watchers: WATCHERS.map(globPattern => ({ globPattern })) } })
    }
    if (ws.didChangeConfiguration?.dynamicRegistration) {
      registrations.push({ id: 'sygnal-configuration', method: 'workspace/didChangeConfiguration', registerOptions: { section: 'sygnal' } })
    }
    if (registrations.length) requestClient('client/registerCapability', { registrations }, 0).catch(() => {})
    await refreshConfiguration()
    ready = true
    recheckAll()
  }

  // ---------------------------------------------------------------- requests

  const requests = {
    initialize(params) {
      if (initialized) throw new ResponseError(ErrorCodes.InvalidRequest, 'initialize was already received')
      clientCaps = isObj(params.capabilities) ? params.capabilities : {}
      if (TRACE.includes(params.trace)) traceLevel = params.trace
      const { settings, problems } = readSettings(params.initializationOptions)
      initOptions = isObj(params.initializationOptions) ? params.initializationOptions : {}
      initSettings = settings
      if (settings.trace) traceLevel = settings.trace
      let folders = []
      if (Array.isArray(params.workspaceFolders) && params.workspaceFolders.length) folders = params.workspaceFolders.map(f => uriToPath(f?.uri)).filter(Boolean)
      if (!folders.length && params.rootUri) folders = [uriToPath(params.rootUri)].filter(Boolean)
      if (!folders.length && typeof params.rootPath === 'string' && params.rootPath) folders = [path.resolve(params.rootPath)]
      if (!folders.length) folders = [path.resolve(cwd)]
      for (const f of folders) addFolder(f)
      initialized = true
      connected = true
      for (const m of problems) log('warn', m)
      log('info', `sygnal-check ${pkg.version} language server; folders: ${folders.join(', ')}; ${checker.usingWorker ? 'checks in a worker thread' : 'checks on the main thread'}`)
      return {
        capabilities: {
          textDocumentSync: { openClose: true, change: 1, save: { includeText: false } },
          hoverProvider: true,
          completionProvider: { triggerCharacters: TRIGGER_CHARACTERS, resolveProvider: false },
          codeActionProvider: { codeActionKinds: CODE_ACTION_KINDS, resolveProvider: false },
          definitionProvider: true,
          referencesProvider: true,
          codeLensProvider: { resolveProvider: false },
          renameProvider: clientCaps.textDocument?.rename?.prepareSupport ? { prepareProvider: true } : true,
          executeCommandProvider: { commands: [GO_TO] },
          workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
        },
        serverInfo: { name: 'sygnal-check', version: pkg.version },
      }
    },

    shutdown() {
      shutdown = true
      for (const p of projects.values()) { clearTimeout(p.timer); p.timer = null; p.dirty = false }
      return null
    },

    'textDocument/hover'(params) {
      const uri = params.textDocument?.uri
      const pos = params.position
      if (typeof uri !== 'string' || !isObj(pos)) return null
      const list = published.get(uri)?.list || []
      const hits = list.filter(d => contains(d.range, pos))
      if (!hits.length) return null
      const markdown = (clientCaps.textDocument?.hover?.contentFormat || ['markdown']).includes('markdown')
      const seen = new Set()
      const parts = []
      for (const d of hits) {
        if (seen.has(d.code)) continue
        seen.add(d.code)
        const e = getExplanation(d.code)
        if (!e) { parts.push(markdown ? `**${d.code}**\n\n${d.message}` : `${d.code}\n\n${d.message}`); continue }
        parts.push(markdown
          ? `**${d.code}: ${e.title}**\n\n${e.explanation}\n\n**Fix:** ${e.fix}\n\nDocs: [${e.docsUrl}](${e.docsUrl})`
          : `${d.code}: ${e.title}\n\n${e.explanation}\n\nFix: ${e.fix}\n\n${e.docsUrl}`)
      }
      return { contents: { kind: markdown ? 'markdown' : 'plaintext', value: parts.join(markdown ? '\n\n---\n\n' : '\n\n') }, range: hits[0].range }
    },

    'textDocument/completion'(params) {
      const abs = uriToPath(params.textDocument?.uri)
      const folder = abs && isObj(params.position) && folderOf(abs)
      if (!folder) return null
      const text = overlays.get(abs) ?? readText(abs)
      if (text == null) return null
      const starts = lineStarts(text)
      const offset = Math.min(text.length, (starts[params.position.line] ?? text.length) + (params.position.character || 0))
      const snippets = !!clientCaps.textDocument?.completion?.completionItem?.snippetSupport
      const t0 = performance.now()
      const r = complete({ text, offset, file: abs, state: projects.get(folder).completion, snippets, readFile: readText })
      if (r) log('debug', `completion: ${r.context ?? 'no context'} (${r.strategy ?? 'none'}${r.repair ? ` ${JSON.stringify(r.repair)}` : ''}), ${r.items.length} item(s), ${(performance.now() - t0).toFixed(1)} ms`)
      return completionList(r)
    },

    'textDocument/codeAction'(params) {
      const uri = params.textDocument?.uri
      const abs = uriToPath(uri)
      const ctx = isObj(params.context) ? params.context : {}
      const only = Array.isArray(ctx.only) && ctx.only.length ? ctx.only : null
      const folder = abs && folderOf(abs)
      if (!folder) return []
      const st = projects.get(folder)
      const stored = published.get(uri)?.list || []
      // the context's sygnal diagnostics, matched to the last results (their fixes and suppression)
      const ours = []
      for (const d of Array.isArray(ctx.diagnostics) ? ctx.diagnostics : []) {
        if (!isObj(d) || d.source !== 'sygnal') continue
        const m = stored.find(s => String(s.code) === String(d.code) && s.message === d.message && sameRange(s.range, d.range))
        if (m && !ours.includes(m)) ours.push(m)
      }
      // G-662: also offered in an explicitly invoked request without `only` (Helix never sends
      // one) when the file has an auto-fixable finding; never in the automatic ones (triggerKind 2)
      const wantFixAll = only ? allows(only, 'source.fixAll.sygnal')
        : ctx.triggerKind !== 2 && ours.length > 0 && stored.some(d => d.data?.fixes?.some(f => f.fixAll))
      const wantRefactors = !!only && allows(only, 'refactor.rewrite')
      if (!ours.length && !wantFixAll && !wantRefactors) return [] // the frequent automatic request (triggerKind 2)

      // a fix applies only to the text it was computed on: an open document must still have it
      const hashes = new Map()
      const current = (file) => {
        if (st.substituted.has(file)) return false
        if (!overlays.has(file)) return true // on disk: re-read at every check
        if (!hashes.has(file)) hashes.set(file, textHash(overlays.get(file)))
        return st.checked.get(file) === hashes.get(file)
      }
      const actions = []
      const suppress = []
      for (const d of ours) {
        for (const fix of d.data?.fixes || []) {
          const kind = fix.kind === 'quickfix' ? 'quickfix' : 'refactor.rewrite'
          if (!allows(only, kind)) continue
          if (!fix.edits.every(e => current(uriToPath(e.uri)))) continue
          actions.push({ title: fix.title, kind, isPreferred: !!fix.preferred, diagnostics: [d], edit: workspaceEdit(fix.edits) })
        }
        const s = d.data?.suppress
        if (s && allows(only, 'quickfix') && current(abs)) {
          suppress.push({
            title: `Suppress ${d.code} on this line`,
            kind: 'quickfix',
            isPreferred: false,
            diagnostics: [d],
            edit: workspaceEdit([{ uri, range: { start: { line: s.line, character: 0 }, end: { line: s.line, character: 0 } }, newText: s.newText }]),
          })
        }
      }
      actions.sort((a, b) => (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0))
      actions.push(...suppress)
      if (!wantFixAll && !wantRefactors) return actions

      const sources = overlaysUnder(folder)
      return (async () => {
        if (wantRefactors) {
          const range = isObj(params.range) ? params.range : { start: { line: 0 }, end: { line: Infinity } }
          const conversions = await checker.call('controls', { folder, file: abs, sources })
          for (const c of conversions) {
            if (c.range.end.line < range.start.line || c.range.start.line > range.end.line) continue
            actions.push({ title: c.title, kind: 'refactor.rewrite', edit: workspaceEdit(c.edits.map(e => ({ ...e, uri: clientUri(e.uri) }))) })
          }
        }
        if (wantFixAll) {
          const r = await checker.call('fixAll', { folder, file: abs, sources })
          for (const m of r.diagnostics) log('warn', m)
          if (r.edits.length) {
            actions.push({ title: 'Fix all auto-fixable Sygnal problems', kind: 'source.fixAll.sygnal', edit: workspaceEdit(r.edits.map(e => ({ ...e, uri: clientUri(e.uri) }))) })
          }
        }
        return actions
      })()
    },
  }

  // PLAN-7 N-2: actions and EVENTS (navigation.js)
  requests['textDocument/definition'] = (params) => nav.definition(params)
  requests['textDocument/references'] = (params) => nav.references(params)
  // PLAN-7 P4-4: code lens (codelens.js)
  requests['textDocument/codeLens'] = (params) => lens.codeLens(params)
  // PLAN-7 P4-5: rename (rename.js)
  requests['textDocument/prepareRename'] = (params) => renamer.prepareRename(params)
  requests['textDocument/rename'] = (params) => renamer.rename(params)
  requests['workspace/executeCommand'] = (params) => {
    if (params.command !== GO_TO) throw new ResponseError(ErrorCodes.InvalidParams, `unknown command: ${params.command}`)
    return lens.executeCommand(params)
  }

  /** `[{ uri, range, newText }]` → a WorkspaceEdit with the edits grouped by file. */
  function workspaceEdit(edits) {
    const changes = {}
    for (const e of edits) (changes[e.uri] ||= []).push({ range: e.range, newText: e.newText })
    return { changes }
  }

  // ---------------------------------------------------------------- notifications

  const docPath = (params) => uriToPath(params.textDocument?.uri)

  const notifications = {
    initialized() {
      onInitialized().catch(err => { log('error', `initialized failed: ${err?.stack || err}`); ready = true; recheckAll() })
    },
    'workspace/didChangeConfiguration'() {
      // the payload is ignored (VS Code's is window-scoped): ask per folder again
      refreshConfiguration().catch(err => log('error', `workspace/configuration failed: ${err?.stack || err}`)).finally(recheckAll)
    },
    'workspace/didChangeWatchedFiles'(params) {
      const touched = new Set()
      for (const c of Array.isArray(params.changes) ? params.changes : []) {
        const abs = uriToPath(c?.uri)
        if (!abs) continue
        if (c.type === 3) overlays.delete(abs) // deleted: re-check from disk (its findings clear)
        for (const f of folderList()) if (within(abs, f) || within(f, abs)) touched.add(f)
      }
      for (const f of touched) schedule(f, 0)
    },
    'workspace/didChangeWorkspaceFolders'(params) {
      const ev = isObj(params.event) ? params.event : {}
      for (const r of Array.isArray(ev.removed) ? ev.removed : []) { const f = uriToPath(r?.uri); if (f) removeFolder(f) }
      const added = []
      for (const a of Array.isArray(ev.added) ? ev.added : []) { const f = uriToPath(a?.uri); if (f && !projects.has(f)) { addFolder(f); added.push(f) } }
      if (added.length) refreshConfiguration().catch(() => {}).finally(() => { for (const f of added) schedule(f, 0) })
    },
    'textDocument/didOpen'(params) {
      const abs = docPath(params)
      if (!abs || typeof params.textDocument.text !== 'string') return
      docUris.set(abs, params.textDocument.uri)
      overlays.set(abs, params.textDocument.text)
      scheduleFor(abs, 0)
    },
    'textDocument/didChange'(params) {
      const abs = docPath(params)
      if (!abs || !Array.isArray(params.contentChanges)) return
      overlays.set(abs, applyChanges(overlays.get(abs) ?? '', params.contentChanges))
      scheduleFor(abs, debounce)
    },
    'textDocument/didSave'(params) {
      const abs = docPath(params)
      if (!abs) return
      if (typeof params.text === 'string' && overlays.has(abs)) overlays.set(abs, params.text)
      scheduleFor(abs, 0) // at once (D306: Claude Code saves with every edit)
    },
    'textDocument/didClose'(params) {
      const abs = docPath(params)
      if (!abs) return
      overlays.delete(abs)
      docUris.delete(abs)
      scheduleFor(abs, 0)
    },
  }

  createReader(input, {
    onMessage,
    onError: (kind, detail) => {
      if (kind === 'parse') write({ id: null, error: { code: ErrorCodes.ParseError, message: `Parse error: ${detail}` } })
      else log('warn', 'skipped a message without a Content-Length header')
    },
    onEnd: () => exit(shutdown ? 0 : 1),
  })

  return {
    done,
    /** Resolves when no check is running, pending or waiting for its debounce (tests). */
    idle: () => isIdle() ? Promise.resolve() : new Promise(r => idleWaiters.push(r)),
    dispose: () => exit(shutdown ? 0 : 1),
    get usingWorker() { return checker.usingWorker },
  }
}

/** Serve LSP over stdio until the input ends or `exit` arrives. Resolves with the exit code. */
export function runLspServer({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, cwd = process.cwd() } = {}) {
  const server = createLspServer({ input: stdin, output: stdout, logStream: stderr, cwd })
  return server.done
}
