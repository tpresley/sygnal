// Main thread vs worker, the same todomvc build (README §4). Chromium, headless, median of RUNS.
//   node dev-plans/research/web-worker/spike/measure.mjs            # RUNS=5 SIZES=0,1000,10000
//   node dev-plans/research/web-worker/spike/measure.mjs --json out.json
//
// Latency: from the input event's timeStamp (when the browser got it) to a frame after the DOM
// shows the result: MutationObserver sees it, then requestAnimationFrame + a macrotask (≈ after
// that frame's paint). Responsiveness: while the app handles toggle-all on N todos, a key press
// into the new-todo field: the Event Timing API's duration for that keydown (input delay +
// handling + the next paint: what INP measures), plus the main thread's long tasks and the
// longest gap between frames.
import {createRequire} from 'node:module'
import {writeFileSync} from 'node:fs'
import {serve} from './serve.mjs'

const require = createRequire(new URL('../../../../browser-tests/package.json', import.meta.url))
const {chromium} = require('playwright')
const RUNS = +(process.env.RUNS || 5)
const SIZES = (process.env.SIZES || '0,1000,10000').split(',').map(Number)
const MODES = ['main', 'worker']
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null

const {server, url} = await serve()
const browser = await chromium.launch()

// in every page before its scripts: long tasks, frames and Event Timing entries, and arm()
const probe = () => {
  window.__long = []
  new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => ({start: e.startTime, dur: e.duration})))).observe({type: 'longtask', buffered: true})
  window.__events = []
  new PerformanceObserver((l) => window.__events.push(...l.getEntries().map((e) => ({name: e.name, start: e.startTime, dur: e.duration, delay: e.processingStart - e.startTime})))).observe({type: 'event', durationThreshold: 16, buffered: true})
  window.__frames = []
  const frame = (t) => { window.__frames.push(t); requestAnimationFrame(frame) }
  requestAnimationFrame(frame)
  const afterPaint = () => new Promise((ok) => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = () => ok(performance.now()); c.port2.postMessage(0) }))
  /** resolves with ms from the first `type` event to a frame after `done()` holds */
  window.__arm = (type, doneSrc) => {
    const done = new Function('return (' + doneSrc + ')')
    let t0 = null
    addEventListener(type, (e) => { if (t0 == null) t0 = e.timeStamp }, {capture: true, once: true})
    return new Promise((ok, fail) => {
      // never hang the run: a step that doesn't finish in 30 s fails, naming its condition
      setTimeout(() => { mo.disconnect(); fail(new Error(`not reached in 30 s (event seen: ${t0 != null}): ${doneSrc}`)) }, 30000)
      const mo = new MutationObserver(async () => {
        if (t0 == null || !done()) return
        mo.disconnect()
        ok((await afterPaint()) - t0)
      })
      mo.observe(document.getElementById('root'), {subtree: true, childList: true, attributes: true, characterData: true})
    })
  }
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN }
const r1 = (x) => Math.round(x * 10) / 10

async function open(mode, n, query = '') {
  const page = await browser.newPage()
  await page.addInitScript(probe)
  await page.goto(`${url}/todomvc/${mode}.html${query}`)
  await page.evaluate((n) => {
    localStorage.setItem('todos', JSON.stringify(Array.from({length: n}, (_, i) => ({id: i + 1, title: 'Todo number ' + (i + 1), completed: false}))))
  }, n)
  const t0 = Date.now()
  await page.reload()
  await page.waitForFunction((n) => document.querySelectorAll('.todo-list li').length === n && document.querySelector('.new-todo'), n, {timeout: 60000, polling: 'raf'})
  const loaded = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    return {ready: performance.now() - (nav ? nav.startTime : 0), long: window.__long.reduce((s, l) => s + l.dur, 0), longest: Math.max(0, ...window.__long.map((l) => l.dur))}
  })
  await settled(page)
  return {page, loaded, wall: Date.now() - t0}
}

// every <Transition> done (the initial render's 10k enter transitions run for seconds), then quiet
async function settled(page) {
  await page.waitForFunction(() => !document.querySelector('[class*="-enter-"], [class*="-leave-"]'), null, {timeout: 120000, polling: 100})
  await page.waitForTimeout(300)
}

const bridgeStats = (page) => page.evaluate(async () => {
  const b = window.__bridge
  if (!b) return null
  const got = new Promise((ok) => b.worker.addEventListener('message', function f(e) { if (e.data.stats) { b.worker.removeEventListener('message', f); ok(e.data.stats) } }))
  b.worker.postMessage({stats: 1})
  return {page: {...b.stats}, worker: await got}
})
const resetStats = (page) => page.evaluate(() => { const b = window.__bridge; if (b) { b.reset(); b.worker.postMessage({stats: 'reset'}) } })

const results = {}
const record = (key, mode, v) => ((results[key] ||= {})[mode] ||= []).push(v)

/**
 * One page session: load with n todos, then four interactions. `withStats`: the worker page with
 * message counting on (?stats), for the message table only: counting stringifies every message
 * and every flush's vnode, so its timings aren't recorded
 */
