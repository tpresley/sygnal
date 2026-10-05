// @vitest-environment jsdom
// PLAN-5 2-R, G-382: with an async schema, `valid` keeps the previous validity while the schema
// re-validates after its first answer (a `disabled={!valid}` button doesn't flicker per
// keystroke); `validating` shows the run. Before the first answer (and after a reset) it is false.
// (waitForState searches the whole state history: only the first wait uses it, later ones next().)
import { it, expect, afterEach } from 'vitest'
import { renderComponent, form } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

const slow = (ms, check) => ({ '~standard': { version: 1, vendor: 'test', validate: (v) => new Promise(r => setTimeout(() => {
  const issues = check(v)
  r(issues.length ? { issues } : { value: v })
}, ms)) } })
const needA = (v) => v.a ? [] : [{ message: 'Need a', path: ['a'] }]

function host() {
  function C({ state }) {
    return h('form', { className: 'f' }, [h('input', { name: 'a', value: state.form.values.a }), h('button', { disabled: !state.form.valid }, 'Save')])
  }
  C.uses = { form: form(slow(15, needA), { values: { a: 'x' }, submit: 'SAVE' }) }
  C.model = { SAVE: { EFFECT: () => {} } }
  return C
}

it('valid stays true while a still-valid edit re-validates; validating shows the run', async () => {
  t = renderComponent(host())
  await t.ready()
  expect(t.state.form.valid).toBe(false) // no answer yet
  await t.waitForState(s => !s.form.validating)
  expect(t.state.form.valid).toBe(true)
  const seen = []
  t.simulateEvent('.f input', 'input', { value: 'xy' })
  await t.next(s => s.form.validating)
  seen.push(t.state.form.valid)
  await t.next(s => !s.form.validating)
  seen.push(t.state.form.valid)
  expect(seen).toEqual([true, true])
})

it('valid becomes false when the new answer has errors (and back once fixed)', async () => {
  t = renderComponent(host())
  await t.ready()
  await t.waitForState(s => !s.form.validating)
  t.simulateEvent('.f input', 'input', { value: '' })
  await t.next(s => s.form.validating)
  expect(t.state.form.valid).toBe(true) // the previous answer, until the new one
  await t.next(s => !s.form.validating)
  expect(t.state.form.valid).toBe(false)
  expect(t.state.form.errors).toEqual({ a: 'Need a' })
  t.simulateEvent('.f input', 'input', { value: 'z' })
  await t.next(s => s.form.validating)
  expect(t.state.form.valid).toBe(false) // still the previous (invalid) answer
  await t.next(s => !s.form.validating)
  expect(t.state.form.valid).toBe(true)
})

it('after form.RESET: not valid until the schema answers again', async () => {
  t = renderComponent(host())
  await t.ready()
  await t.waitForState(s => !s.form.validating)
  t.simulateAction('form.RESET', { a: 'new' })
  await t.next(s => s.form.validating && s.form.values.a === 'new')
  expect(t.state.form.valid).toBe(false)
  await t.next(s => !s.form.validating)
  expect(t.state.form.valid).toBe(true)
})
