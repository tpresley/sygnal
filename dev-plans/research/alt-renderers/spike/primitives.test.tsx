// @vitest-environment jsdom
/**
 * Experiment B: one intent + model, run on the web DOM driver (jsdom), the terminal host driver,
 * and renderComponent's mock DOM, with one shared view (Counter) or a view per platform (Tasks).
 */
import {describe, it, expect, afterEach} from 'vitest'
import {run, renderComponent, makeDOMDriver} from 'sygnal'
import Counter, {Inc, Dec, Reset} from './app/counter'
import WebTasks from './app/tasks.web'
import TuiTasks from './app/tasks.tui'
import {Add, Draft, Done} from './app/tasks.logic'
import {createTerminal} from './terminal'
import {mapTags, webTags} from './primitives'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const apps: any[] = []
afterEach(() => { apps.splice(0).forEach((a) => a.dispose()); document.body.innerHTML = '' })

function web(C: any) {
  document.body.innerHTML = '<div id="app"></div>'
  apps.push(run(C, {DOM: mapTags(makeDOMDriver('#app'), webTags)}))
  return document.getElementById('app')!
}
function tui(C: any) {
  const term = createTerminal()
  apps.push(run(C, {DOM: term.driver}))
  return term
}

describe('Counter: one view, three renderers', () => {
  it('web DOM', async () => {
    const root = web(Counter)
    await tick()
    expect(root.innerHTML).toBe('<div class="counter"><span class="count">Count: 0</span><div style="display: flex; flex-direction: row; gap: 0.5em;"><button type="button" data-control="Dec">-</button><button type="button" data-control="Inc">+</button><button type="button" data-control="Reset">reset</button></div></div>')
    ;(root.querySelector('[data-control="Inc"]') as HTMLElement).click()
    ;(root.querySelector('[data-control="Inc"]') as HTMLElement).click()
    await tick()
    expect(root.querySelector('.count')!.textContent).toBe('Count: 2')
  })

  it('terminal', async () => {
    const term = tui(Counter)
    await tick()
    expect(term.frame()).toBe('Count: 0\n[-] [+] [reset]')
    term.focus(String(Inc))
    term.press('enter'); term.press('space')
    term.press('shift-tab'); term.press('enter')
    await tick()
    expect(term.frame()).toBe('Count: 1\n▸[-] [+] [reset]')
  })

  it('renderComponent (mock DOM): the same tests for every platform', async () => {
    const t = renderComponent(Counter)
    await t.ready()
    await t.simulateEvent(Inc, 'click')
    await t.simulateEvent(Inc, 'click')
    await t.simulateEvent(Dec, 'click')
    await t.waitForState((s: any) => s.count === 1)
    await t.simulateEvent(Reset, 'click')
    await t.waitForState((s: any) => s.count === 0)
    t.dispose()
  })
})

describe('Tasks: shared logic, a view per platform', () => {
  it('web view on the DOM', async () => {
    const root = web(WebTasks)
    await tick()
    const input = root.querySelector(String(Draft)) as HTMLInputElement
    input.value = 'ship it'
    input.dispatchEvent(new Event('input', {bubbles: true}))
    ;(root.querySelector(String(Add)) as HTMLElement).click()
    await tick()
    expect(root.querySelectorAll('.task').length).toBe(1)
    expect(input.value).toBe('')
    ;(root.querySelector(String(Done)) as HTMLElement).click()
    await tick()
    expect(root.querySelector('.task')!.className).toBe('task done')
    expect(root.textContent).toContain('0 left')
  })

  it('terminal view in the terminal', async () => {
    const term = tui(TuiTasks)
    await tick()
    term.focus(String(Draft))
    term.type('ship it')
    term.press('enter')
    await tick()
    term.type('test it')
    term.press('enter')
    await tick()
    term.press('tab')          // → first task's toggle
    term.press('space')
    await tick()
    expect(term.frame()).toBe([
      'TASKS (1 open)',
      '[type, Enter to add]',
      '▸[x] ship it [del]',
      '[ ] test it [del]',
      '[clear done]',
      'Tab: move Space: toggle Enter: activate',
    ].join('\n'))
  })

  it('the same logic under renderComponent, whichever view', async () => {
    for (const C of [WebTasks, TuiTasks]) {
      const t = renderComponent(C)
      await t.ready()
      await t.simulateEvent(Draft, 'input', {target: {value: 'a'}})
      await t.simulateEvent(Draft, 'keydown', {key: 'Enter'})
      await t.waitForState((s: any) => s.tasks.length === 1 && s.draft === '')
      t.dispose()
    }
  })
})

import {controls} from 'sygnal'

describe('gaps the spike found (documented, README §1 C10)', () => {
  // A field whose value the state resets to what it rendered last: the DOM driver re-syncs
  // <input> on every patch, and the pragma never reuses an <input> vnode (FIELD). A neutral tag
  // (textinput) is "plain" to the pragma, so a re-render with the same output keeps the last
  // vnode by identity (P46-P) and no patch reaches the field.
  const field = (tag: string) => {
    const {Box, Clear} = controls({Box: {kind: tag, vnode: (p: any, c: any, h: any) => h(tag, p, ...c)}, Clear: {kind: 'pressable', vnode: (p: any, c: any, h: any) => h('pressable', p, ...c)}})
    const C = Object.assign(({state}: any) => <view><Box value={state.v} /><Clear>x</Clear></view>, {
      initialState: {v: ''},
      intent: ({DOM}: any) => ({CLEAR: DOM.click(Clear)}),
      model: {CLEAR: (s: any) => ({...s, v: ''})},
    })
    return {C, Box, Clear}
  }
  async function typeThenClear(tag: string) {
    const {C, Box, Clear} = field(tag)
    const term = tui(C)
    await tick()
    term.focus(String(Box))
    term.type('abc')            // no intent for input: the state stays ''
    term.focus(String(Clear))
    term.press('enter')         // CLEAR: v '' → '' (a new state object, the same view output)
    await tick()
    return (term.doc.body.querySelector(String(Box)) as any).value
  }
  it('an <input> is re-synced to the state (the pragma never reuses a field vnode)', async () => {
    expect(await typeThenClear('input')).toBe('')
  })
  it('GAP: a neutral field tag (textinput) keeps the typed text: no patch reached it', async () => {
    expect(await typeThenClear('textinput')).toBe('abc')
  })
})
