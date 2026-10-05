// @vitest-environment jsdom
// PLAN-5 1-S: fixes to the `form` behavior and its helpers from the review of 1-F1 (G-371,
// G-373…G-377, G-379, G-380).
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { renderComponent, form } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// a Standard Schema whose validate resolves after `ms`
const slow = (ms, check = () => []) => ({ '~standard': { version: 1, vendor: 'test', validate: (v) => new Promise(r => setTimeout(() => {
  const issues = check(v)
  r(issues.length ? { issues } : { value: v })
}, ms)) } })
const sync = (check = () => []) => ({ '~standard': { version: 1, vendor: 'test', validate: (v) => {
  const issues = check(v)
  return issues.length ? { issues } : { value: v }
} } })

describe('G-371: async schema, a second submit while the first validates', () => {
  function C({ state }) { return h('form', { className: 'f' }, h('input', { name: 'a', value: state.form.values.a })) }
  C.uses = { form: form(slow(30), { values: { a: '' }, submit: 'SAVE' }) }
  C.model = { SAVE: { EFFECT: () => { C.sent++ } } }

  it('is queued and dropped (SYG232): one submit action', async () => {
    t = renderComponent(C)
    await t.ready()
    C.sent = 0
    // typed and submitted before the schema's Promise for the new values settled
    t.simulateEvent('.f input', 'input', { value: 'x' })
    t.simulateEvent('.f', 'submit'); await sleep(5)
    expect(t.state.form.queued).toBe(true)
    expect(t.state.form.validating).toBe(true)
    t.simulateEvent('.f', 'submit')
    await sleep(80); await t.settle()
    expect(C.sent).toBe(1)
    expect(t.state.form.submitCount).toBe(1)
    expect(t.state.form.submitting).toBe(true)
    expect(diagnostics('SYG232')).toHaveLength(1)
    expect(diagnostics('SYG232')[0].message).toMatch(/async schema/)
  })

  it('a RESULT for a submit already being sent does not send again', async () => {
    t = renderComponent(C)
    await t.ready()
    t.simulateEvent('.f input', 'input', { value: 'x' }); await sleep(50); await t.settle()
    C.sent = 0
    t.simulateEvent('.f', 'submit'); await sleep(50); await t.settle()
    expect(C.sent).toBe(1)
    t.simulateAction('form.RESULT', { values: t.state.form.values, submit: 1 }); await t.settle()
    expect(C.sent).toBe(1)
  })
})

describe('G-375: the first validation runs when the host starts, not at module load', () => {
  const need = (v) => v.a ? [] : [{ message: 'Need a', path: ['a'] }]
  const host = (schema) => {
    function C({ state }) { return h('form', { className: 'f' }, h('input', { name: 'a', value: state.form.values.a })) }
    C.uses = { form: form(schema, { values: { a: '' }, submit: 'SAVE' }) }
    C.model = { SAVE: { EFFECT: () => {} } }
    return C
  }

  it('form() does not call validate', () => {
    let calls = 0
    const s = { '~standard': { version: 1, vendor: 'test', validate: (v) => { calls++; return { value: v } } } }
    const b = form(s, { values: { a: '' }, submit: 'SAVE' })
    expect(calls).toBe(0)
    expect(b.state.validating).toBe(true)
    expect(b.state.valid).toBe(false)
  })

  it('an async schema: validating (not valid) until its first result, then its errors', async () => {
    t = renderComponent(host(slow(20, need)))
    await t.ready()
    expect(t.state.form.validating).toBe(true)
    expect(t.state.form.valid).toBe(false)
    await t.next(s => !s.form.validating)
    expect(t.state.form.errors).toEqual({ a: 'Need a' })
    expect(t.state.form.valid).toBe(false)
  })

  it('a sync schema: its errors are there once the host is ready', async () => {
    t = renderComponent(host(sync(need)))
    await t.ready(); await t.settle()
    expect(t.state.form.validating).toBe(false)
    expect(t.state.form.errors).toEqual({ a: 'Need a' })
    expect(t.state.form.valid).toBe(false)
  })

  it('a valid start is valid once validated', async () => {
    t = renderComponent(host(slow(10)))
    await t.ready()
    await t.next(s => !s.form.validating)
    expect(t.state.form.valid).toBe(true)
  })
})

describe('G-373: an invalid submit focuses a field of its own form', () => {
  const req = sync((v) => v.email ? [] : [{ message: 'Need an email', path: ['email'] }])
  // a child component with a field of the same name, before the forms in page order
  function Search() { return h('div', { className: 'search' }, h('input', { name: 'email', className: 'se' })) }
  function C({ state }) {
    return h('div', null,
      h(Search),
      h('form', { className: 'login' }, h('input', { name: 'email', className: 'le', value: state.login.values.email })),
      h('form', { className: 'reg' }, h('div', null, h('input', { name: 'email', className: 're', value: state.reg.values.email }))))
  }
  C.uses = {
    login: form(req, { values: { email: '' }, submit: 'LOGIN', form: '.login' }),
    reg: form(req, { values: { email: '' }, submit: 'REG', form: '.reg' }),
  }
  C.model = { LOGIN: { EFFECT: () => {} }, REG: { EFFECT: () => {} } }

  it('the second form focuses its own field (not a child component\'s, not the first form\'s)', async () => {
    t = renderComponent(C, { dom: 'real' })
    await t.ready(); await t.settle()
    t.simulateEvent('.reg', 'submit'); await t.settle(); await sleep(30)
    expect(document.activeElement?.className).toBe('re')
    t.simulateEvent('.login', 'submit'); await t.settle(); await sleep(30)
    expect(document.activeElement?.className).toBe('le')
  })

  it('focusInvalid(names, within) prefixes each name with the form selector', async () => {
    const { focusInvalid, ABORT } = await import('../src/index.js')
    expect(focusInvalid(['a', 'b.1.c'], '.reg').focus.within).toBe('.reg [name="a"],.reg [name="b.1.c"]')
    expect(focusInvalid({ a: 'x' }).focus.within).toBe('[name="a"]')
    expect(focusInvalid({ a: '' }, 'form')).toBe(ABORT)
  })
})
