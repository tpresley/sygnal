#!/usr/bin/env node
/**
 * S-3 probe: save → SSE 'graph' event latency of serve.mjs, for an in-place write and an
 * editor-style atomic save (write a temp file, rename over), and the auth checks.
 *
 *   node dev-plans/research/graph-viz/live/latency.mjs <copy-of-a-project> <file-in-it> [serve flags...]
 *
 * Edits <file> in place (use a copy: the fixture copied to a scratch dir).
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const [dir, file, ...flags] = process.argv.slice(2)
const abs = path.resolve(dir, file)
const original = fs.readFileSync(abs, 'utf8')
const child = spawn(process.execPath, [path.join(here, 'serve.mjs'), dir, ...flags], { stdio: ['ignore', 'pipe', 'pipe'] })
const logs = []
child.stderr.on('data', d => logs.push(...String(d).trim().split('\n').map(l => { try { return JSON.parse(l) } catch { return l } })))
const url = await new Promise(r => child.stdout.once('data', d => r(String(d).trim())))
const u = new URL(url)
const get = (p, headers = {}) => new Promise(r => http.get({ host: u.hostname, port: u.port, path: p, headers }, res => { res.resume(); r(res.statusCode) }))

const auth = {
  page: await get('/' + u.search),
  noToken: await get('/'),
  badToken: await get('/?t=nope'),
  badHost: await get('/' + u.search, { Host: `evil.example:${u.port}` }),
  otherPath: await get('/x' + u.search),
}

// the SSE stream
let waiting = null
const received = []
await new Promise(r => http.get({ host: u.hostname, port: u.port, path: '/events' + u.search }, res => {
  let buf = ''
  res.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2)
      if (!block.startsWith('event: graph')) continue
      received.push({ at: performance.now(), bytes: block.length })
      if (waiting) { const w = waiting; waiting = null; w() } else r()
    }
  })
}))
// (an edit must change the graph: prepended lines move every id of the file; a graph equal to
// the last one sends nothing)
const next = () => new Promise((r, j) => { waiting = r; setTimeout(() => j(new Error('no graph event within 3 s')), 3000).unref() })
process.on('unhandledRejection', (e) => { child.kill('SIGINT'); fs.writeFileSync(abs, original); console.error(e.message, results, logs); process.exit(1) })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const results = []
for (let i = 0; i < 5; i++) {
  await sleep(150)
  // in place
  let p = next(); let t = performance.now()
  fs.writeFileSync(abs, "//\n".repeat(2 * i + 1) + original)
  await p; results.push({ kind: 'write', ms: +(performance.now() - t).toFixed(1) })
  await sleep(150)
  // atomic save (VS Code's default is in place; vim / JetBrains "safe write" rename over)
  p = next(); t = performance.now()
  const tmp = abs + '.tmp~'
  fs.writeFileSync(tmp, "//\n".repeat(2 * i + 2) + original)
  fs.renameSync(tmp, abs)
  await p; results.push({ kind: 'atomic', ms: +(performance.now() - t).toFixed(1) })
}
// a no-op save (same text): no event should follow
await sleep(150)
const before = received.length
fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8'))
await sleep(400)
const noopEvents = received.length - before
fs.writeFileSync(abs, original)
await sleep(300)
child.kill('SIGINT')
await new Promise(r => child.once('exit', r))
const rebuilds = logs.filter(l => l && l.version !== undefined && !l.initial)
console.log(JSON.stringify({
  auth,
  mode: logs.find(l => l.mode)?.mode,
  latency: results,
  medianWrite: results.filter(r => r.kind === 'write').map(r => r.ms).sort((a, b) => a - b)[2],
  medianAtomic: results.filter(r => r.kind === 'atomic').map(r => r.ms).sort((a, b) => a - b)[2],
  noopSaveSseEvents: noopEvents,
  rebuilds: rebuilds.map(l => ({ ms: l.ms, events: l.events, same: l.same, changed: l.changed })),
}, null, 1))
