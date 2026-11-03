// @vitest-environment jsdom
// Streams on one event type and selector shared a destination whatever their options, so the
// first to start set preventDefault / passive / capture for all: DOM.submit('.f') before
// DOM.submit('.f', { preventDefault: true }) let the submit reload the page. A destination is now
// shared only with the same options. The bubbling root listener was passive or not per the first
// stream, and the other kind of destination never fired: it is passive only while every started
// destination is. An element listener stays while any destination needs it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  vi.restoreAllMocks()
  _resetDiagnostics()
})

const fire = (type, sel = 'form') => {
  const e = new Event(type, { cancelable: true, bubbles: type === 'click' })
  t.query(sel).dispatchEvent(e)
  return e
}
const log = (name) => (s) => ({ ...s, log: [...s.log, name] })
const tick = () => new Promise(r => setTimeout(r, 10))

function app(intent, model) {
  function F({ state }) {
    return h('div', null, h('form', { className: 'f' }, h('input', { name: 'x' })), h('p', null, state.log.join(',')))
  }
  F.initialState = { log: [] }
  F.intent = intent
  F.model = model
  return F
}

describe('streams with different options on one event and selector', () => {
  for (const [name, intent] of [
    ['plain first', ({ DOM }) => ({ A: DOM.submit('.f'), B: DOM.submit('.f', { preventDefault: true }) })],
    ['preventDefault first', ({ DOM }) => ({ B: DOM.submit('.f', { preventDefault: true }), A: DOM.submit('.f') })],
    ['events() form', ({ DOM }) => ({ A: DOM.select('.f').events('submit'), B: DOM.select('.f').events('submit', { preventDefault: true }) })],
  ]) {
    it(`submit: ${name}: preventDefault runs and both fire`, async () => {
      t = renderComponent(app(intent, { A: log('a'), B: log('b') }), { dom: 'real' })
      await t.ready()
      await t.settle()
      expect(fire('submit').defaultPrevented).toBe(true)
      await t.waitForState(s => s.log.length === 2)
      await t.settle()
      expect([...t.state.log].sort()).toEqual(['a', 'b'])
    })
  }

  for (const order of ['passive first', 'active first']) {
    it(`bubbling click, ${order}: both fire and preventDefault runs`, async () => {
      const P = (DOM) => DOM.select('.f').events('click', { passive: true })
      const A = (DOM) => DOM.select('.f').events('click', { preventDefault: true })
      const intent = order === 'passive first'
        ? ({ DOM }) => ({ P: P(DOM), A: A(DOM) })
        : ({ DOM }) => ({ A: A(DOM), P: P(DOM) })
      t = renderComponent(app(intent, { P: log('p'), A: log('a') }), { dom: 'real' })
      await t.ready()
      await t.settle()
      expect(fire('click').defaultPrevented).toBe(true)
      await t.waitForState(s => s.log.length === 2)
      await t.settle()
      expect([...t.state.log].sort()).toEqual(['a', 'p'])
    })
  }

  it('one of two destinations on an element stops: the other still receives, the listener turns passive, then goes', async () => {
    const add = vi.spyOn(HTMLFormElement.prototype, 'addEventListener')
    const remove = vi.spyOn(HTMLFormElement.prototype, 'removeEventListener')
    const intent = ({ DOM }) => ({
      P: DOM.select('.f').events('toggle', { passive: true }),
      A: DOM.select('.f').events('toggle', { preventDefault: true }).take(1),
    })
    t = renderComponent(app(intent, { P: log('p'), A: log('a') }), { dom: 'real' })
    await t.ready()
    await t.settle()
    const toggles = (spy) => spy.mock.calls.filter(c => c[0] === 'toggle')
    expect(toggles(add).at(-1)[2].passive).toBe(false)

    expect(fire('toggle').defaultPrevented).toBe(true)
    await t.waitForState(s => s.log.length === 2)
    await tick()
    await t.settle()
    expect(toggles(add).at(-1)[2].passive).toBe(true)

    expect(fire('toggle').defaultPrevented).toBe(false)
    await t.waitForState(s => s.log.length === 3)
    await t.settle()
    expect(t.state.log.at(-1)).toBe('p')

    t.dispose()
    t = null
    await tick()
    expect(toggles(remove)).toHaveLength(toggles(add).length)
  })
})
