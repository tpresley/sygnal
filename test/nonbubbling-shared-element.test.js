// @vitest-environment jsdom
// A non-bubbling event (submit, reset, toggle, ...) is listened for on the element itself, once per
// element and type. That one listener was bound to the destination of whichever stream found the
// element first, so (1) when snabbdom reused the element for another selector (a form rendered
// before an existing one takes over its element), the new selector never heard the event and its
// preventDefault never ran (a page reload on Enter, found in examples/ai-adaptive), and (2) of two
// selectors matching one element only the first stream fired. Every destination set up on the
// element now receives the event, still through one DOM listener.
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

const submit = (sel) => {
  const e = new Event('submit', { cancelable: true })
  t.query(sel).dispatchEvent(e)
  return e
}

const log = (name) => (s) => ({ ...s, log: [...s.log, name] })

describe('non-bubbling events on a shared element', () => {
  it('a reused element delivers to the selector it now matches (and its preventDefault runs)', async () => {
    function Forms({ state }) {
      return h('div', null,
        state.show && h('form', { className: 'late' }, h('input', { name: 'a' })),
        h('form', { className: 'first' }, h('input', { name: 'b' })),
        h('button', { className: 'show' }, 'show'))
    }
    Forms.initialState = { show: false, log: [] }
    Forms.intent = ({ DOM }) => ({
      SHOW: DOM.click('.show'),
      FIRST: DOM.submit('.first', { preventDefault: true }),
      LATE: DOM.submit('.late', { preventDefault: true }),
    })
    Forms.model = { SHOW: (s) => ({ ...s, show: true }), FIRST: log('first'), LATE: log('late') }

    t = renderComponent(Forms, { dom: 'real' })
    await t.ready()
    const firstEl = t.query('.first')
    t.query('.show').click()
    await t.waitForState(s => s.show)
    await t.settle()
    // snabbdom patched the old .first element into .late and made a new .first after it
    expect(t.query('.late')).toBe(firstEl)

    const late = submit('.late')
    expect(late.defaultPrevented).toBe(true)
    await t.waitForState(s => s.log.includes('late'))
    const first = submit('.first')
    expect(first.defaultPrevented).toBe(true)
    await t.waitForState(s => s.log.includes('first'))
    await t.settle()
    expect(t.state.log).toEqual(['late', 'first'])
  })

  it('two selectors on one element both fire, through one DOM listener', async () => {
    const add = vi.spyOn(HTMLFormElement.prototype, 'addEventListener')
    function Both({ state }) {
      return h('div', null, h('form', { className: 'f a' }, h('input', { name: 'x' })), h('p', null, state.log.join(',')))
    }
    Both.initialState = { log: [] }
    Both.intent = ({ DOM }) => ({
      A: DOM.submit('.a', { preventDefault: true }),
      F: DOM.submit('.f'),
    })
    Both.model = { A: log('a'), F: log('f') }

    t = renderComponent(Both, { dom: 'real' })
    await t.ready()
    await t.settle()
    expect(add.mock.calls.filter(c => c[0] === 'submit')).toHaveLength(1)

    expect(submit('form').defaultPrevented).toBe(true)
    await t.waitForState(s => s.log.length === 2)
    await t.settle()
    expect([...t.state.log].sort()).toEqual(['a', 'f'])
  })

  it('a non-passive destination replaces a passive element listener', async () => {
    const add = vi.spyOn(HTMLDivElement.prototype, 'addEventListener')
    function Pane({ state }) {
      return h('div', { className: 'pane p' }, state.log.join(','))
    }
    Pane.initialState = { log: [] }
    Pane.intent = ({ DOM }) => ({
      PASSIVE: DOM.select('.pane').events('toggle', { passive: true }),
      ACTIVE: DOM.select('.p').events('toggle', { preventDefault: true }),
    })
    Pane.model = { PASSIVE: log('passive'), ACTIVE: log('active') }

    t = renderComponent(Pane, { dom: 'real' })
    await t.ready()
    await t.settle()
    const toggles = add.mock.calls.filter(c => c[0] === 'toggle')
    expect(toggles.at(-1)[2].passive).toBe(false)

    const e = new Event('toggle', { cancelable: true })
    t.query('.pane').dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    await t.waitForState(s => s.log.length === 2)
    await t.settle()
    expect([...t.state.log].sort()).toEqual(['active', 'passive'])
  })

  it('the element listener goes when the last stream on it stops', async () => {
    const remove = vi.spyOn(HTMLFormElement.prototype, 'removeEventListener')
    function Toggle({ state }) {
      return h('div', null, state.on ? h(Child) : null, h('button', { className: 'off' }, 'off'))
    }
    function Child() { return h('form', { className: 'f a' }, 'x') }
    Child.intent = ({ DOM }) => ({ A: DOM.submit('.a'), F: DOM.submit('.f') })
    Child.model = { A: (s) => s, F: (s) => s }
    Toggle.initialState = { on: true }
    Toggle.intent = ({ DOM }) => ({ OFF: DOM.click('.off') })
    Toggle.model = { OFF: (s) => ({ ...s, on: false }) }

    t = renderComponent(Toggle, { dom: 'real' })
    await t.ready()
    await t.settle()
    t.query('.off').click()
    await t.waitForState(s => !s.on)
    await t.settle()
    expect(remove.mock.calls.filter(c => c[0] === 'submit')).toHaveLength(1)
  })
})
