// 7.7.2 (Tune), renderComponent({ commandEvents: true }): on the mock DOM a delivered showModal / show / close / showPopover /
// hidePopover / togglePopover keeps the target's open state and sends `toggle` (and a dialog's
// `close`) as the browser does, so a component that listens for them is testable without a DOM.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent, wizard, Outlet } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { dialog, popover } from '../src/ui.ts'

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  vi.useRealTimers()
})

function Confirm({ state }) {
  return h('div', null,
    h('button', { className: 'ask' }, 'Ask'), h('button', { className: 'yes' }, 'Yes'), h('button', { className: 'hide' }, 'Hide'),
    state.shown ? h('dialog', { className: 'confirm' }, 'Sure?') : null,
    h('div', { className: 'menu', popover: 'auto' }, 'menu'))
}
Confirm.initialState = { shown: true, log: [] }
Confirm.intent = ({ DOM }) => ({
  ASK: DOM.click('.ask'), YES: DOM.click('.yes'), HIDE: DOM.click('.hide'),
  CLOSED: DOM.select('.confirm').events('close').map(e => ({ open: e.target.open, rv: e.target.returnValue })),
  TOGGLED: DOM.select('.confirm').events('toggle').map(e => ({ open: e.target.open, from: e.oldState, to: e.newState })),
  MENU: DOM.select('.menu').events('toggle').map(e => ({ menu: e.newState, open: e.target.matches(':popover-open') })),
})
const log = (s, x) => ({ ...s, log: [...s.log, x] })
Confirm.model = {
  ASK: { ELEMENT: { showModal: '.confirm' } },
  YES: { ELEMENT: { close: '.confirm', returnValue: 'yes' } },
  HIDE: s => ({ ...s, shown: !s.shown }),
  CLOSED: log, TOGGLED: log, MENU: log,
  POP: { ELEMENT: (_s, d) => d },
}

describe('mock DOM: the events of a delivered open / close command', () => {
  it('showModal sends toggle (open); close(returnValue) sends toggle, then close', async () => {
    t = renderComponent(Confirm, { commandEvents: true })
    await t.ready()
    await t.simulateEvent('.ask', 'click')
    await t.waitForState(s => s.log.length == 1)
    expect(t.state.log).toEqual([{ open: true, from: 'closed', to: 'open' }])
    await t.simulateEvent('.yes', 'click')
    await t.waitForState(s => s.log.length == 3)
    expect(t.state.log.slice(1)).toEqual([{ open: false, from: 'open', to: 'closed' }, { open: false, rv: 'yes' }])
    expect(t.commands('ELEMENT')).toEqual([{ showModal: '.confirm' }, { close: '.confirm', returnValue: 'yes' }])
    t.expectNoDiagnostics()
  })

  it('a command that changes nothing sends nothing: close() on a closed dialog, showModal() on an open one', async () => {
    t = renderComponent(Confirm, { commandEvents: true })
    await t.ready()
    await t.simulateEvent('.yes', 'click')
    await t.settle()
    expect(t.state.log).toEqual([])
    await t.simulateEvent('.ask', 'click')
    await t.simulateEvent('.ask', 'click')
    await t.settle()
    expect(t.state.log).toHaveLength(1)
  })

  it('an element removed while open starts closed when rendered again', async () => {
    t = renderComponent(Confirm, { commandEvents: true })
    await t.ready()
    await t.simulateEvent('.ask', 'click')
    await t.waitForState(s => s.log.length == 1)
    await t.simulateEvent('.hide', 'click')
    await t.simulateEvent('.hide', 'click')
    await t.waitForState(s => s.shown)
    await t.simulateEvent('.yes', 'click')
    await t.settle()
    expect(t.state.log).toHaveLength(1)
    await t.simulateEvent('.ask', 'click')
    await t.waitForState(s => s.log.length == 2)
    expect(t.state.log[1]).toEqual({ open: true, from: 'closed', to: 'open' })
  })

  it('popovers: showPopover / hidePopover / togglePopover (force) send toggle with :popover-open', async () => {
    t = renderComponent(Confirm, { commandEvents: true })
    await t.ready()
    for (const c of [{ showPopover: '.menu' }, { showPopover: '.menu' }, { togglePopover: '.menu' }, { togglePopover: '.menu', force: false }, { togglePopover: '.menu', force: true }, { hidePopover: '.menu' }]) {
      await t.simulateAction('POP', c)
      await t.settle()
    }
    expect(t.state.log).toEqual([{ menu: 'open', open: true }, { menu: 'closed', open: false }, { menu: 'open', open: true }, { menu: 'closed', open: false }])
  })

  it('under fake timers', async () => {
    vi.useFakeTimers()
    t = renderComponent(Confirm, { commandEvents: true })
    await t.ready()
    await t.simulateEvent('.ask', 'click')
    await t.simulateEvent('.yes', 'click')
    await t.waitForState(s => s.log.length == 3)
    expect(t.state.log[2]).toEqual({ open: false, rv: 'yes' })
  })

  it('the event goes to the sender\'s own element (two instances with the same selector)', async () => {
    function Row({ state }) { return h('div', { className: 'row' }, h('button', { className: 'ask' }, 'Ask'), h('dialog', { className: 'd' }, 'x'), h('p', { className: 'n' }, String(state.n))) }
    Row.intent = ({ DOM }) => ({ ASK: DOM.click('.ask'), OPENED: DOM.select('.d').events('toggle') })
    Row.model = { ASK: { ELEMENT: { showModal: '.d' } }, OPENED: s => ({ ...s, n: s.n + 1 }) }
    function List() { return h('div', null, h(Row, { state: 'a' }), h(Row, { state: 'b' })) }
    List.initialState = { a: { n: 0 }, b: { n: 0 } }
    t = renderComponent(List, { commandEvents: true })
    await t.ready()
    await t.simulateEvent('.ask', 'click', { within: '.row:nth-child(2)' })
    await t.waitForState(s => s.b.n == 1)
    await t.settle()
    expect(t.state).toEqual({ a: { n: 0 }, b: { n: 1 } })
  })
})

