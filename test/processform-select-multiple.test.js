// @vitest-environment jsdom
// UI sweep round 3: processForm gives a <select multiple> as an array of its selected values ([]
// when none), as the form behavior's CHANGE and a multiple widget field (Select, Combobox) do.
// Checkbox groups (one name, several boxes) are unchanged: the last checked box's value, none absent.
import { it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import processForm from '../src/extra/processForm.ts'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms))

function A() {
  return h('div', null,
    h('form', { className: 'f', id: 'f1' },
      h('input', { name: 'title', value: 'x' }),
      h('select', { name: 'tags', multiple: true },
        h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'), h('option', { value: 'c' }, 'C')),
      h('select', { name: 'off', multiple: true, disabled: true }, h('option', { value: 'z', selected: true }, 'Z')),
      h('fieldset', { disabled: true }, h('select', { name: 'fs', multiple: true }, h('option', { value: 'y', selected: true }, 'Y'))),
      h('select', { name: 'one' }, h('option', { value: '1' }, '1'), h('option', { value: '2' }, '2')),
      h('input', { type: 'checkbox', name: 'opt', value: 'p' }),
      h('input', { type: 'checkbox', name: 'opt', value: 'q' }),
      h('button', { type: 'submit' }, 'Go')),
    h('select', { name: 'outside', multiple: true, attrs: { form: 'f1' } }, h('option', { value: 'o', selected: true }, 'O')))
}
A.initialState = { last: null }
A.intent = ({ DOM }) => ({ F: processForm(DOM.select('.f'), { events: 'submit' }) })
A.model = { F: (s, d) => ({ ...s, last: { ...d, event: undefined } }) }

const submit = async () => { t.query('.f').requestSubmit(); await settle() }

it('a <select multiple>: all its selected values, [] when none; disabled ones (itself or a fieldset) left out; form="id" ones in', async () => {
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await submit()
  expect(t.state.last.tags).toEqual([])
  expect(t.state.last.outside).toEqual(['o'])
  expect('off' in t.state.last).toBe(false)
  expect('fs' in t.state.last).toBe(false)
  const opts = t.query('[name=tags]').options
  opts[0].selected = true; opts[2].selected = true
  await submit()
  expect(t.state.last.tags).toEqual(['a', 'c'])
  // a single select and the other fields are unchanged
  expect(t.state.last.one).toBe('1')
  expect(t.state.last.title).toBe('x')
})

it('checkbox groups are unchanged: the last checked value; none checked: no entry', async () => {
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await submit()
  expect('opt' in t.state.last).toBe(false)
  t.queryAll('[name=opt]').forEach((c) => { c.checked = true })
  await submit()
  expect(t.state.last.opt).toBe('q')
})
