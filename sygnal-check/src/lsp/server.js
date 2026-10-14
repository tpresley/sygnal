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
 * Workspace: the workspace folders are read from `workspaceFolders` even when the client
 * advertises `workspaceFolders: false` (Claude Code), else `rootUri`, `rootPath`, the cwd;
 * `workspace/didChangeWorkspaceFolders` adds and removes them.
 *
 * Projects (G-666, roots.js): one per project root, not per workspace folder. A file's root is
 * its nearest ancestor directory, up to and including its workspace folder, that is a Sygnal
 * project (a sygnal-check.config.json, or a package.json depending on sygnal / sygnal-check or with
 * a "sygnal-check" key), else the workspace folder itself (the fallback root). Each root has its
 * own config (resolved from the root), `paths` (relative to the root), worker caches, navigation,
 * completion, code lens and rename state; a root's check leaves out the files of roots nested in
 * it. Which roots are checked:
 *   - the workspace folder's own root, at startup, as before G-666: unless the folder isn't a
 *     Sygnal project itself and has nested ones (roots.js hasNested, a bounded scan; the Sygnal
 *     repository, a monorepo), where it is checked like the nested ones;
 *   - any other root, from the first didOpen of a document in it; from then on it stays checked
 *     (on changes, saves and watched-file events inside it) until its workspace folder is removed
 *     or it stops being a root (its config or package.json changed).
 * A watched sygnal-check.config.json / package.json change (or a didSave of one) re-detects the
 * roots and re-checks every root; a didOpen re-detects them too (clients without file watching).
 *
 * Not checked (G-665): once per root and directory, an open document that looks like Sygnal source
 * but lies outside its root's `paths` gets a `window/showMessage` (Info) saying so; once per root,
 * a root with an open document whose `paths` match no source file at all. Each also goes to the
 * log (warning). Clients that advertise no `window` capabilities (Claude Code) get the log only.
 *
 * Documents: full sync. Open documents are the checks' `sources` overlay (C-1); closing one drops
 * it and re-checks from disk. Checks run in the check worker (checker.js, core.js; G-657): at
 * once on didOpen / didSave / didClose / watched-file events / settings changes, ≈150 ms after
 * the last didChange without a save (D306). One check at a time; a change while one runs marks
 * its root dirty, and the newest state is checked next (no stale queue).
 *
 * Diagnostics are pushed, never pulled (D305): only the files whose list changed, and an empty
 * list for a file that cleared; each list sorted errors first. See convert.js for the shape.
 *
 * Settings (`sygnal.*`): strict, a11y, ignore, paths, verbose, trace.server, codeLens, highlights, from
 * `initializationOptions` (flat, or under `sygnal`) and, when the client supports it,
 * `workspace/configuration` per project root (section `sygnal`, `scopeUri` the root's URI, so
 * the client answers with the containing workspace folder's settings), which wins. Defined values
 * override the root's config file (sygnal-check.config.json / package.json); unset or null leave
 * it in charge.
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
 * Highlights (highlights.js): action names, EVENTS types, intent selectors, the view tokens they
 * target and selected child components as semantic tokens (`textDocument/semanticTokens/full`),
 * or decoded (`sygnal/highlights`) for a client that draws them itself (the VS Code extension,
 * `initializationOptions.semanticTokens: false`); `sygnal.highlights: false` turns them off.
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
import { createHighlights } from './highlights.js'
import { createRoots, looksLikeSygnal } from './roots.js'
import { CONFIG_FILE } from '../config.js'

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'))

export const SETTINGS = ['strict', 'a11y', 'ignore', 'paths', 'verbose', 'trace.server', 'codeLens', 'highlights']
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
/** sygnal-check.config.json or package.json: a change re-detects the project roots. */
const isConfigFile = (abs) => { const b = path.basename(abs); return b === CONFIG_FILE || b === 'package.json' }

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
  if (typeof s.highlights === 'boolean') out.highlights = s.highlights; else bad('highlights', s.highlights, 'a boolean')
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
  const folders = new Set() // the workspace folders
  const roots = createRoots() // project root detection (G-666)
  let configStarted = false // the initialized notification arrived: roots activated later ask for their settings
  const rootSettings = new Map() // root → settings from workspace/configuration
  // root → { folder, dirty, timer, configuring, uris: Set, checked: Map<absPath, textHash>, substituted: Set }
  const projects = new Map()
  const told = new Set() // G-665: what was said once (per root, per root + directory)
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

  const rootList = () => [...projects.keys()]
  /** The innermost workspace folder holding a path. */
  const folderOf = (abs) => [...folders].filter(f => within(abs, f)).sort((a, b) => b.length - a.length)[0] || null
  /** A file's project root (roots.js), checked or not; null outside every workspace folder. */
  const detectRoot = (abs) => { const f = folderOf(abs); return f && roots.rootOf(abs, f) }
  /** The checked project root of a file (for requests about one document), else null. */
  const rootOf = (abs) => { const r = detectRoot(abs); return r && projects.has(r) ? r : null }
  const uriFor = (abs) => docUris.get(abs) ?? pathToUri(abs)
  /** A URI from the worker, as the client spelled it when it opened the document. */
  const clientUri = (uri) => { const abs = uriToPath(uri); return (abs && docUris.get(abs)) || uri }
  /** How a path reads in messages: relative to its workspace folder, '/'-separated. */
  const shown = (abs, folder) => (path.relative(folder, abs) || path.basename(abs)).split(path.sep).join('/')

  /**
   * Start checking a project root (inside workspace folder `folder`). After the initialized
   * notification it first asks for the root's settings; an active root above it is re-checked
   * (its findings on this root's files clear). false when it was already checked.
   */
  function activate(root, folder) {
    if (projects.has(root)) return false
    const p = { folder, dirty: false, timer: null, configuring: false, uris: new Set(), checked: new Map(), substituted: new Set() }
    projects.set(root, p)
    log('info', `project root ${root}${root === folder ? ' (the workspace folder)' : ''}`)
    for (const r of rootList()) if (r !== root && within(root, r)) schedule(r, 0)
    if (configStarted && clientCaps.workspace?.configuration) {
      p.configuring = true
      refreshConfiguration([root]).catch(() => {}).finally(() => { p.configuring = false; schedule(root, 0) })
    } else if (ready) schedule(root, 0)
    return true
  }

  function removeRoot(root) {
    const p = projects.get(root)
    if (!p) return
    clearTimeout(p.timer)
    projects.delete(root)
    rootSettings.delete(root)
    nav.drop(root)
    lens.drop(root)
    highlights.drop(root)
    for (const uri of p.uris) publish(uri, [], root)
    checker.call('drop', { folder: root }).catch(() => {})
  }

  /** A workspace folder: its own root is checked now unless it only holds nested projects. */
  function addFolder(folder) {
    if (folders.has(folder)) return
    folders.add(folder)
    if (roots.isRoot(folder) || !roots.hasNested(folder)) activate(folder, folder)
    else log('info', `${folder} holds nested Sygnal projects: each is checked once one of its files is opened`)
  }

  function removeFolder(folder) {
    if (!folders.delete(folder)) return
    for (const [r, p] of [...projects]) if (p.folder === folder) removeRoot(r)
  }

  /**
   * Detect the roots again (a config or package.json may have changed): roots that no longer
   * qualify are dropped, the open documents' roots are checked (activate() schedules each new one
   * and the roots above it). Whether a root was dropped (its documents moved to other roots).
   */
  function redetect() {
    roots.clear()
    let dropped = false
    for (const [r, p] of [...projects]) {
      if (r === p.folder || roots.isRoot(r)) continue
      log('info', `${r} is no longer a project root`)
      removeRoot(r)
      dropped = true
    }
    for (const abs of overlays.keys()) {
      const r = detectRoot(abs)
      if (r) activate(r, folderOf(abs))
    }
    return dropped
  }

  function settingsFor(root) {
    const s = { ...initSettings, ...(rootSettings.get(root) || {}) }
    const out = { verbose: !!s.verbose }
    for (const k of ['strict', 'a11y', 'ignore', 'paths']) if (s[k] !== undefined) out[k] = s[k]
    return out
  }

  /** The open documents whose project root is `root`. */
  function overlaysUnder(root) {
    const out = new Map()
    for (const [abs, text] of overlays) if (within(abs, root) && detectRoot(abs) === root) out.set(abs, text)
    return out
  }

  /** Check `root` after `delay` ms (0: as soon as the worker is free). */
  function schedule(root, delay) {
    const p = projects.get(root)
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

  // (navigation, code lens and rename key their state by what `folderOf` returns: the project root)
  const nav = createNavigation({ checker, overlaysUnder, settingsFor, folderOf: rootOf, uriFor, log })
  const lens = createCodeLens({
    nav, caps: () => clientCaps, initOptions: () => initOptions, folderOf: rootOf, uriFor, requestClient, log,
    enabled: (root) => ({ ...initSettings, ...(rootSettings.get(root) || {}) }).codeLens !== false,
  })
  const highlights = createHighlights({
    nav, caps: () => clientCaps, initOptions: () => initOptions, folderOf: rootOf, requestClient, log,
    enabled: (root) => ({ ...initSettings, ...(rootSettings.get(root) || {}) }).highlights !== false,
    notify: (method, params) => write({ method, params }),
  })
  const checkedIndex = (folder, entry) => { lens.checked(folder, entry); highlights.checked(folder, entry) }

  // PLAN-7 P4-5: rename (rename.js), always on the documents as they are now
  const renamer = createRename({
    checker, overlaysUnder, settingsFor, folderOf: rootOf, uriFor, caps: () => clientCaps, log,
    notify: (type, message) => write({ method: 'window/showMessage', params: { type, message } }),
  })

  /** Check the root of a document (when it is checked). */
  const scheduleFor = (abs, delay) => { const r = rootOf(abs); if (r) schedule(r, delay) }

  function isIdle() {
    if (exited) return true
    if (!ready || inFlight) return false
    for (const p of projects.values()) if (p.dirty || p.timer || p.configuring) return false
    return true
  }

  function pump() {
    if (exited) return
    if (ready && !inFlight) {
      const folder = rootList().find(r => projects.get(r).dirty && !projects.get(r).configuring)
      if (folder) {
        const p = projects.get(folder)
        p.dirty = false
        const sources = overlaysUnder(folder)
        const snap = nav.snapshot(sources)
        inFlight = folder
        // the index and completion index come as parts (core.js "Parts"): the index early when a
        // request waits, else with the completion index after the diagnostics; the check is in
        // flight until that late part (the lens refresh check after the requests it releases)
        let lateIn
        const late = new Promise(r => { lateIn = r })
        const onPart = (part) => {
          if (projects.has(folder) && !exited) {
            if (part.completion !== undefined) projects.get(folder).completion = indexState(part.completion, sources)
            if (part.error) log('error', `check of ${folder}: ${part.error}`)
            const entry = nav.indexPart(folder, snap, part)
            if (entry) setImmediate(() => { if (projects.has(folder) && !exited) checkedIndex(folder, entry) })
          }
          if (part.completion !== undefined) lateIn()
        }
        const checked = checker.call('check', { folder, settings: settingsFor(folder), sources }, { onPart })
          .then(res => { if (projects.has(folder) && !exited) checkedIndex(folder, nav.accept(folder, snap, res)); apply(folder, res, sources); return res.late ? late : undefined }, err => log('error', `check of ${folder} failed: ${err?.stack || err}`))
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
    notice(folder, p, res, sources)
    if (res.completion !== undefined) p.completion = indexState(res.completion, sources)
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
    for (const uri of p.uris) if (!next.has(uri)) publish(uri, [], folder)
    for (const [uri, list] of next) publish(uri, list, folder)
    p.uris = new Set(next.keys())
  }

  /**
   * G-665: say once what a check leaves out that the user may expect checked: open documents of
   * Sygnal source outside the root's `paths` (once per root + directory), or `paths` that match
   * no source file while a document of the root is open (once per root).
   */
  function notice(root, p, res, sources) {
    const where = shown(root, p.folder)
    const paths = (res.paths || []).join(', ')
    if (res.noFiles) {
      if (!sources.size || told.has(`none\0${root}`)) return
      // (a plain folder that isn't a Sygnal project: only when an open document looks like one)
      if (!roots.isRoot(root) && ![...sources.values()].some(looksLikeSygnal)) return
      told.add(`none\0${root}`)
      tell(`sygnal-check found no source files in ${paths} for ${where}; set "paths" in ${CONFIG_FILE}.`)
      return
    }
    for (const abs of res.outside || []) {
      const key = `out\0${root}\0${path.dirname(abs)}`
      if (told.has(key)) continue
      told.add(key)
      tell(`${shown(abs, p.folder)} isn't checked: it's outside sygnal-check's paths (${paths}) for ${where}. Add its folder to "paths" in ${CONFIG_FILE}.`)
    }
  }

  /** A message for the user: shown (window/showMessage, Info) when the client has window capabilities, and logged. */
  function tell(message) {
    log('warn', message)
    if (isObj(clientCaps.window)) write({ method: 'window/showMessage', params: { type: 3, message } })
  }

  /**
   * Publish a file's list when it differs from what the client has (an empty list only to clear
   * one). `root`: the project publishing; an empty list from a root that didn't publish the
   * current one is dropped (the file moved to another root, which has published it since).
   */
  function publish(uri, list, root) {
    const prev = published.get(uri)
    const key = JSON.stringify(list)
    if (!list.length) {
      if (!prev || (root && prev.root !== root)) return
      published.delete(uri)
    } else {
      if (prev?.key === key) { prev.root = root; return }
      published.set(uri, { key, list, root })
    }
    write({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: list } })
  }

  /** Ask for the settings of `list` (default: every checked root), one item per root, scopeUri = the root. */
  async function refreshConfiguration(list = rootList()) {
    if (!clientCaps.workspace?.configuration) return
    if (!list.length) return
    const res = await requestClient('workspace/configuration', { items: list.map(r => ({ scopeUri: pathToUri(r), section: 'sygnal' })) }, configurationTimeout)
    if (!Array.isArray(res)) return
    list.forEach((r, i) => {
      const { settings, problems } = readSettings(res[i])
      for (const m of problems) log('warn', m)
      if (settings.trace) traceLevel = settings.trace
      if (projects.has(r)) rootSettings.set(r, settings)
    })
  }

  // (pump() also with no root to check: idle waiters are released)
  const recheckAll = () => { for (const r of rootList()) schedule(r, 0); pump() }

  async function onInitialized() {
    configStarted = true
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
      initialized = true
      connected = true
      for (const m of problems) log('warn', m)
      log('info', `sygnal-check ${pkg.version} language server; folders: ${folders.join(', ')}; ${checker.usingWorker ? 'checks in a worker thread' : 'checks on the main thread'}`)
      for (const f of folders) addFolder(f)
      return {
        capabilities: {
          textDocumentSync: { openClose: true, change: 1, save: { includeText: false } },
          hoverProvider: true,
          completionProvider: { triggerCharacters: TRIGGER_CHARACTERS, resolveProvider: false },
          codeActionProvider: { codeActionKinds: CODE_ACTION_KINDS, resolveProvider: false },
          definitionProvider: true,
          referencesProvider: true,
          codeLensProvider: { resolveProvider: false },
          // not for a client that draws the highlights itself (highlights.js "Clients")
          ...(highlights.provider() ? { semanticTokensProvider: highlights.provider() } : {}),
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
      const folder = abs && isObj(params.position) && rootOf(abs)
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
      const folder = abs && rootOf(abs)
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
  requests['textDocument/semanticTokens/full'] = (params) => highlights.full(params)
  requests['sygnal/highlights'] = (params) => highlights.decoded(params)
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
      let configs = false
      for (const c of Array.isArray(params.changes) ? params.changes : []) {
        const abs = uriToPath(c?.uri)
        if (!abs) continue
        if (c.type === 3) overlays.delete(abs) // deleted: re-check from disk (its findings clear)
        if (isConfigFile(abs)) { configs = true; continue }
        // its root; a file outside every checked root may be imported by any root of its folder
        const r = rootOf(abs)
        if (r) touched.add(r)
        else for (const [root, p] of projects) if (within(abs, p.folder)) touched.add(root)
        for (const root of rootList()) if (within(root, abs)) touched.add(root) // a deleted directory
      }
      // a config or package.json: the roots again, and every root re-checked (its config may differ)
      if (configs) { redetect(); recheckAll(); return }
      for (const r of touched) schedule(r, 0)
    },
    'workspace/didChangeWorkspaceFolders'(params) {
      const ev = isObj(params.event) ? params.event : {}
      for (const r of Array.isArray(ev.removed) ? ev.removed : []) { const f = uriToPath(r?.uri); if (f) removeFolder(f) }
      // (activate() asks for each new root's settings, then checks it)
      for (const a of Array.isArray(ev.added) ? ev.added : []) { const f = uriToPath(a?.uri); if (f) addFolder(f) }
      for (const abs of overlays.keys()) { const r = detectRoot(abs); if (r) activate(r, folderOf(abs)) }
    },
    'textDocument/didOpen'(params) {
      const abs = docPath(params)
      if (!abs || typeof params.textDocument.text !== 'string') return
      docUris.set(abs, params.textDocument.uri)
      overlays.set(abs, params.textDocument.text)
      // the roots afresh (a client without file watching may have added a config since): a
      // dropped root re-checks every root, else the document's own root is checked
      if (redetect()) recheckAll()
      else scheduleFor(abs, 0)
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
      if (isConfigFile(abs)) { redetect(); recheckAll(); return } // (clients without file watching)
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
