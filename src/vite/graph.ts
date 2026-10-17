/**
 * PLAN-10 W-2 / P-2: the live app graph page of sygnal/vite's dev server (D543, D544).
 *
 * `/__sygnal/graph` serves sygnal-check's graph page (`graphHtml`, the same file `sygnal-check
 * --graph=html --watch` serves) in live mode, and `/__sygnal/graph/events` its SSE stream: the
 * whole graph (`event: graph`, `id: <version>`) on connect (unless `Last-Event-ID` already has it)
 * and after each build whose graph changed, a `: ping` comment every 25 s. Dev server only.
 *
 * One live project (sygnal-check's createLiveProject, W-1) feeds the page, the check overlay and
 * the console (the plugin's `check`): each build gives the graph and the diagnostics, so they agree.
 * It builds on start and 100 ms after the last source or config file change Vite's watcher reports.
 *
 * P-2: each build also gives the top-level binding and static key (D521: 'file#name', '#2' for a
 * second of the same name in a file) of every component in a scanned file (sygnal-check's
 * componentStamps); the dev transform appends to those modules a tail that sets a non-enumerable
 * `__sygnalKey` on each component function, and the runtime inspect() reports it as `key`. A
 * module whose text changed since the last build is built again first, so a stamp is never stale.
 *
 * The page is served on the app's origin: its "Live data" (graphView/liveData.js) joins the open
 * app tabs over a BroadcastChannel (src/extra/devGraph.ts), with no server in between.
 *
 * Security: the same guard as `/__sygnal/mcp` (./mcp.ts refusal(): a loopback peer, a local Host
 * (or one in `server.allowedHosts`), a local Origin when there is one); GET and HEAD only; the page
 * gets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
 * `X-Frame-Options: DENY` and a CSP (inline style and script, `connect-src 'self'`, no framing).
 * Read only: it serves the page and the stream, nothing else.
 */
// @ts-ignore
import fs from 'node:fs'
// @ts-ignore
import path from 'node:path'
// @ts-ignore
import { createRequire } from 'node:module'
import { refusal } from './mcp'

export const GRAPH_PATH = '/__sygnal/graph'
export const GRAPH_EVENTS = GRAPH_PATH + '/events'
export const GRAPH_CLIENT = 'virtual:sygnal/graph'
export const GRAPH_CHANNEL = 'sygnal:graph'
/** The property the dev transform sets on component functions (read by inspect()) */
export const STAMP_PROP = '__sygnalKey'

const SOURCE_RE = /\.[cm]?[jt]sx?$/
const CONFIG_FILES = ['sygnal-check.config.json', 'package.json']
const EMPTY = { version: 1, source: 'static', components: [], events: {}, diagnostics: [] }
const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data: blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const SECURITY: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }

const posix = (p: string) => p.split(path.sep).join('/')

/** Whether the project's sygnal-check has the live graph page with "Live data" (checked without loading it). */
export function graphAvailable(root: string): boolean {
  try {
    const main = createRequire(path.join(root, 'package.json')).resolve('sygnal-check')
    return fs.existsSync(path.join(path.dirname(main), 'graphView', 'liveData.js'))
  } catch (_) {
    return false
  }
}

export interface LiveBuild { graph: any; json: string; version: number; changed: boolean; diagnostics: any[]; stamps: Map<string, Array<{ binding: string; key: string }>> | null; files: string[] }

export interface LiveEngine {
  /** build now; listeners hear about it */
  build(): LiveBuild | null
  readonly last: LiveBuild | null
  onBuild(fn: (b: LiveBuild) => void): void
  /** the stamps of a module (absolute path), after building again when its text changed */
  stampsFor(file: string): Array<{ binding: string; key: string }> | null
  /** follow Vite's watcher (100 ms debounce) */
  watch(server: any): void
  readonly mod: any
}

/**
 * The live project behind the page and the checker. `settings` are live.js's (paths = the check's
 * include, strict / a11y / ignore / defaults as the checker resolves them).
 */
export function createEngine(mod: any, root: string, settings: any, logger: any, stamps: boolean): LiveEngine {
  const live = mod.createLiveProject({ root })
  const listeners: Array<(b: LiveBuild) => void> = []
  let last: LiveBuild | null = null
  // the stamps by the live project's path of each file; `known` maps a module path as Vite gives it
  // (posix, possibly through a symlink) to that path
  let stampsByFile = new Map<string, Array<{ binding: string; key: string }>>()
  let known = new Map<string, string>()
  let failed = ''
  const real = (f: string) => { try { return posix(fs.realpathSync(f)) } catch (_) { return posix(f) } }

  const build = (): LiveBuild | null => {
    let b: any
    try {
      b = live.build({ settings, stamps })
    } catch (err: any) {
      const msg = String(err?.message || err)
      if (msg !== failed) logger.warn(`[sygnal] sygnal-check failed: ${msg}`, { timestamp: true })
      failed = msg
      return null
    }
    failed = ''
    if (!b.graph) b = { ...b, json: JSON.stringify(EMPTY) }
    last = b
    stampsByFile = b.stamps || new Map()
    known = new Map()
    for (const f of b.files || []) { known.set(posix(f), f); known.set(real(f), f) }
    for (const fn of listeners) { try { fn(b) } catch (_) { /* a listener never stops the others */ } }
    return b
  }

  const stampsFor = (file: string) => {
    if (!last) return null
    const own = known.get(posix(file)) ?? known.get(real(file))
    if (!own) return null
    let text: string | null = null
    try { text = fs.readFileSync(own, 'utf8') } catch (_) {}
    const entry = live.cache?.get?.(own)
    // changed since the last build (Vite transforms it before the watcher's debounced build)
    if (text !== null && (!entry || entry.text !== text)) build()
    return stampsByFile.get(own) || null
  }

  let timer: any
  const watch = (server: any) => {
    const onChange = (file: string) => {
      if (String(file).split(/[\\/]/).includes('node_modules')) return
      if (!SOURCE_RE.test(file) && !CONFIG_FILES.includes(path.basename(file))) return
      clearTimeout(timer)
      timer = setTimeout(build, 100)
    }
    const watcher = server?.watcher
    if (watcher && typeof watcher.on === 'function') {
      watcher.on('change', onChange)
      watcher.on('add', onChange)
      watcher.on('unlink', onChange)
    }
    try { server.httpServer?.once?.('close', () => clearTimeout(timer)) } catch (_) {}
  }

  return {
    build, stampsFor, watch, mod,
    get last() { return last },
    onBuild(fn) { listeners.push(fn) },
  }
}