async function session(mode, n, withStats) {
  if (process.env.TRACE) console.error(`session ${mode} n=${n}${withStats ? ' stats' : ''}`)
  const rec = withStats ? () => {} : (k, v) => record(k, mode, v)
  const msgs = {}
  const {page, loaded} = await open(mode, n, withStats ? '?stats' : '')
  rec(`load n=${n}: ready (ms)`, loaded.ready)
  rec(`load n=${n}: long tasks total (ms)`, loaded.long)

  // 1. add a todo: Enter → the new row painted
  await page.click('.new-todo')
  await page.keyboard.type('Fresh todo')
  await resetStats(page)
  await page.evaluate((n) => { window.__lat = window.__arm('keydown', `document.querySelectorAll('.todo-list li').length === ${n + 1}`) }, n)
  await page.keyboard.press('Enter')
  rec(`n=${n}: add a todo, Enter → painted (ms)`, await page.evaluate(() => window.__lat))
  await settled(page)
  msgs.add = await bridgeStats(page)

  // 2. toggle the first todo: click → .completed painted
  await resetStats(page)
  await page.evaluate(() => { window.__lat = window.__arm('mousedown', `document.querySelector('.todo-list li').classList.contains('completed')`) })
  await page.click('.todo-list li .toggle')
  rec(`n=${n}: toggle one, click → painted (ms)`, await page.evaluate(() => window.__lat))
  await settled(page)
  msgs['toggle one'] = await bridgeStats(page)

  // 3. a keystroke in the controlled edit field (EDIT_INPUT re-renders the item)
  await page.dblclick('.todo-list li:first-child label')
  await page.waitForFunction(() => document.activeElement?.classList.contains('edit'))
  await page.waitForTimeout(100)
  await resetStats(page)
  await page.keyboard.type('x')
  await page.waitForTimeout(300)
  msgs['edit keystroke'] = await bridgeStats(page)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 4. toggle all N+1 while the user presses a key in the new-todo field
  await page.focus('.new-todo')
  await page.evaluate(() => { window.__long.length = 0; window.__events.length = 0; window.__frames.length = 0 })
  await resetStats(page)
  const t0 = await page.evaluate(() => performance.now())
  // toggle-all completes everything unless everything is completed already (n=0: the one todo)
  await page.evaluate(() => {
    const all = document.querySelectorAll('.todo-list li').length, done = document.querySelectorAll('.todo-list li.completed').length
    window.__lat = window.__arm('click', `document.querySelectorAll('.todo-list li.completed').length === ${done === all ? 0 : all}`)
  })
  await page.evaluate(() => document.querySelector('.toggle-all').click())
  await page.keyboard.press('z')
  const allDone = await page.evaluate(() => window.__lat)
  await page.waitForTimeout(300)
  const w = await page.evaluate((t0) => {
    const long = window.__long.filter((l) => l.start >= t0)
    const key = window.__events.filter((e) => e.name === 'keydown' && e.start >= t0)
    const f = window.__frames.filter((t) => t >= t0)
    let gap = 0
    for (let i = 1; i < f.length; i++) gap = Math.max(gap, f[i] - f[i - 1])
    return {long: long.length, longMs: long.reduce((s, l) => s + l.dur, 0), key: key.length ? key[0].dur : 16, gap}
  }, t0)
  msgs['toggle all'] = await bridgeStats(page)
  rec(`n=${n}: toggle all, click → all painted (ms)`, allDone)
  rec(`n=${n}: toggle all: page long tasks (count)`, w.long)
  rec(`n=${n}: toggle all: page long tasks (ms)`, w.longMs)
  rec(`n=${n}: toggle all: longest frame gap (ms)`, w.gap)
  rec(`n=${n}: toggle all: keydown meanwhile, input→paint (ms, ≤16 = not reported)`, w.key)
  await page.close()
  return msgs
}

for (const n of SIZES) {
  for (let run = 0; run < RUNS; run++) for (const mode of MODES) await session(mode, n, false)
  const msgs = await session('worker', n, true)
  for (const [what, s] of Object.entries(msgs)) {
    (results.messages ||= {})[`n=${n}: ${what}`] = {
      'page→worker': `${s.page.out} msgs, ${s.page.outBytes} B`,
      'worker→page': `${s.page.in} msgs, ${s.page.inBytes} B, ${s.page.ops} ops`,
      'page apply (ms)': r1(s.page.applyMs),
      'worker flush diff (ms)': r1(s.worker.flushMs),
      'as vnodes instead': `${s.worker.vnodes} vnodes, ${s.worker.vnodeBytes} B`,
    }
  }
  process.stderr.write(`n=${n} done\n`)
}

await browser.close()
server.close()

const table = {}
for (const [k, v] of Object.entries(results)) {
  if (k === 'messages') continue
  table[k] = {main: r1(median(v.main)), worker: r1(median(v.worker)), 'main runs': v.main.map(r1).join(' '), 'worker runs': v.worker.map(r1).join(' ')}
}
console.table(table)
console.table(results.messages)
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({runs: RUNS, table, messages: results.messages}, null, 2))
