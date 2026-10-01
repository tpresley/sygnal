import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, renderToString } from 'sygnal'
import 'sygnal/diagnostics'
import Counter from './Counter.jsx'
import TodoList from './TodoList.jsx'

let t
afterEach(() => t?.dispose())

describe('Counter', () => {
  it('renders on the server with the given state', () => {
    const html = renderToString(Counter, { state: { count: 5 } })
    expect(html).toContain('<span class="count">5</span>')
  })

  it('increments and decrements, with no diagnostics in strict mode', async () => {
    t = renderComponent(Counter, { strict: true })
    t.simulateEvent('.inc', 'click')
    t.simulateEvent('.inc', 'click')
    t.simulateEvent('.dec', 'click')
    await t.waitForState(s => s.count === 1)
    expect(t.html()).toContain('<span class="count">1</span>')
    t.expectNoDiagnostics()
  })
})

describe('TodoList', () => {
  it('adds and toggles a todo, with no diagnostics in strict mode', async () => {
    t = renderComponent(TodoList, { strict: true })
    t.simulateEvent('.new-todo', 'input', { value: '  Write tests  ' })
    await t.waitForState(s => s.inputValue === '  Write tests  ')
    t.simulateEvent('.add-btn', 'click')
    const added = await t.waitForState(s => s.items.length === 1)
    expect(added.items[0]).toEqual({ id: 1, text: 'Write tests', done: false })
    expect(added.inputValue).toBe('')

    t.simulateEvent('.toggle', 'change', { dataset: { id: 1 } })
    await t.waitForState(s => s.items[0].done)
    expect(t.html()).toContain('0 items left')
    t.expectNoDiagnostics()
  })

  it('ignores Add with an empty input (ABORT: no new state)', async () => {
    t = renderComponent(TodoList, { strict: true })
    await t.ready()
    const before = t.states.length
    t.simulateEvent('.add-btn', 'click')
    await new Promise(r => setTimeout(r, 30))
    expect(t.states.length).toBe(before)
    t.expectNoDiagnostics()
  })
})
