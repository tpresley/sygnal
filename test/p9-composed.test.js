// PLAN-9 M-1 (D466): <Composed catalog from /> specifics. The parity with catalog.render() is
// test/p9-composed-parity.test.js (the compose suites run through the marker); here: lazy
// registration (G-751), the same HTML as render(), `from` as a key or a path, `card`, the render
// options as props, error containment (only the composition is replaced, SYG408, vs render()'s
// SYG406), misuse (SYG451) and the exports.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { pres } from '../src/core/registry.ts'
import { defineCatalog, compose, Composed, askCard } from '../src/extra/ai/index.ts'
import { configureDiagnostics, getDiagnostics, _resetDiagnostics } from '../src/extra/diagnostics/index.ts'
import * as sygnal from '../src/index.ts'
import * as ai from '../src/ai.ts'

let t
beforeEach(() => { _resetDiagnostics(); configureDiagnostics({ mode: 'collect' }) })
afterEach(() => { t?.dispose(); t = null; _resetDiagnostics() })
const codes = () => getDiagnostics().map((d) => d.code)

function Tile({ state, label, node, scope, frozen, answer }) {
  return h('div', { className: 'tile', 'data-node': node }, `${label}:${state.n}|${scope ?? ''}|${frozen ?? ''}|${answer ?? ''}`, h('button', { className: 'inc', type: 'button' }, '+'))
}
Tile.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Tile.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }

const makeCatalog = (where = 'none') => defineCatalog({
  parts: {
    a: { component: Tile, local: { n: 0 }, description: 'A', props: () => { if (where === 'props') throw new Error('props threw'); return { label: 'a' } } },
    b: { component: Tile, local: { n: 10 }, description: 'B', props: { label: 'b' } },
  },
  containers: {
    box: { slots: { default: null }, render: ({ slots }) => { if (where === 'container') throw new Error('container threw'); return h('div', { className: 'box' }, slots.default) } },
  },
})
const L = (nodes, keys = Object.keys(nodes)) => ({ root: 'page', nodes: { page: { part: 'page', slots: { default: keys } }, ...nodes } })
const BOX = L({ box: { part: 'box', slots: { default: ['a'] } }, a: { part: 'a' } }, ['box'])
const slice = (layout) => ({ layout, preview: null, ui: {}, local: {} })

/** a host with a plain paragraph and the composition at `page` (or at `path`), by `via` */
function host(cat, via, { path = ['page'], layout = BOX, ...extra } = {}) {
  function Host({ state }) {
    const s = path.reduce((x, k) => x?.[k], state)
    return h('main', null, h('p', { className: 'x' }, 'x'), via === 'marker' ? h(Composed, { catalog: cat, from: path.length === 1 ? path[0] : path }) : cat.render(s, state, { at: path }))
  }
  const st = { x: 1 }
  let o = st
  path.slice(0, -1).forEach((k) => { o = o[k] = typeof path[path.indexOf(k) + 1] === 'number' ? [] : {} })
  o[path[path.length - 1]] = slice(layout)
  Host.initialState = st
  Host.model = { SET: (s, layout) => ({ ...s, page: { ...s.page, layout } }) }
  Object.assign(Host, extra)
  return Host
}

