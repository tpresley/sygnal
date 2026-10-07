// @vitest-environment jsdom
// PLAN-5 4-H2 (D238): the two rules the skill and llms.txt state for pages of a Switchable (the
// eval task 41 / 43 shapes, where Haiku failed on the mod tier):
// - Resources: a page that reads state.X from a resource declares it in its own `.resources`.
//   Without it, state.X is undefined on a direct visit (or whatever another page loaded last);
//   a test that starts on the page that declares it hides this. With a queryCache() the second
//   declaration shows the cached data at once.
// - Forms: a `uses: { form }` slice lives in the host's state; a Switchable page shares its
//   parent's, so the values survive leaving the page and coming back (even with `instance=`,
//   which re-creates the page). "Starts empty on each visit" is the form's `resetOnShow: true`
//   (4-G2, D239; it replaced the hand-written STATE.watch to form.RESET the rule showed first).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import { renderComponent, form, queryCache, Switchable } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

const ITEMS = [{ id: 1 }, { id: 2 }, { id: 3 }]

/** the app: two pages over the root's state, re-created per visit (`instance`), as a router app */
const app = (pages, initialState = {}) => {
  function App({ state }) {
    return h('main', {}, h(Switchable, { of: pages, current: state.page, instance: state.page + state.visit }))
  }
  App.initialState = { page: 'list', visit: 0, ...initialState }
  App.model = { GO: (state, page) => ({ ...state, page, visit: state.visit + 1 }) }
  return App
}

function ListPage({ state }) {
  return h('p', { className: 'list' }, state.items.status === 'success' ? `${state.items.data.length} items` : 'Loading…')
}
ListPage.resources = { items: () => '/api/items' }

const count = (state) => state.items === undefined ? 'no data'
  : state.items.status === 'success' ? `Total: ${state.items.data.length}` : `(${state.items.status})`

/** reads state.items without declaring it (the trap) */
function SummaryNoDecl({ state }) { return h('p', { className: 'total' }, count(state)) }

/** declares the same request itself (the rule) */
function Summary({ state }) { return h('p', { className: 'total' }, count(state)) }
Summary.resources = { items: () => '/api/items' }

const text = (sel) => t.query(sel)?.textContent

describe('a page reads a resource it declares in its own .resources', () => {
  it('without its own declaration, a direct visit has no data and sends no request', async () => {
    t = renderComponent(app({ list: ListPage, summary: SummaryNoDecl }, { page: 'summary' }))
    await t.ready()
    expect(t.state.items).toBeUndefined()
    expect(text('.total')).toBe('no data')
    expect(t.requests('HTTP')).toHaveLength(0)
  })

  it('a test that starts on the declaring page hides it', async () => {
    t = renderComponent(app({ list: ListPage, summary: SummaryNoDecl }))
    await t.ready()
    await t.respond('HTTP', ITEMS, 'items')
    expect(text('.list')).toBe('3 items')
    t.simulateAction('GO', 'summary')
    await t.settle()
    expect(text('.total')).toBe('Total: 3')   // only because the list page loaded it first
  })

  it('with its own declaration, a direct visit loads the data', async () => {
    t = renderComponent(app({ list: ListPage, summary: Summary }, { page: 'summary' }))
    await t.ready()
    expect(text('.total')).toBe('(loading)')
    await t.respond('HTTP', ITEMS, 'items')
    expect(text('.total')).toBe('Total: 3')
  })

  it('declared on both pages with a queryCache(): the second page shows the cached data at once', async () => {
    t = renderComponent(app({ list: ListPage, summary: Summary }), { http: { cache: queryCache() } })
    await t.ready()
    await t.respond('HTTP', ITEMS, 'items')
    t.simulateAction('GO', 'summary')
    await t.settle()
    expect(text('.total')).toBe('Total: 3')
    expect(t.state.items.refreshing).toBe(true)   // a background refetch (staleTime 0)
  })
})

const EMPTY = { title: '' }
const schema = {
  '~standard': { version: 1, vendor: 't', validate: (v) => (v.title ? { value: v } : { issues: [{ message: 'Required', path: ['title'] }] }) },
}

