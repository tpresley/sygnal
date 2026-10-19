// PLAN-11 F-2: file fields in the form behavior. A file input's value is its File (`multiple`:
// an array, none: null), validated by the schema like any field; the submit's data carries the
// File, so the entry sends `multipart: data`; `progress: 'form.PROGRESS'` keeps the request's
// progress in the slice; `resets` counts start-overs (a file input keyed by it is cleared).
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { renderComponent, form, fieldNames } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  avatar: z.instanceof(File, { message: 'Choose a picture' }).refine((f) => f.size <= 10, 'At most 10 bytes'),
})

function Profile({ state }) {
  const f = state.form.fields
  return h('form', { className: 'profile' },
    h('input', { attrs: { name: 'name' }, props: { value: f.name.value } }),
    h('input', { key: 'avatar' + state.form.resets, attrs: { type: 'file', name: 'avatar' } }),
    h('p', { className: 'avatar-error' }, f.avatar.error),
    h('p', { className: 'progress' }, String(state.form.progress?.fraction ?? '')),
    h('button', { attrs: { type: 'submit' } }, 'Save'))
}
Profile.uses = { form: form(schema, { values: { name: '', avatar: null }, submit: 'SAVE', show: 'input' }) }
Profile.model = {
  SAVE: { HTTP: (state, data) => ({ url: '/api/profile', multipart: data, progress: 'form.PROGRESS', ok: 'form.DONE', error: 'form.ERRORS' }) },
}

let t
afterEach(() => { t?.dispose(); t = null })
const pick = async (files) => { t.simulateEvent('[name="avatar"]', 'input', { target: { files } }); await t.settle() }
const type = async (name, value) => { t.simulateEvent(`[name="${name}"]`, 'input', { value }); await t.settle() }

describe('form: file fields', () => {
  it('a File is a field (a leaf), not an object of fields', () => {
    const file = new File(['x'], 'a.png')
    expect(fieldNames({ avatar: file, docs: [file, file] })).toEqual(['avatar', 'docs', 'docs.0', 'docs.1'])
  })

  it('picking a file sets its value; the schema validates it; the submit data carries it to multipart', async () => {
    t = renderComponent(Profile, { strict: true })
    await t.ready()
    await type('name', 'Ada')
    await pick([new File(['too long a file'], 'big.png')])
    expect(t.state.form.values.avatar.name).toBe('big.png')
    expect(t.state.form.fields.avatar.error).toBe('At most 10 bytes')
    expect(t.state.form.dirty).toBe(true)
    const small = new File(['tiny'], 'me.png')
    await pick([small])
    expect(t.state.form.fields.avatar.error).toBe('')
    t.simulateEvent('.profile', 'submit')
    await t.settle()
    expect(t.state.form.submitting).toBe(true)
    const [req] = t.requests('HTTP')
    expect(req.multipart.name).toBe('Ada')
    expect(req.multipart.avatar).toBe(small)
    // progress while pending; cleared by DONE
    await t.progress('HTTP', { loaded: 2, total: 4 }, 'form.PROGRESS')
    expect(t.state.form.progress).toEqual({ phase: 'upload', loaded: 2, total: 4, fraction: 0.5 })
    expect(t.html()).toContain('<p class="progress">0.5</p>')
    await t.respond('HTTP', { ok: true }, 'form.DONE')
    expect(t.state.form).toMatchObject({ submitting: false, submitted: true, progress: null, dirty: false })
    t.expectNoDiagnostics()
  })

  it('removing the file (none picked) is null, and required shows its error', async () => {
    t = renderComponent(Profile)
    await t.ready()
    await pick([new File(['a'], 'a.png')])
    await pick([])
    expect(t.state.form.values.avatar).toBe(null)
    expect(t.state.form.fields.avatar.error).toBe('Choose a picture')
  })

  it('multiple: an array of Files', async () => {
    function Docs({ state }) {
      return h('form', null, h('input', { attrs: { type: 'file', name: 'docs', multiple: '' } }), h('p', null, String(state.form.values.docs.length)))
    }
    Docs.uses = { form: form(z.object({ docs: z.array(z.instanceof(File)).min(1) }), { values: { docs: [] }, submit: 'UP' }) }
    Docs.model = { UP: (s) => s }
    t = renderComponent(Docs)
    await t.ready()
    t.simulateEvent('[name="docs"]', 'input', { target: { files: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')] } })
    await t.settle()
    expect(t.state.form.values.docs.map((f) => f.name)).toEqual(['a.txt', 'b.txt'])
  })

  it('dirty compares files by identity (JSON would make every File {}); RESET counts resets and clears progress', async () => {
    const a = new File(['a'], 'a.png'), b = new File(['b'], 'b.png')
    function P() { return h('form', null, h('input', { attrs: { type: 'file', name: 'avatar' } })) }
    P.uses = { form: form(z.object({ avatar: z.any() }), { values: { avatar: a }, submit: 'S' }) }
    P.model = { S: (s) => s }
    t = renderComponent(P)
    await t.ready()
    expect(t.state.form.resets).toBe(0)
    await pick([b])
    expect(t.state.form.dirty).toBe(true)
    await pick([a])
    expect(t.state.form.dirty).toBe(false)
    t.simulateAction('form.RESET')
    await t.settle()
    expect(t.state.form).toMatchObject({ resets: 1, progress: null })
    expect(t.state.form.values.avatar).toBe(a)
  })

  it('a progress step when nothing is submitting is ignored', async () => {
    t = renderComponent(Profile)
    await t.ready()
    t.simulateAction('form.PROGRESS', { phase: 'upload', loaded: 1, total: 2, fraction: 0.5 })
    await t.settle()
    expect(t.state.form.progress).toBe(null)
  })
})