describe('<Composed>', () => {
  it('registers its rewrite when a tag uses it, not on import (G-751)', () => {
    expect(pres.composed).toBeUndefined()
    const v = h(Composed, { catalog: makeCatalog(), from: 'page' })
    expect(v.sel).toBe('composed')
    expect(v.data.m).toBe(Composed)
    expect(typeof pres.composed).toBe('function')
  })

  it('is exported from sygnal and sygnal/ai', () => {
    expect(sygnal.Composed).toBe(Composed)
    expect(ai.Composed).toBe(Composed)
  })

  it('renders the same HTML as render(), with the same instances and local state', async () => {
    const out = {}
    for (const via of ['render', 'marker']) {
      t = renderComponent(host(makeCatalog(), via))
      await t.ready()
      t.simulateEvent('.inc', 'click')
      await t.next((s) => s.page.local.a?.n === 1)
      out[via] = t.html()
      t.dispose(); t = null
    }
    expect(out.marker).toBe(out.render)
    expect(out.marker).toContain('a:1')
  })

  it('`from` as a path: local parts write at that path; a move keeps the instance', async () => {
    t = renderComponent(host(makeCatalog(), 'marker', { path: ['boards', 0, 'page'], layout: L({ a: { part: 'a' }, b: { part: 'b' } }) }))
    await t.ready()
    expect(t.queryAll('.tile').map((e) => e.textContent)).toEqual(['a:0|||+', 'b:10|||+'])
    t.simulateEvent('.inc', 'click')
    await t.next((s) => s.boards[0].page.local.a?.n === 1)
    expect(t.state.page).toBeUndefined()
    expect(t.queryAll('.tile')[0].textContent).toBe('a:1|||+')
  })

  it('scope, frozen and answer reach the parts as with render()', async () => {
    function Host() { return h('main', null, h(Composed, { catalog: makeCatalog(), from: 'page', scope: 'call_1', frozen: true, answer: { node: 'b', value: 'yes' } })) }
    Host.initialState = { page: slice(L({ a: { part: 'a' }, b: { part: 'b' } })) }
    t = renderComponent(Host)
    await t.ready()
    expect(t.query('fieldset.compose-frozen')).toBeTruthy()
    expect(t.queryAll('.tile').map((e) => e.textContent)).toEqual(['a:0|call_1|true|+', 'b:10|call_1|true|yes+'])
  })

  it('card={part}: the card of an ask_user tool part, as askCard() renders it', async () => {
    const cat = makeCatalog()
    const part = { type: 'tool-ask_user', toolCallId: 'c1', state: 'input-available', input: { need: 'x' },
      ui: { status: 'open', layout: L({ a: { part: 'a' } }), local: {}, ui: {}, answer: null } }
    const out = {}
    for (const via of ['render', 'marker']) {
      function Host({ state }) {
        const p = state.chat.messages[0].parts[0]
        return h('main', null, via === 'marker' ? h(Composed, { catalog: cat, card: p, from: 'chat' }) : askCard(cat, state, p, { key: 'chat' }))
      }
      Host.initialState = { chat: { messages: [{ role: 'assistant', parts: [part] }] } }
      t = renderComponent(Host)
      await t.ready()
      t.simulateEvent('.inc', 'click')
      await t.next((s) => s.chat.messages[0].parts[0].ui.local.a?.n === 1)
      out[via] = t.html()
      t.dispose(); t = null
    }
    expect(out.marker).toBe(out.render)
    expect(out.marker).toContain('a:1|c1|')
  })

  it('a card with no layout yet renders nothing', async () => {
    function Host() { return h('main', null, h(Composed, { catalog: makeCatalog(), card: { toolCallId: 'c1', ui: { status: 'composing', layout: null } } }), h('p', { className: 'ok' }, 'ok')) }
    t = renderComponent(Host)
    await t.ready()
    expect(t.query('.ok')).toBeTruthy()
    expect(t.query('.tile')).toBeNull()
    expect(codes()).not.toContain('SYG451')
  })

  it('a layout change moves the parts (keyed by node key) and keeps their state', async () => {
    t = renderComponent(host(makeCatalog(), 'marker', { layout: L({ a: { part: 'a' }, b: { part: 'b' } }) }))
    await t.ready()
    t.simulateEvent('.inc', 'click')
    await t.next((s) => s.page.local.a?.n === 1)
    t.simulateAction('SET', L({ box: { part: 'box', slots: { default: ['b', 'a'] } }, a: { part: 'a' }, b: { part: 'b' } }, ['box']))
    await t.next((s) => s.page.layout.nodes.box)
    expect(t.queryAll('.box .tile').map((e) => e.textContent)).toEqual(['b:10|||+', 'a:1|||+'])
  })
})

