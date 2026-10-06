// @vitest-environment jsdom
// PLAN-5 3-X (G-550): the patch-error mark is set before onError runs; a new app in a container
// a failed, undisposed app marked clears the stale mark on its first patch, and an app's dispose
// removes the mark only when that app set it; renderComponent({ dom: 'real' }) reports through
// run()'s reporter (the hooks' onError too); a throw while flattening the tree is a patch error.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.ts'
import { Fragment } from '../src/cycle/dom/fragment.ts'

const ERR = 'data-sygnal-error'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let apps = [], errors, layer
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1))
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  document.body.innerHTML = '<div id="root"></div>'
})
afterEach(() => {
  apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''
  if (layer) { globalThis.__SYGNAL_DIAGNOSTICS__.layers.splice(globalThis.__SYGNAL_DIAGNOSTICS__.layers.indexOf(layer), 1); layer = null }
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
const click = async (sel = '.b') => { document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(30) }
let armed = false
const bomb = (n) => h('i', { hook: { update: () => { if (armed) { armed = false; throw new Error('once') } } } }, String(n))
const counter = (view = () => null) => {
  function App({ state }) { return view(state) ?? h('main', null, h('button', { className: 'b' }, '+'), h('output', null, String(state.n)), bomb(state.n)) }
  App.initialState = { n: 0 }
  App.intent = ({ DOM }) => ({ T: DOM.select('.b').events('click') })
  App.model = { T: (s) => ({ n: s.n + 1 }) }
  return App
}
async function mount(App, opts = {}) {
  const app = run(App, {}, { mountPoint: '#root', ...opts })
  apps.push(app)
  await sleep(40)
  return app
}
const root = () => document.querySelector('#root')
const out = () => document.querySelector('output')?.textContent

describe('G-550: the mark is set before onError runs', () => {
  it('an onError handler reads data-sygnal-error="patch" on the root', async () => {
    const seen = []
    await mount(counter(), { onError: (e, i) => seen.push([i.phase, root().getAttribute(ERR)]) })
    armed = true
    await click()
    expect(seen).toEqual([['patch', 'patch']])
  })
})

describe('G-550: a stale mark from a failed, undisposed app', () => {
  it("a new run() into the container clears it on its first patch, and the new app's dispose leaves a mark it didn't set", async () => {
    await mount(counter())
    armed = true
    await click()
    expect(root().getAttribute(ERR)).toBe('patch')
    // a new app into the same container (the failed one is never disposed)
    function Next() { return h('section', { className: 'next' }, 'fresh') }
    const b = run(Next, {}, { mountPoint: '#root' })
    await sleep(40)
    expect(document.querySelector('.next')?.textContent).toBe('fresh')
    expect(root().hasAttribute(ERR)).toBe(false)
    // a mark another app sets after that: the healthy app's dispose doesn't remove it
    root().setAttribute(ERR, 'patch')
    b.dispose()
    await sleep(30)
    expect(root().getAttribute(ERR)).toBe('patch')
  })
})

describe("G-550: renderComponent({ dom: 'real' }) reports through run()'s reporter", () => {
  it("the onError option and the hooks' onError both get the patch error", async () => {
    const hooked = [], seen = []
    const D = globalThis.__SYGNAL_DIAGNOSTICS__
    ;(D.layers ||= []).push(layer = () => ({ onError: (e, i) => hooked.push([e.message, i.phase]) }))
    const t = renderComponent(counter(), { dom: 'real', onError: (e, i) => seen.push([e.message, i.phase]) })
    await t.ready()
    armed = true
    t.query('.b').click(); await t.waitForState(s => s.n == 1)
    await sleep(30)
    expect(seen).toEqual([['once', 'patch']])
    expect(hooked).toEqual([['once', 'patch']])
    expect(errors).not.toHaveBeenCalled()
    t.dispose()
  })

  it('without onError the patch error is logged', async () => {
    const t = renderComponent(counter(), { dom: 'real' })
    await t.ready()
    armed = true
    t.query('.b').click(); await t.waitForState(s => s.n == 1)
    await sleep(30)
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual(['Error: once'])
    t.dispose()
  })
})

describe('G-550: a throw while flattening the tree is a patch error', () => {
  it('reported to onError (phase patch), the root marked, DOM updates stop, the app goes on', async () => {
    const bad = { toJSON() { throw new Error('badkey') } }
    const seen = []
    let n = 0
    const App = counter((s) => s.n == 1 ? h('main', null, h('button', { className: 'b' }), h('output', null, '1'), h('ul', null, h(Fragment, { key: bad }, h('li', null, 'x')))) : undefined)
    App.model = { T: (s) => (n++, { n: s.n + 1 }) }
    const app = await mount(App, { onError: (e, i) => seen.push([e.message, i.phase]) })
    await click()
    expect(seen).toEqual([['badkey', 'patch']])
    expect(root().getAttribute(ERR)).toBe('patch')
    expect(out()).toBe('0')
    await click()
    expect(n).toBe(2)
    expect(out()).toBe('0')
    expect(seen.length).toBe(1)
    expect(errors).not.toHaveBeenCalled()
    app.dispose(); apps = []
    await sleep(30)
    expect(root().hasAttribute(ERR)).toBe(false)
    expect(root().innerHTML).toBe('')
  })
})
