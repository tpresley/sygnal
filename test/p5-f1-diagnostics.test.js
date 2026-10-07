// @vitest-environment jsdom
// PLAN-5 F-1: `form` behavior diagnostics through the dev entry (checks/forms.ts): SYG230 (field
// name not in values), SYG231 (not a Standard Schema), SYG232 (submit dropped, info), SYG233
// (values key stripped by the schema), SYG234 (submit action), SYG235 (check key / request),
// SYG236 (rows without id). All dev-only: not in the core table.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { form } from '../src/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { CODE_TITLES, CODE_SEVERITY, DEV_CODE_SEVERITY, getCodeInfo } from '../src/extra/diagnostics/codes.js'
import { SignupA, signupSchema, emptyValues } from './p5-f1-fixtures.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

const ok = { '~standard': { version: 1, vendor: 't', validate: (value) => ({ value }) } }
const type = async (name, value) => { t.simulateEvent(`[name="${name}"]`, 'input', { value }); await t.settle() }

/** a host with one text field per name; `extra` names inputs outside values */
const host = (schema, options, { names = ['email'], extra = [], model } = {}) => {
  function C({ state }) {
    return h('form', { className: 'f' },
      ...[...names, ...extra].map((n) => h('label', null, n, h('input', { name: n, value: state.form.values[n] ?? '' }))),
      h('button', { type: 'submit' }, 'Go'))
  }
  C.uses = { form: form(schema, { values: { email: '' }, submit: 'SAVE', ...options }) }
  C.model = model ?? { SAVE: { EVENTS: (s, v) => ({ type: 'saved', data: v }) } }
  return C
}

describe('codes', () => {
  it('SYG230–236 are dev-entry codes with titles, registered by the dev entry', () => {
    for (const c of ['SYG230', 'SYG231', 'SYG232', 'SYG233', 'SYG234', 'SYG235', 'SYG236']) {
      expect(DEV_CODE_SEVERITY[c], c).toBeTruthy()
      expect(CODE_TITLES[c], c).toMatch(/form/i)
    }
    expect(DEV_CODE_SEVERITY.SYG231).toBe('error')
    expect(DEV_CODE_SEVERITY.SYG232).toBe('info')
    expect(getCodeInfo('SYG230').severity).toBe('warn')
  })
})