describe('<Composed>: error containment', () => {
  for (const where of ['container', 'props']) {
    it(`a ${where} that throws: render() shows .compose-error (SYG406); the marker the host's onError (SYG408); the rest of the view stays`, async () => {
      const res = {}
      for (const via of ['render', 'marker']) {
        _resetDiagnostics(); configureDiagnostics({ mode: 'collect' })
        const errors = []
        t = renderComponent(host(makeCatalog(where), via, { onError: (e) => h('p', { className: 'fallback' }, e.message) }), { onError: (e) => errors.push(e.message) })
        await t.ready()
        res[via] = { html: t.html(), errors, codes: codes() }
        t.dispose(); t = null
      }
      expect(res.render.html).toContain('compose-error')
      expect(res.render.html).toContain('class="x"')
      expect(res.render.codes).toContain('SYG406')
      expect(res.marker.html).toContain(`<p class="fallback">${where} threw</p>`)
      expect(res.marker.html).toContain('class="x"')
      expect(res.marker.html).not.toContain('compose-error')
      expect(res.marker.errors).toEqual([`${where} threw`])
    })
  }

  it('without onError the marker renders the default error element in place of the composition', async () => {
    t = renderComponent(host(makeCatalog('container'), 'marker'), { onError: () => {} })
    await t.ready()
    expect(t.query('.x')).toBeTruthy()
    expect(t.query('.box')).toBeNull()
    expect(t.html()).toContain('data-sygnal-error')
  })

  it('the composition recovers when the layout no longer throws', async () => {
    const cat = makeCatalog('container')
    t = renderComponent(host(cat, 'marker', { onError: () => h('p', { className: 'fallback' }, 'f') }), { onError: () => {} })
    await t.ready()
    expect(t.query('.fallback')).toBeTruthy()
    t.simulateAction('SET', L({ b: { part: 'b' } }))
    await t.next((s) => s.page.layout.nodes.b)
    expect(t.query('.fallback')).toBeNull()
    expect(t.query('.tile').textContent).toBe('b:10|||+')
  })
})

describe('<Composed>: misuse (SYG451)', () => {
  const misuse = async (props, state = { page: slice(BOX) }) => {
    function Host() { return h('main', null, h(Composed, props), h('p', { className: 'ok' }, 'ok')) }
    Host.initialState = state
    t = renderComponent(Host)
    await t.ready()
    expect(t.query('.ok')).toBeTruthy()
    expect(t.query('.tile')).toBeNull()
    return getDiagnostics().filter((d) => d.code === 'SYG451')
  }

  it('no catalog', async () => {
    const d = await misuse({ from: 'page' })
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain('has no catalog')
  })

  it('a catalog that is not one (no render)', async () => {
    expect(await misuse({ catalog: { parts: {} }, from: 'page' })).toHaveLength(1)
  })

  it('`from` naming no state, or state that is not a composition', async () => {
    expect((await misuse({ catalog: makeCatalog(), from: 'nope' }))[0].message).toContain('"nope"')
    t.dispose(); t = null; _resetDiagnostics(); configureDiagnostics({ mode: 'collect' })
    expect(await misuse({ catalog: makeCatalog(), from: ['page', 'ui'] })).toHaveLength(1)
    t.dispose(); t = null; _resetDiagnostics(); configureDiagnostics({ mode: 'collect' })
    expect(await misuse({ catalog: makeCatalog() }, { page: 3 })).toHaveLength(1)
  })

  it('`card` that is not a tool part', async () => {
    expect((await misuse({ catalog: makeCatalog(), card: { ui: {} } }))[0].message).toContain('tool part')
  })

  it('reported once per host and problem, as a warning', async () => {
    function Host({ state }) { return h('main', null, h(Composed, { from: 'page' }), String(state.n)) }
    Host.initialState = { n: 0 }
    Host.model = { BUMP: (s) => ({ n: s.n + 1 }) }
    t = renderComponent(Host)
    await t.ready()
    t.simulateAction('BUMP')
    await t.next((s) => s.n === 1)
    const d = getDiagnostics().filter((x) => x.code === 'SYG451')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warn')
  })

  it('a composition with no layout yet (compose() before its first run) is not misuse', async () => {
    function Host() { return h('main', null, h(Composed, { catalog: makeCatalog(), from: 'page' }), h('p', { className: 'ok' }, 'ok')) }
    Host.uses = { page: compose(makeCatalog(), { backend: compose.llm({ model: 'm' }) }) }
    t = renderComponent(Host)
    await t.ready()
    expect(t.query('.ok')).toBeTruthy()
    expect(codes()).not.toContain('SYG451')
  })
})