function Home() { return h('p', { className: 'home' }, 'Home') }

// the form pages run in a router-shaped app: state.route.name is the page's name
const formApp = (AddPage) => {
  const App = app({ home: Home, newItem: AddPage }, { page: 'home', route: { name: 'home' } })
  App.model = { GO: (state, page) => ({ ...state, page, route: { name: page }, visit: state.visit + 1 }) }
  return App
}
const SNIPPET = "form(schema, { values: EMPTY, submit: 'SAVE', resetOnShow: true })"
const LLMS_SNIPPET = "values: (state) => ({ ...EMPTY, category: state.settings.defaultCategory })"

const addPage = (reset) => {
  function AddPage({ state }) {
    return h('form', { className: 'f' }, h('input', { name: 'title', value: state.form.fields.title.value }), h('button', { type: 'submit' }, 'Add'))
  }
  // the rule's snippet: each time the page is shown, the form starts empty
  AddPage.uses = { form: reset ? form(schema, { values: EMPTY, submit: 'SAVE', resetOnShow: true }) : form(schema, { values: EMPTY, submit: 'SAVE' }) }
  AddPage.model = { SAVE: (state, values) => ({ ...state, added: [...(state.added || []), values.title] }) }
  return AddPage
}

const visitAndType = async (value) => {
  t.simulateAction('GO', 'newItem')
  await t.settle()
  t.simulateEvent('[name="title"]', 'input', { value })
  await t.settle()
}

describe('a form on a Switchable page keeps its values across visits', () => {
  it('without a reset, the values come back on the next visit (they live in the parent state)', async () => {
    t = renderComponent(formApp(addPage(false)))
    await t.ready()
    await visitAndType('Lunch')
    t.simulateAction('GO', 'home')
    await t.settle()
    expect(t.state.form.values.title).toBe('Lunch')
    t.simulateAction('GO', 'newItem')
    await t.settle()
    expect(t.query('[name="title"]').value).toBe('Lunch')
  })

  it('with resetOnShow, each visit starts empty', async () => {
    t = renderComponent(formApp(addPage(true)))
    await t.ready()
    await visitAndType('Lunch')
    t.simulateAction('GO', 'home')
    await t.settle()
    t.simulateAction('GO', 'newItem')
    await t.settle()
    expect(t.state.form.values.title).toBe('')
    expect(t.query('[name="title"]').value).toBe('')
  })

  it('resetOnShow gives the start values: after a submit, form.RESET alone would restore the submitted ones', async () => {
    t = renderComponent(formApp(addPage(true)))
    await t.ready()
    await visitAndType('Lunch')
    t.simulateEvent('.f', 'submit')
    await t.settle()
    expect(t.state.added).toEqual(['Lunch'])
    expect(t.state.form.initial.title).toBe('Lunch')   // a done submit makes the values the new `initial`
    t.simulateAction('GO', 'home')
    await t.settle()
    t.simulateAction('GO', 'newItem')
    await t.settle()
    expect(t.query('[name="title"]').value).toBe('')
  })

  it('(control) form.RESET without values after a submit goes back to the submitted values', async () => {
    t = renderComponent(formApp(addPage(false)))
    await t.ready()
    await visitAndType('Lunch')
    t.simulateEvent('.f', 'submit')
    await t.settle()
    t.simulateAction('form.RESET')
    await t.settle()
    expect(t.state.form.values.title).toBe('Lunch')
  })
})

describe('the agent docs carry both rules (and the snippet these tests run)', () => {
  const RESOURCES = 'declares `items` in its own `.resources`'
  for (const [file, texts] of [
    ['skills/sygnal-dev/SKILL.md', [SNIPPET, RESOURCES]],
    ['evals/agent-ergonomics/skills-toc/references/behaviors-and-forms.md', [SNIPPET]],
    ['evals/agent-ergonomics/skills-toc/references/resources.md', [RESOURCES]],
    ['llms.txt', [SNIPPET, LLMS_SNIPPET, RESOURCES]],
  ]) {
    it(file, () => {
      const text = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')
      for (const s of texts) expect(text).toContain(s)
    })
  }
})
