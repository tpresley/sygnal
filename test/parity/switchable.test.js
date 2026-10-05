// @vitest-environment jsdom
// PLAN-4.6 parity: Switchable (spike 0-S §3, ported to the public API), G-292 and D172 (hidden pages).
import { it, expect } from 'vitest'
import { parity, itNext, mount, h, click, until, sleep, xs, Switchable } from './harness.js'

let renders, disposed
function Counter({ state }) { renders[state.tag] = (renders[state.tag] || 0) + 1; return h('section', { className: state.tag }, h('button', { className: 'inc' }, `${state.tag}:${state.n}`)) }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (s) => ({ ...s, n: s.n + 1 }), DISPOSE: { EFFECT: (s) => disposed.push(s.tag) } }
function Plain() { return h('section', { className: 'plain' }, 'plain') }
function Local({ state }) { return h('section', { className: 'local' }, h('button', { className: 'linc' }, `local:${state.k}`)) }
Local.isolatedState = true
Local.initialState = { k: 0 }
Local.intent = ({ DOM }) => ({ INC: DOM.click('.linc') })
Local.model = { INC: (s) => ({ ...s, k: s.k + 1 }), DISPOSE: { EFFECT: () => disposed.push('local') } }

/** pages: `second` is the other page (Plain, or the isolatedState Local) */
function tabs(second) {
  function Tabs({ state }) {
    return h('div', null, h('button', { className: 'go-a' }, 'a'), h('button', { className: 'go-l' }, 'l'), h('button', { className: 'bump' }, 'bump'), h('button', { className: 'reinst' }, 'r'),
      h('main', null, h(Switchable, { of: { a: Counter, l: second }, current: state.page, state: 'pageA', instance: state.inst })))
  }
  Tabs.initialState = { page: 'a', inst: 1, pageA: { tag: 'pa', n: 0 } }
  Tabs.intent = ({ DOM }) => ({ A: DOM.click('.go-a'), L: DOM.click('.go-l'), BUMP: DOM.click('.bump'), RE: DOM.click('.reinst') })
  Tabs.model = {
    A: (s) => ({ ...s, page: 'a' }), L: (s) => ({ ...s, page: 'l' }),
    BUMP: (s) => ({ ...s, pageA: { ...s.pageA, n: s.pageA.n + 100 } }),
    RE: (s) => ({ ...s, inst: s.inst + 1 }),
  }
  return Tabs
}

parity('parity: Switchable hidden pages kept alive, current, instance', () => {
  it('a hidden page shows the current state when shown again; its own clicks still count', async () => {
    renders = {}; disposed = []
    const m = mount(tabs(Plain))
    await until(() => expect(m.text('.inc')).toBe('pa:0'))
    click(m.$('.inc'))
    await until(() => expect(m.text('.inc')).toBe('pa:1'))
    click(m.$('.go-l'))
    await until(() => expect(m.$('.plain')).toBeTruthy())
    click(m.$('.bump'))
    await sleep(20)
    expect(m.$('.pa')).toBe(null)
    click(m.$('.go-a'))
    await until(() => expect(m.text('.inc')).toBe('pa:101'))
    expect(disposed).toEqual([])
  })

  it('a hidden page does not re-render on state changes (its render is skipped until shown)', async () => {
    renders = {}; disposed = []
    const m = mount(tabs(Plain))
    await until(() => expect(m.text('.inc')).toBe('pa:0'))
    click(m.$('.go-l'))
    await until(() => expect(m.$('.plain')).toBeTruthy())
    await sleep(20)
    const r = renders.pa
    click(m.$('.bump'))
    await sleep(30)
    expect(renders.pa).toBe(r)
    click(m.$('.go-a'))
    await until(() => expect(m.text('.inc')).toBe('pa:100'))
  })

  it('an instance change re-creates the current page (DISPOSE of the old instance)', async () => {
    renders = {}; disposed = []
    const m = mount(tabs(Plain))
    await until(() => expect(m.text('.inc')).toBe('pa:0'))
    click(m.$('.reinst'))
    await until(() => expect(disposed).toEqual(['pa']))
    expect(m.text('.inc')).toBe('pa:0')
  })

  it("a hidden page's actions still run and its PARENT reaches the parent's CHILD.select(Page)", async () => {
    function Page({ state }) { return h('p', { className: 'pg' }, String(state.v)) }
    Page.intent = ({ DOM }) => ({ T: DOM.click('.pg'), TICK: xs.periodic(5).take(3) })
    Page.model = { TICK: { STATE: (s) => ({ ...s, v: s.v + 1 }), PARENT: (s) => s.v + 1 }, T: (s) => s }
    function Other() { return h('p', { className: 'other' }, 'other') }
    function P({ state }) { return h('div', null, h(Switchable, { of: { pg: Page, other: Other }, current: 'other' }), h('b', { className: 'got' }, state.got.join())) }
    P.initialState = { v: 0, got: [] }
    P.intent = ({ CHILD }) => ({ GOT: CHILD.select(Page) })
    P.model = { GOT: (s, v) => ({ ...s, got: [...s.got, v] }) }
    const m = mount(P)
    await until(() => expect(m.text('.got')).toBe('1,2,3'))
    expect(m.$('.pg')).toBe(null)
    expect(m.state().v).toBe(3)
  })
}, 'R2')

