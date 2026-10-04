// @vitest-environment jsdom
// PLAN-4.5 P45-D, D152: a component's static initialState / model / context / calculated are
// shared by all its instances (P45-B). With diagnostics on (the 'sygnal/diagnostics' dev entry
// installed), they are frozen, so an in-place mutation throws in dev; initialState deeply. The
// core never freezes: without the dev entry, or with diagnostics off, nothing is frozen.
import { describe, it, expect, afterEach } from 'vitest'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { run } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let t, app
afterEach(() => {
  t?.dispose(); t = null
  app?.dispose(); app = null
  globalThis.__SYGNAL_DIAGNOSTICS__?.__uninstallChecks?.()
  _resetDiagnostics()
  document.body.innerHTML = ''
})

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function make() {
  function List({ state }) { return h('ul', null, ...state.items.map(i => h('li', null, String(i)))) }
  List.initialState = { items: [1], meta: { tags: ['a'] }, when: new Date(0), seen: new Map() }
  List.context = { count: (s) => s.items.length }
  List.calculated = { total: (s) => s.items.length }
  List.intent = ({ DOM }) => ({ PUSH: DOM.click('ul') })
  List.model = { PUSH: (state) => { state.items.push(2); return { ...state } } }
  return List
}

describe('D152: shared statics frozen in dev', () => {
  it('with the dev entry and diagnostics on: initialState is deep-frozen, the others at the top level', async () => {
    setupChecks()
    const List = make()
    t = renderComponent(List)
    await t.ready()
    const s = List.initialState
    expect(Object.isFrozen(s)).toBe(true)
    expect(Object.isFrozen(s.items)).toBe(true)
    expect(Object.isFrozen(s.meta)).toBe(true)
    expect(Object.isFrozen(s.meta.tags)).toBe(true)
    // class instances are left alone
    expect(Object.isFrozen(s.when)).toBe(false)
    expect(Object.isFrozen(s.seen)).toBe(false)
    expect(Object.isFrozen(List.model)).toBe(true)
    expect(Object.isFrozen(List.context)).toBe(true)
    expect(Object.isFrozen(List.calculated)).toBe(true)
    expect(() => s.items.push(3)).toThrow(TypeError)
  })

  it('a reducer that pushes onto the initial state throws: reported (SYG216), state and the static unchanged', async () => {
    setupChecks()
    const List = make()
    t = renderComponent(List)
    await t.ready()
    await t.simulateAction('PUSH')
    await t.settle()
    expect(List.initialState.items).toEqual([1])
    expect(t.state.items).toEqual([1])
    const d = diagnostics('SYG216')
    expect(d.length).toBe(1)
    expect(String(d[0].data?.message || d[0].data || d[0].text)).toMatch(/not extensible|read.only|frozen/i)
  })

  it('a second instance starts from the untouched initial state', async () => {
    setupChecks()
    const List = make()
    t = renderComponent(List)
    await t.ready()
    await t.simulateAction('PUSH')
    await t.settle()
    t.dispose()
    t = renderComponent(List)
    await t.ready()
    expect(t.state.items).toEqual([1])
  })

  it('without the dev entry nothing is frozen (and the mutation leaks into the static, as D152 warns)', async () => {
    _resetDiagnostics()
    const List = make()
    t = renderComponent(List)
    await t.ready()
    expect(Object.isFrozen(List.initialState)).toBe(false)
    expect(Object.isFrozen(List.initialState.items)).toBe(false)
    expect(Object.isFrozen(List.model)).toBe(false)
    await t.simulateAction('PUSH')
    await t.settle()
    expect(List.initialState.items).toEqual([1, 2])
  })

  it('with the dev entry installed but diagnostics off (run() without the option) nothing is frozen', async () => {
    setupChecks('off')
    const List = make()
    document.body.innerHTML = '<div id="root"></div>'
    app = run(List, {}, { mountPoint: '#root' })
    await sleep(30)
    expect(document.querySelectorAll('li').length).toBe(1)
    expect(Object.isFrozen(List.initialState)).toBe(false)
    expect(Object.isFrozen(List.model)).toBe(false)
  })
})
