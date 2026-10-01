// End-to-end tests for the TodoMVC app: DOM events → intent → model → sinks,
// through renderComponent's mock DOM, with the real localStorage driver (jsdom)
// and a stand-in for the hash router.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { xs, renderComponent } from 'sygnal'
import type { RenderResult } from 'sygnal'
import type { Stream } from 'xstream'
// The sygnal() Vite plugin already loads this as a Vitest setup file;
// importing it here keeps the test meaningful on its own.
import { checks, isStrictEnabled, resetChecks } from 'sygnal/diagnostics'
import APP from './app'
import localStorageDriver from './lib/localStorageDriver'

type Todo = { id: number, title: string, completed: boolean, editing?: boolean }

// routerDriver (director) listens on window.location.hash; this stand-in
// records the registered routes and lets the test navigate.
function mockRouter() {
  const routes: string[] = []
  let listener: { next: (r: string) => void } | null = null
  const driver = (route$: Stream<string>) => {
    route$.addListener({ next: (r) => routes.push(r), error() {}, complete() {} })
    return xs.create<string>({ start: (l) => { listener = l }, stop: () => { listener = null } })
  }
  return { driver, routes, go: (route: string) => listener?.next(route) }
}

function render(options: { strict?: boolean } = {}) {
  const router = mockRouter()
  const t = renderComponent(APP as any, {
    drivers: { STORE: localStorageDriver, ROUTER: router.driver },
    ...options,
  })
  return { t, router }
}

// processForm() reads the submitted form with FormData, so submit a real one
function addTodo(t: RenderResult, title: string) {
  const form = document.createElement('form')
  const input = document.createElement('input')
  input.name = 'new-todo'
  input.value = title
  form.appendChild(input)
  t.simulateEvent('.new-todo-form', 'submit', { srcElement: form })
}

async function until(test: () => boolean, describe = () => '', timeoutMs = 1000) {
  const end = Date.now() + timeoutMs
  while (!test()) {
    if (Date.now() > end) throw new Error(`timed out ${describe()}`)
    await new Promise(r => setTimeout(r, 5))
  }
}

// waitForState() resolves once the root has re-rendered; a Collection item
// renders its own view a moment later. Poll until the HTML matches.
const waitForHtml = (t: RenderResult, test: (html: string) => boolean) =>
  until(() => test(t.html()), () => `waiting for the HTML:\n${t.html().replace(/ of="[^"]*"/g, "")}`)

// Runs `act`, then waits for a state recorded after it that matches the
// predicate (waitForState alone also matches states recorded before the call).
async function step(t: RenderResult, act: () => void, predicate: (s: any) => boolean) {
  const n = t.states.length
  act()
  return t.waitForState(s => t.states.indexOf(s) >= n && predicate(s))
}

const titles = (s: { todos: Todo[] }) => s.todos.map(todo => todo.title)
const byTitle = (s: { todos: Todo[] }, title: string) => s.todos.find(todo => todo.title === title)!
const pause = () => new Promise(r => setTimeout(r, 3))
const stored = () => JSON.parse(localStorage.getItem('todos') ?? 'null')

