// @vitest-environment jsdom
// RT-1 (dev-plans/research/forms/runtime-fields.md): fields chosen at run time. `dynamic:
// (hostState) => ({ path: start })` adds, reshapes and removes fields as the host's state changes;
// `form((state) => schema, …)` validates with rules that depend on the host's state (required-ness
// from what is composed).
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { z } from 'zod'
import { renderComponent, form } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

beforeEach(() => setupChecks())
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

// a form composed from pieces: { key, kind, required? } in state.pieces
const START = { amount: () => ({ amount: '', currency: 'USD' }), note: () => '' }
const dynamic = (state) => Object.fromEntries(state.pieces.map((p) => [p.key, START[p.kind]()]))
const RULES = {
  amount: (p) => z.object({ amount: z.coerce.number().positive('Enter an amount'), currency: z.string() }),
  note: (p) => (p.required ? z.string().min(1, 'Required') : z.string()),
}
// memoized on the pieces array (the same rules for the same composition: no SYG239)
const memo = new WeakMap()
const schemaOf = (state) => {
  if (!memo.has(state.pieces)) memo.set(state.pieces, z.object({ title: z.string(), ...Object.fromEntries(state.pieces.map((p) => [p.key, RULES[p.kind](p)])) }))
  return memo.get(state.pieces)
}

function piece(state, p) {
  const f = state.form.fields
  if (p.kind == 'note') return h('input', { name: p.key, value: f[p.key]?.value ?? '' })
  return h('div', {}, h('input', { name: `${p.key}.amount`, value: f[`${p.key}.amount`]?.value ?? '' }),
    h('span', { className: `err-${p.key}` }, f[`${p.key}.amount`]?.error ?? ''),
    h('select', { name: `${p.key}.currency` }, h('option', { value: 'USD' }, 'USD'), h('option', { value: 'EUR' }, 'EUR')))
}

function make(schema = schemaOf, options = {}, pieces = [{ key: 'amount', kind: 'amount' }]) {
  function Composed({ state }) {
    return h('form', { className: 'f' }, h('input', { name: 'title', value: state.form.values.title }), ...state.pieces.map((p) => piece(state, p)))
  }
  Composed.initialState = { pieces, sent: null }
  Composed.uses = { form: form(schema, { form: '.f', values: { title: '' }, dynamic, submit: 'SEND', ...options }) }
  Composed.model = {
    PIECES: (state, pieces) => ({ ...state, pieces }),
    SEND: (state, sent) => ({ ...state, sent }),
  }
  return Composed
}

const type = (name, value) => t.simulateEvent(`[name="${name}"]`, 'input', { value })

