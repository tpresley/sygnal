// @vitest-environment jsdom
// PLAN-4 CT-1: the runtime control diagnostics in the 'sygnal/diagnostics' dev entry:
// SYG124 (a component where a control or selector is expected), SYG125 (a control given
// component statics, or a spec whose vnode() isn't one element vnode), SYG104 by identifier,
// and inspect() listing the controls a component renders.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setupChecks, diagnostics, settle } from './helpers.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { Collection } from '../../src/collection.js'
import { controls } from '../../src/extra/controls.js'
import { inspect } from '../../src/extra/diagnostics/checks/index.js'
import { validate } from '../../sygnal-check/src/schema.js'
import { until } from '../support/wait.js'

const schema = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../sygnal-check/schema/inspect.schema.json'), 'utf8'))

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null; vi.restoreAllMocks() })

function TodoItem({ state }) { return h('li', null, String(state.text)) }

describe('SYG124: a component where a control or selector is expected', () => {
  for (const [label, intent] of [
    ['DOM.click(Component)', ({ DOM }) => ({ HIT: DOM.click(TodoItem) })],
    ['DOM.select(Component)', ({ DOM }) => ({ HIT: DOM.select(TodoItem).events('click') })],
    ["DOM.select('.x').select(Component)", ({ DOM }) => ({ HIT: DOM.select('.list').select(TodoItem).events('click') })],
  ]) {
    for (const dom of ['mock', 'real']) {
      it(`${label} reports SYG124 naming both fixes (${dom} DOM)`, async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        function List() { return h('ul', { className: 'list' }, h(TodoItem, { state: 'item' })) }
        List.initialState = { item: { text: 'a' } }
        List.intent = intent
        List.model = { HIT: (s) => s }
        try { t = renderComponent(List, dom === 'real' ? { dom: 'real' } : {}); await t.ready() } catch (_) { /* the select() itself still throws */ }
        await until(() => expect(diagnostics('SYG124')).toHaveLength(1))
        const [d] = diagnostics('SYG124')
        expect(d.severity).toBe('error')
        expect(d.component).toBe('List')
        expect(d.message).toContain('TodoItem')
        expect(d.fix).toContain('CHILD.select(TodoItem)')
        expect(d.fix).toContain('PARENT')
        expect(d.fix).toMatch(/controls\(/)
      })
    }
  }

  it('a control or a selector string is not SYG124', async () => {
    const { Go } = controls({ Go: 'button' })
    function C() { return h('div', null, h(Go, null, 'go'), h('b', { className: 'x' })) }
    C.initialState = {}
    C.intent = ({ DOM }) => ({ A: DOM.click(Go), B: DOM.click('.x'), C: DOM.select(Go).events('click') })
    C.model = { A: s => s, B: s => s, C: s => s }
    t = renderComponent(C)
    await t.ready()
    await settle(30)
    expect(diagnostics('SYG124')).toHaveLength(0)
  })
})

describe('SYG125: controls are elements, not components', () => {
  it('a control given .intent / .model / .initialState reports SYG125 once, naming the control', async () => {
    const { Save } = controls({ Save: 'button' })
    Save.intent = () => ({})
    Save.initialState = { x: 1 }
    function Form() { return h('form', null, h(Save, null, 'save')) }
    Form.initialState = { n: 0 }
    t = renderComponent(Form)
    await t.ready()
    await until(() => expect(diagnostics('SYG125')).toHaveLength(1))
    const [d] = diagnostics('SYG125')
    expect(d.severity).toBe('error')
    expect(d.message).toContain('Save')
    expect(d.message).toContain('.intent')
    expect(d.message).toContain('.initialState')
    expect(d.message).toMatch(/elements, not components/)
    // still renders its element
    expect(t.html()).toContain('data-control="Save"')
  })

  for (const [label, vnode] of [
    ['a string', () => 'text'],
    ['nothing', () => undefined],
    ['an array', (p, c, hh) => [hh('i'), hh('b')]],
    ['a component vnode', (p, c, hh) => hh(TodoItem, { state: 'x' })],
    ['a text vnode', (p, c, hh) => ({ sel: undefined, text: 'x', data: undefined, children: undefined, elm: undefined, key: undefined })],
  ]) {
    it(`a spec whose vnode() returns ${label} reports SYG125 naming the control key`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { Bad } = controls({ Bad: { kind: 'test', vnode } })
      let caught
      function Host() { return h('div', null, h(Bad, null)) }
      Host.initialState = {}
      Host.onError = (e) => { caught = e; return h('p', null, 'failed') }
      t = renderComponent(Host)
      await settle(40)
      const found = diagnostics('SYG125')
      expect(found.length).toBeGreaterThanOrEqual(1)
      expect(found[0].message).toContain('Bad')
      expect(found[0].message).toContain('vnode()')
      expect(caught?.message).toContain('SYG125')
    })
  }

  it('a plain control without statics is not SYG125', async () => {
    const { Ok } = controls({ Ok: 'button' })
    function C() { return h('div', null, h(Ok, null, 'ok')) }
    C.initialState = {}
    t = renderComponent(C)
    await t.ready()
    await settle(30)
    expect(diagnostics('SYG125')).toHaveLength(0)
  })
})

