// PLAN-5 3-K G-463: `form` and `list` are getter-only DOM properties (HTMLInputElement.form,
// .list, HTMLButtonElement.form, ...). As props the patch throws ("only a getter"), outside
// onError; the pragma routes them to attrs on an element tag (a component keeps them as props).
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { jsx } from '../src/jsx-runtime.js'
import { renderComponent } from '../src/index.js'
import { init, attributesModule, propsModule } from 'snabbdom'

describe('G-463: form / list go to attrs', () => {
  it('createElement and the JSX runtime route form and list to attrs', () => {
    expect(h('input', { form: 'f', list: 'l', value: 'x' }).data).toMatchObject({ attrs: { form: 'f', list: 'l' }, props: { value: 'x' } })
    expect(jsx('button', { form: 'f' }).data.attrs).toEqual({ form: 'f' })
    expect(jsx('button', { form: 'f' }).data.props).toBeUndefined()
  })
  it('a component placeholder keeps them as props', () => {
    const C = () => null
    expect(h(C, { form: 'f', list: 'l' }).data.props).toEqual({ form: 'f', list: 'l' })
  })
  it('patches and updates without throwing', () => {
    const patch = init([attributesModule, propsModule])
    const root = document.createElement('div')
    document.body.appendChild(root)
    const view = (f, l) => h('div', {}, h('form', { attrs: { id: f } }), h('datalist', { attrs: { id: l } }),
      h('input', { form: f, list: l }), h('button', { form: f }), h('select', { form: f }), h('textarea', { form: f }))
    let v = patch(root, view('f1', 'l1'))
    const [form, list, input, button, select, textarea] = v.elm.children
    expect(input.form).toBe(form)
    expect(input.list).toBe(list)
    expect(button.form).toBe(form)
    expect(select.form).toBe(form)
    expect(textarea.form).toBe(form)
    v = patch(v, view('f2', 'l2'))
    expect(v.elm.children[2].getAttribute('form')).toBe('f2')
    expect(v.elm.children[2].getAttribute('list')).toBe('l2')
    expect(v.elm.children[2].form).toBe(v.elm.children[0])
    v.elm.remove()
  })
})

describe('G-463: in a component (real DOM)', () => {
  let t
  afterEach(() => t?.dispose())
  it('<input form list> and <button form> render and update', async () => {
    function F({ state }) {
      return h('div', {},
        h('form', { id: state.f }),
        h('datalist', { id: 'opts' }, h('option', { value: 'a' })),
        h('input', { className: 'i', form: state.f, list: 'opts' }),
        h('button', { className: 'b', type: 'submit', form: state.f }, 'Go'))
    }
    F.initialState = { f: 'one' }
    F.model = { SWAP: () => ({ f: 'two' }) }
    t = renderComponent(F, { dom: 'real' })
    await t.ready()
    expect(t.query('.i').form.id).toBe('one')
    expect(t.query('.i').list.id).toBe('opts')
    expect(t.query('.b').form.id).toBe('one')
    t.simulateAction('SWAP')
    await t.waitForState(s => s.f === 'two')
    await t.settle()
    expect(t.query('.i').getAttribute('form')).toBe('two')
    expect(t.query('.b').form.id).toBe('two')
  })
})