describe('RT-1: dynamic fields', () => {
  it('adds the fields the host state names, at their start values (in initial too: not dirty)', async () => {
    t = renderComponent(make())
    await t.ready()
    expect(t.state.form.values).toEqual({ title: '', amount: { amount: '', currency: 'USD' } })
    expect(t.state.form.initial).toEqual(t.state.form.values)
    expect(t.state.form.dirty).toBe(false)
    expect(Object.keys(t.state.form.fields)).toEqual(['title', 'amount.amount', 'amount.currency'])
    type('amount.amount', '12')
    await t.settle()
    expect(t.state.form.values.amount).toEqual({ amount: '12', currency: 'USD' })
    expect(t.state.form.fields['amount.amount'].dirty).toBe(true)
    expect(diagnostics('SYG230')).toEqual([])
  })

  it('a field is in `fields` in the first render after the state that adds it (no guard needed in views)', async () => {
    const seen = []
    function Lines({ state }) {
      for (const k of state.lines) seen.push(state.form.fields[k] ? k : 'missing ' + k)
      return h('form', {}, ...state.lines.map((k) => h('input', { name: k, value: state.form.fields[k].value })))
    }
    Lines.initialState = { lines: ['a'] }
    Lines.uses = { form: form(z.any(), { values: {}, dynamic: (s) => Object.fromEntries(s.lines.map((k) => [k, ''])), submit: 'S' }) }
    Lines.model = { ADD: (s) => ({ ...s, lines: [...s.lines, 'b'] }), S: (s) => s }
    t = renderComponent(Lines)
    await t.ready()
    t.simulateAction('ADD')
    await t.settle()
    expect(seen.filter((x) => x.startsWith('missing'))).toEqual([])
    expect(seen).toContain('b')
  })

  it('a piece that repeats has its own values under its key', async () => {
    t = renderComponent(make(schemaOf, {}, [{ key: 'amount', kind: 'amount' }, { key: 'amount~2', kind: 'amount' }]))
    await t.ready()
    type('amount.amount', '900')
    type('amount~2.amount', '250')
    t.simulateEvent('[name="amount~2.currency"]', 'input', { value: 'EUR' })
    await t.settle()
    expect(t.state.form.values).toMatchObject({ amount: { amount: '900', currency: 'USD' }, 'amount~2': { amount: '250', currency: 'EUR' } })
  })

  it('a field added later keeps what was typed in the others; one removed takes its value, touched and server errors along', async () => {
    t = renderComponent(make())
    await t.ready()
    type('title', 'Trip')
    type('amount.amount', '0')
    t.simulateEvent('[name="amount.amount"]', 'focusout')
    await t.settle()
    t.simulateAction('form.ERRORS', { 'amount.currency': 'Not supported', '': 'Try again' })
    await t.settle()
    expect(t.state.form.errors).toEqual({ 'amount.amount': 'Enter an amount' })

    t.simulateAction('PIECES', [{ key: 'amount', kind: 'amount' }, { key: 'note', kind: 'note' }])
    await t.settle()
    expect(t.state.form.values).toEqual({ title: 'Trip', amount: { amount: '0', currency: 'USD' }, note: '' })
    expect(t.state.form.touched).toEqual({ 'amount.amount': true })

    t.simulateAction('PIECES', [{ key: 'note', kind: 'note' }])
    await t.settle()
    expect(t.state.form.values).toEqual({ title: 'Trip', note: '' })
    expect(t.state.form.initial).toEqual({ title: '', note: '' })
    expect(t.state.form.touched).toEqual({})
    expect(t.state.form.server).toEqual({ '': 'Try again' })
    // the schema follows the composition: the amount's error is gone
    expect(t.state.form.errors).toEqual({})
    expect(t.state.form.valid).toBe(true)
  })

  it('a start value that changes shape reshapes the entry: new keys added, gone ones dropped, typed ones kept', async () => {
    const shapes = { one: () => ({ start: '' }), range: () => ({ start: '', end: '' }) }
    function Dates({ state }) {
      return h('form', { className: 'f' }, h('input', { name: 'when.start', value: state.form.values.when?.start ?? '' }))
    }
    Dates.initialState = { mode: 'one' }
    Dates.uses = { form: form(z.any(), { form: '.f', values: {}, dynamic: (s) => ({ when: shapes[s.mode]() }), submit: 'SEND' }) }
    Dates.model = { MODE: (state, mode) => ({ ...state, mode }), SEND: (s) => s }
    t = renderComponent(Dates)
    await t.ready()
    type('when.start', '2026-11-02')
    await t.settle()
    t.simulateAction('MODE', 'range')
    await t.settle()
    expect(t.state.form.values.when).toEqual({ start: '2026-11-02', end: '' })
    t.simulateAction('MODE', 'one')
    await t.settle()
    expect(t.state.form.values.when).toEqual({ start: '2026-11-02' })
  })

  it('form.SET (an AI fill) reaches the dynamic fields; an unknown name is still SYG230', async () => {
    t = renderComponent(make())
    await t.ready()
    t.simulateAction('form.SET', { values: { 'amount.amount': '40', 'amount.currency': 'EUR', 'nope.amount': '1' } })
    await t.settle()
    expect(t.state.form.values.amount).toEqual({ amount: '40', currency: 'EUR' })
    expect(diagnostics('SYG230')).toHaveLength(1)
  })

  it('form.RESET starts the dynamic fields over too; they stay on the form', async () => {
    t = renderComponent(make())
    await t.ready()
    type('amount.amount', '5')
    t.simulateEvent('[name="amount.currency"]', 'input', { value: 'EUR' })
    await t.settle()
    t.simulateAction('form.RESET')
    await t.settle()
    expect(t.state.form.values).toEqual({ title: '', amount: { amount: '', currency: 'USD' } })
    // RESET with whole values: the dynamic fields the host state names are added back at their start
    t.simulateAction('form.RESET', { title: 'Again' })
    await t.settle()
    expect(t.state.form.values).toEqual({ title: 'Again', amount: { amount: '', currency: 'USD' } })
  })
})

