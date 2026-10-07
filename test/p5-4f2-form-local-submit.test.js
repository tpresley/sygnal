// @vitest-environment jsdom
// PLAN-5 4-F2 (G-575, D236): a submit that sends nothing completes at once (no lingering
// `submitting`), and a host that unmounts mid-submit doesn't leave its persisted slice stuck (the
// form resets `submitting` when its host starts). The HTTP path and its double-submit guard are
// unchanged. The wizard cases are the eval task-10 shapes the agents wrote (p5-s14b-opus t1–t5).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { renderComponent, form, ABORT } from '../src/index.js'
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
      if (v.password.length < 8) issues.push({ message: 'Short password', path: ['password'] })
      return issues.length ? { issues } : { value: v }
    },
  },
}
const values = { email: '', password: '' }

/** a one-form host: `model` is the host's model (the submit action is SAVE) */
const host = (model, options = {}) => {
  function C({ state }) {
    return h('form', { className: 'f' },
      h('input', { name: 'email', value: state.form.values.email }),
      h('input', { name: 'password', value: state.form.values.password }),
      h('button', { type: 'submit' }, 'Go'))
  }
  C.uses = { form: form(schema, { values, submit: 'SAVE', ...options }) }
  C.model = model
  return C
}
const type = async (name, value) => { t.simulateEvent(`[name="${name}"]`, 'input', { value }); await t.settle() }
const fill = async () => { await type('email', 'ada@example.com'); await type('password', 'correct horse') }
const submit = async (sel = '.f') => { t.simulateEvent(sel, 'submit'); await t.settle() }

describe('a submit that sends nothing completes at once', () => {
  for (const [what, model] of [
    ['a STATE reducer', { SAVE: (state, v) => ({ ...state, saved: v }) }],
    ['EVENTS', { SAVE: { EVENTS: (state, v) => ({ type: 'saved', data: v }) } }],
    ['STATE + EFFECT', { SAVE: { STATE: (state, v) => ({ ...state, saved: v }), EFFECT: () => {} } }],
  ]) {
    it(`submit entry with ${what}: submitting is false, submitted true, a second submit sends again`, async () => {
      t = renderComponent(host(model), { strict: true })
      await t.ready()
      await fill()
      await submit()
      expect(t.state.form).toMatchObject({ submitting: false, submitted: true, queued: false, submitCount: 1, dirty: false })
      await submit()
      expect(t.state.form).toMatchObject({ submitting: false, submitCount: 2 })
      expect(t.actions.filter((a) => a.type === 'SAVE')).toHaveLength(2)
      t.expectNoDiagnostics()
    })
  }

  it('the host entry gets the values, and an explicit form.DONE after it is harmless', async () => {
    t = renderComponent(host({
      SAVE: { STATE: (state, v) => ({ ...state, saved: v }), EFFECT: (state, v, next) => next('form.DONE') },
    }), { strict: true })
    await t.ready()
    await fill()
    await submit()
    expect(t.state.saved).toEqual({ email: 'ada@example.com', password: 'correct horse' })
    expect(t.state.form).toMatchObject({ submitting: false, submitted: true })
  })

  it('an invalid submit still sends nothing and leaves submitted false', async () => {
    t = renderComponent(host({ SAVE: (state, v) => ({ ...state, saved: v }) }), { strict: true })
    await t.ready()
    await submit()
    expect(t.state.saved).toBeUndefined()
    expect(t.state.form).toMatchObject({ submitting: false, submitted: false, submitCount: 1 })
  })
})

