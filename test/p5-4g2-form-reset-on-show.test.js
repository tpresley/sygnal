// @vitest-environment jsdom
// PLAN-5 4-G2 (D239, G-578): `form(schema, { resetOnShow: true })` starts the form over (its start
// values; touched, errors, submit state cleared) each time it is shown: when its host starts (a
// component mounted again, a Switchable page made again for another `instance`) and each time
// its form element appears again in the DOM (a Switchable page shown again: hidden pages stay
// alive). Off by default (a wizard keeps its values across steps). `values` can be a function
// of the host's state: the start values are computed each time the form starts over.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import { renderComponent, form, Switchable } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

const schema = {
  '~standard': {
    version: 1,
    vendor: 't',
    validate(v) {
      const issues = []
      if (!v.description) issues.push({ message: 'Required', path: ['description'] })
      if (!v.category) issues.push({ message: 'Pick one', path: ['category'] })
      return issues.length ? { issues } : { value: v }
    },
  },
}
const asyncSchema = { '~standard': { ...schema['~standard'], validate: (v) => Promise.resolve(schema['~standard'].validate(v)) } }
const EMPTY = { description: '', category: '' }

/** the new-expense page (task 43's shape): reads the app's state (no `state` prop) */
const editPage = (options = {}, s = schema) => {
  function EditPage({ state }) {
    const f = state.form.fields
    return h('form', { className: 'expense' },
      h('input', { name: 'description', value: f.description.value }),
      h('p', { className: 'description-error' }, f.description.error),
      h('select', { name: 'category', value: f.category.value },
        h('option', { value: '' }, 'Choose…'), h('option', { value: 'Travel' }, 'Travel'), h('option', { value: 'Meals' }, 'Meals')),
      h('p', { className: 'category-error' }, f.category.error),
      h('button', { type: 'submit' }, 'Add'))
  }
  EditPage.uses = { form: form(s, { values: EMPTY, submit: 'SAVE', ...options }) }
  EditPage.model = { SAVE: (state, v) => ({ ...state, saved: [...state.saved, v] }) }
  return EditPage
}
function ListPage({ state }) { return h('p', { className: 'list' }, `${state.saved.length} saved`) }

/** a router-like app: pages in a Switchable keyed by the path (instance=) */
const app = (EditPage, initial = {}) => {
  function App({ state }) {
    return h('main', null, h(Switchable, { of: { list: ListPage, edit: EditPage }, current: state.page, instance: state.path }))
  }
  App.initialState = { page: 'list', path: '/', saved: [], settings: { defaultCategory: 'Meals' }, ...initial }
  App.model = {
    GO: (state, [page, path]) => ({ ...state, page, path }),
    DEFAULT: (state, c) => ({ ...state, settings: { defaultCategory: c } }),
  }
  return App
}

const type = async (name, value) => { t.simulateEvent(`[name="${name}"]`, 'input', { value }); await t.settle() }
const blur = async (name) => { t.simulateEvent(`[name="${name}"]`, 'focusout'); await t.settle() }
const submit = async () => { t.simulateEvent('.expense', 'submit'); await t.settle() }
const go = async (page, path = page == 'edit' ? '/new' : '/') => { t.simulateAction('GO', [page, path]); await t.settle() }

/** type, blur and submit an invalid form: values, touched, errors and a submit count to clear */
const scribble = async () => {
  await type('description', 'Taxi')
  await blur('description')
  await submit()
  expect(t.state.form).toMatchObject({ values: { description: 'Taxi', category: '' }, submitCount: 1, dirty: true })
  expect(t.query('.category-error').textContent).toBe('Pick one')
}
const expectFresh = (values = EMPTY) => {
  expect(t.state.form).toMatchObject({ values, initial: values, touched: {}, server: {}, submitCount: 0, submitting: false, submitted: false, dirty: false, validated: true })
  expect(t.query('[name="description"]').value).toBe(values.description)
  expect(t.query('[name="category"]').value).toBe(values.category)
  expect(t.query('.description-error').textContent).toBe('')
  expect(t.query('.category-error').textContent).toBe('')
}

