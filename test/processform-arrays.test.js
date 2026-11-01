// @vitest-environment jsdom
// UI sweep round 3: processForm gives a <select multiple> as an array of its selected values ([]
// when none), as the form behavior's CHANGE and a multiple widget field (Select, Combobox) do.
// Round 4: checkboxes sharing a name (more than one in the form) are an array of the checked
// values ([] when none), FormData.getAll's; a lone checkbox keeps FormData.get's value.
import { it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import processForm from '../src/extra/processForm.ts'
import { HostDocument } from '../src/host/dom.ts'
import xs from 'xstream'

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
      h('input', { type: 'checkbox', name: 'agree' }),
      h('input', { type: 'checkbox', name: 'solo', value: 's' }),
      h('input', { type: 'checkbox', name: 'dis', value: 'd1' }),
      h('input', { type: 'checkbox', name: 'dis', value: 'd2', disabled: true }),
      h('input', { type: 'checkbox', name: 'alloff', value: 'x', disabled: true }),
      h('input', { type: 'checkbox', name: 'alloff', value: 'y', disabled: true }),
      h('input', { type: 'checkbox', name: 'far', value: 'in' }),
      h('input', { type: 'radio', name: 'size', value: 'S' }),
      h('input', { type: 'radio', name: 'size', value: 'M' }),
      h('button', { type: 'submit' }, 'Go')),
    h('select', { name: 'outside', multiple: true, attrs: { form: 'f1' } }, h('option', { value: 'o', selected: true }, 'O')),
    h('input', { type: 'checkbox', name: 'far', value: 'out', attrs: { form: 'f1' } }),
    h('input', { type: 'checkbox', name: 'stray', value: 'a' }), h('input', { type: 'checkbox', name: 'stray', value: 'b' }))
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

it('checkboxes sharing a name: the checked values in order, [] when none; disabled boxes count but give no value; form="id" ones in', async () => {
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await submit()
  const d = t.state.last
  expect(d.opt).toEqual([])
  expect(d.dis).toEqual([])
  expect(d.far).toEqual([])
  // every box disabled: no entry, as a disabled <select multiple> (FormData has none)
  expect('alloff' in d).toBe(false)
  // boxes outside the form (and not form="id") aren't its controls
  expect('stray' in d).toBe(false)
  t.queryAll('[name=opt], [name=dis], [name=far]').forEach((c) => { c.checked = true })
  await submit()
  expect(t.state.last.opt).toEqual(['p', 'q'])
  expect(t.state.last.dis).toEqual(['d1'])
  expect(t.state.last.far).toEqual(['in', 'out'])
  t.query('[name=opt][value=p]').checked = false
  await submit()
  expect(t.state.last.opt).toEqual(['q'])
})

it('a lone checkbox and radios are unchanged: the value ("on" without one), no entry when unchecked', async () => {
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await submit()
  for (const n of ['agree', 'solo', 'size']) expect(n in t.state.last).toBe(false)
  t.query('[name=agree]').checked = true
  t.query('[name=solo]').checked = true
  t.query('[name=size][value=M]').checked = true
  await submit()
  expect(t.state.last.agree).toBe('on')
  expect(t.state.last.solo).toBe('s')
  expect(t.state.last.size).toBe('M')
})

it('a sygnal/host form gives checkbox groups the same way', () => {
  const doc = new HostDocument(), form = doc.createElement('form')
  const box = (name, value, checked, disabled) => {
    const b = doc.createElement('input')
    b.type = 'checkbox'; b.name = name; b.value = value; b.checked = checked; b.disabled = !!disabled
    form.appendChild(b)
  }
  box('tags', 'a', true); box('tags', 'b', false); box('tags', 'c', true, true)
  box('none', 'x', false); box('none', 'y', false)
  box('one', 'z', true)
  doc.body.appendChild(form)
  let out
  processForm({ events: () => xs.of({ type: 'input', currentTarget: form, preventDefault() {} }) }, { events: 'input' })
    .addListener({ next: (d) => { out = d } })
  expect(out.tags).toEqual(['a'])
  expect(out.none).toEqual([])
  expect(out.one).toBe('z')
})
