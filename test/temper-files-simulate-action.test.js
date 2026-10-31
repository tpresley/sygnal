// @vitest-environment jsdom
// Temper feedback 2026-10, item 9: a file input in a test (the `files` shorthand, a FileList on the
// target; on the real DOM a target property the DOM rejects is defined on the element), a form's
// file field through a multipart submit with progress, and simulateAction's target (a name the
// instance doesn't handle fails the test; `{ component, within }` picks a child).
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, createElement as h, form, Collection } from '../src/index.ts'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = undefined
})
const csv = () => new File(['a,b'], 'agents.csv', { type: 'text/csv' })
const DOMS = [['mock DOM', {}], ['dom: real', { dom: 'real' }]]

function Start({ state }) {
  return h('div', null, h('input', { type: 'file', className: 'infer-file', multiple: true }), h('p', { className: 'name' }, state.fileName || ''))
}
Start.intent = ({ DOM }) => ({ INFER_FILE: DOM.select('.infer-file').events('change').map((e) => e.target.files?.[0]) })
Start.model = {
  INFER_FILE: (s, f) => ({ ...s, fileName: f ? f.name : 'none' }),
  RESET: (s) => ({ ...s, fileName: '' }),
}
function Wizard({ state }) { return h('div', null, h(Start, { state: 'start' })) }
Wizard.initialState = { start: {} }
Wizard.model = { NEXT: (s) => s }

describe.each(DOMS)('a file input (%s)', (_, opts) => {
  it('{ files } sets the target\'s files, a FileList-like with item()', async () => {
    t = renderComponent(Wizard, opts)
    await t.ready()
    await t.simulateEvent('.infer-file', 'change', { files: [csv()] })
    expect(t.state.start.fileName).toBe('agents.csv')
    expect(t.query('.name').textContent).toBe('agents.csv')
  })

  it('{ target: { files } } works the same', async () => {
    t = renderComponent(Wizard, opts)
    await t.ready()
    await t.simulateEvent('.infer-file', 'change', { target: { files: [csv()] } })
    expect(t.state.start.fileName).toBe('agents.csv')
  })
})

it('dom: real: the input holds the files (item(), length), as the browser would show them', async () => {
  t = renderComponent(Wizard, { dom: 'real' })
  await t.ready()
  const b = new File(['x'], 'b.csv')
  await t.simulateEvent('.infer-file', 'change', { files: [csv(), b] })
  const el = t.container.querySelector('.infer-file')
  expect(el.files.length).toBe(2)
  expect(el.files.item(1)).toBe(b)
  expect([...el.files].map((f) => f.name)).toEqual(['agents.csv', 'b.csv'])
})

it('dom: real: a property the element rejects twice fails the test, naming it', async () => {
  t = renderComponent(Wizard, { dom: 'real' })
  await t.ready()
  Object.preventExtensions(t.container.querySelector('.infer-file'))
  t.simulateEvent('.infer-file', 'change', { files: [csv()] })
  await expect(t.settle()).rejects.toThrow(/can't set files on the <input>/)
})

const schema = { '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) } }
function Upload({ state }) {
  return h('form', null,
    h('input', { type: 'file', name: 'avatar' }),
    h('button', { type: 'submit' }, 'Send'),
    h('p', { className: 'pct' }, state.form.progress ? `${Math.round(state.form.progress.fraction * 100)}%` : ''))
}
Upload.initialState = {}
Upload.uses = { form: form(schema, { values: { avatar: null }, request: { url: '/api/avatar' } }) }

describe.each(DOMS)('a form file field through submit (%s)', (_, opts) => {
  it('the File goes as multipart; t.progress moves state.form.progress; t.respond ends it', async () => {
    t = renderComponent(Upload, opts)
    await t.ready()
    const f = csv()
    await t.simulateEvent('[name="avatar"]', 'input', { files: [f] })
    expect(t.state.form.values.avatar).toBe(f)
    await t.simulateEvent('form', 'submit')
    const req = t.requests('HTTP').at(-1)
    expect(req).toMatchObject({ url: '/api/avatar', progress: 'form.PROGRESS' })
    expect(req.multipart.avatar).toBe(f)
    expect(req.json).toBeUndefined()
    await t.progress('HTTP', { loaded: 1, total: 4 }, 'form.PROGRESS')
    expect(t.state.form.progress).toMatchObject({ phase: 'upload', loaded: 1, total: 4, fraction: 0.25 })
    expect(t.query('.pct').textContent).toBe('25%')
    await t.respond('HTTP', { id: 7 }, 'form.DONE')
    expect(t.state.form.submitting).toBe(false)
    expect(t.state.form.progress).toBeNull()
  })
})

describe('simulateAction: the target', () => {
  it("a name the rendered component doesn't handle fails at the call, naming who does", async () => {
    t = renderComponent(Wizard)
    await t.ready()
    expect(() => t.simulateAction('INFER_FILE', csv())).toThrow(/Wizard has no model entry 'INFER_FILE'.*Start handles it: t\.simulateAction\('INFER_FILE', data, \{ component: Start \}\)/)
    expect(() => t.simulateAction('NOPE')).toThrow(/No rendered component handles it/)
  })

  it('before the component is ready, the failure rejects the next wait', async () => {
    t = renderComponent(Wizard)
    t.simulateAction('INFER_FILE', csv())
    await expect(t.settle()).rejects.toThrow(/Wizard has no model entry 'INFER_FILE'/)
  })

  it('{ component } sends it to the first instance of that component (or its name)', async () => {
    t = renderComponent(Wizard)
    await t.ready()
    t.simulateAction('INFER_FILE', csv(), { component: Start })
    await t.settle()
    expect(t.state.start.fileName).toBe('agents.csv')
    t.simulateAction('RESET', undefined, { component: 'Start' })
    await t.settle()
    expect(t.state.start.fileName).toBe('')
    // the root's own actions and built-ins still need no option
    t.simulateAction('NEXT')
    t.simulateAction('BOOTSTRAP')
    await t.settle()
    expect(() => t.simulateAction('NEXT', undefined, { component: Start })).toThrow(/Start has no model entry 'NEXT'.*Wizard handles it/)
    expect(() => t.simulateAction('RESET', undefined, { component: Upload })).toThrow(/no rendered instance of Upload\. Rendered: Wizard, Start/)
  })

  it('{ component, within } picks one Collection item', async () => {
    function Row({ state }) { return h('li', { className: 'row', attrs: { 'data-id': String(state.id) } }, state.name) }
    Row.model = { RENAME: (s, name) => ({ ...s, name }) }
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] }
    t = renderComponent(List)
    await t.ready()
    t.simulateAction('RENAME', 'B!', { component: Row, within: '[data-id="2"]' })
    await t.settle()
    expect(t.state.rows.map((r) => r.name)).toEqual(['a', 'B!'])
    t.simulateAction('RENAME', 'A!', { component: Row })
    await t.settle()
    expect(t.state.rows.map((r) => r.name)).toEqual(['A!', 'B!'])
    expect(() => t.simulateAction('RENAME', 'x', { component: Row, within: '[data-id="9"]' })).toThrow(/nothing rendered matches within/)
  })
})
