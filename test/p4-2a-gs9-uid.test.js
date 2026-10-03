// @vitest-environment jsdom
// PLAN-4 2-A GS-9: uid(name?) — a stable id string per component instance, derived from its
// position (parent uid + child path or id + Collection item key), never from a counter, so
// renderToString and the client produce the same ids (SSR determinism gate).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import run from '../src/extra/run.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.ts'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { Switchable } from '../src/switchable.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 2000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}
// a valid HTML id that is also a plain CSS identifier (no escaping in #selectors)
const ID = /^[A-Za-z][\w-]*$/

let t
beforeEach(() => { setupChecks() })
afterEach(() => { t?.dispose(); t = null; vi.restoreAllMocks() })

// A field with a label, used at several depths
function Field({ uid, label }) {
  return h('p', null, h('label', { attrs: { for: uid('input') } }, label), h('input', { attrs: { id: uid('input') } }))
}
function Row({ state, uid }) {
  return h('li', { attrs: { id: uid() } }, state.text, h(Field, { label: state.text }))
}
function Form({ state, uid }) {
  return h('form', { attrs: { id: uid('form') } },
    h(Field, { label: 'name' }),
    h('div', null, h(Field, { label: 'email' })),
    h('ul', null, h(Collection, { of: Row, from: 'rows' })))
}
Form.initialState = { rows: [{ id: 'a1', text: 'one' }, { id: 7, text: 'two' }, { text: 'no id' }] }

const idsIn = (root) => [...root.querySelectorAll('[id]')].map(e => e.id)

describe('GS-9: uid', () => {
  it('is a view prop: uid() is the instance id, uid(name) a derived one; short, valid ids', async () => {
    const seen = []
    function App({ uid }) { seen.push([uid(), uid('title')]); return h('h1', { attrs: { id: uid('title') } }, 'x') }
    App.initialState = {}
    t = renderComponent(App)
    await t.ready()
    const [base, title] = seen[0]
    expect(title).toBe(base + '-title')
    expect(base).toMatch(ID)
    expect(base.length).toBeLessThanOrEqual(2)
  })

  it('is unique across nested children and Collection items, and every id is short and valid', async () => {
    t = renderComponent(Form, { dom: 'real' })
    await t.ready(); await t.settle()
    const ids = idsIn(t.container)
    expect(ids).toHaveLength(1 + 2 + 3 + 3) // form, 2 fields, 3 rows, a field per row
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(ID)
      expect(id.length).toBeLessThanOrEqual(20)
    }
    // labels point at their own input
    for (const label of t.container.querySelectorAll('label')) {
      expect(t.container.querySelector('#' + label.getAttribute('for'))).toBe(label.nextSibling)
    }
  })

  it('is deterministic (no global counter): a second app gets the same ids', async () => {
    t = renderComponent(Form, { dom: 'real' })
    await t.ready(); await t.settle()
    const first = idsIn(t.container)
    const t2 = renderComponent(Form, { dom: 'real' })
    await t2.ready(); await t2.settle()
    expect(idsIn(t2.container)).toEqual(first)
    t2.dispose()
  })

  it('is stable across re-renders, and moves with its Collection item when items are reordered', async () => {
    function List({ state }) { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }] }
    List.model = { REVERSE: (s) => ({ ...s, rows: [...s.rows].reverse() }), RENAME: (s) => ({ ...s, rows: s.rows.map(r => ({ ...r, text: r.text + '!' })) }) }
    t = renderComponent(List, { dom: 'real' })
    await t.ready(); await t.settle()
    const byText = () => Object.fromEntries([...t.container.querySelectorAll('li')].map(li => [li.firstChild.textContent.replace('!', ''), li.id]))
    const before = byText()
    t.simulateAction('RENAME'); await t.next(s => s.rows[0].text === 'a!'); await t.settle()
    expect(byText()).toEqual(before)
    t.simulateAction('REVERSE'); await t.next(s => s.rows[0].id === 3); await t.settle()
    expect([...t.container.querySelectorAll('li')].map(li => li.firstChild.textContent)).toEqual(['c!', 'b!', 'a!'])
    expect(byText()).toEqual(before)
  })

  it("is on the reducer's props (and EFFECT's), the same as the view's", async () => {
    let viewUid, reducerUid, effectUid
    function Child({ uid }) { viewUid = uid('x'); return h('span', null, 'c') }
    Child.model = {
      GO: { STATE: (s, d, next, props) => { reducerUid = props.uid('x'); return s }, EFFECT: (s, d, next, props) => { effectUid = props.uid('x') } },
    }
    Child.intent = ({ DOM }) => ({ GO: DOM.click('span') })
    function App() { return h('div', null, h(Child)) }
    App.initialState = {}
    t = renderComponent(App, { dom: 'real' })
    await t.ready(); await t.settle()
    t.simulateEvent('span', 'click'); await t.settle()
    expect(viewUid).toMatch(ID)
    expect(reducerUid).toBe(viewUid)
    expect(effectUid).toBe(viewUid)
  })

  it('differs per Switchable page', async () => {
    const got = {}
    function A({ uid }) { got.A = uid(); return h('p', null, 'a') }
    function B({ uid }) { got.B = uid(); return h('p', null, 'b') }
    function App({ state }) { return h('div', null, h(Switchable, { of: { A, B }, current: state.page })) }
    App.initialState = { page: 'A' }
    App.model = { FLIP: (s) => ({ ...s, page: 'B' }) }
    t = renderComponent(App, { dom: 'real' })
    await t.ready(); await t.settle()
    t.simulateAction('FLIP'); await t.next(s => s.page === 'B'); await t.settle()
    expect(got.A).toMatch(ID)
    expect(got.B).toMatch(ID)
    expect(got.A).not.toBe(got.B)
  })

  it('is a reserved prop: a parent passing uid gets SYG106, and the child sees its own uid()', async () => {
    let childUid
    function Child({ uid }) { childUid = uid; return h('span', null, 'c') }
    function App() { return h('div', null, h(Child, { uid: 'mine' })) }
    App.initialState = {}
    t = renderComponent(App)
    await t.ready(); await t.settle()
    expect(typeof childUid).toBe('function')
    expect(diagnostics('SYG106').map(d => d.data.prop)).toContain('uid')
  })
})

describe('GS-9: SSR determinism (renderToString ids = client ids after hydration)', () => {
  // Form's view as a child (Form itself has an initialState)
  function SubForm(props) { return Form(props) }
  function Page({ state, uid }) {
    return h('main', { attrs: { id: uid() } },
      h(SubForm, { state: 'form' }),
      h('section', null, h(Field, { id: 'named', label: 'with an id prop' })))
    // (no Switchable here: renderToString reads its components/active props, not of/current;
    // a pre-existing SSR gap outside GS-9)
  }
  Page.initialState = { form: Form.initialState }

  it('renderToString and run() produce the same ids', async () => {
    const html = renderToString(Page)
    const ssrIds = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1])
    expect(ssrIds.length).toBe(11)
    expect(new Set(ssrIds).size).toBe(ssrIds.length)

    document.body.innerHTML = `<div id="root">${html}</div>`
    const app = run(Page, {}, { mountPoint: '#root', diagnostics: 'off' })
    try {
      await until(() => document.querySelectorAll('#root [id]').length >= ssrIds.length && document.querySelector('#root li'), 'hydration')
      await sleep(50)
      expect(idsIn(document.querySelector('#root'))).toEqual(ssrIds)
    } finally {
      app.dispose()
    }
  })
})