describe('RT-1: a schema of the host state', () => {
  it('required-ness follows the composition: the submit is blocked by a piece that is there, not by one that went', async () => {
    t = renderComponent(make(schemaOf, {}, [{ key: 'note', kind: 'note', required: true }]))
    await t.ready()
    t.simulateEvent('.f', 'submit')
    await t.settle()
    expect(t.state.sent).toBe(null)
    expect(t.state.form.fields.note.error).toBe('Required')
    expect(t.state.form.submitted).toBe(false)
    t.simulateAction('PIECES', [{ key: 'amount', kind: 'amount' }])
    await t.settle()
    type('amount.amount', '30')
    await t.settle()
    t.simulateEvent('.f', 'submit')
    await t.settle()
    // the output is the schema's: coerced, with the dynamic values under their keys
    expect(t.state.sent).toEqual({ title: '', amount: { amount: 30, currency: 'USD' } })
  })

  it('a schema change with the same fields re-validates (an optional piece made required)', async () => {
    t = renderComponent(make(schemaOf, {}, [{ key: 'note', kind: 'note' }]))
    await t.ready()
    expect(t.state.form.valid).toBe(true)
    t.simulateAction('PIECES', [{ key: 'note', kind: 'note', required: true }])
    await t.settle()
    expect(t.state.form.valid).toBe(false)
    expect(t.state.form.errors).toEqual({ note: 'Required' })
  })

  it('an async schema function: a result for a schema the state no longer gives is dropped', async () => {
    let calls = 0
    const asyncMemo = new WeakMap()
    const slow = (state) => {
      if (!asyncMemo.has(state.pieces)) {
        const inner = schemaOf(state)
        asyncMemo.set(state.pieces, { '~standard': { version: 1, vendor: 'test', validate: (v) => (calls++, new Promise((r) => setTimeout(() => r(inner['~standard'].validate(v)), 10))) } })
      }
      return asyncMemo.get(state.pieces)
    }
    t = renderComponent(make(slow, {}, [{ key: 'note', kind: 'note' }]))
    await t.ready()
    await t.waitForState((s) => s.form.validated)
    expect(t.state.form.valid).toBe(true)
    t.simulateAction('PIECES', [{ key: 'note', kind: 'note', required: true }])
    await t.waitForState((s) => s.form.validated && !s.form.validating && !s.form.valid)
    expect(t.state.form.errors).toEqual({ note: 'Required' })
    t.simulateEvent('.f', 'submit')
    await t.waitForState((s) => s.form.submitCount == 1 && !s.form.queued)
    expect(t.state.sent).toBe(null)
    expect(calls).toBeGreaterThan(1)
  })

  it('SYG239: a schema function that builds a new schema each call', async () => {
    t = renderComponent(make((state) => z.object({ title: z.string() }).loose()))
    await t.ready()
    type('title', 'x')
    await t.settle()
    expect(diagnostics('SYG239')).toHaveLength(1)
    expect(diagnostics('SYG231')).toEqual([])
  })

  it('a memoized schema function: no SYG239', async () => {
    t = renderComponent(make())
    await t.ready()
    type('title', 'x')
    await t.settle()
    expect(diagnostics('SYG239')).toEqual([])
  })

  it('a schema function that returns something that is not a Standard Schema: SYG231 (the form never validates)', async () => {
    const bad = { parse() {} }
    t = renderComponent(make(() => bad))
    await t.ready()
    await t.settle()
    expect(t.state.form.validated).toBe(false)
    // the reducer throws the SYG231 error (reported as SYG216, state unchanged)
    expect(diagnostics('SYG216').map((d) => String(d.data?.error?.message ?? d.error?.message ?? JSON.stringify(d)))).toEqual(expect.arrayContaining([expect.stringMatching(/SYG231/)]))
  })
})
