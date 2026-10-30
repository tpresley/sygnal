// The bridge in jsdom: React renders the host tree; React callbacks (onPress, onChangeText,
// onValueChange, onSubmitEditing) drive the Sygnal intents. The same files the iOS app runs.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { run, renderComponent } from 'sygnal'
import { createNativeHost } from '../src/nativeHost'
import Counter from '../src/counter'
import Todos from '../src/todos.native'
import { Draft } from '../src/todos.logic'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const done = []
afterEach(() => { done.splice(0).forEach((f) => f()); document.body.innerHTML = '' })

async function mount(App) {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  const host = createNativeHost((tree) => act(() => root.render(tree)))
  const app = run(App, { DOM: host.driver })
  done.push(() => { host.stop(); app.dispose(); act(() => root.unmount()) })
  await act(() => tick(20))
  return el
}
const press = (b) => act(async () => { b.click(); await tick(20) })
const setInput = (input, v) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick(20)
})

describe('the native bridge', () => {
  it('Counter (an HTML view) through the React Native table', async () => {
    const el = await mount(Counter)
    expect(el.textContent).toContain('Count: 0')
    const [dec, inc] = el.querySelectorAll('button')
    expect(inc.getAttribute('aria-label')).toBe('Increment')
    await press(inc); await press(inc); await press(dec)
    expect(el.textContent).toContain('Count: 1')
  })

  it('Todos (the neutral tags): type, submit, toggle, remove, clear', async () => {
    const el = await mount(Todos)
    expect(el.textContent).toContain('Todos (1 left)')
    const input = () => el.querySelector('input:not([type])')
    await setInput(input(), 'Ship the bridge')
    await act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(20) })
    expect(el.textContent).toContain('Ship the bridge')
    expect(input().value).toBe('')
    expect(el.textContent).toContain('Todos (2 left)')
    await act(async () => { el.querySelector('input[type="checkbox"]').click(); await tick(20) })
    expect(el.textContent).toContain('Todos (1 left)')
    await press([...el.querySelectorAll('button')].find((b) => b.textContent === 'Clear done'))
    expect(el.textContent).not.toContain('Run Sygnal on iOS')
    await press(el.querySelector('button[aria-label="Remove Ship the bridge"]'))
    expect(el.textContent).toContain('Todos (0 left)')
  })

  it('the same logic under renderComponent: no renderer at all', async () => {
    const t = renderComponent(Todos)
    await t.ready()
    await t.simulateEvent(Draft, 'input', { target: { value: 'a' } })
    await t.simulateEvent(Draft, 'keydown', { key: 'Enter' })
    await t.waitForState((s) => s.todos.length === 2 && s.draft === '')
    t.dispose()
  })
})
