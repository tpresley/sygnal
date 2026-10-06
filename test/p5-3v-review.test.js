// @vitest-environment jsdom
// PLAN-5 3-V: the review of 3-Q (fragment flattening, the patch-error guard). The review's probes
// (rv3q a, b, f: the guard; c: keyed fragment perf; d: derived keys; e: renderComponent) are the
// cases below.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, Portal, Transition, Collection, defineWidget } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.ts'
import { Fragment } from '../src/cycle/dom/fragment.ts'
import { flat } from '../src/cycle/dom/utils.ts'

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

describe('G-541: derived keys never collide (the file-tree case)', () => {
  const dirs = (n) => n % 2 ? [['src/a', ['b.ts']], ['src', ['a/b.ts', 'c.ts']]] : [['src', ['a/b.ts', 'c.ts']], ['src/a', ['b.ts']]]
  const view = (n) => h('ul', null, ...dirs(n).map(([d, fs]) => h(Fragment, { key: d },
    h('li', { key: 'hdr' }, '[' + d + ']'), ...fs.map(f => h('li', { key: f }, d + ' : ' + f)))))

  it("fragment 'src' + 'a/b.ts' and fragment 'src/a' + 'b.ts' get different keys", () => {
    const keys = flat(view(0)).children.map(c => c.key)
    expect(new Set(keys).size).toBe(5)
    // a child's own key never equals a tag-and-count one either
    const ks = flat(h('ul', null, h(Fragment, { key: 'k' }, h('li', { key: 'li#1' }), h('li', null)))).children.map(c => c.key)
    expect(ks[0]).not.toBe(ks[1])
  })

  it('an element is never reused for another item (swapped, or one directory for the other)', async () => {
    const trees = [0, 1, [['src', ['a/b.ts']]], [['src/a', ['b.ts']]]]
    const at = (n) => n < 2 ? dirs(n) : trees[2 + n % 2]
    await mount(counter((s) => h('ul', null, ...at(s.n).map(([d, fs]) => h(Fragment, { key: d },
      h('li', { key: 'hdr' }, '[' + d + ']'), ...fs.map(f => h('li', { key: f }, d + ' : ' + f)))))))
    const stamp = () => { for (const li of document.querySelectorAll('li')) li.stamp ||= li.textContent }
    stamp()
    for (let i = 1; i <= 5; i++) {
      await click('.b')
      expect([...document.querySelectorAll('li')].map(l => l.textContent)).toEqual(at(i).flatMap(([d, fs]) => ['[' + d + ']', ...fs.map(f => d + ' : ' + f)]))
      for (const li of document.querySelectorAll('li')) if (li.stamp) expect(li.stamp).toBe(li.textContent)
      stamp()
    }
  })
})

describe('G-539: an unchanged keyed fragment keeps its copies (snabbdom skips it)', () => {
  /** 2k Collection items, one changed per click: user update hooks run and ms per patch */
  async function bench(frag) {
    let upd = 0
    function Item({ state }) {
      const kids = [h('dt', { hook: { update: () => upd++ } }, state.k), h('dd', null, 'v' + state.k)]
      return frag ? h(Fragment, null, ...kids) : h('div', { hook: { update: () => upd++ } }, ...kids)
    }
    function App() { return h('main', null, h('button', { className: 'b' }), h('dl', null, h(Collection, { of: Item, from: 'items' }))) }
    App.initialState = { items: Array.from({ length: 2000 }, (_, i) => ({ id: i, k: 'k' + i })) }
    App.intent = ({ DOM }) => ({ T: DOM.select('.b').events('click') })
    App.model = { T: s => ({ items: s.items.map((x, i) => i == 5 ? { ...x, k: x.k + '!' } : x) }) }
    const app = await mount(App)
    await sleep(100)
    const hooks = [], times = []
    for (let r = 0; r < 6; r++) {
      upd = 0
      const t0 = performance.now()
      document.querySelector('.b').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await app.__runtime.flushed()
      await sleep(0)
      times.push(performance.now() - t0)
      hooks.push(upd)
    }
    app.dispose(); apps = []
    times.sort((a, b) => a - b)
    return { hooks, ms: times[3] }
  }

  it("2k fragment items, one changed: the changed item's hook only, time comparable to element roots", async () => {
    const el = await bench(false), fr = await bench(true)
    expect(el.hooks).toEqual([2, 2, 2, 2, 2, 2])
    // (it was 2,000 a patch: every item's copy was new)
    expect(fr.hooks).toEqual([1, 1, 1, 1, 1, 1])
    // twice the DOM children (dt + dd per item, no wrapper); it was ~6x
    expect(fr.ms).toBeLessThan(el.ms * 4 + 5)
  })

  it('flat() keeps the copies while the fragment and its prefix are the same', () => {
    const f = h(Fragment, { key: 'a' }, h('i', null, 'x'), h('b', null, 'y'))
    const one = flat(h('div', null, f, h('p', null, 'z'))), two = flat(h('div', null, f))
    expect(two.children[0]).toBe(one.children[0])
    expect(two.children[1]).toBe(one.children[1])
    // under another keyed fragment (another prefix): other copies
    const three = flat(h('div', null, h(Fragment, { key: 'o' }, f)))
    expect(three.children[0]).not.toBe(one.children[0])
    expect(three.children[0].key).not.toBe(one.children[0].key)
  })
})
