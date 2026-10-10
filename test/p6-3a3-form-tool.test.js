// @vitest-environment jsdom
// PLAN-6 A-3 (D241 experimental, D269, D270, D291, G-598, G-602, G-603): `form(…, { tool:
// formTool({ … }) })` writes the
// declarative WebMCP attributes (as attrs, not props) on the host's <form> and its named fields,
// and answers an agent's submit (`agentInvoked`) through `respondWith` after validation and the
// flush. Mock DOM and `dom: 'real'`; the real-browser round trip is browser-tests/src/webmcp/.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, form, Collection, formTool } from '../src/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const schema = {
  '~standard': {
    version: 1,
    vendor: 't',
    validate(v) {
      const issues = []
      if (!EMAIL.test(v.email)) issues.push({ message: 'Bad email', path: ['email'] })
      if (v.plan !== 'pro' && v.plan !== 'free') issues.push({ message: 'Pick a plan', path: ['plan'] })
      return issues.length ? { issues } : { value: { ...v, email: v.email.toLowerCase() } }
    },
  },
}
const values = { email: '', plan: '', note: '', nick: '' }
const spec = { name: 'sign_up', description: 'Create an account' }
const tool = formTool(spec)

function Signup({ state }) {
  const f = state.form.values
  return h('main', {},
    h('label', { htmlFor: 'note' }, 'A note ', h('em', {}, 'for us')),
    h('form', { className: 'signup' },
      h('label', {}, 'Email address ', h('input', { name: 'email', value: f.email })),
      h('select', { name: 'plan', 'aria-label': 'The plan', value: f.plan }, h('option', { value: 'free' }, 'Free'), h('option', { value: 'pro' }, 'Pro')),
      h('textarea', { name: 'note', id: 'note', value: f.note }),
      h('input', { name: 'nick', 'attrs-toolparamdescription': 'Own text', 'aria-label': 'ignored', value: f.nick }),
      h('input', { value: 'unnamed', 'aria-label': 'no name' }),
      h('button', { type: 'submit' }, 'Sign up')),
    h('p', { className: 'out' }, state.saved ? `saved:${state.saved.email}` : 'none'))
}
const make = (opts = {}, model = {}) => {
  function C(p) { return Signup(p) }
  C.uses = { form: form(schema, { values, submit: 'SAVE', form: '.signup', tool, ...opts }) }
  C.initialState = { saved: null }
  C.model = { SAVE: (s, v) => ({ ...s, saved: v }), ...model }
  return C
}
const attrsOf = (el) => Object.fromEntries([...el.attributes].filter((a) => a.name.startsWith('tool')).map((a) => [a.name, a.value]))

for (const dom of ['mock', 'real']) {
  describe(`attributes (${dom} DOM)`, () => {
    it('the form gets toolname / tooldescription (no toolautosubmit by default); fields a toolparamdescription', async () => {
      t = renderComponent(make(), dom == 'real' ? { dom: 'real' } : {})
      await t.ready()
      const at = (sel, n) => t.query(sel).getAttribute(n)
      expect(at('form', 'toolname')).toBe('sign_up')
      expect(at('form', 'tooldescription')).toBe('Create an account')
      expect(at('form', 'toolautosubmit')).toBe(null)
      expect(at('[name="email"]', 'toolparamdescription')).toBe('Email address')   // wrapping label
      expect(at('[name="plan"]', 'toolparamdescription')).toBe('The plan')         // aria-label (G-603)
      expect(at('[name="note"]', 'toolparamdescription')).toBe('A note for us')    // <label for>, outside the form
      expect(at('[name="nick"]', 'toolparamdescription')).toBe('Own text')         // the view's own wins
      if (dom == 'real') {
        // attributes, not props (G-598)
        expect(attrsOf(t.query('form'))).toEqual({ toolname: 'sign_up', tooldescription: 'Create an account' })
        expect(t.query('input:not([name])').hasAttribute('toolparamdescription')).toBe(false)
      }
    })

    it('autosubmit: true writes toolautosubmit; a re-render keeps the attributes', async () => {
      t = renderComponent(make({ tool: formTool({ ...spec, autosubmit: true }) }), dom == 'real' ? { dom: 'real' } : {})
      await t.ready()
      expect(t.query('form').getAttribute('toolautosubmit')).toBe('')
      t.simulateEvent('[name="email"]', 'input', { value: 'a@b.c' })
      await t.settle()
      expect(t.query('form').getAttribute('toolname')).toBe('sign_up')
      expect(t.query('[name="email"]').getAttribute('toolparamdescription')).toBe('Email address')
    })

    it('without `tool` nothing is written, and a form that the selector does not match is left alone', async () => {
      function C(p) { return Signup(p) }
      C.uses = { form: form(schema, { values, submit: 'SAVE', form: '.signup' }) }
      C.initialState = { saved: null }
      C.model = { SAVE: (s, v) => ({ ...s, saved: v }) }
      t = renderComponent(C, dom == 'real' ? { dom: 'real' } : {})
      await t.ready()
      expect(t.query('form').getAttribute('toolname')).toBe(null)
      expect(t.query('[name="email"]').getAttribute('toolparamdescription')).toBe(null)
      t.dispose()
      t = renderComponent(make({ form: '.other' }), dom == 'real' ? { dom: 'real' } : {})
      await t.ready()
      expect(t.query('form').getAttribute('toolname')).toBe(null)
    })
  })
}

