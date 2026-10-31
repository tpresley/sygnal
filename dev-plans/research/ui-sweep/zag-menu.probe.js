// @vitest-environment jsdom
// UI sweep (zag.md): Menu probes, and the parts inside Switchable, a dialog, a Portal, an isolated child.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../../../src/pragma/index.js'
import { renderComponent } from '../../../src/extra/testing.js'
import { ABORT, Switchable, Portal } from '../../../src/index.ts'
import { dialog } from '../../../src/ui.ts'
import { Menu } from '../../../src/ui-menu.ts'
import { Select } from '../../../src/ui-select.ts'
import { rec } from './zag-rec.js'

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const real = async (C, o = {}) => { t = renderComponent(C, { dom: 'real', ...o }); await t.ready(); await settle(); return t }
const ITEMS = [{ value: 'edit', label: 'Edit' }, { value: 'copy', label: 'Copy' }, { value: 'del', label: 'Delete' }]

describe('Menu', () => {
  it('controlled open: follows state; a reducer that refuses keeps it closed', async () => {
    function A({ state }) { return h('div', null, h(Menu, { className: 'm', label: 'Actions', items: ITEMS, open: state.open })) }
    A.initialState = { open: false, locked: true }
    A.intent = ({ DOM }) => ({ OPEN: DOM.select('.m').events('open-change').detail() })
    A.model = { OPEN: (s, open) => (s.locked ? ABORT : { ...s, open }), UNLOCK: (s) => ({ ...s, locked: false }) }
    await real(A)
    t.query('.m [data-part=trigger]').click()
    await settle()
    expect(t.query('.m [data-part=content]').hidden).toBe(true)
    t.simulateAction('UNLOCK')
    await settle()
    t.query('.m [data-part=trigger]').click()
    await settle()
    expect(t.query('.m [data-part=content]').hidden).toBe(false)
    t.query('.m [role=menuitem][data-value=copy]').click()
    await settle()
    expect(t.state.open).toBe(false)
    expect(t.query('.m [data-part=content]').hidden).toBe(true)
  })

  it('items change while open: a removed item goes, a new one is selectable', async () => {
    function A({ state }) { return h('div', null, h(Menu, { className: 'm', label: 'Actions', items: state.items }), h('p', null, state.last)) }
    A.initialState = { items: ITEMS, last: '' }
    A.intent = ({ DOM }) => ({ PICK: DOM.select('.m').events('select').detail() })
    A.model = { PICK: (s, last) => ({ ...s, last }), SWAP: (s) => ({ ...s, items: [{ value: 'paste', label: 'Paste' }, ...ITEMS.slice(1)] }) }
    await real(A)
    const tr = t.query('.m [data-part=trigger]')
    tr.focus()
    key(tr, 'ArrowDown')
    await settle()
    expect(t.query('.m [data-highlighted]')?.dataset.value).toBe('edit')
    t.simulateAction('SWAP')
    await settle()
    expect(t.queryAll('.m [role=menuitem]').map((e) => e.dataset.value)).toEqual(['paste', 'copy', 'del'])
    rec('[probe] menu: highlighted after its item was removed:', t.query('.m [data-highlighted]')?.dataset.value ?? null)
    key(t.query('.m [data-part=content]'), 'ArrowDown')
    await settle()
    rec('[probe] menu: ArrowDown after removal highlights', t.query('.m [data-highlighted]')?.dataset.value ?? null)
    t.query('.m [role=menuitem][data-value=paste]').click()
    await settle()
    expect(t.state.last).toBe('paste')
  })

  it('closeOnSelect={false}: stays open, each pick dispatches', async () => {
    function A({ state }) { return h('div', null, h(Menu, { className: 'm', label: 'A', items: ITEMS, closeOnSelect: false }), h('p', null, state.n)) }
    A.initialState = { n: 0 }
    A.intent = ({ DOM }) => ({ PICK: DOM.select('.m').events('select').detail() })
    A.model = { PICK: (s) => ({ ...s, n: s.n + 1 }) }
    await real(A)
    t.query('.m [data-part=trigger]').click()
    await settle()
    t.query('.m [role=menuitem][data-value=edit]').click()
    await settle()
    t.query('.m [role=menuitem][data-value=copy]').click()
    await settle()
    expect(t.state.n).toBe(2)
    expect(t.query('.m [data-part=content]').hidden).toBe(false)
  })

  it('a menu without `label` but with aria-label (icon trigger): the types say label is required', async () => {
    function A() { return h('div', null, h(Menu, { className: 'm', 'aria-label': 'More', items: ITEMS })) }
    await real(A)
    const tr = t.query('.m [data-part=trigger]')
    expect(tr.getAttribute('aria-label')).toBe('More')
    rec('[probe] menu without label: trigger text', JSON.stringify(tr.textContent))
  })

  it('two menus: opening one closes the other', async () => {
    function A() { return h('div', null, h(Menu, { className: 'a', label: 'A', items: ITEMS }), h(Menu, { className: 'b', label: 'B', items: ITEMS })) }
    await real(A)
    t.query('.a [data-part=trigger]').click()
    await settle()
    t.query('.b [data-part=trigger]').click()
    await settle()
    rec('[probe] two menus: a open', !t.query('.a [data-part=content]').hidden, 'b open', !t.query('.b [data-part=content]').hidden)
  })
})

