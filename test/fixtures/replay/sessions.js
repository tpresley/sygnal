// sygnal/replay tests: two real sessions, recorded the way a user's would be: run() on the real
// DOM driver (jsdom), real DOM events, the real makeFetchDriver against a real HTTP server on
// localhost, the real makeTimerDriver on real timers, localStorage (TodoMVC's STORE) and
// kanban's drag source (its tests' stand-in: jsdom has no drag and drop).
import http from 'node:http'
import { run, makeFetchDriver, makeTimerDriver, xs } from 'sygnal'
import { startRecording } from 'sygnal/replay'
import KanbanSync, { API as KANBAN_API } from './kanbanSync.js'
import TodoSync, { API as TODO_API } from './todoSync.ts'
import { mockDragDriver } from '../../../examples/kanban/src/testHelpers.js'
import localStorageDriver from '../../../examples/todomvc/lib/localStorageDriver.ts'

/** a real server: POST /board counts saves, GET /seed answers two todos after 15 ms */
export async function startServer() {
  let saves = 0
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      requests.push([req.method, req.url, body.length])
      const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)) }
      if (req.method == 'POST' && req.url == '/board') return send(200, { saves: ++saves })
      if (req.url == '/seed') return setTimeout(() => send(200, [{ title: 'Read the record/replay notes' }, { title: 'Try a replay', completed: true }]), 15)
      send(404, { error: 'not found' })
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, requests, reset: () => { saves = 0 }, close: () => new Promise(r => server.close(r)) }
}

/** makeFetchDriver over the real fetch, the app's API host mapped to the local server */
const fetchTo = (api, base) => makeFetchDriver({ fetch: (url, init) => fetch(String(url).replace(api, base), init) })

export const until = async (fn, ms = 4000) => {
  const t0 = Date.now()
  for (;;) {
    try { const v = fn(); if (v !== false && v !== undefined) return v } catch (e) { if (Date.now() - t0 > ms) throw e }
    if (Date.now() - t0 > ms) throw new Error('until: timed out')
    await new Promise(r => setTimeout(r, 5))
  }
}
export const sleep = ms => new Promise(r => setTimeout(r, ms))
const $ = (sel, i = 0) => document.querySelectorAll(sel)[i]
const $$ = sel => [...document.querySelectorAll(sel)]
const fire = (el, ev) => el.dispatchEvent(ev)
const click = (sel, i = 0) => fire($(sel, i), new MouseEvent('click', { bubbles: true }))
const dblclick = (sel, i = 0) => fire($(sel, i), new MouseEvent('dblclick', { bubbles: true }))
/** typing: one input event per character, as a user would */
const typeInto = async (sel, text) => {
  const el = $(sel)
  for (const ch of text) { el.value += ch; fire(el, new Event('input', { bubbles: true })); await sleep(1) }
}
const key = (sel, k, code) => fire($(sel), new KeyboardEvent('keydown', { key: k, keyCode: code, bubbles: true }))

function mount(App, drivers) {
  document.body.innerHTML = '<div id="root"></div>'
  return run(App, drivers, { mountPoint: '#root' })
}

/**
 * kanban: add a lane, rename a lane (typed), add a task (its id from Date.now()), drag a task to
 * Done, wait for the autosave (timer -> POST -> SAVED with Date.now() / Math.random()), move a
 * lane, delete a task, wait for the second autosave.
 */
export async function recordKanban({ server, recorder = {} } = {}) {
  server.reset()
  const rec = startRecording(recorder)
  const dnd = mockDragDriver()
  const app = mount(KanbanSync, { DND: dnd.driver, HTTP: fetchTo(KANBAN_API, server.base), TIMER: makeTimerDriver() })
  const state = () => app.sources.STATE.stream._v
  try {
    const laneOrder = () => $$('.lane-header').map(e => e.dataset.laneId)
    await until(() => laneOrder().length === 3)
    click('.add-lane-btn')
    await until(() => laneOrder().length === 4)
    dblclick('.lane-title')
    await until(() => $('.lane-title-input'))
    $('.lane-title-input').value = ''
    await typeInto('.lane-title-input', 'Backlog')
    key('.lane-title-input', 'Enter', 13)
    await until(() => state().lanes[0].title === 'Backlog')
    click('.add-task-btn', 1)
    await until(() => $('.new-task-input'))
    $('.new-task-input').value = 'Ship the replay spike'
    key('.new-task-input', 'Enter', 13)
    await until(() => state().lanes[1].tasks.length === 2)
    const card = document.querySelector('[data-task-id="task-1"]')
    dnd.emit('task:dragstart', { element: card, dataset: { ...card.dataset } })
    await until(() => state().dragging)
    dnd.emit('lane:drop', { dropZone: document.querySelector('.lane-drop-zone[data-lane-id="lane-3"]'), insertBefore: null })
    dnd.emit('task:dragend', {})
    await until(() => state().lanes[2].tasks.length === 1)
    await until(() => state().saves === 1)
    click('.move-lane-right')
    await until(() => laneOrder()[0] === 'lane-2')
    click('.delete-task-btn')
    await until(() => state().saves === 2)
    await sleep(30)
    return { log: rec.stop(), final: state(), html: document.querySelector('#root').innerHTML }
  } finally {
    rec.stop()
    app.dispose()
  }
}

/**
 * TodoMVC: start (BOOTSTRAP: routes via next(), the seed GET), wait for the seed reply, add two
 * todos (each a toast with a randomUUID, cleared by an `after` timer), toggle one, edit one by
 * typing, filter to active (the router), clear completed.
 */
export async function recordTodo({ server, recorder = {} } = {}) {
  localStorage.clear()
  let go
  const router = route$ => {
    route$.addListener({ next() {}, error() {}, complete() {} })
    return xs.create({ start: l => { go = r => l.next(r) }, stop() {} })
  }
  const rec = startRecording(recorder)
  const app = mount(TodoSync, { STORE: localStorageDriver, ROUTER: router, HTTP: fetchTo(TODO_API, server.base), TIMER: makeTimerDriver() })
  const state = () => app.sources.STATE.stream._v
  try {
    await until(() => state()?.seeded)
    const add = async (title, n) => {
      $('.new-todo').value = title
      fire($('.new-todo-form'), new Event('submit', { bubbles: true, cancelable: true }))
      await until(() => state().todos.length === n)
    }
    await add('Buy milk', 3)
    await until(() => state().toast === null)
    await add('Walk the dog', 4)
    await until(() => $$('.toggle').length === 4)
    click('.toggle', 0)
    await until(() => state().todos[0].completed)
    dblclick('.todo-4 label')
    await until(() => state().todos[3].editing)
    $('.todo-4 .edit').value = ''
    await typeInto('.todo-4 .edit', 'Walk the cat')
    fire($('.todo-4 .edit'), new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
    await until(() => state().todos[3].title === 'Walk the cat')
    go('active')
    await until(() => state().visibility === 'active')
    await until(() => $('.clear-completed'))
    click('.clear-completed')
    await until(() => state().todos.length === 2)
    await until(() => state().toast === null)
    await sleep(20)
    return { log: rec.stop(), final: state(), html: document.querySelector('#root').innerHTML }
  } finally {
    rec.stop()
    app.dispose()
  }
}

export { KanbanSync, TodoSync }