describe('fields rendered by Collection items', () => {
  it('get their toolparamdescription too (the post-processor sees the injected children)', async () => {
    function Row({ state }) { return h('li', {}, h('label', {}, 'Street ', h('input', { name: `rows.${state.id}.street`, value: state.street }))) }
    function C({ state }) {
      return h('form', {}, h('ul', {}, h(Collection, { of: Row, from: 'rows' })), h('button', { type: 'submit' }, 'Go'))
    }
    const s = { '~standard': { version: 1, vendor: 't', validate: (v) => ({ value: v }) } }
    C.uses = { form: form(s, { values: { rows: [{ id: 1, street: '' }] }, submit: 'SAVE', tool }) }
    C.initialState = { rows: [{ id: 1, street: '' }] }
    C.model = { SAVE: (st) => st }
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    expect(t.query('form').getAttribute('toolname')).toBe('sign_up')
    expect(t.query('[name="rows.1.street"]').getAttribute('toolparamdescription')).toBe('Street')
  })
})

describe('an agent submit (agentInvoked + respondWith)', () => {
  /** a submit as the browser's agent sends it: agentInvoked, respondWith(promise) during dispatch */
  const agentSubmit = (opts = {}) => {
    let answer, during = false
    const p = new Promise((r) => { answer = r })
    const ev = new Event('submit', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'agentInvoked', { value: true })
    ev.respondWith = (x) => {
      if (!during) throw new Error('respondWith outside the dispatch')
      if (!ev.defaultPrevented) throw new Error('respondWith before preventDefault')
      answer(x)
    }
    during = true
    t.query('form').dispatchEvent(ev)
    during = false
    return p.then((x) => x)
  }
  const type = async (name, value) => { t.simulateEvent(`[name="${name}"]`, 'input', { value }); await t.settle() }

  it('valid: { ok: true, values } (the schema output), after the flush that rendered the submit', async () => {
    t = renderComponent(make(), { dom: 'real' })
    await t.ready()
    await type('email', 'A@B.co')
    await type('plan', 'pro')
    const r = await agentSubmit()
    expect(r).toEqual({ ok: true, values: { email: 'a@b.co', plan: 'pro', note: '', nick: '' } })
    expect(t.query('.out').textContent).toBe('saved:a@b.co')   // rendered when the answer came
  })

  it('invalid: { ok: false, errors } with the field errors; the host action is not dispatched', async () => {
    t = renderComponent(make(), { dom: 'real' })
    await t.ready()
    await type('email', 'nope')
    const r = await agentSubmit()
    expect(r).toEqual({ ok: false, errors: { email: 'Bad email', plan: 'Pick a plan' } })
    expect(t.query('.out').textContent).toBe('none')
    expect(t.state.form.submitCount).toBe(1)                  // the same SUBMIT a user's submit is
  })

  it('a submit sent as a request waits for form.DONE; form.ERRORS answers with the server errors', async () => {
    const C = make({}, { SAVE: { HTTP: (s, v) => ({ url: '/signup', method: 'POST', body: v, ok: 'form.DONE', error: 'form.ERRORS' }) } })
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    await type('email', 'a@b.co')
    await type('plan', 'free')
    let done = false
    const p = agentSubmit().then((x) => { done = true; return x })
    await t.settle()
    expect(done).toBe(false)
    expect(t.state.form.submitting).toBe(true)
    await t.fail('HTTP', { status: 422, body: { errors: { email: 'Taken' } } })
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.errors.email).toBe('Taken')
    const p2 = agentSubmit()
    await t.settle()
    await t.respond('HTTP', { id: 7 })
    expect(await p2).toEqual({ ok: true, values: { email: 'a@b.co', plan: 'free', note: '', nick: '' } })
  })

  it('a user submit is unchanged (no respondWith); without `tool` an agent submit is not answered by the form', async () => {
    t = renderComponent(make(), { dom: 'real' })
    await t.ready()
    await type('email', 'a@b.co')
    await type('plan', 'pro')
    t.simulateEvent('form', 'submit')
    await t.settle()
    expect(t.query('.out').textContent).toBe('saved:a@b.co')
    t.dispose()
    function C(p) { return Signup(p) }
    C.uses = { form: form(schema, { values, submit: 'SAVE', form: '.signup' }) }
    C.initialState = { saved: null }
    C.model = { SAVE: (s, v) => ({ ...s, saved: v }) }
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    let called = false
    const ev = new Event('submit', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'agentInvoked', { value: true })
    ev.respondWith = () => { called = true }
    t.query('form').dispatchEvent(ev)
    await t.settle()
    expect(called).toBe(false)
  })

  it('an async schema: the call waits for its answer', async () => {
    const sync = schema['~standard'].validate
    const slow = { '~standard': { version: 1, vendor: 't', validate: (v) => new Promise((r) => setTimeout(() => r(sync(v)), 5)) } }
    function C(p) { return Signup(p) }
    C.uses = { form: form(slow, { values, submit: 'SAVE', form: '.signup', tool }) }
    C.initialState = { saved: null }
    C.model = { SAVE: (s, v) => ({ ...s, saved: v }) }
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    await type('email', 'x@y.zz')
    expect(await agentSubmit()).toEqual({ ok: false, errors: { plan: 'Pick a plan' } })
    await type('plan', 'free')
    expect(await agentSubmit()).toEqual({ ok: true, values: { email: 'x@y.zz', plan: 'free', note: '', nick: '' } })
    expect(t.query('.out').textContent).toBe('saved:x@y.zz')
  })

  it('a second agent submit while one is running is refused at once', async () => {
    const C = make({}, { SAVE: { HTTP: (s, v) => ({ url: '/signup', body: v, ok: 'form.DONE', error: 'form.ERRORS' }) } })
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    await type('email', 'a@b.co')
    await type('plan', 'free')
    const p1 = agentSubmit()
    await t.settle()
    expect(await agentSubmit()).toEqual({ ok: false, error: 'A submit is already running' })
    await t.respond('HTTP', {})
    expect((await p1).ok).toBe(true)
  })

  it('a pending call is answered when the host goes away', async () => {
    const C = make({}, { SAVE: { HTTP: (s, v) => ({ url: '/signup', body: v, ok: 'form.DONE', error: 'form.ERRORS' }) } })
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    await type('email', 'a@b.co')
    await type('plan', 'free')
    const p = agentSubmit()
    await t.settle()
    t.dispose()
    t = null
    expect(await p).toEqual({ ok: false, error: 'The form was removed' })
  })
})

describe('D291: pay per use', () => {
  it('a plain object as tool is SYG245 (dev) and offers nothing; the form still works', async () => {
    setupChecks()
    t = renderComponent(make({ tool: { ...spec } }), { dom: 'real' })
    await t.ready()
    expect(t.query('form').hasAttribute('toolname')).toBe(false)
    const d = diagnostics('SYG245')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('error')
    expect(d[0].fix).toContain("tool: formTool({ name: 'sign_up'")
    t.simulateEvent('[name="email"]', 'input', { value: 'a@b.co' })
    t.simulateEvent('[name="plan"]', 'input', { value: 'pro' })
    t.simulateEvent('form', 'submit')
    await t.settle()
    expect(t.query('.out').textContent).toBe('saved:a@b.co')
  })

  it('formTool keeps the spec readable', () => {
    expect(tool).toMatchObject(spec)
  })

})