describe('SYG231: not a Standard Schema', () => {
  it('form() throws the coded error, naming what it got', () => {
    let err
    try { form({ parse() {} }, { values: {}, submit: 'X' }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(TypeError)
    expect(err.code).toBe('SYG231')
    expect(err.message).toMatch(/\[Sygnal SYG231\].*an object without ~standard\.validate \(a validator from before Standard Schema\?\)/)
    expect(err.message).toContain('sygnal.js.org/reference/errors#syg231')
    expect(() => form(() => {}, { values: {}, submit: 'X' })).toThrow(/a function, not a Standard Schema/)
  })
})

describe('SYG230: field name not in values', () => {
  it('warns once per name; the change is ignored; unnamed fields are silent', async () => {
    t = renderComponent(host(ok, {}, { extra: ['emial'] }))
    await t.ready()
    await type('emial', 'a')
    await type('emial', 'b')
    t.simulateEvent('[name="emial"]', 'focusout')
    await t.settle()
    const d = diagnostics('SYG230')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warn')
    expect(d[0].message).toMatch(/a field named 'emial' changed, but 'emial' isn't a field of the form's values \(email\)/)
    expect(t.state.form.values).toEqual({ email: '' })
    t.simulateEvent('button', 'focusout')
    await t.settle()
    expect(diagnostics('SYG230')).toHaveLength(1)
  })
})

describe('SYG232: submit dropped', () => {
  it('info for a submit while submitting; expectNoDiagnostics still passes', async () => {
    // G-575: only a submit that sends a request is pending (a local one is done at once)
    t = renderComponent(host(ok, {}, { model: { SAVE: { HTTP: (s, v) => ({ url: '/save', json: v, ok: 'form.DONE' }) } } }))
    await t.ready()
    t.simulateEvent('.f', 'submit'); await t.settle()
    t.simulateEvent('.f', 'submit'); await t.settle()
    const d = diagnostics('SYG232')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('info')
    expect(d[0].message).toMatch(/still being sent/)
    expect(t.requests('HTTP')).toHaveLength(1)
    t.expectNoDiagnostics()
  })
})

describe('SYG233: values key stripped by the schema', () => {
  it('warns once per key on a valid submit (zod strips undeclared keys)', async () => {
    const schema = z.object({ email: z.string() })
    t = renderComponent(host(schema, { values: { email: '', nickname: '' } }))
    await t.ready()
    t.simulateEvent('.f', 'submit'); await t.settle()
    const d = diagnostics('SYG233')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/values\.nickname is not in the schema's output \(stripped or renamed\)/)
    expect(t.emitted.at(-1).data).toEqual({ email: '' })
  })
  // 1-S G-377: a schema that reshapes its output (a key not in values) renames rather than strips:
  // not reported
  it('not for an output that has keys values lacks (a transform that renames)', async () => {
    const schema = z.object({ email: z.string(), nickname: z.string() }).transform(({ nickname, ...x }) => ({ ...x, handle: nickname }))
    t = renderComponent(host(schema, { values: { email: '', nickname: '' } }))
    await t.ready()
    t.simulateEvent('.f', 'submit'); await t.settle()
    expect(diagnostics('SYG233')).toEqual([])
    expect(t.emitted.at(-1).data).toEqual({ email: '', handle: '' })
  })
})

describe('SYG234: submit action', () => {
  it('no model entry for it', async () => {
    t = renderComponent(host(ok, { submit: 'SAVE_IT' }))
    await t.ready()
    const d = diagnostics('SYG234')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/dispatches 'SAVE_IT' on a valid submit, but C has no model entry 'SAVE_IT'/)
  })
  it("missing, or one of the form's own actions", async () => {
    t = renderComponent(host(ok, { submit: undefined }))
    await t.ready()
    expect(diagnostics('SYG234')[0].message).toMatch(/has no submit action/)
    t.dispose()
    setupChecks()
    t = renderComponent(host(ok, { submit: 'DONE' }, { model: { DONE: () => ({}) } }))
    await t.ready()
    expect(diagnostics('SYG234')[0].message).toMatch(/one of the form's own actions; the submit would dispatch 'form\.DONE'/)
  })
  it('a submit action with a sink suffix key counts', async () => {
    t = renderComponent(host(ok, {}, { model: { 'SAVE | EVENTS': (s, v) => ({ type: 'saved', data: v }) } }))
    await t.ready()
    expect(diagnostics('SYG234')).toEqual([])
  })
})

describe('SYG235: checks', () => {
  it('a check key not in values (on create)', async () => {
    t = renderComponent(host(ok, { check: { mail: { request: (v) => ({ url: '/x', query: { v } }) } } }))
    await t.ready()
    const d = diagnostics('SYG235')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/has a check for 'mail', which isn't a field of its values/)
  })
  it('a request that sets ok / error / latest (when it runs)', async () => {
    t = renderComponent(host(ok, { check: { email: { request: (v) => ({ url: '/x', query: { v }, ok: 'MINE', latest: false }) } } }))
    await t.ready()
    await type('email', 'a@b.c')
    t.simulateEvent('[name="email"]', 'focusout'); await t.settle()
    const d = diagnostics('SYG235')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/returns a request with 'ok', 'latest'/)
    expect(t.requests('HTTP').at(-1)).toMatchObject({ ok: 'form.CHECKED_email', latest: true })
  })
})

describe('SYG236: rows without an id', () => {
  it('names the array', async () => {
    t = renderComponent(host(ok, { values: { email: '', rows: [{ city: '' }], tags: ['a'] } }))
    await t.ready()
    const d = diagnostics('SYG236')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/values\.rows has rows without an id/)
  })
})

describe('the canonical signup form', () => {
  it('reports nothing with the dev entry on (strict)', async () => {
    t = renderComponent(SignupA, { strict: true })
    await t.ready()
    for (const [n, v] of [['name', 'Ada'], ['email', 'ada@example.com'], ['password', 'correct horse'], ['addresses.1.street', 'Elm'], ['addresses.1.city', 'Oslo']]) await type(n, v)
    t.simulateEvent('.signup', 'submit'); await t.settle()
    await t.respond('HTTP', { available: true }); await t.settle()
    expect(t.requests('HTTP').at(-1).url).toBe('/api/signup')
    expect(diagnostics().filter((d) => d.severity !== 'info')).toEqual([])
    t.expectNoDiagnostics()
    void signupSchema; void emptyValues; void CODE_SEVERITY
  })
})