describe('a submit that sends a request is unchanged', () => {
  const http = { SAVE: { HTTP: (state, v) => ({ url: '/api/save', method: 'POST', json: v, ok: 'form.DONE', error: 'form.ERRORS' }) } }

  it('HTTP: submitting until form.DONE, a double submit is dropped', async () => {
    t = renderComponent(host(http), { strict: true })
    await t.ready()
    await fill()
    await submit()
    expect(t.state.form).toMatchObject({ submitting: true, submitted: false })
    await submit()
    expect(t.requests('HTTP').filter((r) => r.url === '/api/save')).toHaveLength(1)
    await t.respond('HTTP', { id: 1 })
    expect(t.state.form).toMatchObject({ submitting: false, submitted: true })
  })

  it('a request on the sink the `http` option names keeps the submit pending too', async () => {
    t = renderComponent(host({ SAVE: { API: (state, v) => ({ url: '/save', json: v, ok: 'form.DONE' }) } }, { http: 'API' }), { strict: true })
    await t.ready()
    await fill()
    await submit()
    expect(t.state.form.submitting).toBe(true)
    await t.respond('API', {})
    expect(t.state.form).toMatchObject({ submitting: false, submitted: true })
  })

  it('an HTTP entry that sends nothing this time (ABORT) still waits for its reply action', async () => {
    t = renderComponent(host({ SAVE: { HTTP: () => ABORT } }), { strict: true })
    await t.ready()
    await fill()
    await submit()
    expect(t.state.form.submitting).toBe(true)
  })
})

// ---- the wizard (eval task 10): a step's form slice lives in the parent's state
const PLANS = ['free', 'pro', 'team']

/** AccountStep with the given model (each one a shape an agent wrote) */
const accountStep = (model) => {
  function AccountStep({ state }) {
    const f = state.form.fields
    return h('form', { className: 'account' },
      h('input', { name: 'email', value: f.email.value }), h('p', { className: 'email-error' }, f.email.error),
      h('input', { name: 'password', value: f.password.value }), h('p', { className: 'password-error' }, f.password.error),
      h('button', { type: 'submit', className: 'next' }, 'Next'))
  }
  AccountStep.uses = { form: form(schema, { values, submit: 'NEXT' }) }
  AccountStep.model = model
  return AccountStep
}

const planSchema = { '~standard': { version: 1, vendor: 't', validate: (v) => (PLANS.includes(v.plan) ? { value: v } : { issues: [{ message: 'Pick a plan', path: ['plan'] }] }) } }
function PlanStep({ state }) {
  return h('form', { className: 'plan' },
    ...PLANS.map((p) => h('input', { type: 'radio', name: 'plan', value: p, checked: state.form.values.plan === p })),
    h('button', { type: 'button', className: 'back' }, 'Back'),
    h('button', { type: 'submit', className: 'create' }, 'Create account'))
}
PlanStep.uses = { form: form(planSchema, { values: { plan: 'free' }, submit: 'CREATE' }) }
PlanStep.intent = ({ DOM }) => ({ BACK: DOM.click('.back') })
PlanStep.model = {
  BACK: { PARENT: () => ({ type: 'BACK' }) },
  CREATE: { PARENT: (state, v) => ({ type: 'CREATE', plan: v.plan }) },
}

const wizard = (AccountStep) => {
  function App({ state }) {
    if (state.done) return h('p', { className: 'summary' }, `Account created for ${state.email} on the ${state.plan} plan.`)
    return h('div', null,
      h('p', { className: 'step' }, `Step ${state.step} of 2`),
      state.step === 1 ? h(AccountStep, { state: 'account' }) : h(PlanStep, { state: 'choice' }))
  }
  App.initialState = { step: 1, account: {}, choice: {}, email: '', plan: '', done: false }
  App.intent = ({ CHILD }) => {
    const plan$ = CHILD.select(PlanStep)
    return {
      TO_PLAN: CHILD.select(AccountStep),
      TO_ACCOUNT: plan$.filter((m) => m.type === 'BACK'),
      FINISH: plan$.filter((m) => m.type === 'CREATE'),
    }
  }
  App.model = {
    TO_PLAN: (state, m) => ({ ...state, step: 2, email: m.email }),
    TO_ACCOUNT: (state) => ({ ...state, step: 1 }),
    FINISH: (state, m) => ({ ...state, done: true, plan: m.plan }),
  }
  return App
}

