// @vitest-environment jsdom
// PLAN-4 3-E (GS-10) acceptance: "Copy as test" for 3 sessions of real run() apps (kanban,
// TodoMVC, a form with reply actions), driven through the DOM and their drivers the way a user
// would. Each generated test is committed next to this file (test/copied/*.copied.test.js) and
// runs unchanged in this suite: those files are the proof. This test checks that copying the
// same session still produces exactly those files (UPDATE_COPIED_TESTS=1 rewrites them).
// Runs against the built package (npm run build) and needs the kanban / todomvc installs.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, makeFetchDriver, xs } from 'sygnal'

let dev
beforeAll(async () => { dev = await import('sygnal/devtools') })

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const $ = (sel, i = 0) => document.querySelectorAll(sel)[i]
const click = (sel, i = 0) => $(sel, i).dispatchEvent(new MouseEvent('click', { bubbles: true }))
const type = (sel, value) => { const el = $(sel); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }

let app
function mount(App, drivers) {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, drivers, { mountPoint: '#root' })
  return app
}
afterEach(() => { app?.dispose(); app = undefined })

function compare(name, result) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'copied', `${name}.copied.test.js`)
  if (process.env.UPDATE_COPIED_TESTS) fs.writeFileSync(file, result.code)
  expect(result.complete).toBe(true)
  expect(result.warnings).toEqual([])
  expect(result.code).toBe(fs.readFileSync(file, 'utf8'))
}

describe('Copy as test: three recorded sessions (PLAN-4 3-E acceptance)', () => {
  it('kanban: lanes added, moved and deleted, a task dragged to another lane, a lane dragged', async () => {
    const { RootComponent, mockDragDriver } = await import('./copied/kanban-app.js')
    const dnd = mockDragDriver()
    mount(RootComponent, { DND: dnd.driver })
    await tick(50)
    click('.add-lane-btn')                                  // ADD_LANE (lane-4)
    await tick(30)
    click('.move-lane-right')                              // the first lane: MOVE_LANE_RIGHT (via EVENTS)
    await tick(30)
    const card = document.querySelector('[data-task-id="task-1"]')
    dnd.emit('task:dragstart', { element: card, dataset: { ...card.dataset } })   // DRAG_START
    await tick(10)
    const done = document.querySelector('.lane-drop-zone[data-lane-id="lane-3"]')
    dnd.emit('lane:drop', { dropZone: done, insertBefore: null })                // DROP into Done
    dnd.emit('task:dragend', {})                                                  // DRAG_END (aborts)
    await tick(30)
    const handle = document.querySelector('.lane-drag-handle[data-lane-id="lane-3"]')
    dnd.emit('lane-sort:dragstart', { element: handle, dataset: { ...handle.dataset } })  // LANE_DRAG_START
    await tick(10)
    const header = document.querySelector('.lane-header[data-lane-id="lane-1"]')
    dnd.emit('lane-sort:drop', { dropZone: header, insertBefore: null })          // LANE_DROP
    await tick(30)
    click('.delete-lane-btn', 3)                           // the new lane: DELETE_LANE (via EVENTS)
    await tick(50)
    const state = app.sources.STATE.stream._v
    // lane-1 moved right, lane-3 dropped before lane-1, lane-4 deleted; task-1 in Done
    expect(state.lanes.map(l => l.id)).toEqual(['lane-2', 'lane-3', 'lane-1'])
    expect(state.lanes[1].tasks.map(t => t.id)).toEqual(['task-1'])

    compare('kanban', dev.copyAsTestResult(app, {
      componentImport: "import { RootComponent, mockDragDriver } from './kanban-app.js'",
      drivers: { DND: 'mockDragDriver().driver' },
      testName: 'kanban: a recorded session replays (copied from sygnal/devtools)',
    }))
  })

  it('TodoMVC: todos added, all toggled, filtered, completed cleared', async () => {
    const { APP, localStorageDriver } = await import('./copied/todomvc-app.js')
    localStorage.clear()
    let go
    // the session's router: takes the routes, navigates when the test says
    const router = (route$) => {
      route$.addListener({ next() {}, error() {}, complete() {} })
      return xs.create({ start: l => { go = r => l.next(r) }, stop() {} })
    }
    mount(APP, { STORE: localStorageDriver, ROUTER: router })
    await tick(50)
    const add = async (title) => {
      $('.new-todo').value = title
      $('.new-todo-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await tick(30)
    }
    await add('  Buy milk ')
    await add('Walk the dog')
    click('.toggle-all')                                   // TOGGLE_ALL: both done
    await tick(30)
    await add('Write tests')
    go('active')                                           // VISIBILITY
    await tick(30)
    click('.clear-completed')                              // CLEAR_COMPLETED
    await tick(50)
    const state = app.sources.STATE.stream._v
    expect(state).toMatchObject({ visibility: 'active', todos: [{ id: 3, title: 'Write tests', completed: false }] })

    compare('todomvc', dev.copyAsTestResult(app, {
      componentImport: "import { APP, localStorageDriver, silentRouter } from './todomvc-app.js'",
      drivers: { STORE: 'localStorageDriver', ROUTER: 'silentRouter' },
      environment: 'jsdom',
      testName: 'TodoMVC: a recorded session replays (copied from sygnal/devtools)',
    }))
  })

  it('a form with reply actions: a rejected signup (422), then an accepted one', async () => {
    const { default: SignupForm } = await import('./copied/signup-form.js')
    const calls = []
    const fetch = async (url, init) => {
      const { email } = JSON.parse(init.body)
      calls.push([url, email])
      const ok = email.includes('@')
      return new Response(JSON.stringify(ok ? { id: 1, name: 'Ada', email } : { message: 'Email is invalid' }), {
        status: ok ? 201 : 422, headers: { 'content-type': 'application/json' },
      })
    }
    mount(SignupForm, { HTTP: makeFetchDriver({ fetch }) })
    await tick(30)
    type('.email', 'ada')
    click('.submit')
    await tick(50)
    expect($('.error').textContent).toBe('Email is invalid')
    type('.email', 'ada@example.com')
    click('.submit')
    await tick(50)
    expect($('.welcome').textContent).toBe('Welcome, Ada')
    expect(calls).toEqual([['/api/signup', 'ada'], ['/api/signup', 'ada@example.com']])

    compare('signup-form', dev.copyAsTestResult(app, {
      componentImport: "import SignupForm from './signup-form.js'",
      testName: 'signup form: a recorded session with replies replays (copied from sygnal/devtools)',
    }))
  })
})