// ─── SYG104 by identifier ───────────────────────────────────────────────────

const { Remove } = controls({ Remove: 'button' })
function Item({ state }) { return h('li', null, String(state.text), h(Remove, null, 'x')) }
Item.intent = ({ DOM }) => ({ REMOVE: DOM.click(Remove) })
Item.model = { REMOVE: () => undefined }
function List({ state }) { return h('ul', null, h(Collection, { of: Item, from: 'items' }), h('i', null, String(state.leaks))) }
List.initialState = { items: [{ id: 1, text: 'a' }], leaks: 0 }
List.intent = ({ DOM }) => ({ LEAK: DOM.click(Remove) })   // Remove is rendered by Item only
List.model = { LEAK: (s) => ({ ...s, leaks: s.leaks + 1 }) }

describe('SYG104 by identifier', () => {
  for (const dom of ['mock', 'real']) {
    it(`a parent listening to a child's control never fires and gets SYG104 naming the control (${dom} DOM)`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      t = renderComponent(List, dom === 'real' ? { dom: 'real' } : {})
      await t.ready()
      await settle(80)   // the real-DOM check sweeps after the render settles
      t.simulateEvent(Remove, 'click')
      await t.next(s => s.items.length === 0)
      await until(() => expect(diagnostics('SYG104').length).toBeGreaterThanOrEqual(1))
      expect(t.state.leaks).toBe(0)
      const d = diagnostics('SYG104').find(x => x.component === 'List')
      expect(d).toBeTruthy()
      expect(d.data.selector).toBe('[data-control="Remove"]')
      expect(d.data.control).toBe('Remove')
      expect(d.message).toContain('control Remove')
      expect(d.message).toContain('Item')
    })
  }
})

// ─── inspect() lists controls ───────────────────────────────────────────────

const { Draft, Add, Unused } = controls({ Draft: 'input', Add: 'button', Unused: 'span' })
const { Rating } = controls({ Rating: { kind: 'widget', vnode: (p, c, hh) => hh('wa-rating', p) } })
function Form({ state }) {
  return h('div', null,
    h(Draft, { value: state.draft }), h(Add, null, 'add'), h(Unused, null, '?'), h(Rating, null),
    h('ul', null, h(Collection, { of: Item, from: 'items' })))
}
Form.initialState = { draft: '', items: [{ id: 1, text: 'a' }] }
Form.intent = ({ DOM }) => ({ DRAFT: DOM.input(Draft).value(), ADD: DOM.click(Add), RATE: DOM.select('.x').events('click') })
Form.model = { DRAFT: (s, draft) => ({ ...s, draft }), ADD: (s) => s, RATE: (s) => s }

describe('inspect() lists controls (G-202)', () => {
  for (const dom of ['mock', 'real']) {
    it(`t.inspect() lists each component's controls and marks control selectors (${dom} DOM)`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      t = renderComponent(Form, dom === 'real' ? { dom: 'real' } : {})
      await t.ready()
      await settle(80)
      const g = t.inspect()
      expect(validate(schema, g)).toEqual([])
      const form = g.components.find(c => c.name === 'Form')
      expect(form.controls).toEqual([
        { name: 'Draft', element: 'input', listened: true },
        { name: 'Add', element: 'button', listened: true },
        { name: 'Unused', element: 'span', listened: false },
        { name: 'Rating', element: null, kind: 'widget', listened: false },
      ])
      const sel = form.selectors.find(s => s.selector === '[data-control="Add"]')
      expect(sel.control).toBe('Add')
      expect(form.selectors.find(s => s.selector === '.x').control).toBeUndefined()
      const item = g.components.find(c => c.name === 'Item')
      expect(item.controls).toEqual([{ name: 'Remove', element: 'button', listened: true }])
    })
  }

  it('inspect() (no renderComponent) also lists controls, and omits the field when there are none', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    t = renderComponent(Form, { dom: 'real' })
    await t.ready()
    await settle(80)
    const g = inspect()
    expect(validate(schema, g)).toEqual([])
    const form = g.components.find(c => c.name === 'Form')
    expect(form.controls.map(c => c.name)).toEqual(['Draft', 'Add', 'Unused', 'Rating'])
    t.dispose(); t = null
    function Plain() { return h('div', null, 'x') }
    Plain.initialState = {}
    t = renderComponent(Plain)
    await t.ready()
    await settle(30)
    expect('controls' in t.inspect().components[0]).toBe(false)
  })
})
