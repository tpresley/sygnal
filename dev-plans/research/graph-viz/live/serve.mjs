#!/usr/bin/env node
/**
 * S-3 throwaway prototype of `sygnal-check --graph=html --watch` (W-1). Not the design: the
 * smallest thing that answers the transport questions (watcher choice, event bursts, rebuild
 * cost, SSE through a token on loopback, latency from save to the page).
 *
 *   node dev-plans/research/graph-viz/live/serve.mjs <project-dir> [--debounce=50] [--poll] [--log=file.jsonl]
 *
 * - builds the graph with a ParseCache (sygnal-check/src/cache.js), the config resolved from <project-dir>
 * - watches with fs.watch({ recursive: true }) where the platform supports it (--per-dir forces the fallback), else one
 *   non-recursive fs.watch per directory (the Linux / Node 18 fallback), or polling with --poll
 * - serves on 127.0.0.1, a random port, a random token: GET /?t=<token> the page,
 *   GET /events?t=<token> an SSE stream ('graph' events with the whole graph JSON); anything else
 *   403 / 404; a Host header other than 127.0.0.1:<port> / localhost:<port> is refused (DNS rebinding)
 * - the page: template.html with the graph inlined, plus a small script that keeps the zoom and
 *   the selection across a reload when a new graph arrives (the in-place update is V-1's job; see
 *   live-mode.md for its design)
 * - prints one JSON line per rebuild to stderr (and to --log): changed paths, events coalesced, ms
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { graph } from '../../../../sygnal-check/src/graph.js'
import { createParseCache } from '../../../../sygnal-check/src/cache.js'
import { resolveOptions } from '../../../../sygnal-check/src/config.js'
import { IGNORED_DIRS } from '../../../../sygnal-check/src/files.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : args.includes(`--${n}`) ? true : d }
const root = path.resolve(args.find(a => !a.startsWith('--')) || '.')
const debounce = Number(opt('debounce', 50))
const logFile = opt('log', null)
const { options } = resolveOptions({ cwd: root })
const inputs = options.paths.map(p => path.resolve(root, p))

// ---------------------------------------------------------------- build
const cache = createParseCache()
let current = null // { json, version }
let version = 0
function rebuild(reason) {
  const t0 = performance.now()
  let g
  try { g = graph(null, { cwd: root, cache }) } catch (err) { log({ error: String(err?.stack || err) }); return }
  const json = JSON.stringify(g)
  const ms = +(performance.now() - t0).toFixed(1)
  const same = current && current.json === json
  if (!same) { current = { json, version: ++version }; broadcast() }
  log({ version, ms, same, components: g.components.length, bytes: json.length, ...reason })
}
function log(o) {
  const line = JSON.stringify({ t: Date.now(), ...o })
  process.stderr.write(line + '\n')
  if (logFile) fs.appendFileSync(logFile, line + '\n')
}

// ---------------------------------------------------------------- watch
const SOURCE = /\.[cm]?[jt]sx?$/
const CONFIG = new Set(['sygnal-check.config.json', 'package.json'])
const relevant = (abs) => {
  const rel = path.relative(root, abs)
  if (rel.split(path.sep).some(d => IGNORED_DIRS.has(d) || (d.startsWith('.') && d !== '.' && d !== '..'))) return false
  return SOURCE.test(abs) || CONFIG.has(path.basename(abs))
}
let timer = null
let pending = new Set()
let events = 0
const onEvent = (abs) => {
  if (!abs || !relevant(abs)) return
  events++
  pending.add(path.relative(root, abs))
  clearTimeout(timer)
  timer = setTimeout(() => { const changed = [...pending]; const n = events; pending = new Set(); events = 0; rebuild({ changed, events: n }) }, debounce)
}

const watchers = []
let mode
function watchRecursive(dir) {
  watchers.push(fs.watch(dir, { recursive: true }, (_type, name) => onEvent(name && path.join(dir, String(name)))))
}
function watchTree(dir) {
  // the fallback: one non-recursive watcher per directory, new directories picked up on 'rename'
  const seen = new Set()
  const add = (d) => {
    if (seen.has(d)) return
    let st; try { st = fs.statSync(d) } catch { return }
    if (!st.isDirectory()) return
    seen.add(d)
    watchers.push(fs.watch(d, (type, name) => {
      const abs = name && path.join(d, String(name))
      if (type === 'rename' && abs) add(abs)
      onEvent(abs)
    }))
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) add(path.join(d, e.name))
  }
  add(dir)
  return seen.size
}
function watchPoll(dir) {
  // the last resort: fs.watchFile on every source file (and nothing for new files: a rescan would)
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p) } else if (relevant(p)) { fs.watchFile(p, { interval: 200 }, () => onEvent(p)); watchers.push({ close: () => fs.unwatchFile(p) }) } } }
  walk(dir)
}
const dirs = [...new Set(inputs.map(p => { try { return fs.statSync(p).isDirectory() ? p : path.dirname(p) } catch { return null } }).filter(Boolean))]
if (opt('poll')) { mode = 'poll'; dirs.forEach(watchPoll) }
else if (opt('per-dir')) { mode = 'per-directory'; dirs.forEach(watchTree) }
else {
  try { dirs.forEach(watchRecursive); mode = 'recursive' } catch (err) {
    // ERR_FEATURE_UNAVAILABLE_ON_PLATFORM: Linux before Node 19.1 / 20
    for (const w of watchers.splice(0)) w.close()
    mode = 'per-directory'; dirs.forEach(watchTree)
  }
}
// the config files at the root (outside src/)
for (const f of CONFIG) { const p = path.join(root, f); if (fs.existsSync(p)) watchers.push(fs.watch(p, () => onEvent(p))) }

// ---------------------------------------------------------------- serve
const token = crypto.randomBytes(18).toString('base64url')
const clients = new Set()
function broadcast() {
  for (const res of clients) res.write(`event: graph\nid: ${current.version}\ndata: ${current.json}\n\n`)
}
const LIVE = `<script>
(() => {
  // prototype: keep the view across a reload (V-1 applies the graph in place instead)
  const es = new EventSource('/events' + location.search)
  let first = true
  es.addEventListener('graph', (e) => {
    if (first && Number(e.lastEventId) === __VERSION__) { first = false; return }
    sessionStorage.setItem('sygnal-graph:live', JSON.stringify(window.__graphState?.() ?? {}))
    location.reload()
  })
})()
</script>`
function page() {
  const inline = (v) => JSON.stringify(v).replace(/[<\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
  const meta = { title: path.basename(root), subtitle: `live · v${current.version}`, root, codes: {} }
  return fs.readFileSync(path.join(here, '..', 'template.html'), 'utf8')
    .replace('__TITLE__', meta.title.replace(/[<&]/g, ''))
    .replace('__GRAPH__', () => current.json.replace(/</g, '\\u003c'))
    .replace('__META__', () => inline(meta))
    // expose the view and selection, and restore them after a reload (prototype only)
    .replace('fit(undefined, false)\nconst first', `window.__graphState = () => ({ view, selected })
{ let s = null; try { s = JSON.parse(sessionStorage.getItem('sygnal-graph:live')) } catch (_) {}
  if (s && s.view) { view = s.view; apply() } else fit(undefined, false)
  if (s && s.selected && byId.has(s.selected)) select(s.selected) }
const first`)
    .replace('</body>', LIVE.replace('__VERSION__', String(current.version)) + '</body>')
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const host = req.headers.host
  const port = server.address().port
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403).end(); return }
  const given = url.searchParams.get('t') || ''
  const ok = given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))
  if (!ok) { res.writeHead(403).end(); return }
  const sec = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { ...sec, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data: blob:" })
    res.end(page())
  } else if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { ...sec, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
    res.write(`retry: 1000\n\n`)
    res.write(`event: graph\nid: ${current.version}\ndata: ${current.json}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
  } else res.writeHead(404, sec).end()
})
// keep-alive comments: proxies and some browsers drop an idle stream
const ping = setInterval(() => { for (const res of clients) res.write(': ping\n\n') }, 25000)
rebuild({ initial: true })
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/?t=${token}`
  log({ listening: url, mode, watchers: watchers.length })
  process.stdout.write(url + '\n')
})
const shutdown = () => {
  clearInterval(ping); clearTimeout(timer)
  for (const w of watchers) w.close()
  for (const res of clients) res.end()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