describe('mock DOM: without the option', () => {
  it('the commands are only recorded: no event', async () => {
    t = renderComponent(Confirm)
    await t.ready()
    await t.simulateEvent('.ask', 'click')
    await t.simulateEvent('.yes', 'click')
    await t.settle()
    expect(t.commands('ELEMENT')).toHaveLength(2)
    expect(t.state.log).toEqual([])
  })
})

describe('mock DOM: sygnal/ui parts follow the commands', () => {
  it('dialog(): opened by the host\'s own ELEMENT command, the slice learns it (TOGGLED); its close is CLOSED', async () => {
    function Host({ state }) { return h('div', null, h('button', { className: 'go' }, 'Go'), h('button', { className: 'done' }, 'Done'), h('dialog', { className: 'd', 'aria-label': 'D' }, 'x'), h('p', null, String(state.d.open))) }
    Host.uses = { d: dialog({ dialog: '.d' }) }
    Host.intent = ({ DOM }) => ({ GO: DOM.click('.go'), DONE: DOM.click('.done') })
    Host.model = { GO: { ELEMENT: { showModal: '.d' } }, DONE: { ELEMENT: { close: '.d', returnValue: 'ok' } } }
    t = renderComponent(Host, { commandEvents: true })
    await t.ready()
    await t.simulateEvent('.go', 'click')
    await t.waitForState(s => s.d.open)
    await t.simulateEvent('.done', 'click')
    await t.waitForState(s => !s.d.open)
    expect(t.state.d.returnValue).toBe('ok')
    t.expectNoDiagnostics()
  })

  it('popover(): the trigger opens it, and the state stays in step', async () => {
    function Host({ state }) { return h('div', null, h('button', { className: 'b' }, 'Menu'), h('div', { className: 'p', popover: 'auto' }, 'x'), h('p', null, String(state.p.open))) }
    Host.uses = { p: popover({ popover: '.p', trigger: '.b' }) }
    t = renderComponent(Host, { commandEvents: true })
    await t.ready()
    await t.simulateEvent('.b', 'click')
    await t.waitForState(s => s.p.open)
    await t.simulateEvent('.b', 'click')
    await t.waitForState(s => !s.p.open)
    await t.settle()
    expect(t.state.p.open).toBe(false)
    t.expectNoDiagnostics()
  })

  // Tune's report, as a mock DOM test (it passed on 7.7.0, where no toggle came)
  it('a wizard step left with its dialog open (opened by ELEMENT) comes back closed', async () => {
    function One({ state }) { return h('div', { className: 'one' }, h('button', { className: 'go' }, 'Go'), h('dialog', { className: 'd', 'aria-label': 'D' }, 'x'), h('p', null, String(state.d.open))) }
    One.uses = { d: dialog({ dialog: '.d' }) }
    One.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    One.model = { GO: { ELEMENT: { showModal: '.d' } } }
    function Two() { return h('p', { className: 'two' }, 'Two') }
    function Flow() { return h('section', null, h(Outlet, { of: { one: One, two: Two }, from: 'wizard' }), h('button', { className: 'back' }, 'Back'), h('button', { className: 'next' }, 'Next')) }
    Flow.uses = { wizard: wizard({ steps: { one: {}, two: {} }, draft: {}, next: '.next', back: '.back' }) }
    t = renderComponent(Flow, { commandEvents: true })
    await t.ready()
    await t.simulateEvent('.go', 'click')
    await t.waitForState(s => s.wizard.local.one?.d.open)
    await t.simulateEvent('.next', 'click')
    await t.waitForState(s => s.wizard.step == 'two')
    expect(t.state.wizard.local.one.d.open).toBe(false)
    await t.simulateEvent('.back', 'click')
    await t.waitForState(s => s.wizard.step == 'one')
    await t.settle()
    expect(t.commands('ELEMENT').filter(c => c.showModal)).toHaveLength(1)
  })
})
