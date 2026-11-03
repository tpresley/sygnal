// @vitest-environment jsdom
// RT-1 (dev-plans/research/forms/runtime-fields.md): fields chosen at run time. `dynamic:
// (hostState) => ({ path: start })` adds, reshapes and removes fields as the host's state changes
// (a removed one's value kept by default, `keepRemoved: false` drops it);
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

  it('keepRemoved: false: a field added later keeps what was typed in the others; one removed takes its value, touched and server errors along', async () => {
    t = renderComponent(make(schemaOf, { keepRemoved: false }))
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
    expect(t.state.form.kept).toEqual({})
  })

  it('by default a field removed keeps its value (initial as is: dirty); its touched and server errors go; it shows the value when it comes back', async () => {
    t = renderComponent(make())
    await t.ready()
    type('title', 'Trip')
    type('amount.amount', '0')
    t.simulateEvent('[name="amount.amount"]', 'focusout')
    await t.settle()
    t.simulateAction('form.ERRORS', { 'amount.currency': 'Not supported', '': 'Try again' })
    await t.settle()
    t.simulateAction('PIECES', [{ key: 'note', kind: 'note' }])
    await t.settle()
    expect(t.state.form.values).toEqual({ title: 'Trip', amount: { amount: '0', currency: 'USD' }, note: '' })
    expect(t.state.form.initial).toEqual({ title: '', amount: { amount: '', currency: 'USD' }, note: '' })
    expect(t.state.form.kept).toEqual({ amount: true })
    expect(t.state.form.added).toEqual({ note: '' })
    expect(t.state.form.touched).toEqual({})
    expect(t.state.form.server).toEqual({ '': 'Try again' })
    expect(t.state.form.errors).toEqual({})
    expect(t.state.form.fields['amount.amount'].dirty).toBe(true)
    // back: the kept value, validated again (its error shows once touched)
    t.simulateAction('PIECES', [{ key: 'amount', kind: 'amount' }, { key: 'note', kind: 'note' }])
    await t.settle()
    expect(t.state.form.kept).toEqual({})
    expect(t.state.form.values.amount).toEqual({ amount: '0', currency: 'USD' })
    expect(t.state.form.errors).toEqual({ 'amount.amount': 'Enter an amount' })
  })

  it('by default a kept field reshapes to the start value when it comes back', async () => {
    const shapes = { one: () => ({ start: '' }), range: () => ({ start: '', end: '' }) }
    function Dates() { return h('form', { className: 'f' }) }
    Dates.initialState = { mode: 'one' }
    Dates.uses = { form: form(z.any(), { form: '.f', values: {}, dynamic: (s) => (s.mode ? { when: shapes[s.mode]() } : {}), submit: 'SEND' }) }
    Dates.model = { MODE: (state, mode) => ({ ...state, mode }), SEND: (s) => s }
    t = renderComponent(Dates)
    await t.ready()
    t.simulateAction('form.SET', { values: { 'when.start': '2026-11-02' } })
    t.simulateAction('MODE', null)
    await t.settle()
    expect(t.state.form.values.when).toEqual({ start: '2026-11-02' })
    t.simulateAction('MODE', 'range')
    await t.settle()
    expect(t.state.form.values.when).toEqual({ start: '2026-11-02', end: '' })
  })

  it('a kept value is not validated, runs no check, and is not sent (the schema sees the fields on the form)', async () => {
    function C() { return h('form', { className: 'f' }) }
    C.initialState = { on: true, sent: null }
    const schema = z.object({ title: z.string(), note: z.string().min(1, 'Required').optional() }).loose()
    C.uses = { form: form(schema, { form: '.f', values: { title: '' }, dynamic: (s) => (s.on ? { note: '' } : {}), submit: 'SEND',
      check: { note: { request: (note) => ({ url: '/api/note', query: { note } }) } } }) }
    C.model = { OFF: (s) => ({ ...s, on: false }), SEND: (s, sent) => ({ ...s, sent }) }
    t = renderComponent(C)
    await t.ready()
    expect(t.state.form.errors).toEqual({ note: 'Required' })
    t.simulateAction('form.SET', { values: { note: 'x' } })
    await t.settle()
    t.simulateAction('OFF')
    await t.settle()
    expect(t.state.form.values).toEqual({ title: '', note: 'x' })
    t.simulateAction('form.SET', { values: { note: '' } })
    await t.settle()
    expect(t.state.form.errors).toEqual({})
    expect(t.state.form.valid).toBe(true)
    t.simulateEvent('.f', 'submit')
    await t.settle()
    expect(t.requests('HTTP')).toEqual([])
    expect(t.state.sent).toEqual({ title: '' })
    expect(t.state.form.values).toEqual({ title: '', note: '' })
  })

  it('SYG233 does not warn about a kept value the schema strips', async () => {
    t = renderComponent(make(schemaOf, {}, [{ key: 'note', kind: 'note' }]))
    await t.ready()
    type('note', 'n')
    t.simulateAction('PIECES', [])
    await t.settle()
    expect(t.state.form.values).toEqual({ title: '', note: 'n' })
    t.simulateEvent('.f', 'submit')
    await t.settle()
    expect(t.state.sent).toEqual({ title: '' })
    expect(diagnostics('SYG233')).toEqual([])
  })

  it('form.RESET drops the kept values (the dynamic fields start over)', async () => {
    t = renderComponent(make(schemaOf, {}, [{ key: 'note', kind: 'note' }, { key: 'amount', kind: 'amount' }]))
    await t.ready()
    type('note', 'n')
    type('amount.amount', '3')
    t.simulateAction('PIECES', [{ key: 'amount', kind: 'amount' }])
    await t.settle()
    expect(t.state.form.kept).toEqual({ note: true })
    t.simulateAction('form.RESET')
    await t.settle()
    expect(t.state.form.values).toEqual({ title: '', amount: { amount: '', currency: 'USD' } })
    expect(t.state.form.initial).toEqual(t.state.form.values)
    expect(t.state.form.kept).toEqual({})
    expect(t.state.form.dirty).toBe(false)
    t.simulateAction('PIECES', [{ key: 'amount', kind: 'amount' }, { key: 'note', kind: 'note' }])
    await t.settle()
    expect(t.state.form.values.note).toBe('')
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

describe('RT-1: review fixes', () => {
  it('a `values` function with dynamic fields: its start values and the dynamic ones', async () => {
    function C({ state }) { return h('form', {}, h('input', { name: 'email', value: state.form.values.email })) }
    C.initialState = { user: { email: 'a@b.c' }, on: true }
    C.uses = { form: form(z.any(), { values: (s) => ({ email: s.user.email }), dynamic: (s) => (s.on ? { note: 'n' } : {}), submit: 'S' }) }
    C.model = { S: (s) => s }
    t = renderComponent(C)
    await t.ready()
    await t.settle()
    expect(t.state.form.values).toEqual({ email: 'a@b.c', note: 'n' })
    expect(t.state.form.initial).toEqual({ email: 'a@b.c', note: 'n' })
    expect(t.state.form.dirty).toBe(false)
  })

  it('keepRemoved: false: a nested dynamic path that goes takes the parents it left empty along (an optional nested schema stays valid)', async () => {
    function C() { return h('form', {}) }
    C.initialState = { on: true }
    const schema = z.object({ keep: z.object({ x: z.string() }), a: z.object({ b: z.string().min(1, 'Required') }).optional() })
    C.uses = { form: form(schema, { values: { keep: { x: '' } }, dynamic: (s) => (s.on ? { 'a.b': '', 'keep.y': '' } : {}), keepRemoved: false, submit: 'S' }) }
    C.model = { OFF: (s) => ({ ...s, on: false }), S: (s) => s }
    t = renderComponent(C)
    await t.ready()
    expect(t.state.form.values).toEqual({ keep: { x: '', y: '' }, a: { b: '' } })
    expect(t.state.form.valid).toBe(false)
    t.simulateAction('OFF')
    await t.settle()
    expect(t.state.form.values).toEqual({ keep: { x: '' } })
    expect(t.state.form.initial).toEqual({ keep: { x: '' } })
    expect(t.state.form.valid).toBe(true)
  })

  it('a dynamic entry named after a static field leaves it alone (it stays when the entry goes)', async () => {
    function C({ state }) { return h('form', {}, h('input', { name: 'title', value: state.form.values.title })) }
    C.initialState = { on: true }
    C.uses = { form: form(z.any(), { values: { title: 'T', addr: { city: '' } }, dynamic: (s) => (s.on ? { title: '', addr: { zip: '' }, extra: '' } : {}), keepRemoved: false, submit: 'S' }) }
    C.model = { OFF: (s) => ({ ...s, on: false }), S: (s) => s }
    t = renderComponent(C)
    await t.ready()
    expect(t.state.form.values).toEqual({ title: 'T', addr: { city: '' }, extra: '' })
    type('title', 'typed')
    await t.settle()
    t.simulateAction('OFF')
    await t.settle()
    expect(t.state.form.values).toEqual({ title: 'typed', addr: { city: '' } })
    expect(t.state.form.initial).toEqual({ title: 'T', addr: { city: '' } })
  })

  it('SYG239: a schema memoized on the whole host state', async () => {
    const memo = new WeakMap()
    const onState = (state) => memo.get(state) ?? (memo.set(state, z.object({ title: z.string() }).loose()), memo.get(state))
    t = renderComponent(make(onState))
    await t.ready()
    type('title', 'x')
    t.simulateEvent('[name="title"]', 'focusout')
    await t.settle()
    expect(diagnostics('SYG239')).toHaveLength(1)
  })

  it('no SYG239 for a schema that follows the host state (rules changed with the same fields)', async () => {
    t = renderComponent(make(schemaOf, {}, [{ key: 'note', kind: 'note' }]))
    await t.ready()
    type('note', 'x')
    t.simulateEvent('[name="note"]', 'focusout')
    t.simulateAction('PIECES', [{ key: 'note', kind: 'note', required: true }])
    await t.settle()
    t.simulateEvent('.f', 'submit')
    await t.settle()
    expect(diagnostics('SYG239')).toEqual([])
  })

  it('the SYG239 check calls the schema function a second time only for the first host state', async () => {
    let calls = 0
    const counted = (state) => (calls++, schemaOf(state))
    t = renderComponent(make(counted))
    await t.ready()
    await t.settle()
    const start = calls
    type('title', 'abc')
    t.simulateEvent('[name="title"]', 'focusout')
    await t.settle()
    const after = calls - start
    // compare with production (no diagnostics hook): the same number of calls once started
    const hook = globalThis.__SYGNAL_DIAGNOSTICS__.form
    t.dispose(); t = null; calls = 0
    globalThis.__SYGNAL_DIAGNOSTICS__.form = undefined
    try {
      t = renderComponent(make(counted))
      await t.ready()
      await t.settle()
      const s2 = calls
      type('title', 'abc')
      t.simulateEvent('[name="title"]', 'focusout')
      await t.settle()
      expect(after).toBe(calls - s2)
      expect(start).toBe(s2 + 1)
    } finally { globalThis.__SYGNAL_DIAGNOSTICS__.form = hook }
  })
})
