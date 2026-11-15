// @vitest-environment jsdom
// within(selector): an ELEMENT target that reaches into the sender's children for ANY method
// (Tune 2026-11: only `focus` could, through focusWithin). The target finds its element itself
// (spec.el, elementCommands.ts) and declares no command, so the element's own method runs.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent, within, focusWithin, Collection } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

function Card({ state }) {
  return h('article', null,
    h('button', { className: 'inner' }, 'Inner'),
    state.open && h('div', { className: 'impact-box', tabIndex: -1 }, 'impact'))
}
Card.intent = ({ DOM }) => ({ INNER: DOM.click('.inner') })
Card.model = { INNER: (s) => ({ ...s, clicks: (s.clicks || 0) + 1 }) }

function Row({ state }) { return h('li', { 'data-id': state.id }, h('input', { className: 'title', value: state.title })) }

function Page({ state }) {
  return h('main', null,
    h(Card, { state: 'card' }),
    h('ul', null, h(Collection, { of: Row, from: 'rows' })))
}
Page.initialState = { card: { open: false }, rows: [{ id: 1, title: 'a' }] }
Page.model = {
  // the box is rendered by the child in the same action
  CHECKED: { STATE: (s) => ({ ...s, card: { ...s.card, open: true } }), ELEMENT: { scrollIntoView: within('.impact-box'), block: 'nearest' } },
  PLAIN: { STATE: (s) => ({ ...s, card: { ...s.card, open: true } }), ELEMENT: { scrollIntoView: '.impact-box' } },
  PRESS: { ELEMENT: { click: within('.inner') } },
  SELECT: { ELEMENT: [{ select: within('[data-id="1"] .title') }, { focus: within('[data-id="1"] .title'), preventScroll: true }] },
  MISSING: { ELEMENT: { scrollIntoView: within('.nowhere') } },
}

describe('within(selector)', () => {
  it('is a target object: its selector, the sender\'s root as its string form, no command of its own', () => {
    const tg = within('.x')
    expect(tg.within).toBe('.x')
    expect(String(tg)).toBe('')
    expect(tg.spec.commands).toBeUndefined()
    // another DOM source (no isolate tree): under the sender's own root, which the runner passes
    const el = {}, root = { matches: () => false, querySelector: (s) => (s === '.x' ? el : null) }
    expect(tg.spec.el({ sources: {}, DOMSourceName: 'DOM' }, [root])).toBe(el)
    expect(tg.spec.el({ sources: {}, DOMSourceName: 'DOM' }, [])).toBeUndefined()
  })

  it('real DOM: scrollIntoView reaches an element a child renders in the same action, with its options', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    try {
      t.simulateAction('CHECKED'); await t.settle(); await wait()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.instances[0]).toBe(t.query('.impact-box'))
      expect(spy.mock.calls[0][0]).toEqual({ block: 'nearest' })
    } finally { spy.mockRestore() }
  })

  it('real DOM: a plain selector stays in the sender\'s own scope', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    try {
      t.simulateAction('PLAIN'); await t.settle(); await wait()
      expect(t.query('.impact-box')).toBeTruthy()
      expect(spy).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })

  it('real DOM: other methods (click in a child, select + focus in a Collection item)', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    t.simulateAction('PRESS'); await t.settle(); await wait()
    expect(t.state.card.clicks).toBe(1)
    const input = t.query('[data-id="1"] .title'), sel = vi.spyOn(input, 'select')
    t.simulateAction('SELECT'); await t.settle(); await wait()
    expect(sel).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(input)
  })

  it('focusWithin targets work for other methods too (the element it finds, its own method)', async () => {
    function P({ state }) { return h('main', null, h(Card, { state: 'card' })) }
    P.initialState = { card: { open: true } }
    P.model = { GO: { ELEMENT: { scrollIntoView: focusWithin('.impact-box') } } }
    t = renderComponent(P, { dom: 'real' }); await t.ready()
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    try {
      t.simulateAction('GO'); await t.settle(); await wait()
      expect(spy.mock.instances[0]).toBe(t.query('.impact-box'))
    } finally { spy.mockRestore() }
  })

  it('mock DOM: recorded in t.commands(); no diagnostics when the selector is inside a child', async () => {
    t = renderComponent(Page); await t.ready()
    t.simulateAction('CHECKED'); await t.settle()
    t.simulateAction('SELECT'); await t.settle()
    expect(t.commands().map(c => Object.values(c)[0].within)).toEqual(['.impact-box', '[data-id="1"] .title', '[data-id="1"] .title'])
    await wait(1100)
    t.expectNoDiagnostics()
  }, 3000)

  it('mock DOM: SYG640 when nothing under the sender matches, naming the selector', async () => {
    t = renderComponent(Page); await t.ready()
    t.simulateAction('MISSING'); await t.settle()
    await wait(1100)
    const d = t.diagnostics.find(d => d.code == 'SYG640')
    expect(d.message).toContain(`{ scrollIntoView: within(".nowhere") }`)
    expect(d.message).toContain(`under Page's root, its children included, matches '.nowhere'`)
    expect(d.message).not.toContain('has no target')
  }, 3000)

  it('mock DOM: a plain selector that only a child renders says to use within()', async () => {
    t = renderComponent(Page); await t.ready()
    t.simulateAction('PLAIN'); await t.settle()
    await wait(1100)
    const d = t.diagnostics.find(d => d.code == 'SYG640')
    expect(d.message).toContain(`send { scrollIntoView: within('.impact-box') }`)
  }, 3000)
})
