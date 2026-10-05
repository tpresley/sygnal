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
    // D212: deterministic: validate's results come when the test releases them (no timer race
    // between the schema and ready())
    const pending = []
    const gated = { '~standard': { version: 1, vendor: 'test', validate: (v) => new Promise((r) => pending.push(() => {
      const issues = need(v)
      r(issues.length ? { issues } : { value: v })
    })) } }
    t = renderComponent(host(gated))
    await t.ready()
    expect(t.state.form.validating).toBe(true)
    expect(t.state.form.valid).toBe(false)
    expect(pending.length).toBeGreaterThan(0)
    pending.splice(0).forEach((go) => go())
    await t.waitForState(s => !s.form.validating)
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
    // waitForState: the 10 ms answer may already be in when ready() resolves (next() would wait for another)
    await t.waitForState(s => !s.form.validating)
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

describe('G-374: two form uses with the same form selector (SYG237)', () => {
  const ok = sync()
  const host = (a, b) => {
    function C({ state }) {
      return h('div', null,
        h('form', { className: 'login' }, h('input', { name: 'email', value: state.login.values.email })),
        h('form', { className: 'news' }, h('input', { name: 'email', value: state.news.values.email })))
    }
    C.uses = { login: form(ok, { values: { email: '' }, submit: 'LOGIN', ...a }), news: form(ok, { values: { email: '' }, submit: 'SUB', ...b }) }
    C.model = { LOGIN: { EFFECT: () => {} }, SUB: { EFFECT: () => {} } }
    return C
  }

  it('both on the default: warned once, naming both keys and the selector', async () => {
    t = renderComponent(host({}, {}))
    await t.ready()
    const d = diagnostics('SYG237')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warn')
    expect(d[0].message).toMatch(/'login' and 'news'/)
    expect(d[0].message).toMatch(/'form'/)
  })

  it('the same explicit selector is warned too', async () => {
    t = renderComponent(host({ form: '.f' }, { form: '.f' }))
    await t.ready()
    expect(diagnostics('SYG237')).toHaveLength(1)
  })

  it('distinct selectors: no warning, and each form hears only its own fields', async () => {
    t = renderComponent(host({ form: '.login' }, { form: '.news' }))
    await t.ready()
    expect(diagnostics('SYG237')).toHaveLength(0)
    t.simulateEvent('.news input', 'input', { value: 'n@x.y' }); await t.settle()
    expect(t.state.login.values.email).toBe('')
    expect(t.state.news.values.email).toBe('n@x.y')
  })
})

describe('G-379: a field whose value is undefined is a field; focusout from a named button is ignored', () => {
  function C({ state }) {
    const v = state.form.values
    return h('form', { className: 'f' },
      h('input', { name: 'email', value: v.email }),
      h('input', { name: 'nick', value: v.nick ?? '' }),
      h('input', { name: 'address.city', value: v.address.city ?? '' }),
      h('button', { type: 'submit', name: 'intent', value: 'save' }, 'Save'))
  }
  C.uses = { form: form(sync(), {
    values: { email: '', nick: undefined, address: { city: undefined } },
    submit: 'SAVE',
    check: { nick: { request: (nick) => ({ url: '/api/nick', query: { nick } }) } },
  }) }
  C.model = { SAVE: { EFFECT: () => {} } }

  it('an optional (undefined) field takes input; no SYG230 / SYG235', async () => {
    t = renderComponent(C)
    await t.ready()
    t.simulateEvent('[name="nick"]', 'input', { value: 'ada' }); await t.settle()
    t.simulateEvent('[name="address.city"]', 'input', { value: 'Paris' }); await t.settle()
    expect(t.state.form.values.nick).toBe('ada')
    expect(t.state.form.values.address.city).toBe('Paris')
    expect(diagnostics('SYG230')).toEqual([])
    expect(diagnostics('SYG235')).toEqual([])
  })

  it('focusout from a named button: no SYG230, no change', async () => {
    t = renderComponent(C)
    await t.ready()
    const before = t.state.form
    t.simulateEvent('button', 'focusout'); await t.settle()
    expect(diagnostics('SYG230')).toEqual([])
    expect(t.state.form.touched).toEqual(before.touched)
  })

  it('an unknown name on input is still SYG230', async () => {
    function D({ state }) { return h('form', null, h('input', { name: 'emial', value: '' })) }
    D.uses = { form: form(sync(), { values: { email: '' }, submit: 'SAVE' }) }
    D.model = { SAVE: { EFFECT: () => {} } }
    t = renderComponent(D)
    await t.ready()
    t.simulateEvent('[name="emial"]', 'input', { value: 'x' }); await t.settle()
    expect(diagnostics('SYG230')).toHaveLength(1)
  })

  it('hasField: by `in` along the path (rows by id)', async () => {
    const { hasField } = await import('../src/index.js')
    const v = { a: undefined, b: { c: undefined }, rows: [{ id: 7, x: undefined }], tags: ['p'] }
    expect(hasField(v, 'a')).toBe(true)
    expect(hasField(v, 'b.c')).toBe(true)
    expect(hasField(v, 'rows.7.x')).toBe(true)
    expect(hasField(v, 'tags.0')).toBe(true)
    expect(hasField(v, 'z')).toBe(false)
    expect(hasField(v, 'b.z')).toBe(false)
    expect(hasField(v, 'rows.0.x')).toBe(false)
    expect(hasField(v, 'tags.3')).toBe(false)
    expect(hasField(v, 'a.b')).toBe(false)
  })
})