parity('parity: an isolatedState page next to a state-bound page (G-292)', () => {
  // On the current core the isolatedState page's local state leaks into the sibling page's
  // STATE source: Counter renders Local's { k: 0 } ('undefined:undefined'). Found in R0 while
  // porting the spike's Switchable tests; the spike core (and so the next core) keeps them apart.
  itNext('G-292 current-core bug', 'the state-bound page renders its own slice, not the isolated sibling\'s local state', async () => {
    renders = {}; disposed = []
    const m = mount(tabs(Local))
    await until(() => expect(m.text('.inc')).toBe('pa:0'), 500)
  })

  itNext('G-292 current-core bug', 'local state survives switches; an instance change re-creates the current isolated page (fresh state, DISPOSE)', async () => {
    renders = {}; disposed = []
    const m = mount(tabs(Local))
    await until(() => expect(m.text('.inc')).toBe('pa:0'), 500)
    click(m.$('.go-l'))
    await until(() => expect(m.text('.linc')).toBe('local:0'))
    click(m.$('.linc')); click(m.$('.linc'))
    await until(() => expect(m.text('.linc')).toBe('local:2'))
    click(m.$('.go-a'))
    await until(() => expect(m.text('.inc')).toBe('pa:0'))
    click(m.$('.go-l'))
    await until(() => expect(m.text('.linc')).toBe('local:2')) // kept alive
    click(m.$('.reinst'))
    await until(() => expect(m.text('.linc')).toBe('local:0'))
    expect(disposed).toEqual(['local'])
  })
}, 'R2')

parity('parity: D172 hidden pages render on first show (G-121; no `lazy` prop)', () => {
  // D172 (supersedes D166): today's behaviour is kept. A hidden page is created at mount and runs
  // from then on, but its view is first called when it is first shown. R0's D166 tests ("render
  // at mount" and a `lazy` prop) were rewritten in R2.
  it('a page never shown has its view called only when it is first shown', async () => {
    let views = 0
    function Hidden() { views++; return h('p', { className: 'hid' }, 'h') }
    function Shown() { return h('p', { className: 'shown' }, 's') }
    function P({ state }) { return h('div', null, h('button', { className: 'flip' }), h(Switchable, { of: { s: Shown, h: Hidden }, current: state.page })) }
    P.initialState = { page: 's' }
    P.intent = ({ DOM }) => ({ FLIP: DOM.click('.flip') })
    P.model = { FLIP: (s) => ({ ...s, page: 'h' }) }
    const m = mount(P)
    await until(() => expect(m.$('.shown')).toBeTruthy())
    await sleep(20)
    expect(views).toBe(0)
    expect(m.$('.hid')).toBe(null)
    click(m.$('.flip'))
    await until(() => expect(m.$('.hid')).toBeTruthy())
    expect(views).toBeGreaterThan(0)
  })

  it("a hidden page's intent, actions, BOOTSTRAP and PARENT run from mount, before its view is first called", async () => {
    const log = { views: 0, boot: 0 }
    function Hidden({ state }) { log.views++; return h('p', { className: 'hid' }, `h${state.n}`) }
    Hidden.intent = () => ({ TICK: xs.periodic(5).take(2) })
    Hidden.model = { TICK: { STATE: (s) => ({ ...s, n: s.n + 1 }), PARENT: (s) => s.n + 1 }, BOOTSTRAP: { EFFECT: () => log.boot++ } }
    function Shown() { return h('p', { className: 'shown' }, 's') }
    function P({ state }) { return h('div', null, h('button', { className: 'flip' }), h(Switchable, { of: { s: Shown, h: Hidden }, current: state.page, state: 'h' }), h('b', { className: 'got' }, state.got.join())) }
    P.initialState = { page: 's', h: { n: 0 }, got: [] }
    P.intent = ({ DOM, CHILD }) => ({ FLIP: DOM.click('.flip'), GOT: CHILD.select(Hidden) })
    P.model = { FLIP: (s) => ({ ...s, page: 'h' }), GOT: (s, v) => ({ ...s, got: [...s.got, v] }) }
    const m = mount(P)
    await until(() => expect(m.text('.got')).toBe('1,2'))
    expect(m.state().h.n).toBe(2) // its actions ran while hidden
    expect(log.boot).toBe(1) // mounted (BOOTSTRAP) though never rendered
    expect(log.views).toBe(0)
    click(m.$('.flip'))
    await until(() => expect(m.text('.hid')).toBe('h2')) // first shown: rendered with the current state
    expect(log.views).toBeGreaterThan(0)
  })
}, 'R2')
