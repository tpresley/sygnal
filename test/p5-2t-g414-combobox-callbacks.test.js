// @vitest-environment jsdom
// PLAN-5 2-T, G-414: a Combobox's own onOpenChange / onInputValueChange (filtering, input-change)
// compose with the ones the app passes: both run, and the part keeps filtering.
import { it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Combobox } from '../src/ui-combobox.ts'

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const type = (input, text) => {
  input.value = text
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
}
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

it('user onOpenChange / onInputValueChange run, and the filter and input-change still work', async () => {
  const calls = []
  function A({ state }) {
    return h('div', null,
      h(Combobox, {
        className: 'c', label: 'C', items: ['ab', 'cd', 'ax'],
        onOpenChange: (d) => calls.push(['open', d.open]),
        onInputValueChange: (d) => calls.push(['in', d.inputValue]),
      }),
      h('p', { className: 'typed' }, state.typed))
  }
  A.initialState = { typed: '' }
  A.intent = ({ DOM }) => ({ TYPED: DOM.select('.c').events('input-change').detail() })
  A.model = { TYPED: (s, typed) => ({ ...s, typed }) }
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await settle()
  const input = t.query('.c input')
  input.focus()
  type(input, 'a')
  await t.next((s) => s.typed === 'a')
  await settle()
  expect(t.queryAll('.c [role=option]').map((o) => o.dataset.value)).toEqual(['ab', 'ax'])
  key(input, 'Escape')
  await settle()
  expect(calls).toContainEqual(['in', 'a'])
  expect(calls).toContainEqual(['open', true])
  expect(calls).toContainEqual(['open', false])
})