describe('G-380: row segments are ids only (no index fallback)', () => {
  it('replyErrors: an index-keyed name on rows with ids is form-level', async () => {
    const { replyErrors } = await import('../src/index.js')
    const values = { addresses: [{ id: 1, city: '' }, { id: 2, city: '' }] }
    expect(replyErrors({ 'addresses.0.city': 'Bad city' }, values)).toEqual({ '': 'Bad city' })
    expect(replyErrors({ 'addresses.2.city': 'Bad city' }, values)).toEqual({ 'addresses.2.city': 'Bad city' })
    // the first row's index (0) is no row id: before, it fell back to index 0 (row id 1)
    expect(replyErrors({ 'addresses.1.city': 'Bad city' }, values)).toEqual({ 'addresses.1.city': 'Bad city' })
  })
  it('getField / setField: no index fallback for rows with ids; plain arrays by index', async () => {
    const { getField, setField } = await import('../src/index.js')
    const values = { addresses: [{ id: 5, city: 'a' }], tags: ['x', 'y'] }
    expect(getField(values, 'addresses.0.city')).toBe(undefined)
    expect(getField(values, 'addresses.5.city')).toBe('a')
    expect(setField(values, 'addresses.0.city', 'b')).toBe(values)
    expect(getField(values, 'tags.1')).toBe('y')
    // a row without an id in a mixed array is still reached by its index (SYG236 warns)
    expect(getField({ r: [{ id: 3, v: 1 }, { v: 2 }] }, 'r.1.v')).toBe(2)
  })
})

describe('G-376: field types', () => {
  if (!customElements.get('x-check')) {
    customElements.define('x-check', class extends HTMLElement {
      static formAssociated = true
      constructor() { super(); this._c = false }
      get checked() { return this._c }
      set checked(v) { this._c = !!v }
    })
    customElements.define('x-text', class extends HTMLElement {
      static formAssociated = true
      constructor() { super(); this._v = '' }
      get value() { return this._v }
      set value(v) { this._v = String(v) }
    })
  }
  const opt = (v, sel) => h('option', { value: v, selected: sel }, v)
  function C({ state }) {
    const v = state.form.values
    return h('form', { className: 'f' },
      h('select', { name: 'colors', multiple: true }, opt('red', v.colors.includes('red')), opt('green', v.colors.includes('green')), opt('blue', v.colors.includes('blue'))),
      ...['a', 'b', 'c'].map(x => h('input', { type: 'checkbox', name: 'tags', value: x, className: 'tag-' + x, checked: v.tags.includes(x) })),
      h('input', { type: 'checkbox', name: 'agree', className: 'agree', checked: v.agree }),
      h('x-check', { name: 'news', className: 'news', checked: v.news }),
      h('x-text', { name: 'nick', className: 'nick', value: v.nick }),
      h('input', { type: 'number', name: 'age', value: v.age }),
      h('input', { type: 'file', name: 'avatar' }))
  }
  C.uses = { form: form(sync(), { values: { colors: [], tags: ['a'], agree: false, news: false, nick: '', age: '' }, submit: 'SAVE' }) }
  C.model = { SAVE: { EFFECT: () => {} } }

  it('<select multiple>: the selected values, as an array', async () => {
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    const s = t.query('select')
    s.options[0].selected = true; s.options[2].selected = true
    t.simulateEvent('select', 'input'); await t.settle()
    expect(t.state.form.values.colors).toEqual(['red', 'blue'])
  })

  it('same-named checkboxes on an array value: a group (checking adds its value, unchecking removes it)', async () => {
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.tag-c', 'input', { checked: true }); await t.settle()
    expect(t.state.form.values.tags).toEqual(['a', 'c'])
    t.simulateEvent('.tag-a', 'input', { checked: false }); await t.settle()
    expect(t.state.form.values.tags).toEqual(['c'])
    expect(t.query('.tag-a').checked).toBe(false)
    expect(t.query('.tag-c').checked).toBe(true)
  })

  it('a single checkbox on a boolean value: checked', async () => {
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.agree', 'input', { checked: true }); await t.settle()
    expect(t.state.form.values.agree).toBe(true)
  })

  it('a form-associated custom checkbox (a hyphenated tag with a boolean `checked`): checked; a custom text field: value', async () => {
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.news', 'input', { checked: true }); await t.settle()
    expect(t.state.form.values.news).toBe(true)
    t.simulateEvent('.nick', 'input', { value: 'ada' }); await t.settle()
    expect(t.state.form.values.nick).toBe('ada')
  })

  it('number: the string as typed (coerce in the schema)', async () => {
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    t.simulateEvent('[name="age"]', 'input', { value: '42' }); await t.settle()
    expect(t.state.form.values.age).toBe('42')
  })

  it('type=file is ignored (no SYG230, values unchanged)', async () => {
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    const before = t.state.form.values
    t.simulateEvent('[name="avatar"]', 'input'); await t.settle()
    expect(t.state.form.values).toBe(before)
    expect(diagnostics('SYG230')).toEqual([])
  })
})