/** The tail the dev transform appends to a module: a non-enumerable key on each component function. */
export function stampTail(list: Array<{ binding: string; key: string }>): string {
  const ok = list.filter(s => /^[A-Za-z_$][\w$]*$/.test(s.binding))
  if (!ok.length) return ''
  const pairs = ok.map(s => `[typeof ${s.binding} == 'function' ? ${s.binding} : null, ${JSON.stringify(s.key)}]`).join(', ')
  return `\n;(() => { try { for (const [f, k] of [${pairs}]) if (f) Object.defineProperty(f, '${STAMP_PROP}', { value: k, configurable: true }) } catch (_) {} })();\n`
}

/** 'virtual:sygnal/graph': the app side of the page's "Live data" (dev only) */
export function graphClientModule(): string {
  return `import { installGraphBridge } from 'sygnal/devtools';\ninstallGraphBridge({ channel: ${JSON.stringify(GRAPH_CHANNEL)} });\n`
}

function deny(res: any, status: number, text: string, headers: Record<string, string> = {}) {
  res.statusCode = status
  for (const k in { ...SECURITY, ...headers }) res.setHeader(k, ({ ...SECURITY, ...headers } as any)[k])
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(text + '\n')
}

function projectTitle(root: string): string {
  try {
    const name = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name
    if (typeof name === 'string' && name) return name
  } catch (_) {}
  return path.basename(root)
}

/**
 * The middleware for `/__sygnal/graph` and its stream. `engine` resolves to null when sygnal-check
 * isn't installed (or too old): the route then answers 404 with the install hint.
 */
export function graphMiddleware(server: any, root: string, engine: Promise<LiveEngine | null>, ping = 25000) {
  const streams = new Set<any>()
  let subscribed = false
  let pinger: any = null
  const event = (b: LiveBuild) => `event: graph\nid: ${b.version}\ndata: ${b.json}\n\n`
  const subscribe = (e: LiveEngine) => {
    if (subscribed) return
    subscribed = true
    e.onBuild((b) => { if (b.changed) for (const res of streams) res.write(event(b)) })
    pinger = setInterval(() => { for (const res of streams) res.write(': ping\n\n') }, ping)
    pinger.unref?.()
    try {
      server.httpServer?.once?.('close', () => {
        clearInterval(pinger)
        for (const res of streams) res.end()
        streams.clear()
      })
    } catch (_) {}
  }

  return async (req: any, res: any, next: any) => {
    const url = String(req.url || '').replace(/[?#].*$/, '')
    if (url !== GRAPH_PATH && url !== GRAPH_PATH + '/' && url !== GRAPH_EVENTS) return next()
    const why = refusal(req, server?.config?.server?.allowedHosts, 'the Sygnal graph page')
    if (why) return deny(res, 403, `Forbidden: ${why}`)
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' })
    const e = await engine
    if (!e) return deny(res, 404, 'The Sygnal graph page needs a sygnal-check with the live graph page in the project: npm i -D sygnal-check@latest')
    subscribe(e)
    const b = e.last || e.build()
    if (!b) return deny(res, 500, 'sygnal-check failed: see the dev server output')
    if (url === GRAPH_EVENTS) {
      res.writeHead(200, { ...SECURITY, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'Content-Security-Policy': "default-src 'none'" })
      if (req.method === 'HEAD') return res.end()
      res.write('retry: 1000\n\n')
      if (req.headers['last-event-id'] !== String(b.version)) res.write(event(b))
      streams.add(res)
      req.on('close', () => streams.delete(res))
      return
    }
    let body: string
    try {
      body = e.mod.graphHtml(b.graph || EMPTY, {
        title: projectTitle(root),
        subtitle: 'dev server',
        root,
        live: { events: GRAPH_EVENTS, version: b.version },
        appData: { channel: GRAPH_CHANNEL },
      })
    } catch (err: any) {
      return deny(res, 500, `The graph page failed: ${err?.message || err}`)
    }
    res.writeHead(200, { ...SECURITY, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, 'Content-Length': (globalThis as any).Buffer.byteLength(body) })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}

/** Adds the page's URL under Vite's own when the dev server prints them. */
export function printGraphUrl(server: any) {
  const print = server?.printUrls
  if (typeof print !== 'function') return
  server.printUrls = function (this: any, ...args: any[]) {
    const out = print.apply(this, args)
    try {
      const local = server.resolvedUrls?.local?.[0]
      if (local) (server.config?.logger || console).info(`  ➜  Sygnal graph: ${new URL(local).origin}${GRAPH_PATH}`)
    } catch (_) {}
    return out
  }
}
