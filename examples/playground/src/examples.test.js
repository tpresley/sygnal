// Smoke test: compiles each built-in playground example the way the editor
// does (Babel → evaluate), renders it with the dev checks ('sygnal/diagnostics')
// and strict mode on, drives it through simulateEvent, and asserts that no
// diagnostics were reported.
import { describe, it, expect } from 'vitest'
import 'sygnal/diagnostics'
import { renderComponent } from 'sygnal'
import { compile, evaluate } from './compiler.js'
import * as examples from './examples.js'

const wait = (ms) => new Promise(r => setTimeout(r, ms))

async function smoke(name, drive) {
  const Component = evaluate(compile(examples[name]))
  const t = renderComponent(Component, { strict: true })
  try {
    await t.ready()
    await drive(t)
    t.expectNoDiagnostics()
  } finally {
    t.dispose()
  }
}

describe('playground examples (smoke)', () => {
  it('has a test for every example', () => {
    expect(Object.keys(examples).sort()).toEqual(['counter', 'greeter', 'todo'])
  })

  it('counter', () => smoke('counter', async (t) => {
    t.simulateEvent('.increment', 'click')
    t.simulateEvent('.increment', 'click')
    t.simulateEvent('.decrement', 'click')
    await t.waitForState(s => s.count === 2)
    await wait(30)
    expect(t.states.at(-1).count).toBe(1)
    expect(t.html()).toContain('Count: 1')
  }))

  it('greeter', () => smoke('greeter', async (t) => {
    t.simulateEvent('.name-input', 'input', { value: 'Sygnal' })
    await t.waitForState(s => s.name === 'Sygnal')
    expect(t.html()).toContain('Hello Sygnal!')
  }))

  it('todo', () => smoke('todo', async (t) => {
    // Add with empty text is a no-op (ABORT)
    t.simulateEvent('.add-btn', 'click')
    t.simulateEvent('.new-todo', 'input', { value: 'Write tests' })
    await t.waitForState(s => s.text === 'Write tests')
    t.simulateEvent('.add-btn', 'click')
    const added = await t.waitForState(s => s.items.length === 3)
    expect(added.text).toBe('')
    expect(added.items[2]).toEqual({ text: 'Write tests', done: false })

    // clicking a todo toggles it (index from data-index)
    t.simulateEvent('.todo-item', 'click')
    const toggled = await t.waitForState(s => s.items[0].done)
    expect(toggled.items.map(i => i.done)).toEqual([true, false, false])
    expect(t.html()).toContain('2 remaining')
  }))
})