describe('inside other parts', () => {
  it('Switchable: a page switched away and back keeps working', async () => {
    function P1({ state }) { return h('div', null, h(Select, { className: 's', label: 'S', items: ['a', 'b'], value: state.v })) }
    P1.intent = ({ DOM }) => ({ V: DOM.select('.s').events('value-change').detail() })
    P1.model = { V: (s, v) => ({ ...s, v }) }
    function P2() { return h('p', null, 'two') }
    function A({ state }) { return h('div', null, h(Switchable, { of: { one: P1, two: P2 }, current: state.page })) }
    A.initialState = { page: 'one', v: null }
    A.model = { GO: (s, page) => ({ ...s, page }) }
    await real(A)
    t.simulateAction('GO', 'two')
    await settle()
    t.simulateAction('GO', 'one')
    await settle()
    t.query('.s [data-part=trigger]').click()
    await settle()
    t.query('.s [role=option][data-value=b]').click()
    await settle()
    expect(t.state.v).toBe('b')
    expect(t.query('.s [data-part=value-text]').textContent).toBe('b')
  })

  it('inside a sygnal/ui dialog: a pick works and Escape closes the select, not the dialog', async () => {
    function A({ state }) {
      return h('div', null,
        h('button', { className: 'edit' }, 'edit'),
        h('dialog', { className: 'dlg' }, h(Select, { className: 's', label: 'S', items: ['a', 'b'], value: state.v })))
    }
    A.initialState = { v: null }
    A.uses = { dlg: dialog({ dialog: '.dlg', trigger: '.edit' }) }
    A.intent = ({ DOM }) => ({ V: DOM.select('.s').events('value-change').detail() })
    A.model = { V: (s, v) => ({ ...s, v }) }
    HTMLDialogElement.prototype.showModal ||= function () { this.open = true }
    HTMLDialogElement.prototype.close ||= function () { this.open = false }
    await real(A)
    t.query('.edit').click()
    await settle()
    const tr = t.query('.s [data-part=trigger]')
    tr.focus()
    key(tr, 'ArrowDown')
    await settle()
    key(t.query('.s [data-part=content]'), 'Escape')
    await settle()
    rec('[probe] select in dialog: after Escape dialog open', t.query('.dlg').open, 'state.dlg.open', t.state.dlg?.open, 'select open', !t.query('.s [data-part=content]').hidden)
    t.query('.s [data-part=trigger]').click()
    await settle()
    t.query('.s [role=option][data-value=b]').click()
    await settle()
    expect(t.state.v).toBe('b')
  })

  it('inside a Portal: events reach the intent through the document (widgets guide)', async () => {
    function A({ state }) {
      return h('div', null, h(Portal, { target: '#elsewhere' }, h(Menu, { className: 'm', label: 'A', items: ITEMS }), h('button', { className: 'plain' }, 'x')), h('p', null, state.last))
    }
    A.initialState = { last: '', plain: 0 }
    A.intent = ({ DOM }) => ({ PICK: DOM.select('document').select('.m').events('select').detail(), PLAIN: DOM.click('.plain') })
    A.model = { PICK: (s, last) => ({ ...s, last }), PLAIN: (s) => ({ ...s, plain: s.plain + 1 }) }
    const host = document.createElement('div'); host.id = 'elsewhere'; document.body.appendChild(host)
    await real(A)
    const tr = document.querySelector('#elsewhere .m [data-part=trigger]')
    rec('[probe] menu in Portal: rendered in target?', !!tr)
    document.querySelector('#elsewhere .plain').click()
    await settle()
    rec('[probe] plain button in Portal heard:', t.state.plain)
    tr.click()
    await settle()
    document.querySelector('#elsewhere .m [role=menuitem][data-value=copy]').click()
    await settle()
    expect(t.state.last).toBe('copy')
  })

  it('an isolated child component: its own intent hears the widget, the parent does not', async () => {
    function Child({ state }) { return h('div', null, h(Menu, { className: 'm', label: 'A', items: ITEMS }), h('span', null, state.last)) }
    Child.intent = ({ DOM }) => ({ PICK: DOM.select('.m').events('select').detail() })
    Child.model = { PICK: (s, last) => ({ ...s, last }) }
    function A({ state }) { return h('div', null, h(Child, { state: 'child' }), h('p', null, state.parent)) }
    A.initialState = { child: { last: '' }, parent: '' }
    A.intent = ({ DOM }) => ({ P: DOM.select('.m').events('select').detail() })
    A.model = { P: (s, parent) => ({ ...s, parent }) }
    await real(A)
    t.query('.m [data-part=trigger]').click()
    await settle()
    t.query('.m [role=menuitem][data-value=copy]').click()
    await settle()
    expect(t.state.child.last).toBe('copy')
    expect(t.state.parent).toBe('')
  })
})

describe('mock DOM testing', () => {
  it('t.widget(...).dispatch on each part; props visible', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'S', items: ['a'], value: state.v })) }
    A.initialState = { v: null }
    A.intent = ({ DOM }) => ({ V: DOM.select('.s').events('value-change').detail() })
    A.model = { V: (s, v) => ({ ...s, v }) }
    t = renderComponent(A)
    await t.ready()
    t.widget('.s').dispatch('value-change', 'a')
    await t.next((s) => s.v === 'a')
    expect(t.widget('.s').props.value).toBe('a')
    // simulateEvent on the widget host: does it reach the intent like dispatch does?
    t.simulateEvent('.s', 'value-change', { detail: null })
    await settle()
    rec('[probe] mock: simulateEvent value-change with {detail: null} ->', t.state.v)
  })
})
