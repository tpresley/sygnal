// @vitest-environment jsdom
// PLAN-5 1-F item 5 (D194): focusWithin(selector), an ELEMENT target that lets a component focus
// an element inside its children (Collection items included). A plain `{ focus: '.x' }` is
// resolved in the sender's isolated scope and can't reach into a child. Built on the element
// command spec mechanism (D102): 0 B core.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, focusWithin, Collection, ABORT } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

function Row({ state }) { return h('li', { 'data-id': state.id }, h('input', { className: 'title', value: state.title })) }
Row.intent = ({ DOM }) => ({ TITLE: DOM.input('.title').value() })
Row.model = { TITLE: (s, title) => ({ ...s, title }) }

function Field({ state }) { return h('label', null, 'Email', h('input', { className: 'email', name: 'email', value: state.email ?? '' })) }

function List({ state }) {
  return h('div', null,
    h('button', { className: 'add' }, 'Add'),
    h('button', { className: 'first' }, 'First'),
    h(Field, { state: 'contact' }),
    h('ul', null, h(Collection, { of: Row, from: 'rows' })))
}
List.initialState = { rows: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }], contact: { email: '' }, next: 3 }
List.intent = ({ DOM }) => ({ ADD: DOM.click('.add'), FIRST: DOM.click('.first') })
List.model = {
  // add a row and focus its input: the new item renders in the same patch
  ADD: {
    STATE: (s) => ({ ...s, rows: [...s.rows, { id: s.next, title: '' }], next: s.next + 1 }),
    ELEMENT: (s) => ({ focus: focusWithin(`[data-id="${s.next}"] .title`) }),
  },
  FIRST: { ELEMENT: { focus: focusWithin('.email'), preventScroll: true } },
  // the isolated form can't reach it (for contrast)
  PLAIN: { ELEMENT: { focus: '.email' } },
  NONE: { ELEMENT: ABORT },
}

describe('focusWithin (D194)', () => {
  it('is a target object: its selector, a spec focus command, the root as the element it runs on', () => {
    const tg = focusWithin('.x')
    expect(tg.within).toBe('.x')
    expect(String(tg)).toBe('')
    expect(typeof tg.spec.commands.focus).toBe('function')
  })

  it('real DOM: focuses an element inside a child component', async () => {
    t = renderComponent(List, { dom: 'real' }); await t.ready()
    t.simulateEvent('.first', 'click'); await t.settle()
    await new Promise(r => setTimeout(r, 30))
    expect(document.activeElement).toBe(t.query('.email'))
  })

  it('real DOM: focuses an input inside a Collection item created by the same action', async () => {
    t = renderComponent(List, { dom: 'real' }); await t.ready()
    t.simulateEvent('.add', 'click'); await t.settle()
    await new Promise(r => setTimeout(r, 30))
    expect(document.activeElement).toBe(t.query('[data-id="3"] .title'))
  })

  it('real DOM: a plain selector stays in the sender\'s scope (focus does not move)', async () => {
    t = renderComponent(List, { dom: 'real' }); await t.ready()
    t.simulateAction('PLAIN'); await t.settle()
    await new Promise(r => setTimeout(r, 30))
    expect(document.activeElement).not.toBe(t.query('.email'))
  })

  it('passes the options to focus()', async () => {
    const calls = []
    const root = { matches: () => false, querySelector: (s) => (s === '.x' ? { focus: (o) => calls.push(o) } : null) }
    focusWithin('.x').spec.commands.focus(root, { preventScroll: true })
    expect(calls).toEqual([{ preventScroll: true }])
    // no match: nothing (no throw)
    expect(() => focusWithin('.y').spec.commands.focus(root, {})).not.toThrow()
  })

  it('mock DOM: recorded in t.commands(); no SYG640 when the selector is inside a child', async () => {
    t = renderComponent(List); await t.ready()
    t.simulateEvent('.first', 'click'); await t.settle()
    t.simulateEvent('.add', 'click'); await t.settle()
    expect(t.commands().map(c => c.focus.within)).toEqual(['.email', '[data-id="3"] .title'])
    expect(t.commands()[0].preventScroll).toBe(true)
    await new Promise(r => setTimeout(r, 1100))
    t.expectNoDiagnostics()
  }, 3000)

  it('mock DOM: SYG640 when nothing in the view (children included) matches', async () => {
    function Lonely() { return h('div', null, h('p', null, 'x')) }
    Lonely.model = { GO: { ELEMENT: { focus: focusWithin('.missing') } } }
    t = renderComponent(Lonely); await t.ready()
    t.simulateAction('GO'); await t.settle()
    await new Promise(r => setTimeout(r, 1100))
    const ds = t.diagnostics.map(d => d.code)
    expect(ds).toContain('SYG640')
  }, 3000)
})

describe('the element-commands guide sample (Checklist)', () => {
  function Row({ state }) {
    return h('li', { 'data-id': state.id }, h('input', { className: 'title', 'aria-label': 'Title', value: state.title }))
  }
  Row.intent = ({ DOM }) => ({ TITLE: DOM.input('.title').value() })
  Row.model = { TITLE: (state, title) => ({ ...state, title }) }
  function Checklist({ state }) {
    return h('div', null, h('button', { className: 'add' }, 'Add item'), h('ul', null, h(Collection, { of: Row, from: 'rows' })))
  }
  Checklist.initialState = { rows: [], next: 1 }
  Checklist.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
  Checklist.model = {
    ADD: {
      STATE: (state) => ({ ...state, rows: [...state.rows, { id: state.next, title: '' }], next: state.next + 1 }),
      ELEMENT: (state) => ({ focus: focusWithin(`[data-id="${state.next}"] .title`) }),
    },
  }
  it('each Add focuses the new row', async () => {
    t = renderComponent(Checklist, { dom: 'real' }); await t.ready()
    for (const id of [1, 2]) {
      t.simulateEvent('.add', 'click'); await t.settle()
      await new Promise(r => setTimeout(r, 30))
      expect(document.activeElement).toBe(t.query(`[data-id="${id}"] .title`))
    }
    t.expectNoDiagnostics()
  })
})
