// @vitest-environment jsdom
// ui-sweep R1 / R5 (dev-plans/research/ui-sweep/native.md, Round 2): the dev entry's SYG118 (a host
// intent action that replaces a behavior trigger built from an option the host passed) and SYG116
// for `EVENTS: (…) => event(…)` (the function form around event(), which sends nothing).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { event } from '../src/index.js'
import { tabs, tabsAttrs, dialog, popover } from '../src/ui.ts'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { CODE_TITLES, DEV_CODE_SEVERITY } from '../src/extra/diagnostics/codes.js'

let t
beforeEach(() => { setupChecks() })
afterEach(() => { try { t?.dispose() } catch (_) {} ; t = null })

const settings = (intent) => {
  function S({ state, uid }) {
    const a = tabsAttrs(state.tabs, uid)
    return h('div', null, h('button', { className: 'go' }, 'go'), h('div', a.list, h('button', { className: 'tab', ...a.tab('a') }, 'a')))
  }
  S.uses = { tabs: tabs({ tab: '.tab' }) }
  if (intent) S.intent = intent
  return S
}

describe('SYG118 (dev)', () => {
  it('is registered as a dev-entry warning with a title', () => {
    expect(DEV_CODE_SEVERITY.SYG118).toBe('warn')
    expect(CODE_TITLES.SYG118).toMatch(/replaces a behavior trigger/)
  })

  it('a host intent action replacing the trigger built from the tab option', async () => {
    t = renderComponent(settings(({ DOM }) => ({ 'tabs.SELECT': DOM.click('.go').mapTo('a') })))
    await t.ready()
    const d = diagnostics('SYG118')
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain("'tabs.SELECT'")
    expect(d[0].message).toContain("'tab'")
  })

  it('not for a host intent of an action whose option the host left out (popover OPEN; a dialog without trigger)', async () => {
    function P() { return h('div', null, h('button', { className: 'go' }), h('div', { className: 'p', attrs: { popover: 'auto' } }), h('dialog', { className: 'd' })) }
    P.uses = { p: popover({ popover: '.p' }), d: dialog({ dialog: '.d' }) }
    P.intent = ({ DOM }) => ({ 'p.OPEN': DOM.click('.go'), 'd.OPEN': DOM.click('.go') })
    t = renderComponent(P)
    await t.ready()
    expect(diagnostics('SYG118')).toHaveLength(0)
  })

  it('not without a host intent of that name, nor for simulateAction', async () => {
    t = renderComponent(settings())
    await t.ready()
    t.simulateAction('tabs.SELECT', 'a')
    await t.settle()
    expect(diagnostics('SYG118')).toHaveLength(0)
  })
})

describe('SYG116 (dev) for the function form around event() (R5)', () => {
  it('EVENTS: (s) => event(...) is reported, and sends nothing', async () => {
    function C() { return h('button', { className: 'save' }, 'Save') }
    C.initialState = {}
    C.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
    C.model = { SAVE: { EVENTS: (s) => event('SAVED', { at: 1 }) } }
    t = renderComponent(C)
    await t.ready()
    t.simulateEvent('.save', 'click')
    await t.settle()
    expect(diagnostics('SYG116')).toHaveLength(1)
  })
})
