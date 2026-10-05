// @vitest-environment jsdom
// PLAN-4.6 R4: fixes of the R3 review's findings (G-318...G-323), on the next core. Each test is a
// behaviour both cores meet (the current core is the oracle), unless it says otherwise.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, createElement as h, Portal, xs, Collection, Switchable } from '../src/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let apps = []
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = '' })
const start = (App, drivers = {}) => { const a = run(App, drivers, { mountPoint: '#root' }); apps.push(a); return a }
const click = (sel) => document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('G-318: a Portal first reached by a patch (not an insert) mounts', () => {
  it('over server markup (hydration patches the placeholder in place)', async () => {
    document.body.innerHTML = '<div id="modal"></div><div id="root"><div><div data-sygnal-portal="#modal" style="display:none"></div></div></div>'
    function App() { return h('div', null, h(Portal, { target: '#modal' }, h('p', { className: 'hi' }, 'hi'))) }
    start(App)
    await sleep(60)
    expect(document.querySelector('#modal .hi')?.textContent).toBe('hi')
  })

  it('replacing a plain div at the same position', async () => {
    document.body.innerHTML = '<div id="modal"></div><div id="root"></div>'
    function App({ state }) { return h('div', null, h('button', null, 'x'), state.open ? h(Portal, { target: '#modal' }, h('p', { className: 'hi' }, 'hi')) : h('div', null, 'closed')) }
    App.initialState = { open: false }
    App.intent = ({ DOM }) => ({ T: DOM.click('button') })
    App.model = { T: (s) => ({ ...s, open: !s.open }) }
    start(App)
    await sleep(40)
    click('button')
    await sleep(60)
    expect(document.querySelector('#modal .hi')?.textContent).toBe('hi')
    // (switching back to the plain div patches the placeholder div in place: its content stays
    // in the target on both cores, an inherited limit of the placeholder being a div)
  })
})

/** a connections driver that logs declarations ([decl, sender, names]) and stopped replies ([stop, sender]) */
function recDriver(log) {
  return (sink$) => {
    sink$.addListener({ next: (v) => log.push(['decl', v.__emitterId, Object.keys(v.connections || {}).join()]) })
    const src = { __sygnalStatic: 'connections', __sygnalReplies: true,
      replies: (id) => xs.create({ start: () => {}, stop: () => log.push(['stop', id]) }),
      isolateSource: () => src, isolateSink: (s$) => s$, isolateValue: (v) => v }
    return src
  }
}

describe('G-320: statics keep following the state while a render throws', () => {
  it("a child's declaration goes out though a sibling Collection's sort throws in the same render", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    document.body.innerHTML = '<div id="root"></div>'
    const log = []
    function Child({ state }) { return h('p', null, String(state.n)) }
    Child.connections = (s) => ({ ['n' + s.n]: { socket: '/n/' + s.n } })
    function Item({ state }) { return h('li', null, String(state.v)) }
    function App() { return h('div', null, h('button', null, 'x'), h(Child, { state: 'kid' }), h(Collection, { of: Item, from: 'rows', sort: (a, b) => { if (a.bad || b.bad) throw new Error('bad sort'); return a.v - b.v } })) }
    App.initialState = { kid: { n: 1 }, rows: [{ id: 1, v: 1 }] }
    App.intent = ({ DOM }) => ({ GO: DOM.click('button') })
    App.model = { GO: (s) => ({ ...s, kid: { n: 2 }, rows: [...s.rows, { id: 2, v: 0, bad: true }] }) }
    start(App, { SOCK: recDriver(log) })
    await sleep(40)
    click('button'); await sleep(60)
    expect(log.some(e => e[0] == 'decl' && e[2] == 'n2')).toBe(true)
    vi.restoreAllMocks()
  })
})

describe('G-322: an id-less item and an item whose id equals its index get different uids', () => {
  // (the current core gives both 'u-0-0': next core only, with renderToString matching it)
  const nextOnly = process.env.SYGNAL_CORE == 'next' ? it : it.skip
  nextOnly('[{ t }, { id: 0 }] renders two distinct ids, and the server renders the same ones', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    function Item({ state, uid }) { return h('li', { attrs: { id: uid() } }, String(state.t)) }
    function App() { return h('ul', null, h(Collection, { of: Item, from: 'rows' })) }
    App.initialState = { rows: [{ t: 'noid' }, { id: 0, t: 'zero' }] }
    start(App)
    await sleep(40)
    const ids = [...document.querySelectorAll('li')].map(l => l.id)
    expect(new Set(ids).size).toBe(2)
    const { renderToString } = await import('../src/index.js')
    const html = renderToString(App)
    for (const id of ids) expect(html).toContain(`id="${id}"`)
  })
})

describe('G-319: a Collection on a hidden Switchable page follows its array', () => {
  it('removed rows stop and new rows declare their background statics while the page is hidden', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const log = []
    function Item({ state }) { return h('li', null, String(state.id)) }
    Item.connections = (s) => ({ ['c' + s.id]: { socket: '/i/' + s.id, background: true } })
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'rows' })) }
    function Other() { return h('p', null, 'other') }
    function App({ state }) { return h('div', null, h('button', { className: 'sw' }, 's'), h('button', { className: 'del' }, 'd'), h(Switchable, { of: { list: List, other: Other }, current: state.cur })) }
    App.initialState = { cur: 'list', rows: [{ id: 1 }, { id: 2 }] }
    App.intent = ({ DOM }) => ({ SW: DOM.click('.sw'), DEL: DOM.click('.del') })
    App.model = { SW: (s) => ({ ...s, cur: s.cur == 'list' ? 'other' : 'list' }), DEL: (s) => ({ ...s, rows: [{ id: 2 }, { id: 3 }] }) }
    start(App, { SOCK: recDriver(log) })
    await sleep(40)
    click('.sw'); await sleep(40)
    const n = log.length
    click('.del'); await sleep(40)
    const hidden = log.slice(n)
    expect(hidden.filter(e => e[0] == 'stop')).toHaveLength(1)
    expect(hidden.some(e => e[0] == 'decl' && e[2] == 'c3')).toBe(true)
  })
})
