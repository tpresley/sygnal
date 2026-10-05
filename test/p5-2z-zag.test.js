// @vitest-environment jsdom
// PLAN-5 2-Z (W-2, D203): fromZag, a Zag machine as a widget tag (sygnal/zag). Generalises E3:
// a Zag menu machine rendered with Sygnal's createElement through a private snabbdom patch,
// the newest props always (E3's stale-props bug), machine callbacks as dispatched DOM events,
// commands, controlled props, unmount, SSR fallback, the mock DOM (t.widget) and SYG667.
import { describe, it, expect, afterEach } from 'vitest'
import * as menu from '@zag-js/menu'
import * as dialog from '@zag-js/dialog'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.ts'
import { fromZag, zagProps } from '../src/zag.ts'

// jsdom has no ResizeObserver; Zag's positioning (floating-ui autoUpdate) needs one
globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} }

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let app, t
afterEach(() => {
  app?.dispose(); app = null
  try { t?.dispose() } catch (_) {}
  t = null
  document.body.innerHTML = ''
})
const mount = (App) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'off' })
  return app
}
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
const pointer = (el, type) => el.dispatchEvent(new (window.PointerEvent || MouseEvent)(type, { bubbles: true, button: 0, pointerType: 'mouse' }))

const renders = []
const Actions = fromZag(menu, (api, props) => {
  renders.push(props.items.length)
  return h('div', { className: 'menu-root' },
    h('button', { className: 'trigger', ...api.getTriggerProps() }, props.label),
    h('div', api.getPositionerProps(),
      h('div', { className: 'content', ...api.getContentProps() },
        props.items.map((i) => h('div', { className: 'item', ...api.getItemProps({ value: i }) }, i)))))
}, {
  name: 'Actions',
  events: { select: ['onSelect', (d) => d.value], 'open-change': ['onOpenChange', (d) => d.open] },
  commands: { open: (api) => api.setOpen(true), close: (api) => api.setOpen(false) },
  fallback: (p, hh) => hh('button', { className: 'trigger' }, p.label),
})

function App({ state }) {
  return h('div', null,
    h(Actions, { className: 'actions', label: state.label, items: state.items, open: state.open }),
    h('button', { className: 'ext' }, 'open from the app'),
    h('button', { className: 'more' }, 'more items'),
    h('p', { className: 'log' }, state.log.join(',')))
}
App.initialState = { label: 'Actions', items: ['edit', 'copy'], open: undefined, log: [] }
App.intent = ({ DOM }) => ({
  PICK: DOM.select('.actions').events('select').detail(),
  OPEN: DOM.select('.actions').events('open-change').detail(),
  EXT: DOM.click('.ext'),
  MORE: DOM.click('.more'),
})
App.model = {
  PICK: (s, v) => ({ ...s, log: [...s.log, 'pick:' + v] }),
  OPEN: (s, open) => ({ ...s, log: [...s.log, open ? 'opened' : 'closed'] }),
  EXT: { ELEMENT: { open: '.actions' } },
  MORE: (s) => ({ ...s, items: [...s.items, 'delete'], label: 'More actions' }),
}

describe('zagProps', () => {
  it('normalises a Zag prop bag into snabbdom data', () => {
    const click = () => {}, change = () => {}, focus = () => {}
    const d = zagProps({
      id: 'x', role: 'menu', tabIndex: -1, htmlFor: 'y', hidden: false, 'aria-expanded': false, 'aria-hidden': true,
      'data-state': 'open', onClick: click, onChange: change, onFocus: focus, onPointerDown: click,
      style: { minWidth: '10px', '--x': '4px' }, defaultValue: 'abc', spellCheck: false, ignored: undefined,
    })
    expect(d.attrs).toEqual({ id: 'x', role: 'menu', tabindex: -1, for: 'y', hidden: false, 'aria-expanded': 'false', 'aria-hidden': 'true', 'data-state': 'open', spellcheck: 'false' })
    expect(d.on).toEqual({ click, input: change, focusin: focus, pointerdown: click })
    expect(d.props).toEqual({ value: 'abc' })
    expect(d.style).toEqual({ minWidth: '10px', '--x': '4px' })
  })
})