describe('resetOnShow: a Switchable page shown again', () => {
  it('starts over each time the page is shown (same instance: the page stayed alive)', async () => {
    t = renderComponent(app(editPage({ resetOnShow: true })), { strict: true, dom: 'real' })
    await t.ready()
    await go('edit')
    expectFresh()
    await scribble()
    await go('list')
    expect(t.query('.list')).toBeTruthy()
    await go('edit')
    expectFresh()
    t.expectNoDiagnostics()
  })

  it('also when the page comes back with another instance (made again)', async () => {
    t = renderComponent(app(editPage({ resetOnShow: true })), { strict: true, dom: 'real' })
    await t.ready()
    await go('edit', '/new')
    await scribble()
    await go('edit', '/new?copy=1')
    expectFresh()
  })

  it('after a saved submit, the next visit starts empty (submitted cleared)', async () => {
    t = renderComponent(app(editPage({ resetOnShow: true })), { strict: true, dom: 'real' })
    await t.ready()
    await go('edit')
    await type('description', 'Taxi')
    await type('category', 'Travel')
    await submit()
    expect(t.state.saved).toEqual([{ description: 'Taxi', category: 'Travel' }])
    expect(t.state.form.submitted).toBe(true)
    await go('list')
    await go('edit')
    expectFresh()
  })

  it('keeps what the user types while the page stays shown (re-renders are not a show)', async () => {
    t = renderComponent(app(editPage({ resetOnShow: true })), { strict: true, dom: 'real' })
    await t.ready()
    await go('edit')
    await type('description', 'Taxi')
    t.simulateAction('DEFAULT', 'Travel')                        // an app write: the page re-renders
    await t.settle()
    await type('category', 'Meals')
    expect(t.state.form.values).toEqual({ description: 'Taxi', category: 'Meals' })
    expect(t.query('[name="description"]').value).toBe('Taxi')
  })

  it('off by default: the values survive the visit (the documented wizard behaviour)', async () => {
    t = renderComponent(app(editPage()), { strict: true, dom: 'real' })
    await t.ready()
    await go('edit')
    await type('description', 'Taxi')
    await go('list')
    await go('edit')
    expect(t.state.form.values.description).toBe('Taxi')
    expect(t.query('[name="description"]').value).toBe('Taxi')
  })

  it('an async schema validates the fresh values (not left validating)', async () => {
    t = renderComponent(app(editPage({ resetOnShow: true }, asyncSchema)), { strict: true, dom: 'real' })
    await t.ready()
    await go('edit')
    await type('description', 'Taxi')
    await go('list')
    await go('edit')
    await t.waitForState((s) => s.form.validated && !s.form.validating)
    expect(t.state.form).toMatchObject({ values: EMPTY, valid: false, errors: { description: 'Required', category: 'Pick one' } })
  })
})

describe('resetOnShow: a host made again', () => {
  /** the form's host mounted and unmounted by its parent; its slice lives in the parent's state */
  const toggled = (options) => {
    const Edit = editPage(options)
    function App({ state }) {
      return h('div', null, state.open ? h(Edit) : h('p', { className: 'closed' }, 'closed'))
    }
    App.initialState = { open: true, saved: [], settings: { defaultCategory: 'Meals' } }
    App.model = { TOGGLE: (state) => ({ ...state, open: !state.open }) }
    return App
  }
  for (const dom of ['mock', 'real']) {
    it(`starts over when the host mounts again (${dom} DOM)`, async () => {
      t = renderComponent(toggled({ resetOnShow: true }), { strict: true, ...(dom == 'real' && { dom }) })
      await t.ready()
      await type('description', 'Taxi')
      await blur('description')
      expect(t.state.form.values.description).toBe('Taxi')
      t.simulateAction('TOGGLE'); await t.settle()
      t.simulateAction('TOGGLE'); await t.settle()
      expect(t.state.form).toMatchObject({ values: EMPTY, touched: {}, dirty: false })
    })
  }
  it('without the option the slice kept in the parent comes back as it was', async () => {
    t = renderComponent(toggled({}), { strict: true })
    await t.ready()
    await type('description', 'Taxi')
    t.simulateAction('TOGGLE'); await t.settle()
    t.simulateAction('TOGGLE'); await t.settle()
    expect(t.state.form.values.description).toBe('Taxi')
  })
})

