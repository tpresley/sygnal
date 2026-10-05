// @vitest-environment jsdom
// PLAN-4.6 R3: fixes of the R2 review (G-306 ... G-317) on the next core. Next core only
// (SYGNAL_CORE=next, npm run test:next), except where noted.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { run, createElement as h, xs, Collection, Switchable, Portal, lazy } from '../src/index.js'
import { App as CoreApp } from '../src/core/runtime'

const NEXT = globalThis.__SYGNAL_CORE__ === 'next'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let apps = []
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers() })
function mount(App, drivers = {}, options = {}) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  const app = run(App, drivers, { mountPoint: '#root', ...options })
  apps.push(app)
  const rt = app.__runtime
  const settle = async () => { await rt.flushed(); await sleep(5); await rt.flushed() }
  return { app, el, rt, settle, $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)], texts: (s) => [...el.querySelectorAll(s)].map((e) => e.textContent) }
}
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe.skipIf(!NEXT)('PLAN-4.6 R3: R2 review fixes (next core)', () => {
  it('G-306: an id-less item that wrote itself back keeps its place after a removal before it; no made-up id is stored', async () => {
    function Item({ state }) { return h('li', null, `${state.t}`) }
    Item.intent = ({ DOM }) => ({ T: DOM.click('li') })
    Item.model = { T: (s) => ({ ...s, t: s.t + '!' }) }
    function App() { return h('div', null, h('button', null, 'x'), h(Collection, { of: Item, from: 'rows' })) }
    App.initialState = { rows: [{ t: 'x' }, { t: 'y' }, { t: 'z' }, { t: 'w' }] }
    App.intent = ({ DOM }) => ({ DEL: DOM.click('button') })
    App.model = { DEL: (s) => ({ ...s, rows: s.rows.slice(1) }) }
    const m = mount(App)
    await m.settle()
    click(m.$$('li')[2]); await m.settle()
    expect(m.rt.getState().rows).toEqual([{ t: 'x' }, { t: 'y' }, { t: 'z!' }, { t: 'w' }])
    click(m.$('button')); await m.settle()
    expect(m.texts('li')).toEqual(['y', 'z!', 'w'])
  })

  it('G-307: id 0 is an id; an id and an index are different keys; ids are compared as strings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    function Item({ state }) { return h('li', null, `${state.id}:${state.t}`) }
    function App() { return h('ul', null, h(Collection, { of: Item, from: 'rows' })) }
    App.initialState = { rows: [{ t: 'noid' }, { id: 0, t: 'zero' }, { id: 1, t: 'one' }, { id: '1', t: 'str1' }] }
    const m = mount(App)
    await m.settle()
    // '1' and 1 are one key (as today's stringified keys): the first renders (D177)
    expect(m.texts('li')).toEqual(['0:noid', '0:zero', '1:one'])
    warn.mockRestore()
  })

  it('G-308 (D178): a Collection whose `from` key is missing at creation renders once it appears', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    function Item({ state }) { return h('li', null, state.t) }
    function App() { return h('div', null, h('button', null, 'x'), h(Collection, { of: Item, from: 'rows' })) }
    App.initialState = { other: 1 }
    App.intent = ({ DOM }) => ({ ADD: DOM.click('button') })
    App.model = { ADD: (s) => ({ ...s, rows: [{ id: 1, t: 'a' }] }) }
    const m = mount(App)
    await m.settle()
    expect(m.$$('li').length).toBe(0)
    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/renders nothing until it exists/)
    click(m.$('button')); await m.settle()
    expect(m.texts('li')).toEqual(['a'])
  })

  it('G-309 (D174/D179): a seed queued behind a parent write of the slice does not overwrite it', async () => {
    function Child({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    Child.isolatedState = true
    Child.initialState = { n: 0 }
    Child.model = { X: (s) => s }
    function Mid({ state }) { return h('div', null, state.show ? h(Child, { state: 'sub' }) : h('span', null, 'no')) }
    Mid.intent = () => ({ LOAD: xs.of(5) })
    Mid.model = { LOAD: (s, n) => ({ ...s, show: true, sub: { n } }) }
    function App() { return h('div', null, h(Mid, { state: 'mid' })) }
    App.initialState = { mid: { show: true } }
    const m = mount(App)
    await m.settle()
    expect(m.rt.getState().mid.sub).toEqual({ n: 5 })
    expect(m.$('.c').textContent).toBe('5')
  })

  it('G-310: a lazy import that fails renders the error placeholder', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let rej
    const L = lazy(() => new Promise((_, r) => { rej = r }))
    function App() { return h('div', null, h(L, {})) }
    App.initialState = { a: 1 }
    const m = mount(App)
    await m.settle()
    expect(m.el.innerHTML).toContain('data-sygnal-lazy')
    rej(new Error('nope'))
    await sleep(5); await m.settle()
    expect(m.el.innerHTML).toContain('data-sygnal-error')
  })

  it('G-311: after a render that threw, an earlier sibling\'s update reaches the DOM at the next flush; the Collection retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function A({ state }) { return h('p', { className: 'a' }, String(state)) }
    function Item({ state }) { return h('li', null, String(state.value)) }
    let bad = true
    function App() { return h('div', null, h('button', null, 'x'), h(A, { state: 'n' }), h(Collection, { of: Item, from: 'rows', filter: (x) => { if (x === 99 && bad) throw new Error('bad'); return true } }), h('i', { className: 'other' }, 'k')) }
    App.initialState = { n: 1, rows: [1, 2], z: 0 }
    App.intent = ({ DOM }) => ({ GO: DOM.click('button'), FIX: DOM.click('.other') })
    App.model = { GO: (s) => ({ ...s, n: 2, rows: [1, 99] }), FIX: (s) => ({ ...s, z: s.z + 1 }) }
    const m = mount(App)
    await m.settle()
    click(m.$('button')); await m.settle()
    bad = false
    click(m.$('.other')); await m.settle()
    expect(m.$('.a').textContent).toBe('2')
    expect(m.texts('li')).toEqual(['1', '99'])
  })

  it('G-311 (c): actions queued in a flush whose render threw are still drained', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen = []
    function Kid() { return h('i', null, 'k') }
    Kid.isolatedState = true
    Kid.initialState = { k: 1 }
    Kid.model = { INITIALIZE: (s) => { seen.push('init'); return s } }
    function Boom() { throw new Error('boom') }
    Boom.onError = undefined
    function App() { return h('div', null, h(Kid), h(Collection, { of: Kid, from: 'rows', sort: () => { throw new Error('sort') } })) }
    App.initialState = { rows: [{ id: 1 }, { id: 2 }] }
    mount(App)
    await sleep(20)
    expect(seen.length).toBeGreaterThan(0)
  })

  it('G-312: a layered transformDef / wrapSources / wrapHandler returning nothing keeps the layer below', () => {
    const app = new CoreApp({ __hooks: { transformDef: (s) => ({ ...s, marked: 1 }), wrapSources: (i, so) => ({ ...so, extra: 1 }), wrapHandler: (i, t, s, f) => (...a) => f(...a) } })
    app.addHooks({ transformDef: () => {}, wrapSources: () => {}, wrapHandler: () => {} })
    expect(app.hooks.transformDef({ a: 1 })).toEqual({ a: 1, marked: 1 })
    expect(app.hooks.wrapSources(null, { b: 1 })).toEqual({ b: 1, extra: 1 })
    const f = (s) => s + 1
    expect(app.hooks.wrapHandler(null, 'A', 'STATE', f)(1)).toBe(2)
  })

  it('G-313: a throwing onPatch still ends the early sink log and dispatches BOOTSTRAP', async () => {
    const boots = []
    function App() { return h('div', null, 'x') }
    App.initialState = { a: 1 }
    App.model = { BOOTSTRAP: { EFFECT: () => boots.push(1) } }
    const onErr = vi.fn()
    process.on('uncaughtException', onErr)
    let once = true
    try {
      const m = mount(App, {}, { __hooks: { onPatch: () => { if (once) { once = false; throw new Error('patch') } } } })
      await sleep(10)
      expect(m.app.__runtime).toBeDefined()
      expect(boots).toEqual([1])
    } catch (e) { /* the throw may surface from the microtask */ } finally { process.off('uncaughtException', onErr) }
    expect(boots).toEqual([1])
  })

  it('G-314 (D179): an isolated, model-less child bound by a lens reads its initialState while the slice is missing', async () => {
    function Child({ state }) { return h('p', { className: 'c' }, String(state?.n)) }
    Child.isolatedState = true
    Child.initialState = { n: 7 }
    function App() { return h('div', null, h(Child, { state: { get: (s) => s.sub, set: (s, v) => ({ ...s, sub: v }) } }), h(Child, { state: 'k' })) }
    App.initialState = { a: 1 }
    const m = mount(App)
    await m.settle()
    expect(m.texts('.c')).toEqual(['7', '7'])
  })

  it('G-316: a Portal whose target appears late mounts once; destroyed while retrying, it never mounts', async () => {
    function App({ state }) { return h('div', null, h('button', null, 'b'), state.on ? h(Portal, { target: '#late' }, h('em', { className: 'pc' }, 'P' + state.n)) : null) }
    App.initialState = { on: true, n: 0 }
    App.intent = ({ DOM }) => ({ INC: DOM.click('button') })
    App.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    const m = mount(App)
    await m.settle()
    click(m.$('button')); await m.rt.flushed()
    const late = document.createElement('div'); late.id = 'late'; document.body.appendChild(late)
    await sleep(40)
    expect(document.querySelectorAll('#late .pc').length).toBe(1)
    expect(document.querySelector('#late .pc').textContent).toBe('P1')

    // destroyed while a retry is pending: nothing mounts later
    document.body.innerHTML = ''; apps.forEach((a) => a.dispose()); apps = []
    function B({ state }) { return h('div', null, h('button', null, 'b'), state.on ? h(Portal, { target: '#late2' }, h('em', { className: 'pc2' }, 'x')) : null) }
    B.initialState = { on: true }
    B.intent = ({ DOM }) => ({ OFF: DOM.click('button') })
    B.model = { OFF: (s) => ({ ...s, on: false }) }
    const m2 = mount(B)
    await m2.settle()
    click(m2.$('button')); await m2.rt.flushed()
    const late2 = document.createElement('div'); late2.id = 'late2'; document.body.appendChild(late2)
    await sleep(60)
    expect(document.querySelectorAll('#late2 .pc2').length).toBe(0)
  })

  it('G-317: lazy() as a Collection `of` and as a Switchable page resolves', async () => {
    let res
    function Real() { return h('li', { className: 'real' }, 'real') }
    Real.model = { X: (s) => s }
    const L = lazy(() => new Promise((r) => { res = r }))
    function App() { return h('div', null, h(Collection, { of: L, from: 'rows' }), h(Switchable, { of: { a: L }, current: 'a' })) }
    App.initialState = { rows: [{ id: 1 }] }
    const m = mount(App)
    await m.settle()
    expect(m.$$('.real').length).toBe(0)
    res({ default: Real })
    await sleep(5); await m.settle()
    expect(m.$$('.real').length).toBe(2)
  })
})
