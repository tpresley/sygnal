// @vitest-environment jsdom
// PLAN-4 1-F item 1: events that don't bubble (HTML spec) reach intent. The DOM driver listens
// for bubbling events once on the root, so a non-bubbling event (a dialog's `close`/`cancel`, a
// popover's `beforetoggle`, a media/img `error`) never got there, even with { useCapture: true }.
// Such events are listed in eventTypesThatDontBubble and listened for on the element itself.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { controls } from '../src/extra/controls.js'
import { Collection } from '../src/collection.js'
import { eventTypesThatDontBubble } from '../src/cycle/dom/EventDelegator.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
})

const { HelpDialog } = controls({ HelpDialog: 'dialog' })

function Help({ state }) {
  return h('div', { className: 'wrap' },
    h(HelpDialog, null, h('p', null, 'Help')),
    h('dialog', { className: 'plain' }, 'Plain'),
    h('div', { className: 'pop', popover: 'auto' }, 'Pop'),
    h('img', { className: 'pic', src: 'missing.png', alt: 'x' }),
    h('p', { className: 'log' }, state.log.join(',')))
}
Help.initialState = { log: [] }
Help.intent = ({ DOM }) => ({
  CLOSED: DOM.close(HelpDialog),
  CANCELLED: DOM.select(HelpDialog).events('cancel'),
  PLAIN_CLOSED: DOM.select('dialog.plain').events('close', { useCapture: true }),
  BEFORE_TOGGLE: DOM.select('.pop').events('beforetoggle'),
  TOGGLE: DOM.select('.pop').events('toggle'),
  IMG_ERROR: DOM.select('.pic').events('error'),
  WRAP_CLOSE: DOM.select('.wrap').events('close'),
})
const log = (name) => (s, e) => ({ ...s, log: [...s.log, `${name}:${e && e.bubbles === false ? 'nb' : 'b'}`] })
Help.model = {
  CLOSED: log('closed'),
  CANCELLED: log('cancelled'),
  PLAIN_CLOSED: log('plain'),
  BEFORE_TOGGLE: log('beforetoggle'),
  TOGGLE: log('toggle'),
  IMG_ERROR: log('error'),
  WRAP_CLOSE: log('wrap'),
}

const dispatch = (sel, type) => t.query(sel).dispatchEvent(new Event(type))

describe('eventTypesThatDontBubble', () => {
  it('lists the dialog, popover and media events the HTML spec fires without bubbling', () => {
    for (const type of ['close', 'cancel', 'toggle', 'beforetoggle', 'error', 'abort', 'loadstart', 'progress', 'load', 'invalid', 'scrollend']) {
      expect(eventTypesThatDontBubble, type).toContain(type)
    }
  })
})

describe('real DOM: a non-bubbling event dispatched on the element reaches intent', () => {
  it('dialog close through a control shorthand (DOM.close(Control))', async () => {
    t = renderComponent(Help, { dom: 'real' })
    await t.ready()
    dispatch(HelpDialog, 'close')
    await t.waitForState(s => s.log.includes('closed:nb'))
    expect(t.state.log).toEqual(['closed:nb'])
  })

  it('dialog cancel, and close with { useCapture: true }', async () => {
    t = renderComponent(Help, { dom: 'real' })
    await t.ready()
    dispatch(HelpDialog, 'cancel')
    await t.waitForState(s => s.log.includes('cancelled:nb'))
    dispatch('dialog.plain', 'close')
    await t.waitForState(s => s.log.includes('plain:nb'))
    expect(t.state.log).toEqual(['cancelled:nb', 'plain:nb'])
  })

  it('popover beforetoggle and toggle; img error', async () => {
    t = renderComponent(Help, { dom: 'real' })
    await t.ready()
    dispatch('.pop', 'beforetoggle')
    await t.waitForState(s => s.log.includes('beforetoggle:nb'))
    dispatch('.pop', 'toggle')
    await t.waitForState(s => s.log.includes('toggle:nb'))
    dispatch('.pic', 'error')
    await t.waitForState(s => s.log.includes('error:nb'))
    expect(t.state.log).toEqual(['beforetoggle:nb', 'toggle:nb', 'error:nb'])
  })

  it('an ancestor does not see a descendant dialog\'s close (it does not bubble)', async () => {
    t = renderComponent(Help, { dom: 'real' })
    await t.ready()
    dispatch(HelpDialog, 'close')
    await t.waitForState(s => s.log.includes('closed:nb'))
    await t.settle()
    expect(t.state.log).not.toContain('wrap:nb')
    expect(t.state.log).not.toContain('wrap:b')
  })

  it('simulateEvent fires close and cancel without bubbling, like the browser', async () => {
    t = renderComponent(Help, { dom: 'real' })
    await t.ready()
    t.simulateEvent(HelpDialog, 'close')
    await t.waitForState(s => s.log.includes('closed:nb'))
    t.simulateEvent(HelpDialog, 'cancel')
    await t.waitForState(s => s.log.includes('cancelled:nb'))
    await t.settle()
    expect(t.state.log).toEqual(['closed:nb', 'cancelled:nb'])
  })

  it('reaches the right instance in a Collection item rendered after start', async () => {
    const { Box } = controls({ Box: 'dialog' })
    function Row({ state }) { return h('li', { 'data-id': String(state.id) }, h(Box, null, state.closed ? 'closed' : 'open')) }
    Row.intent = ({ DOM }) => ({ CLOSE: DOM.close(Box) })
    Row.model = { CLOSE: (s) => ({ ...s, closed: true }) }
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    t = renderComponent(List, { dom: 'real', initialState: { rows: [{ id: 1, closed: false }] } })
    await t.ready()
    await t.settle()
    t.query('[data-id="1"] dialog').dispatchEvent(new Event('close'))
    await t.waitForState(s => s.rows[0].closed)
    expect(t.state.rows).toEqual([{ id: 1, closed: true }])
  })
})

describe('mock DOM: simulateEvent delivers dialog/popover events', () => {
  it('close, cancel, beforetoggle and error', async () => {
    t = renderComponent(Help)
    await t.ready()
    t.simulateEvent(HelpDialog, 'close')
    await t.waitForState(s => s.log.length === 1)
    t.simulateEvent(HelpDialog, 'cancel')
    await t.waitForState(s => s.log.length === 2)
    t.simulateEvent('.pop', 'beforetoggle')
    await t.waitForState(s => s.log.length === 3)
    t.simulateEvent('.pic', 'error')
    await t.waitForState(s => s.log.length === 4)
    expect(t.state.log.map(x => x.split(':')[0])).toEqual(['closed', 'cancelled', 'beforetoggle', 'error'])
  })
})
