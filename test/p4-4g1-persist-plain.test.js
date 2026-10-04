// @vitest-environment jsdom
// PLAN-4 4-G1 (D143, REPORT-v4 rec 3b): persist({ format: 'plain' }) stores the picked keys as
// they are, with no `{ version, state }` envelope (REPORT-v4 task 26: `{ title, body }` raw under
// `note-draft`; 5/5 adopters wrote a storage adapter to unwrap the envelope). `version` and
// `migrate` don't apply to it (a type error; ignored at runtime). A stored value that isn't an
// object is ignored, as an unreadable entry is.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { persist } from '../src/extra/persist.js'
import run from '../src/extra/run.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t, t2, app
afterEach(() => {
  t?.dispose(); t2?.dispose(); app?.dispose()
  t = t2 = app = null
  _resetDiagnostics()
  vi.restoreAllMocks()
  try { localStorage.clear() } catch (_) {}
  document.body.innerHTML = ''
})
const wait = (ms) => new Promise(r => setTimeout(r, ms))

const makeNote = (opts = {}) => {
  function Note({ state }) {
    return h('div', null,
      h('label', null, 'Title ', h('input', { className: 'title', value: state.title })),
      h('label', null, 'Body ', h('textarea', { className: 'body', value: state.body })),
      h('p', { className: 'status' }, state.status))
  }
  Note.initialState = { title: '', body: '', status: '' }
  Note.intent = ({ DOM }) => ({ TITLE: DOM.input('.title').value(), BODY: DOM.input('.body').value() })
  Note.model = {
    TITLE: (state, title) => ({ ...state, title }),
    BODY: (state, body) => ({ ...state, body }),
    DISCARD: { STATE: (state) => ({ ...state, title: '', body: '' }), PERSIST: { clear: true } },
  }
  Note.persist = persist({ key: 'note-draft', pick: ['title', 'body'], format: 'plain', ...opts })
  return Note
}

describe("persist({ format: 'plain' })", () => {
  it('task 26: saves { title, body } raw under note-draft (no envelope)', async () => {
    t = renderComponent(makeNote())
    await t.ready()
    t.simulateEvent('.title', 'input', { value: 'Groceries' })
    t.simulateEvent('.body', 'input', { value: 'milk' })
    await t.next(s => s.body === 'milk')
    await t.settle()
    expect(t.storage('note-draft')).toEqual({ title: 'Groceries', body: 'milk' })
  })

  it('restores from a plain stored value (only the picked keys)', async () => {
    t = renderComponent(makeNote(), { storage: { 'note-draft': { title: 'Saved', body: 'text', status: 'x' } } })
    await t.ready()
    expect(t.state).toEqual({ title: 'Saved', body: 'text', status: '' })
    expect(t.states[0]).toEqual({ title: 'Saved', body: 'text', status: '' })
    expect(t.html()).toContain('Saved')
  })

  it('an envelope stored by the default format is read as plain keys (nothing picked from it)', async () => {
    t = renderComponent(makeNote(), { storage: { 'note-draft': { version: 1, state: { title: 'Old' } } } })
    await t.ready()
    expect(t.state.title).toBe('')
  })

  it('version and migrate are ignored (no migrate call; the stored value is used as is)', async () => {
    const migrate = vi.fn(() => ({ title: 'migrated' }))
    t = renderComponent(makeNote({ version: 3, migrate }), { storage: { 'note-draft': { title: 'Kept', body: '' } } })
    await t.ready()
    expect(t.state.title).toBe('Kept')
    expect(migrate).not.toHaveBeenCalled()
    t.simulateAction('BODY', 'b')
    await t.next(s => s.body === 'b')
    await t.settle()
    expect(t.storage('note-draft')).toEqual({ title: 'Kept', body: 'b' })
  })

  it('a stored value that is not an object (an array, a number, a string) is ignored', async () => {
    for (const stored of [['a'], 5, '"text"']) {
      t = renderComponent(makeNote(), { storage: { 'note-draft': stored } })
      await t.ready()
      expect(t.state).toEqual({ title: '', body: '', status: '' })
      t.dispose(); t = null
    }
  })

  it('sync: another instance applies a plain write through RESTORE', async () => {
    const shared = {}
    t = renderComponent(makeNote({ sync: true }), { storage: shared })
    t2 = renderComponent(makeNote({ sync: true }), { storage: shared })
    await t.ready(); await t2.ready()
    t.simulateAction('TITLE', 'From tab 1')
    await t.settle()
    await t2.waitForState(s => s.title === 'From tab 1')
    expect(shared['note-draft']).toEqual({ title: 'From tab 1', body: '' })
    expect(t2.actions.map(a => a.type)).toContain('RESTORE')
  })

  it('PERSIST: { clear: true } removes the plain entry', async () => {
    t = renderComponent(makeNote(), { storage: { 'note-draft': { title: 'x', body: 'y' } } })
    await t.ready()
    t.simulateAction('DISCARD')
    await t.next(s => s.title === '')
    await t.settle()
    expect(t.storage('note-draft')).toBe(undefined)
  })

  it('real localStorage: the raw text is the JSON of the picked keys', async () => {
    localStorage.setItem('note-draft', JSON.stringify({ title: 'Restored', body: 'b' }))
    document.body.innerHTML = '<div id="root"></div>'
    const Note = makeNote({ debounceMs: 10 })
    app = run(Note, {}, { mountPoint: '#root' })
    await wait(40)
    expect(document.querySelector('.title').value).toBe('Restored')
    app.sources.STATE.stream.take(1).addListener({ next: () => {} })
    const input = document.querySelector('.body')
    input.value = 'new body'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(60)
    expect(localStorage.getItem('note-draft')).toBe('{"title":"Restored","body":"new body"}')
  })

  it("the default format is unchanged: { version, state }", async () => {
    t = renderComponent(makeNote({ format: undefined }))
    await t.ready()
    t.simulateAction('TITLE', 'T')
    await t.next(s => s.title === 'T')
    await t.settle()
    expect(t.storage('note-draft')).toEqual({ version: 1, state: { title: 'T', body: '' } })
  })
})