const shapes = [
  // t3 (and the plain shape the docs now show): PARENT only
  ['PARENT only', { NEXT: { PARENT: (state, v) => ({ email: v.email }) } }],
  // t2: finish with a delayed next('form.DONE'); the step unmounts before it arrives
  ['PARENT + EFFECT next(form.DONE, v, 0)', {
    NEXT: { EFFECT: (state, v, next) => next('form.DONE', v, 0) },
    'form.DONE': { PARENT: (state, v) => ({ email: v.email }) },
  }],
  ['PARENT + EFFECT next(form.DONE)', {
    NEXT: { PARENT: (state, v) => ({ email: v.email }), EFFECT: (state, v, next) => next('form.DONE') },
  }],
  // t1, t5: clear submitting by hand
  ['PARENT + a STATE that clears submitting', {
    NEXT: { STATE: (state) => ({ ...state, form: { ...state.form, submitting: false } }), PARENT: (state, v) => ({ email: v.email }) },
  }],
]

describe('a wizard: the step unmounts after its submit', () => {
  for (const [what, model] of shapes) {
    it(`${what}: Next, Back (values kept), Next again, then the next step's form works`, async () => {
      t = renderComponent(wizard(accountStep(model)), { strict: true, dom: 'real' })
      await t.ready()
      await submit('.account')                                   // invalid: stays, shows errors
      expect(t.query('.step').textContent).toBe('Step 1 of 2')
      expect(t.query('.email-error').textContent).toBe('Bad email')
      await type('email', 'ada@example.com')
      await type('password', 'correct horse')
      await submit('.account')
      await t.waitForState((s) => s.step === 2)
      expect(t.query('.step').textContent).toBe('Step 2 of 2')
      expect(t.state.account.form.submitting).toBe(false)

      t.simulateEvent('[name="plan"][value="pro"]', 'input', { value: 'pro' })
      await t.settle()
      t.simulateEvent('.back', 'click')
      await t.waitForState((s) => s.step === 1)
      expect(t.query('[name="email"]').value).toBe('ada@example.com')
      expect(t.query('[name="password"]').value).toBe('correct horse')
      expect(t.state.account.form.submitting).toBe(false)

      await submit('.account')                                   // the second Next is not dropped
      await t.waitForState((s) => s.step === 2)
      expect(t.query('[name="plan"][value="pro"]').checked).toBe(true)  // the plan was kept
      await submit('.plan')
      await t.waitForState((s) => s.done)
      expect(t.query('.summary').textContent).toBe('Account created for ada@example.com on the pro plan.')
    })
  }

  it('a host that unmounts during an HTTP submit starts again unstuck', async () => {
    const Step = accountStep({ NEXT: { HTTP: (state, v) => ({ url: '/api/account', json: v, ok: 'form.DONE' }) } })
    function App({ state }) {
      return h('div', null, state.show ? h(Step, { state: 'account' }) : h('p', { className: 'gone' }, 'gone'))
    }
    App.initialState = { show: true, account: {} }
    App.model = { TOGGLE: (state) => ({ ...state, show: !state.show }) }
    t = renderComponent(App, { strict: true })
    await t.ready()
    await type('email', 'ada@example.com')
    await type('password', 'correct horse')
    await submit('.account')
    expect(t.state.account.form.submitting).toBe(true)
    t.simulateAction('TOGGLE')
    await t.settle()
    expect(t.query('.gone')).toBeTruthy()
    t.simulateAction('TOGGLE')
    await t.settle()
    expect(t.state.account.form).toMatchObject({ submitting: false, queued: false, pending: {} })
    expect(t.state.account.form.values.email).toBe('ada@example.com')
    await submit('.account')
    expect(t.requests('HTTP').filter((r) => r.url === '/api/account')).toHaveLength(2)
  })
})

describe('docs (D236)', () => {
  it('guide/forms has "Submit without a request" with a PARENT-only entry and the wizard note; the reference the rule', () => {
    const page = fs.readFileSync(path.join(__dirname, '../docs/src/content/docs/guide/forms.md'), 'utf8')
    const sec = page.slice(page.indexOf('## Submit without a request'), page.indexOf('## Server errors'))
    expect(sec).toContain('NEXT: { PARENT: (state, values) =>')
    expect(sec).not.toContain('HTTP:')
    expect(sec).toContain('**Wizards**')
    const ref = fs.readFileSync(path.join(__dirname, '../docs/src/content/docs/guide/forms-reference.md'), 'utf8')
    expect(ref).toContain('**With the `http` sink**')
    expect(ref).toContain('**A host that unmounts**')
  })
})
