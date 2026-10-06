// @vitest-environment jsdom
// PLAN-5 3-V: the review of 3-Q (fragment flattening, the patch-error guard). The review's probes
// (rv3q a, b, f: the guard; c: keyed fragment perf; d: derived keys; e: renderComponent) are the
// cases below.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, Portal, Transition, defineWidget } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.ts'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let apps = [], errors
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1))
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

const click = async (sel) => { document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(30) }
/** an App with a `.b` button whose click adds 1 to state.n */
const counter = (view) => {
  function App({ state }) { return h('main', null, h('button', { className: 'b' }, '+'), view(state)) }
  App.initialState = { n: 0 }
  App.intent = ({ DOM }) => ({ T: DOM.select('.b').events('click') })
  App.model = { T: (s) => ({ n: s.n + 1 }) }
  return App
}
async function mount(App, opts = {}) {
  document.body.innerHTML = '<div id="root"></div><div id="modals"></div>'
  const app = run(App, {}, { mountPoint: '#root', ...opts })
  apps.push(app)
  await sleep(40)
  return app
}
/** an element whose update hook throws once, when armed */
let armed = false
const bomb = (n) => h('i', { hook: { update: () => { if (armed) { armed = false; throw new Error('once') } } } }, String(n))

describe('G-540: a patch that throws stops the app\'s DOM updates (no re-adoption over a live app)', () => {
  it('a widget keeps its DOM (it was wiped and stayed blank)', async () => {
    let mounts = 0
    const Chart = defineWidget({ mount(el) { mounts++; el.innerHTML = '<canvas class="cv"></canvas>'; return {} }, update() {} })
    await mount(counter((s) => h('div', null, h(Chart, { className: 'chart', v: s.n }), bomb(s.n))))
    armed = true
    await click('.b'); await click('.b')
    expect(document.querySelector('.chart').innerHTML).toBe('<canvas class="cv"></canvas>')
    expect(mounts).toBe(1)
  })

  it('a Portal is not duplicated, and its content goes on dispose', async () => {
    const app = await mount(counter((s) => h('div', null,
      h(Portal, { target: '#modals' }, h('b', { className: 'pc' }, 'p' + s.n)), bomb(s.n))))
    armed = true
    await click('.b'); await click('.b')
    expect(document.querySelectorAll('.pc').length).toBe(1)
    app.dispose(); apps = []
    await sleep(30)
    expect(document.querySelector('#modals').innerHTML).toBe('')
  })

  it('a Transition child is not made again (its enter replayed), a typed input is kept', async () => {
    await mount(counter((s) => h('div', null, h('input', { className: 'in' }),
      h(Transition, { name: 'f' }, h('p', { className: 'tp' }, 'x')), bomb(s.n))))
    const inp = document.querySelector('.in'), tp = document.querySelector('.tp')
    inp.value = 'typed'
    armed = true
    await click('.b')
    expect(document.querySelector('.in')).toBe(inp)
    expect(inp.value).toBe('typed')
    expect(document.querySelector('.tp')).toBe(tp)
  })

  it('an error on every patch is reported once (no spam); later patches are not tried', async () => {
    let calls = 0
    await mount(counter((s) => h('div', null, h('output', null, String(s.n)),
      h('i', { hook: { update: () => { calls++; throw new Error('always') } } }, 'x'))))
    await click('.b'); await click('.b'); await click('.b')
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual(['Error: always'])
    expect(calls).toBe(1)
    // the failed patch had written the output before the hook threw; nothing after it
    expect(document.querySelector('output').textContent).toBe('1')
  })

  it('events still reach the app (the DOM source does not end)', async () => {
    let seen = 0
    function App({ state }) { return h('main', null, h('button', { className: 'b' }), bomb(state.n)) }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ T: DOM.select('.b').events('click') })
    App.model = { T: (s) => (seen++, { n: s.n + 1 }) }
    await mount(App)
    armed = true
    await click('.b'); await click('.b'); await click('.b')
    expect(seen).toBe(3)
  })
})

describe('G-537 (D223): a patch error goes to run({ onError }) with phase \'patch\'', () => {
  it('onError gets it (not console.error), once', async () => {
    const seen = []
    await mount(counter((s) => h('div', null, bomb(s.n))), { onError: (e, info) => seen.push([e.message, info]) })
    armed = true
    await click('.b'); await click('.b')
    expect(seen).toEqual([['once', { phase: 'patch' }]])
    expect(errors).not.toHaveBeenCalled()
  })

  it("the hooks' onError gets it too (devtools, diagnostics)", async () => {
    const seen = []
    await mount(counter((s) => h('div', null, bomb(s.n))), { __hooks: { onError: (e, info) => seen.push([e.message, info.phase]) } })
    armed = true
    await click('.b')
    expect(seen).toEqual([['once', 'patch']])
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual(['Error: once'])
  })

  it("renderComponent({ dom: 'real', onError }) gets it as well", async () => {
    const seen = []
    const t = renderComponent(counter((s) => h('div', null, bomb(s.n))), { dom: 'real', onError: (e, info) => seen.push([e.message, info.phase]) })
    await t.ready()
    armed = true
    t.query('.b').click()
    await t.waitForState(s => s.n == 1)
    expect(seen).toEqual([['once', 'patch']])
    t.dispose()
  })

  it('a throwing onError is logged and swallowed', async () => {
    await mount(counter((s) => h('div', null, bomb(s.n))), { onError: () => { throw new Error('hook') } })
    armed = true
    await click('.b')
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual(['Error: hook'])
  })
})
