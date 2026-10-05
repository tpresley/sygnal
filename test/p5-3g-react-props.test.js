// @vitest-environment jsdom
// PLAN-5 3-G, G-436 / D215: fromReact prop routing. A React icon button named by `aria-label`
// (passed to the widget) gets that name on its own <button>; the host div stays unnamed. Before:
// aria-* / role / title went to the host only and the button had no accessible name.
import { it, expect, afterEach } from 'vitest'
import { createElement as r } from 'react'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { fromReact } from '../src/react.ts'

const settle = (ms = 30) => new Promise((res) => setTimeout(res, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

// an icon-only React button: the props it doesn't use itself go on the <button>
function IconButton({ icon, onPress, ...rest }) {
  return r('button', { type: 'button', ...rest, onClick: () => onPress?.() }, r('svg', { 'aria-hidden': 'true', 'data-icon': icon }))
}
const Icon = fromReact(IconButton, { events: { press: 'onPress' } })

it('aria-label, aria-describedby, title name and describe the React button; the host has none; tabIndex stays on the host', async () => {
  function A({ state }) {
    return h('div', null,
      h(Icon, { className: 'del', icon: 'trash', 'aria-label': 'Delete', 'aria-describedby': 'hint', title: 'Delete row', 'data-row': '7' }),
      h('p', { id: 'hint' }, 'Removes the row'),
      h('output', { className: 'n' }, String(state.n)))
  }
  A.initialState = { n: 0 }
  A.intent = ({ DOM }) => ({ PRESS: DOM.select('.del').events('press') })
  A.model = { PRESS: (s) => ({ n: s.n + 1 }) }
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await settle()
  const host = t.query('.del'), button = host.querySelector('button')
  expect(button.getAttribute('aria-label')).toBe('Delete')
  expect(button.getAttribute('aria-describedby')).toBe('hint')
  expect(button.getAttribute('title')).toBe('Delete row')
  expect(button.dataset.row).toBe('7')
  expect(host.dataset.row).toBe('7')
  for (const a of ['aria-label', 'aria-describedby', 'title', 'role']) expect(host.hasAttribute(a)).toBe(false)
  button.click()
  await t.next((s) => s.n === 1)
})

it('tabIndex / hidden: host only; ownProps sends one to the component; hostProps puts role on the host too', async () => {
  let got
  const Spy = (p) => { got = p; return r('span', null, 'x') }
  const A1 = fromReact(Spy)
  const A2 = fromReact(Spy, { ownProps: ['tabIndex'], hostProps: ['role'] })
  function A() { return h('div', null, h(A1, { className: 'w', tabIndex: 0, hidden: false, role: 'region' })) }
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await settle()
  expect(t.query('.w').getAttribute('tabindex')).toBe('0')
  expect(t.query('.w').hasAttribute('role')).toBe(false)
  expect(Object.keys(got).sort()).toEqual(['role'])
  t.dispose()
  function C() { return h('div', null, h(A2, { className: 'w', tabIndex: 0, role: 'region' })) }
  t = renderComponent(C, { dom: 'real' })
  await t.ready()
  await settle()
  expect(t.query('.w').hasAttribute('tabindex')).toBe(false)
  expect(t.query('.w').getAttribute('role')).toBe('region')
  expect(Object.keys(got).sort()).toEqual(['role', 'tabIndex'])
  expect([...A2.def.ownProps]).toEqual(['tabIndex'])
})
