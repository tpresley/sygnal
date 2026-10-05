// PLAN-5 1-F item 6 (D199), renderComponent fixes:
// - the mock DOM's simulateEvent target carries name, id, type and getAttribute() (from spike
//   0-S2), so a listener that delegates by name (`e.target.name`, as on the real DOM) works
// - t.fail(sink, { status, body }) is an HTTP error response, as its JSDoc says (before: the
//   object was treated as a network failure)
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; _resetDiagnostics() })

describe('mock DOM event target: name, id, type, getAttribute', () => {
  function Signup({ state }) {
    return h('form', { className: 'signup' },
      h('input', { name: 'email', id: 'em', type: 'email', value: state.values.email, 'aria-invalid': false }),
      h('input', { attrs: { name: 'age', type: 'number' }, value: state.values.age }),
      h('input#plain.plain', { value: '' }))
  }
  Signup.initialState = { values: { email: '', age: '' }, seen: [] }
  // one listener on the form, delegating by the field's name (the form behavior's shape)
  Signup.intent = ({ DOM }) => ({ FIELD: DOM.select('.signup').events('input').map(e => ({ name: e.target.name, id: e.target.id, type: e.target.type, value: e.target.value, invalid: e.target.getAttribute('aria-invalid'), missing: e.target.getAttribute('nope') })) })
  Signup.model = { FIELD: (s, f) => ({ ...s, values: { ...s.values, [f.name]: f.value }, seen: [...s.seen, f] }) }

  it('the target names the element as the real DOM would', async () => {
    t = renderComponent(Signup)
    await t.ready()
    t.simulateEvent('[name="email"]', 'input', { value: 'a@b.c' })
    t.simulateEvent('[name="age"]', 'input', { value: '42' })
    t.simulateEvent('.plain', 'input', { value: 'x' })
    await t.settle()
    expect(t.state.values).toEqual({ email: 'a@b.c', age: '42', '': 'x' })
    expect(t.state.seen.map(({ value, ...f }) => f)).toEqual([
      { name: 'email', id: 'em', type: 'email', invalid: 'false', missing: null },
      { name: 'age', id: '', type: 'number', invalid: null, missing: null },
      { name: '', id: 'plain', type: '', invalid: null, missing: null },
    ])
  })

  it('a target passed in the event init still wins', async () => {
    t = renderComponent(Signup)
    await t.ready()
    t.simulateEvent('[name="email"]', 'input', { target: { name: 'age', value: '7' } })
    await t.settle()
    expect(t.state.values.age).toBe('7')
  })
})

describe('t.fail(sink, { status, body })', () => {
  function Save({ state }) { return h('div', null, h('button', { className: 'save' }, 'Save'), h('p', null, state.msg)) }
  Save.initialState = { msg: '' }
  Save.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
  Save.model = {
    SAVE: { HTTP: () => ({ url: '/api/save', method: 'POST', ok: 'SAVED', error: 'REJECTED' }) },
    SAVED: (s) => ({ ...s, msg: 'saved' }),
    REJECTED: (s, { error, status, body }) => ({ ...s, msg: error.message, status, body }),
  }

  it('is an HTTP error response with that status and body, as fail(sink, 422, { body }) is', async () => {
    t = renderComponent(Save)
    t.simulateEvent('.save', 'click')
    await t.fail('HTTP', { status: 422, body: { errors: { email: 'taken' } } })
    expect(t.state).toMatchObject({ status: 422, body: { errors: { email: 'taken' } }, msg: 'HTTP 422: /api/save' })
    t.simulateEvent('.save', 'click')
    await t.fail('HTTP', 422, { body: { errors: { email: 'taken' } } })
    expect(t.state).toMatchObject({ status: 422, body: { errors: { email: 'taken' } }, msg: 'HTTP 422: /api/save' })
  })

  it('an Error or a message is still a network failure', async () => {
    t = renderComponent(Save)
    t.simulateEvent('.save', 'click')
    await t.fail('HTTP', new Error('Failed to fetch'))
    expect(t.state).toMatchObject({ msg: 'Failed to fetch' })
    expect(t.state.status).toBe(undefined)
  })
})
