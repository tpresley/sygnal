// Record/replay spike: the numbers in README §8 (opt-in: MEASURE=1; writes ../results.json).
//
// 1. Overhead per action: TodoMVC (the example's APP) with 50 todos, real DOM (jsdom), N real
//    clicks on item checkboxes (each: an item TOGGLE, the root's TO_STORE echo, one patch),
//    each awaited to its patch. Runs alternate between configurations, median of 11.
// 2. Log size per minute: a paced kanban session (KanbanSync: the autosave timer every 200 ms)
//    of SESSION_MS: typing lane titles at ~6.7 characters/s (80 wpm), adding lanes and tasks,
//    dragging, deleting; the bytes (raw and gzip) scaled to one minute.
import { it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { run, makeFetchDriver, makeTimerDriver, xs } from 'sygnal'
import { startRecording } from './recorder.js'
import { replay } from './replayer.js'
import { startServer, sleep, until } from './sessions.js'
import KanbanSync, { API } from './fixtures/kanbanSync.jsx'
import APP from '../../../../examples/todomvc/app.tsx'
import localStorageDriver from '../../../../examples/todomvc/lib/localStorageDriver.ts'
import { mockDragDriver } from '../../../../examples/kanban/src/testHelpers.js'

const on = !!process.env.MEASURE
const N = 300
const SESSION_MS = Number(process.env.SESSION_MS || 20000)
const results = {}
const median = xs_ => [...xs_].sort((a, b) => a - b)[Math.floor(xs_.length / 2)]

async function clicks(config) {
  localStorage.clear()
  localStorage.setItem('todos', JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: i + 1, title: `Todo number ${i + 1}`, completed: false }))))
  const rec = config && startRecording(config)
  document.body.innerHTML = '<div id="root"></div>'
  const router = r$ => { r$.addListener({ next() {}, error() {}, complete() {} }); return xs.never() }
  const app = run(APP, { STORE: localStorageDriver, ROUTER: router }, { mountPoint: '#root' })
  await until(() => document.querySelectorAll('.toggle').length === 50)
  await sleep(20)
  const boxes = () => document.querySelectorAll('.toggle')
  const t0 = performance.now()
  for (let i = 0; i < N; i++) {
    boxes()[i % 50].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await app.__runtime.flushed()
  }
  const ms = performance.now() - t0
  const log = rec && rec.stop()
  app.dispose()
  return { ms, log }
}

it.runIf(on)('overhead per action (TodoMVC, 50 todos, real DOM)', async () => {
  const configs = { off: null, record: {}, 'record+html': { vnodes: 'html' }, 'record+redact': { redact: true } }
  const times = Object.fromEntries(Object.keys(configs).map(k => [k, []]))
  let log
  await clicks(null); await clicks({}) // warm-up
  for (let r = 0; r < 11; r++) for (const [k, c] of Object.entries(configs)) {
    const x = await clicks(c)
    times[k].push(x.ms / N)
    if (k == 'record') log = x.log
  }
  // where the recorder's time goes (one more run, timed per hook; wrapHandler's wrapper itself
  // runs inside the handler call and is measured separately as handlerWrap)
  const profile = {}
  await clicks({ profile })
  const base = median(times.off)
  results.overhead = {
    actionsPerRun: N, perClickMs: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, +median(v).toFixed(3)])),
    overheadMs: Object.fromEntries(Object.keys(configs).filter(k => k != 'off').map(k => [k, +(median(times[k]) - base).toFixed(3)])),
    actionsPerClick: +(log.a.length / N).toFixed(2),
    logBytesPerClick: Math.round(JSON.stringify(log).length / N),
    stateBytes: JSON.stringify(log.init).length,
    hookMsPerClick: Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, +(v / N).toFixed(4)])),
  }
  // replaying the 300 clicks
  const t0 = performance.now()
  const r = await replay(APP, log)
  results.overhead.replayMsPerInput = +((performance.now() - t0) / log.a.length).toFixed(3)
  results.overhead.replayOk = r.ok
  r.t.dispose()
  expect(r.ok).toBe(true)
}, 120000)

it.runIf(on)('log size per minute (a paced kanban session)', async () => {
  const server = await startServer()
  for (const dropNoops of [true, false]) {
    server.reset()
    const rec = startRecording({ dropNoops })
    const dnd = mockDragDriver()
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(KanbanSync, { DND: dnd.driver, TIMER: makeTimerDriver(), HTTP: makeFetchDriver({ fetch: (u, i) => fetch(String(u).replace(API, server.base), i) }) }, { mountPoint: '#root' })
    const $ = (s, i = 0) => document.querySelectorAll(s)[i]
    const fire = (el, e) => el && el.dispatchEvent(e)
    await until(() => $('.lane-title'))
    const t0 = performance.now()
    let n = 0
    const words = ['Backlog', 'Review', 'Blocked on design', 'Ready for QA', 'Shipped this week']
    while (performance.now() - t0 < SESSION_MS) {
      const lane = n % 3
      fire($('.lane-title', lane), new MouseEvent('dblclick', { bubbles: true }))
      await until(() => $('.lane-title-input'))
      const input = $('.lane-title-input')
      input.value = ''
      for (const ch of words[n % words.length]) { input.value += ch; fire(input, new Event('input', { bubbles: true })); await sleep(150) }
      fire(input, new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
      await sleep(400)
      fire($('.add-task-btn', lane), new MouseEvent('click', { bubbles: true }))
      await until(() => $('.new-task-input'))
      $('.new-task-input').value = `Task ${n}`
      fire($('.new-task-input'), new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
      await sleep(400)
      const card = document.querySelector('.task-card')
      if (card) {
        dnd.emit('task:dragstart', { element: card, dataset: { ...card.dataset } })
        await sleep(300)
        dnd.emit('lane:drop', { dropZone: $('.lane-drop-zone', (lane + 1) % 3), insertBefore: null })
        dnd.emit('task:dragend', {})
      }
      await sleep(600)
      if (n % 4 == 3) fire($('.delete-task-btn'), new MouseEvent('click', { bubbles: true }))
      n++
    }
    await sleep(300)
    const log = rec.stop()
    app.dispose()
    const json = JSON.stringify(log)
    const minute = 60000 / log.end.ms
    const inputs = log.a.filter(a => 'inrBag'.includes(a.c)).length
    results[dropNoops ? 'perMinute' : 'perMinuteNoDrop'] = {
      sessionMs: log.end.ms, actions: log.a.length, inputs, dropped: log.end.dropped, checkpoints: log.k.length,
      bytes: json.length, gzip: zlib.gzipSync(json).length,
      perMinute: { actions: Math.round(log.a.length * minute), bytes: Math.round(json.length * minute), gzip: Math.round(zlib.gzipSync(json).length * minute) },
      bytesPerAction: Math.round(json.length / log.a.length),
    }
    if (dropNoops) {
      const t1 = performance.now()
      const r = await replay(KanbanSync, log)
      results.perMinute.replayMs = Math.round(performance.now() - t1)
      results.perMinute.replayOk = r.ok
      r.t.dispose()
      expect(r.ok).toBe(true)
    }
  }
  await server.close()
}, 300000)

// both tests' numbers, merged into what an earlier run (of one of them) wrote
afterAll(() => {
  if (!on || !Object.keys(results).length) return
  const file = fileURLToPath(import.meta.url).replace(/spike\/measure.test.jsx$/, 'results.json')
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  fs.writeFileSync(file, JSON.stringify({ ...prev, measured: new Date().toISOString(), node: process.version, ...results }, null, 2) + '\n')
})
