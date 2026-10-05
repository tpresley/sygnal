// @vitest-environment jsdom
// PLAN-5 2-T, G-413: accessible names of the Zag parts and fromReact's host attributes.
// - Menu / Select / Combobox take aria-label, aria-labelledby and aria-describedby from their
//   props and put them on the control (Menu's trigger, Select's trigger, Combobox's input), not
//   on the host; without a `label`, no aria-labelledby points at a missing label element.
// - fromReact (D215, 3-G): tabIndex and hidden go to the host only (no second tab stop); aria-*,
//   role and title to the component only (p5-3g-react-props.test.js); data-* to both.
import { it, expect, afterEach } from 'vitest'
import { createElement as r } from 'react'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Menu } from '../src/ui-menu.ts'
import { Select } from '../src/ui-select.ts'
import { Combobox } from '../src/ui-combobox.ts'
import { fromReact } from '../src/react.ts'

const settle = (ms = 30) => new Promise((res) => setTimeout(res, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const real = async (C) => {
  t = renderComponent(C, { dom: 'real' })
  await t.ready()
  await settle()
}

// a small accessible-name computation (aria-labelledby, aria-label, <label for>, content)
const nameOf = (el) => {
  const ids = el.getAttribute('aria-labelledby')
  if (ids) return ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent.trim() ?? `#missing:${id}`).join(' ')
  if (el.hasAttribute('aria-label')) return el.getAttribute('aria-label')
  if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) return l.textContent.trim() }
  return el.localName == 'button' ? el.textContent.trim() : ''
}
const describedBy = (el) => (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent.trim()).join(' ')
// every id reference inside the widget resolves
const dangling = (root) => [...root.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls]')]
  .flatMap((el) => ['aria-labelledby', 'aria-describedby', 'aria-controls'].flatMap((a) => (el.getAttribute(a) || '').split(/\s+/).filter(Boolean).filter((id) => !document.getElementById(id)).map((id) => `${el.dataset.part}.${a}=${id}`)))

it('aria-label on Select and Combobox names the control; no dangling labelledby; the host has none', async () => {
  function A() {
    return h('div', null,
      h(Combobox, { className: 'c', 'aria-label': 'City', items: ['a', 'b'] }),
      h(Select, { className: 's', 'aria-label': 'Size', items: ['a', 'b'], placeholder: 'Pick' }),
      h(Menu, { className: 'm', 'aria-label': 'More actions', label: '⋯', items: ['a'] }))
  }
  await real(A)
  const input = t.query('.c [data-part=input]'), trig = t.query('.s [data-part=trigger]'), menuTrig = t.query('.m [data-part=trigger]')
  expect(input.getAttribute('role')).toBe('combobox')
  expect(nameOf(input)).toBe('City')
  expect(trig.getAttribute('role')).toBe('combobox')
  expect(nameOf(trig)).toBe('Size')
  expect(nameOf(menuTrig)).toBe('More actions')
  for (const s of ['.c', '.s', '.m']) {
    expect(t.query(s).hasAttribute('aria-label'), s).toBe(false)
    expect(dangling(t.query(s)), s).toEqual([])
  }
})

it('aria-labelledby and aria-describedby from the props reach the control', async () => {
  function A() {
    return h('div', null,
      h('h2', { id: 'trip' }, 'Destination'),
      h('p', { id: 'hint' }, 'Pick where you go'),
      h(Combobox, { className: 'c', 'aria-labelledby': 'trip', 'aria-describedby': 'hint', items: ['a'] }),
      h(Select, { className: 's', 'aria-labelledby': 'trip', 'aria-describedby': 'hint', items: ['a'] }),
      h(Menu, { className: 'm', label: 'Go', 'aria-describedby': 'hint', items: ['a'] }))
  }
  await real(A)
  const input = t.query('.c [data-part=input]'), trig = t.query('.s [data-part=trigger]'), menuTrig = t.query('.m [data-part=trigger]')
  expect(nameOf(input)).toBe('Destination')
  expect(describedBy(input)).toBe('Pick where you go')
  expect(nameOf(trig)).toBe('Destination')
  expect(describedBy(trig)).toBe('Pick where you go')
  expect(nameOf(menuTrig)).toBe('Go')
  expect(describedBy(menuTrig)).toBe('Pick where you go')
  for (const s of ['.c', '.s', '.m']) {
    expect(t.query(s).hasAttribute('aria-labelledby'), s).toBe(false)
    expect(t.query(s).hasAttribute('aria-describedby'), s).toBe(false)
  }
})

it('with a label: the label names the control, as before', async () => {
  function A() { return h('div', null, h(Select, { className: 's', label: 'Size', items: ['a'] }), h(Combobox, { className: 'c', label: 'City', items: ['a'] })) }
  await real(A)
  expect(nameOf(t.query('.s [data-part=trigger]'))).toBe('Size')
  expect(nameOf(t.query('.c [data-part=input]'))).toBe('City')
  expect(dangling(t.query('.s'))).toEqual([])
})

it('fromReact (D215): tabIndex and hidden stay on the host; role, aria-* and title go to the component only; data-* to both', async () => {
  let got
  const W = fromReact((p) => { got = p; return r('span', { className: 'in' }, 'x') })
  function A() { return h('div', null, h(W, { className: 'w', tabIndex: 0, role: 'img', 'aria-label': 'Chart', title: 'Chart', hidden: false, 'data-kind': 'pie', value: 3 })) }
  await real(A)
  const host = t.query('.w')
  expect(host.getAttribute('tabindex')).toBe('0')
  expect(host.hasAttribute('role')).toBe(false)
  expect(host.hasAttribute('aria-label')).toBe(false)
  expect(host.hasAttribute('title')).toBe(false)
  expect(host.dataset.kind).toBe('pie')
  expect(Object.keys(got).sort()).toEqual(['aria-label', 'data-kind', 'role', 'title', 'value'])
})