describe('TodoMVC', () => {
  let t: RenderResult | null = null
  beforeEach(() => {
    localStorage.clear()
    // The checks report each finding once per process, so a finding raised
    // in an earlier test would otherwise be skipped in a later one.
    resetChecks()
  })
  afterEach(() => {
    t?.dispose()
    t = null
  })

  it('smoke test: add, toggle, edit, filter and clear with zero diagnostics (dev checks + strict)', async () => {
    const app = render({ strict: true })
    t = app.t
    await t.ready()
    expect(checks.length).toBeGreaterThan(0)
    expect(isStrictEnabled()).toBe(true)
    // BOOTSTRAP registers one route per filter
    await until(() => app.router.routes.length === 3)
    expect(app.router.routes).toEqual(['all', 'active', 'completed'])

    // Add three todos (the intent trims the title and drops empty ones)
    await step(t, () => addTodo(t!, '  Buy milk '), s => s.todos.length === 1)
    addTodo(t, '   ')
    await pause()
    await step(t, () => addTodo(t!, 'Walk the dog'), s => s.todos.length === 2)
    await pause()
    let s = await step(t, () => addTodo(t!, 'Write tests'), s => s.todos.length === 3)
    // Todo ids are Date.now() timestamps, so todos added in the same millisecond
    // would share an id; pause() keeps them apart, like a real user
    expect(new Set(s.todos.map((todo: Todo) => todo.id)).size).toBe(3)
    expect(titles(s)).toEqual(['Buy milk', 'Walk the dog', 'Write tests'])
    await waitForHtml(t, html => html.includes('<strong>3</strong> items left'))

    // Toggle one
    const milk = byTitle(s, 'Buy milk').id
    await waitForHtml(t, html => html.includes(`todo-${milk}`))
    s = await step(t, () => t!.simulateEvent(`.todo-${milk} .toggle`, 'click'), s => byTitle(s, 'Buy milk').completed)
    await waitForHtml(t, html => html.includes('<strong>2</strong> items left') && html.includes('Clear completed'))

    // Edit one: double-click the label, type, press Enter
    const dog = byTitle(s, 'Walk the dog').id
    await step(t, () => t!.simulateEvent(`.todo-${dog} label`, 'dblclick'), s => s.todos.some((todo: Todo) => todo.editing))
    await waitForHtml(t, html => html.includes(`todo-${dog} editing`))
    s = await step(t, () => {
      t!.simulateEvent(`.todo-${dog} .edit`, 'input', { value: '  Walk the cat ' })
      t!.simulateEvent(`.todo-${dog} .edit`, 'keydown', { keyCode: 13 })
    }, s => s.todos.some((todo: Todo) => todo.title === 'Walk the cat'))
    expect(titles(s)).toEqual(['Buy milk', 'Walk the cat', 'Write tests'])
    expect(s.todos.every((todo: Todo) => !todo.editing)).toBe(true)

    // Filter: #/active, then #/completed, then #/all
    await step(t, () => app.router.go('active'), s => s.visibility === 'active')
    await waitForHtml(t, html => !html.includes('Buy milk') && html.includes('Walk the cat'))
    expect(t.html()).toContain('<a class="selected" href="#/active">Active</a>')
    await step(t, () => app.router.go('completed'), s => s.visibility === 'completed')
    await waitForHtml(t, html => html.includes('Buy milk') && !html.includes('Walk the cat'))
    await step(t, () => app.router.go('all'), s => s.visibility === 'all')
    await waitForHtml(t, html => html.includes('Buy milk') && html.includes('Walk the cat'))

    // Clear completed
    s = await step(t, () => t!.simulateEvent('.clear-completed', 'click'), s => s.todos.length === 2)
    expect(titles(s)).toEqual(['Walk the cat', 'Write tests'])
    await waitForHtml(t, html => !html.includes('Clear completed'))

    // Toggle all, twice
    s = await step(t, () => t!.simulateEvent('.toggle-all', 'click'), s => s.allDone)
    expect(s.todos.every((todo: Todo) => todo.completed)).toBe(true)
    s = await step(t, () => t!.simulateEvent('.toggle-all', 'click'), s => !s.allDone)
    expect(s.todos.every((todo: Todo) => !todo.completed)).toBe(true)

    // Every state change is saved to localStorage
    await new Promise(r => setTimeout(r, 20))
    expect(stored()).toEqual(s.todos.map(({ id, title, completed }: Todo) => ({ id, title, completed })))

    t.expectNoDiagnostics()
  })

  it('loads the saved todos from localStorage on start', async () => {
    localStorage.setItem('todos', JSON.stringify([
      { id: 1, title: 'Saved', completed: true },
      { id: 2, title: 'Also saved', completed: false },
    ]))
    t = render().t
    const s = await t.waitForState(s => s.todos.length === 2)
    expect(s.remaining).toBe(1)
    await waitForHtml(t, html => html.includes('<strong>1</strong> item left'))
    t.expectNoDiagnostics()
  })

  it('Escape cancels an edit and restores the title', async () => {
    localStorage.setItem('todos', JSON.stringify([{ id: 7, title: 'Keep me', completed: false }]))
    t = render().t
    await t.waitForState(s => s.todos.length === 1)
    await waitForHtml(t, html => html.includes('todo-7'))
    t.simulateEvent('.todo-7 label', 'dblclick')
    await t.waitForState(s => s.todos[0]?.editing === true)
    await waitForHtml(t, html => html.includes('todo-7 editing'))
    t.simulateEvent('.todo-7 .edit', 'input', { value: 'Changed' })
    await t.waitForState(s => s.todos[0]?.editValue === 'Changed')
    t.simulateEvent('.todo-7 .edit', 'keydown', { keyCode: 27 })
    const s = await t.waitForState(s => s.todos[0]?.editing === false && s.todos[0]?.cachedTitle === '')
    expect(s.todos[0].title).toBe('Keep me')
    t.expectNoDiagnostics()
  })

  it('saving an empty edit (blur) removes the todo; the destroy button removes one too', async () => {
    localStorage.setItem('todos', JSON.stringify([
      { id: 1, title: 'Empty me', completed: false },
      { id: 2, title: 'Destroy me', completed: false },
      { id: 3, title: 'Stay', completed: false },
    ]))
    t = render().t
    await t.waitForState(s => s.todos.length === 3)
    await waitForHtml(t, html => html.includes('todo-1') && html.includes('todo-2'))

    t.simulateEvent('.todo-1 label', 'dblclick')
    await waitForHtml(t, html => html.includes('todo-1 editing'))
    t.simulateEvent('.todo-1 .edit', 'input', { value: '   ' })
    t.simulateEvent('.todo-1 .edit', 'blur')
    await t.waitForState(s => s.todos.length === 2)

    t.simulateEvent('.todo-2 .destroy', 'click')
    const s = await t.waitForState(s => s.todos.length === 1)
    expect(titles(s)).toEqual(['Stay'])
    t.expectNoDiagnostics()
  })
})