describe('fromZag: a Zag menu machine on a widget host (real DOM)', () => {
  it('renders the machine parts into the host, with Zag ARIA', async () => {
    mount(App)
    await settle()
    const host = document.querySelector('.actions')
    const trigger = host.querySelector('.trigger')
    expect(trigger.textContent).toBe('Actions')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    const content = host.querySelector('.content')
    expect(content.getAttribute('role')).toBe('menu')
    expect(content.hidden).toBe(true)
    expect([...host.querySelectorAll('.item')].map((e) => e.getAttribute('role'))).toEqual(['menuitem', 'menuitem'])
    expect(host.__sw.i.api().open).toBe(false)
  })

  it('a click opens it; machine callbacks reach the intent as dispatched events; selection closes it', async () => {
    mount(App)
    await settle()
    const trigger = document.querySelector('.actions .trigger')
    pointer(trigger, 'pointerdown')
    trigger.click()
    await settle()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.actions .content').hidden).toBe(false)
    expect(document.querySelector('.log').textContent).toBe('opened')
    document.querySelectorAll('.actions .item')[1].click()
    await settle()
    expect(document.querySelector('.log').textContent).toBe('opened,pick:copy,closed')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('keyboard: ArrowDown on the trigger opens and highlights; Enter selects', async () => {
    mount(App)
    await settle()
    const trigger = document.querySelector('.actions .trigger')
    trigger.focus()
    key(trigger, 'ArrowDown')
    await settle()
    const content = document.querySelector('.actions .content')
    expect(content.hidden).toBe(false)
    const items = document.querySelectorAll('.actions .item')
    expect(items[0].hasAttribute('data-highlighted')).toBe(true)
    key(content, 'ArrowDown')
    await settle()
    expect(items[1].hasAttribute('data-highlighted')).toBe(true)
    key(content, 'Enter')
    await settle()
    expect(document.querySelector('.log').textContent).toContain('pick:copy')
  })

  it('newest props always: a render with other props re-renders the parts, and the machine sees them', async () => {
    mount(App)
    await settle()
    document.querySelector('.more').click()
    await settle()
    const host = document.querySelector('.actions')
    expect(host.querySelector('.trigger').textContent).toBe('More actions')
    expect([...host.querySelectorAll('.item')].map((e) => e.textContent)).toEqual(['edit', 'copy', 'delete'])
    // the new item is selectable (its value reaches the callback, not the mount-time items)
    host.querySelector('.trigger').click()
    await settle()
    host.querySelectorAll('.item')[2].click()
    await settle()
    expect(document.querySelector('.log').textContent).toContain('pick:delete')
  })

  it('a controlled prop (open) from state drives the machine', async () => {
    function C({ state }) {
      return h('div', null, h(Actions, { className: 'actions', label: 'A', items: ['x'], open: state.open }), h('button', { className: 't' }, 't'))
    }
    C.initialState = { open: false }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t'), CH: DOM.select('.actions').events('open-change').detail() })
    C.model = { T: (s) => ({ ...s, open: !s.open }), CH: (s, open) => ({ ...s, open }) }
    mount(C)
    await settle()
    const content = () => document.querySelector('.actions .content')
    expect(content().hidden).toBe(true)
    document.querySelector('.t').click()
    await settle()
    expect(content().hidden).toBe(false)
    document.querySelector('.t').click()
    await settle()
    expect(content().hidden).toBe(true)
  })

  it('commands: ELEMENT { open } runs the widget command with the api', async () => {
    mount(App)
    await settle()
    document.querySelector('.ext').click()
    await settle()
    expect(document.querySelector('.actions .content').hidden).toBe(false)
    expect(document.querySelector('.log').textContent).toBe('opened')
  })

  it('unmount stops the machine and removes its content; no later renders', async () => {
    function C({ state }) {
      return h('div', null, state.show ? h(Actions, { className: 'actions', label: 'A', items: ['x'] }) : null, h('button', { className: 't' }, 't'))
    }
    C.initialState = { show: true }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => ({ ...s, show: !s.show }) }
    mount(C)
    await settle()
    const x = document.querySelector('.actions').__sw.i
    document.querySelector('.t').click()
    await settle()
    expect(document.querySelector('.actions')).toBe(null)
    expect(x.machine.status).toBe('Stopped')
    const n = renders.length
    x.refresh()
    await settle()
    expect(renders.length).toBe(n)
  })

  it('a Zag dialog (E3) works through the same adapter', async () => {
    const Dlg = fromZag(dialog, (api) => h('div', null,
      h('button', { className: 'trigger', ...api.getTriggerProps() }, 'Open'),
      h('div', api.getPositionerProps(),
        h('div', { className: 'content', ...api.getContentProps() },
          h('h2', api.getTitleProps(), 'Title'),
          h('button', { className: 'close', ...api.getCloseTriggerProps() }, 'x')))), {
      events: { 'open-change': ['onOpenChange', (d) => d.open] },
    })
    function C({ state }) { return h('div', null, h(Dlg, { className: 'dlg', open: state.open }), h('p', { className: 'o' }, String(state.open))) }
    C.initialState = { open: false }
    C.intent = ({ DOM }) => ({ CH: DOM.select('.dlg').events('open-change').detail() })
    C.model = { CH: (s, open) => ({ ...s, open }) }
    mount(C)
    await settle()
    const content = () => document.querySelector('.dlg .content')
    expect(content().getAttribute('role')).toBe('dialog')
    expect(content().hidden).toBe(true)
    document.querySelector('.dlg .trigger').click()
    await settle()
    expect(document.querySelector('.o').textContent).toBe('true')
    expect(content().hidden).toBe(false)
    expect(content().getAttribute('aria-labelledby')).toBe(document.querySelector('.dlg h2').id)
    key(content(), 'Escape')
    await settle()
    expect(document.querySelector('.o').textContent).toBe('false')
  })
})

describe('fromZag: tests, SSR, errors', () => {
  it('the mock DOM renders the host; t.widget().dispatch reaches the intent', async () => {
    t = renderComponent(App)
    await t.ready()
    expect(t.widget('.actions').props.label).toBe('Actions')
    t.widget('.actions').dispatch('select', 'edit')
    await t.next((s) => s.log.length === 1)
    expect(t.state.log).toEqual(['pick:edit'])
  })

  it('dom: real mounts it; t.widget().instance is the adapter instance', async () => {
    t = renderComponent(App, { dom: 'real' })
    await t.ready()
    await settle()
    const x = t.widget('.actions').instance
    expect(typeof x.api).toBe('function')
    expect(x.api().open).toBe(false)
    expect(t.query('.actions .trigger').getAttribute('aria-haspopup')).toBe('menu')
  })

  it('renderToString renders the host with the fallback', async () => {
    const html = await renderToString(App)
    expect(html).toContain('class="actions"')
    expect(html).toContain('<button class="trigger">Actions</button>')
  })

  it('SYG667: not a Zag machine package, or no render', () => {
    expect(() => fromZag({}, () => null)).toThrow(/SYG667.*not a Zag machine package/)
    expect(() => fromZag(menu)).toThrow(/SYG667.*render must be a function/)
  })
})
