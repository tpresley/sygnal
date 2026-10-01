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

// renderComponent's waits: t.next(pred) resolves on the first state recorded
// after the call that matches, once the whole tree (Collection items included)
// has rendered it; t.settle() resolves once nothing is pending anywhere.

const titles = (s: { todos: Todo[] }) => s.todos.map(todo => todo.title)
const byTitle = (s: { todos: Todo[] }, title: string) => s.todos.find(todo => todo.title === title)!
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
    // BOOTSTRAP registers one route per filter (through next(), so after a delay)
    await t.settle()
    expect(app.router.routes).toEqual(['all', 'active', 'completed'])

    // Add three todos (the intent trims the title and drops empty ones)
    addTodo(t, '  Buy milk ')
    await t.next(s => s.todos.length === 1)
    addTodo(t, '   ')
    addTodo(t, 'Walk the dog')
    await t.next(s => s.todos.length === 2)
    addTodo(t, 'Write tests')
    let s = await t.next(s => s.todos.length === 3)
    // Ids are sequential, even for todos added back to back
    expect(s.todos.map((todo: Todo) => todo.id)).toEqual([1, 2, 3])
    expect(titles(s)).toEqual(['Buy milk', 'Walk the dog', 'Write tests'])
    expect(t.html()).toContain('<strong>3</strong> items left')

    // Toggle one
    const milk = byTitle(s, 'Buy milk').id
    t.simulateEvent(`.todo-${milk} .toggle`, 'click')
    s = await t.next(s => byTitle(s, 'Buy milk').completed)
    expect(t.html()).toContain('<strong>2</strong> items left')
    expect(t.html()).toContain('Clear completed')

    // Edit one: double-click the label, type, press Enter
    const dog = byTitle(s, 'Walk the dog').id
    t.simulateEvent(`.todo-${dog} label`, 'dblclick')
    await t.next(s => s.todos.some((todo: Todo) => todo.editing))
    expect(t.html()).toContain(`todo-${dog} editing`)
    t.simulateEvent(`.todo-${dog} .edit`, 'input', { value: '  Walk the cat ' })
    t.simulateEvent(`.todo-${dog} .edit`, 'keydown', { keyCode: 13 })
    s = await t.next(s => s.todos.some((todo: Todo) => todo.title === 'Walk the cat'))
    expect(titles(s)).toEqual(['Buy milk', 'Walk the cat', 'Write tests'])
    expect(s.todos.every((todo: Todo) => !todo.editing)).toBe(true)

    // Filter: #/active, then #/completed, then #/all
    app.router.go('active')
    await t.next(s => s.visibility === 'active')
    expect(t.html()).not.toContain('Buy milk')
    expect(t.html()).toContain('Walk the cat')
    expect(t.html()).toContain('<a class="selected" href="#/active">Active</a>')
    app.router.go('completed')
    await t.next(s => s.visibility === 'completed')
    expect(t.html()).toContain('Buy milk')
    expect(t.html()).not.toContain('Walk the cat')
    app.router.go('all')
    await t.next(s => s.visibility === 'all')
    expect(t.html()).toContain('Buy milk')
    expect(t.html()).toContain('Walk the cat')

    // Clear completed
    t.simulateEvent('.clear-completed', 'click')
    s = await t.next(s => s.todos.length === 2)
    expect(titles(s)).toEqual(['Walk the cat', 'Write tests'])
    expect(t.html()).not.toContain('Clear completed')

    // Toggle all, twice
    t.simulateEvent('.toggle-all', 'click')
    s = await t.next(s => s.allDone)
    expect(s.todos.every((todo: Todo) => todo.completed)).toBe(true)
    t.simulateEvent('.toggle-all', 'click')
    s = await t.next(s => !s.allDone)
    expect(s.todos.every((todo: Todo) => !todo.completed)).toBe(true)

    // Every state change is saved to localStorage
    await t.settle()
    expect(stored()).toEqual(s.todos.map(({ id, title, completed }: Todo) => ({ id, title, completed })))

    t.expectNoDiagnostics()
  })

  it('a new todo gets an id above every saved one', async () => {
    localStorage.setItem('todos', JSON.stringify([{ id: 41, title: 'Saved', completed: false }]))
    t = render().t
    await t.waitForState(s => s.todos.length === 1)
    addTodo(t, 'New')
    const s = await t.next(s => s.todos.length === 2)
    expect(s.todos.map((todo: Todo) => todo.id)).toEqual([41, 42])
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
    expect(t.html()).toContain('<strong>1</strong> item left')
    t.expectNoDiagnostics()
  })

  it('Escape cancels an edit and restores the title', async () => {
    localStorage.setItem('todos', JSON.stringify([{ id: 7, title: 'Keep me', completed: false }]))
    t = render().t
    await t.waitForState(s => s.todos.length === 1)
    t.simulateEvent('.todo-7 label', 'dblclick')
    await t.next(s => s.todos[0]?.editing === true)
    expect(t.html()).toContain('todo-7 editing')
    t.simulateEvent('.todo-7 .edit', 'input', { value: 'Changed' })
    await t.next(s => s.todos[0]?.editValue === 'Changed')
    t.simulateEvent('.todo-7 .edit', 'keydown', { keyCode: 27 })
    const s = await t.next(s => s.todos[0]?.editing === false && s.todos[0]?.cachedTitle === '')
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

    t.simulateEvent('.todo-1 label', 'dblclick')
    await t.next(s => s.todos[0]?.editing === true)
    expect(t.html()).toContain('todo-1 editing')
    t.simulateEvent('.todo-1 .edit', 'input', { value: '   ' })
    t.simulateEvent('.todo-1 .edit', 'blur')
    await t.next(s => s.todos.length === 2)

    t.simulateEvent('.todo-2 .destroy', 'click')
    const s = await t.next(s => s.todos.length === 1)
    expect(titles(s)).toEqual(['Stay'])
    t.expectNoDiagnostics()
  })
})
