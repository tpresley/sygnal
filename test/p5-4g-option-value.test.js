// PLAN-5 4-G G-553: `<option value="">` rendered without its value attribute. snabbdom runs the
// module create hooks before it appends the children, so the props module saw option.value ===
// '' (no text yet) and skipped the write as unchanged; once the text was appended the option's
// value fell back to its label, and a placeholder option submitted its label text.
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/index.js'

const fd = (form) => Object.fromEntries(new FormData(form))

describe('G-553: <option value>', () => {
  let t
  afterEach(() => t?.dispose())

  it("a placeholder <option value=''> submits '' (not its label); value='0' submits '0'", async () => {
    function F() {
      return h('form', { className: 'f' },
        h('select', { name: 'a' }, h('option', { value: '' }, 'Pick one'), h('option', { value: 'x' }, 'X')),
        h('select', { name: 'b' }, h('option', { value: '0' }, 'Zero'), h('option', { value: '1' }, 'One')),
        h('select', { name: 'c' }, h('option', { value: 0 }, 'Zero (number)')))
    }
    t = renderComponent(F, { dom: 'real' })
    await t.ready()
    const opts = t.queryAll('option')
    expect(opts[0].getAttribute('value')).toBe('')
    expect(opts[0].value).toBe('')
    expect(opts[2].getAttribute('value')).toBe('0')
    expect(opts[4].value).toBe('0')
    expect(fd(t.query('.f'))).toEqual({ a: '', b: '0', c: '0' })
  })

  it("value={''} updates: 'x' -> '' -> 'y' (attribute and FormData follow)", async () => {
    function F({ state }) {
      return h('form', { className: 'f' },
        h('select', { name: 's' }, h('option', { className: 'o', value: state.v }, 'Label')))
    }
    F.initialState = { v: 'x' }
    F.model = { SET: (s, v) => ({ v }) }
    t = renderComponent(F, { dom: 'real' })
    await t.ready()
    expect(fd(t.query('.f'))).toEqual({ s: 'x' })
    t.simulateAction('SET', '')
    await t.waitForState(s => s.v === '')
    expect(t.query('.o').getAttribute('value')).toBe('')
    expect(fd(t.query('.f'))).toEqual({ s: '' })
    t.simulateAction('SET', 'y')
    await t.waitForState(s => s.v === 'y')
    expect(fd(t.query('.f'))).toEqual({ s: 'y' })
  })

  it("an <input value=''> and a select's own value still render as before", async () => {
    function F() {
      return h('form', { className: 'f' },
        h('input', { name: 'i', value: '' }),
        h('select', { name: 's', value: 'b' }, h('option', { value: '' }, 'Pick'), h('option', { value: 'b' }, 'B')))
    }
    t = renderComponent(F, { dom: 'real' })
    await t.ready()
    expect(t.query('input').value).toBe('')
    expect(fd(t.query('.f'))).toEqual({ i: '', s: 'b' })
  })
})