describe('resetOnShow: a form element rendered again inside a live host', () => {
  it('starts over when the form appears again', async () => {
    function Panel({ state }) {
      return h('div', null,
        h('button', { className: 'toggle' }, 'Toggle'),
        state.open ? h('form', { className: 'f' }, h('input', { name: 'description', value: state.form.values.description })) : null)
    }
    Panel.initialState = { open: true }
    Panel.uses = { form: form(schema, { values: EMPTY, submit: 'SAVE', resetOnShow: true }) }
    Panel.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
    Panel.model = { TOGGLE: (state) => ({ ...state, open: !state.open }), SAVE: (state) => state }
    t = renderComponent(Panel, { strict: true, dom: 'real' })
    await t.ready()
    await type('description', 'Taxi')
    t.simulateEvent('.toggle', 'click'); await t.settle()
    expect(t.state.form.values.description).toBe('Taxi')             // hidden: kept until shown
    t.simulateEvent('.toggle', 'click'); await t.settle()
    expect(t.state.form.values.description).toBe('')
    expect(t.query('[name="description"]').value).toBe('')
  })
})

describe('values as a function of the host state', () => {
  const byDefault = (state) => ({ ...EMPTY, category: state.settings.defaultCategory })

  it('the page shown first renders (before its first action) and starts on the state default', async () => {
    t = renderComponent(app(editPage({ values: byDefault, resetOnShow: true }), { page: 'edit', path: '/new' }), { strict: true, dom: 'real' })
    await t.ready()
    expectFresh({ description: '', category: 'Meals' })
    t.expectNoDiagnostics()
  })

  it('each show uses the current state', async () => {
    t = renderComponent(app(editPage({ values: byDefault, resetOnShow: true })), { strict: true, dom: 'real' })
    await t.ready()
    await go('edit')
    expectFresh({ description: '', category: 'Meals' })
    await type('category', 'Travel')
    await go('list')
    t.simulateAction('DEFAULT', 'Travel'); await t.settle()
    await go('edit')
    expectFresh({ description: '', category: 'Travel' })
    await submit()                                                   // dirty / invalid against the fresh start
    expect(t.query('.description-error').textContent).toBe('Required')
    expect(t.query('.category-error').textContent).toBe('')
  })

  it('without resetOnShow it gives the values the host starts with (mock DOM, a root host)', async () => {
    function Root({ state }) {
      return h('form', null, h('input', { name: 'description', value: state.form.fields.description.value }), h('input', { name: 'category', value: state.form.fields.category.value }))
    }
    Root.initialState = { settings: { defaultCategory: 'Travel' } }
    Root.uses = { form: form(schema, { values: byDefault, submit: 'SAVE' }) }
    Root.model = { SAVE: (state) => state }
    t = renderComponent(Root, { strict: true })
    await t.ready()
    expect(t.state.form).toMatchObject({ values: { description: '', category: 'Travel' }, initial: { description: '', category: 'Travel' }, dirty: false })
    t.simulateAction('form.RESET')                                   // RESET without data: back to the start values
    await t.settle()
    expect(t.state.form.values.category).toBe('Travel')
  })
})

describe('docs (D239)', () => {
  const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')
  it('guide/forms has "Start empty on each visit" with resetOnShow and a values function; the options table both; the reference the rule', () => {
    const page = read('docs/src/content/docs/guide/forms.md')
    const sec = page.slice(page.indexOf('## Start empty on each visit'), page.indexOf('## Server errors'))
    expect(sec).toContain('values: (state) => ({ ...EMPTY, category: state.settings.defaultCategory }),')
    expect(sec).toContain('resetOnShow: true,')
    expect(page).toMatch(/\| `resetOnShow` \| `true`: start over each time the form is shown/)
    expect(read('docs/src/content/docs/guide/forms-reference.md')).toContain('**Starting over when shown** (`resetOnShow: true`)')
  })
  it('the agent context has no hand-written STATE.watch reset left', () => {
    for (const f of ['skills/sygnal-dev/SKILL.md', 'skills/sygnal-dev-toc/references/behaviors-and-forms.md', 'llms.txt', 'docs/public/llms.txt']) {
      expect(read(f), f).not.toContain("'form.RESET': STATE.watch")
      expect(read(f), f).toContain('resetOnShow: true')
    }
  })
})
