// @vitest-environment jsdom
/** Experiment C: Counter and Tasks (the web view) through React, with react-dom as the host */
import {describe, it, expect, afterEach} from 'vitest'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {run} from 'sygnal'
import Counter, {Inc} from './app/counter'
import WebTasks from './app/tasks.web'
import {Draft, Add, Done} from './app/tasks.logic'
import {createReactHost, domTable} from './reactBridge'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const tick = () => new Promise((r) => setTimeout(r, 0))
const done: any[] = []
afterEach(() => { done.splice(0).forEach((f) => f()); document.body.innerHTML = '' })

async function mount(C: any) {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  const host = createReactHost(domTable, (tree) => act(() => root.render(tree)))
  const app = run(C, {DOM: host.driver})
  done.push(() => { app.dispose(); act(() => root.unmount()) })
  await act(tick)
  return el
}

describe('Sygnal through a React host', () => {
  it('Counter: React DOM renders it, React onClick drives the intent', async () => {
    const el = await mount(Counter)
    expect(el.innerHTML).toBe('<div class="counter"><span class="count">Count: 0</span><div style="display: flex; gap: 0.5em;"><button type="button" data-control="Dec">-</button><button type="button" data-control="Inc">+</button><button type="button" data-control="Reset">reset</button></div></div>')
    await act(async () => { (el.querySelector(String(Inc)) as HTMLElement).click(); await tick() })
    expect(el.querySelector('.count')!.textContent).toBe('Count: 1')
  })

  it('Tasks: a Collection, a controlled TextInput and toggles', async () => {
    const el = await mount(WebTasks)
    const input = () => el.querySelector(String(Draft)) as HTMLInputElement
    // React's onChange fires for a value set through the native setter + an input event
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setValue.call(input(), 'one'); input().dispatchEvent(new Event('input', {bubbles: true})); await tick() })
    await act(async () => { (el.querySelector(String(Add)) as HTMLElement).click(); await tick() })
    expect(el.querySelectorAll('.task').length).toBe(1)
    expect(input().value).toBe('')
    await act(async () => { (el.querySelector(String(Done)) as HTMLElement).click(); await tick() })
    expect(el.querySelector('.task')!.className).toBe('task done')
    expect(el.textContent).toContain('0 left')
  })
})
