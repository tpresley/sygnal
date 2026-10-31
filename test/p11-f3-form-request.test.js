// PLAN-11 F-3: form(schema, { request }) sends a valid submit itself on the `http` sink, with
// the body (json, or multipart when the data has a File; progress: 'form.PROGRESS' only for multipart
// or `progress: true`: a progress request goes over XMLHttpRequest) and its own
// ok: 'form.DONE' / error: 'form.ERRORS'. No host model entry needed; `submit` stays optional.
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { renderComponent, form, ABORT } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

const schema = z.object({ title: z.string().trim().min(1, 'Required'), photo: z.instanceof(File).nullable() })

const view = ({ state }) => h('form', { className: 'f' },
  h('input', { attrs: { name: 'title' }, props: { value: state.form.fields.title.value } }),
  h('input', { attrs: { type: 'file', name: 'photo' } }),
  h('p', { className: 'err' }, state.form.fields.title.error || state.form.error),
  h('button', { attrs: { type: 'submit' } }, 'Save'))

const make = (opts, model) => {
  const C = (p) => view(p)
  C.initialState = { id: 7, saved: null }
  C.uses = { form: form(schema, { values: { title: '', photo: null }, ...opts }) }
  if (model) C.model = model
  return C
}

let t
afterEach(() => { t?.dispose(); t = null; _resetDiagnostics() })
const type = async (v) => { t.simulateEvent('[name="title"]', 'input', { value: v }); await t.settle() }
const submit = async () => { t.simulateEvent('.f', 'submit'); await t.settle() }

describe('form request option', () => {
  it('a JSON submit: no model entry; form.DONE / form.ERRORS / form.PROGRESS wired', async () => {
    t = renderComponent(make({ request: { url: '/api/items' } }), { strict: true })
    await t.ready()
    await type('  Hello ')
    await submit()
    const [req] = t.requests('HTTP')
    expect(req).toMatchObject({ url: '/api/items', json: { title: 'Hello', photo: null }, ok: 'form.DONE', error: 'form.ERRORS' })
    expect(req.progress).toBe(undefined)
    expect(t.state.form.submitting).toBe(true)
    await t.respond('HTTP', { id: 1 }, 'form.DONE')
    expect(t.state.form).toMatchObject({ submitting: false, submitted: true })
    t.expectNoDiagnostics()
  })

  it('a File in the data makes it multipart; server errors land on the fields', async () => {
    t = renderComponent(make({ request: { url: '/api/items' } }))
    await t.ready()
    await type('Pic')
    const file = new File(['x'], 'p.png')
    t.simulateEvent('[name="photo"]', 'input', { target: { files: [file] } })
    await t.settle()
    await submit()
    const [req] = t.requests('HTTP')
    expect(req.json).toBe(undefined)
    expect(req.multipart).toEqual({ title: 'Pic', photo: file })
    expect(req.progress).toBe('form.PROGRESS')
    await t.progress('HTTP', { loaded: 1, total: 2 }, 'form.PROGRESS')
    expect(t.state.form.progress.fraction).toBe(0.5)
    await t.fail('HTTP', 422, { body: { errors: { title: 'Taken' } } })
    expect(t.state.form).toMatchObject({ submitting: false, progress: null })
    expect(t.state.form.fields.title.error).toBe('Taken')
  })

  it('a function of the data and the host state; its own fields pass through; ABORT sends nothing', async () => {
    t = renderComponent(make({ request: (data, state) => (data.title == 'skip' ? ABORT : { url: `/api/items/${state.id}`, method: 'PUT', timeoutMs: 5000, json: { name: data.title } }) }))
    await t.ready()
    await type('Renamed')
    await submit()
    expect(t.requests('HTTP')[0]).toMatchObject({ url: '/api/items/7', method: 'PUT', timeoutMs: 5000, json: { name: 'Renamed' }, ok: 'form.DONE' })
  })

  it('with submit too, the host action is dispatched as well (for state)', async () => {
    t = renderComponent(make({ request: { url: '/api/items' }, submit: 'NOTE' }, { NOTE: (s, data) => ({ ...s, saved: data.title }) }))
    await t.ready()
    await type('Both')
    await submit()
    expect(t.state.saved).toBe('Both')
    expect(t.requests('HTTP')).toHaveLength(1)
    expect(t.state.form.submitting).toBe(true)
  })

  it('an invalid submit sends nothing', async () => {
    t = renderComponent(make({ request: { url: '/api/items' } }))
    await t.ready()
    await submit()
    expect(t.requests('HTTP')).toHaveLength(0)
    expect(t.state.form.fields.title.error).toBe('Required')
  })

  it('SYG234 is not reported for a form with a request and no submit; it is without either', async () => {
    setupChecks()
    t = renderComponent(make({ request: { url: '/api/items' } }))
    await t.ready()
    expect(diagnostics('SYG234')).toEqual([])
    t.dispose()
    setupChecks()
    t = renderComponent(make({}))
    await t.ready()
    expect(diagnostics('SYG234')[0].message).toMatch(/has no submit action and no request/)
  })
})
