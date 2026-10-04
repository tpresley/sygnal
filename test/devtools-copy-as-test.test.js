// @vitest-environment jsdom
// PLAN-4 3-E (GS-10) acceptance: "Copy as test" for 3 sessions of real run() apps (kanban,
// TodoMVC, a form with reply actions), driven through the DOM and their drivers the way a user
// would. Each generated test is committed next to this file (test/copied/*.copied.test.js) and
// runs unchanged in this suite: those files are the proof. This test checks that copying the
// same session still produces exactly those files (UPDATE_COPIED_TESTS=1 rewrites them).
// Runs against the built package (npm run build) and needs the kanban / todomvc installs.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, makeFetchDriver, xs } from 'sygnal'

let dev
beforeAll(async () => { dev = await import('sygnal/devtools') })

// G-233: each step waits for its effect (state or DOM), not a fixed time: fixed ticks failed
// under full-suite load. The comparison itself is retried until every action is recorded.
const until = (fn) => vi.waitFor(fn, { timeout: 5000, interval: 5 })
const state = () => app.sources.STATE.stream._v
const $ = (sel, i = 0) => document.querySelectorAll(sel)[i]
const $$ = (sel) => [...document.querySelectorAll(sel)]
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
    const laneOrder = () => $$('.lane-header').map(e => e.dataset.laneId)
    await until(() => expect(laneOrder()).toEqual(['lane-1', 'lane-2', 'lane-3']))
    click('.add-lane-btn')                                  // ADD_LANE (lane-4)
    await until(() => expect(laneOrder()).toEqual(['lane-1', 'lane-2', 'lane-3', 'lane-4']))
    click('.move-lane-right')                              // the first lane: MOVE_LANE_RIGHT (via EVENTS)
    await until(() => expect(laneOrder()).toEqual(['lane-2', 'lane-1', 'lane-3', 'lane-4']))
    const card = document.querySelector('[data-task-id="task-1"]')
    dnd.emit('task:dragstart', { element: card, dataset: { ...card.dataset } })   // DRAG_START
    await until(() => expect(state().dragging).toEqual({ taskId: 'task-1' }))
    const done = document.querySelector('.lane-drop-zone[data-lane-id="lane-3"]')
    dnd.emit('lane:drop', { dropZone: done, insertBefore: null })                // DROP into Done
    dnd.emit('task:dragend', {})                                                  // DRAG_END (aborts)
    await until(() => expect($('.lane-drop-zone[data-lane-id="lane-3"] [data-task-id="task-1"]')).toBeTruthy())
    expect(state().dragging).toBe(null)
    const handle = document.querySelector('.lane-drag-handle[data-lane-id="lane-3"]')
    dnd.emit('lane-sort:dragstart', { element: handle, dataset: { ...handle.dataset } })  // LANE_DRAG_START
    await until(() => expect(state().draggingLane).toBe('lane-3'))
    const header = document.querySelector('.lane-header[data-lane-id="lane-1"]')
    dnd.emit('lane-sort:drop', { dropZone: header, insertBefore: null })          // LANE_DROP
    await until(() => expect(laneOrder()).toEqual(['lane-2', 'lane-3', 'lane-1', 'lane-4']))
    click('.delete-lane-btn', 3)                           // the new lane: DELETE_LANE (via EVENTS)
    await until(() => expect(laneOrder()).toEqual(['lane-2', 'lane-3', 'lane-1']))
    // lane-1 moved right, lane-3 dropped before lane-1, lane-4 deleted; task-1 in Done
    expect(state().lanes.map(l => l.id)).toEqual(['lane-2', 'lane-3', 'lane-1'])
    expect(state().lanes[1].tasks.map(t => t.id)).toEqual(['task-1'])

    await until(() => compare('kanban', dev.copyAsTestResult(app, {
      componentImport: "import { RootComponent, mockDragDriver } from './kanban-app.js'",
      drivers: { DND: 'mockDragDriver().driver' },
      testName: 'kanban: a recorded session replays (copied from sygnal/devtools)',
    })))
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
    await until(() => expect(dev.getSession(app).actions.map(a => a.type)).toContain('FROM_STORE'))
    await until(() => expect($('.new-todo-form')).toBeTruthy())
    const add = async (title, count) => {
      $('.new-todo').value = title
      $('.new-todo-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await until(() => expect(state().todos).toHaveLength(count))
    }
    await add('  Buy milk ', 1)
    await add('Walk the dog', 2)
    click('.toggle-all')                                   // TOGGLE_ALL: both done
    await until(() => expect(state().todos.map(t => t.completed)).toEqual([true, true]))
    await add('Write tests', 3)
    go('active')                                           // VISIBILITY
    await until(() => expect(state().visibility).toBe('active'))
    await until(() => expect($('.clear-completed')).toBeTruthy())
    click('.clear-completed')                              // CLEAR_COMPLETED
    await until(() => expect(state().todos).toHaveLength(1))
    expect(state()).toMatchObject({ visibility: 'active', todos: [{ id: 3, title: 'Write tests', completed: false }] })

    await until(() => compare('todomvc', dev.copyAsTestResult(app, {
      componentImport: "import { APP, localStorageDriver, silentRouter } from './todomvc-app.js'",
      drivers: { STORE: 'localStorageDriver', ROUTER: 'silentRouter' },
      environment: 'jsdom',
      testName: 'TodoMVC: a recorded session replays (copied from sygnal/devtools)',
    })))
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
    await until(() => expect($('.submit')).toBeTruthy())
    type('.email', 'ada')
    click('.submit')
    await until(() => expect($('.error')?.textContent).toBe('Email is invalid'))
    type('.email', 'ada@example.com')
    click('.submit')
    await until(() => expect($('.welcome')?.textContent).toBe('Welcome, Ada'))
    expect(calls).toEqual([['/api/signup', 'ada'], ['/api/signup', 'ada@example.com']])

    await until(() => compare('signup-form', dev.copyAsTestResult(app, {
      componentImport: "import SignupForm from './signup-form.js'",
      testName: 'signup form: a recorded session with replies replays (copied from sygnal/devtools)',
    })))
  })
})
