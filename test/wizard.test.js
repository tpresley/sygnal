// @vitest-environment jsdom
// The wizard spike (dev-plans/research/wizard): the `wizard` behavior and <Outlet>.
import { describe, it, expect, afterEach, vi } from 'vitest'

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { ABORT, makeRouter, wizard, Outlet } from '../src/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))

// a log of step lifetimes: [ 'source:BOOT', 'source:DISPOSE', ... ]
let log = []

function Source({ state }) {
  return h('div', { className: 'source' },
    h('h2', null, 'Source'),
    h('input', { className: 'title', value: state.draft.title }),
    h('input', { className: 'note', value: state.note }),
    h('span', { className: 'busy' }, String(state.busy)))
}
Source.initialState = { note: '', busy: false }
Source.isolatedState = true
Source.intent = ({ DOM }) => ({
  TITLE: DOM.input('.title').map(e => e.target.value),
  NOTE: DOM.input('.note').map(e => e.target.value),
  BUSY: DOM.click('.busy'),
})
Source.model = {
  BOOTSTRAP: { EFFECT: () => { log.push('source:BOOT') } },
  DISPOSE: { EFFECT: () => { log.push('source:DISPOSE') } },
  TITLE: (s, title) => ({ ...s, draft: { ...s.draft, title } }),
  NOTE: (s, note) => ({ ...s, note }),
  BUSY: (s) => ({ ...s, busy: true }),
}

function Review({ state }) {
  return h('div', { className: 'review' },
    h('h2', null, 'Review'),
    h('p', { className: 'shown' }, state.draft.title),
    h('span', { className: 'data' }, String(state.data ?? '')))
}
Review.intent = ({ DOM }) => ({ LOAD: DOM.click('.data') })
Review.model = {
  BOOTSTRAP: { EFFECT: () => { log.push('review:BOOT') } },
  DISPOSE: { EFFECT: () => { log.push('review:DISPOSE') } },
  LOAD: (s) => ({ ...s, data: 'review data' }),
}

const STEPS = { source: Source, review: Review }

const makeFlow = (extra = {}) => wizard({
  steps: {
    source: { label: 'Source', visit: { busy: false }, valid: (s) => !!s.draft.title },
    review: { label: 'Review' },
  },
  draft: { title: '' },
  next: '.next', back: '.back', reset: '.reset', goto: '.goto',
  ...extra,
})

function host(flow, extraView) {
  function Flow({ state }) {
    const w = state.wizard
    return h('section', null,
      h('ol', null, ...w.steps.map(s => h('li', { 'aria-current': s.current ? 'step' : undefined, 'data-status': s.status },
        h('button', { className: 'goto', 'data-step': s.name }, s.label)))),
      h(Outlet, { of: STEPS, from: 'wizard' }),
      h('button', { className: 'back' }, 'Back'),
      h('button', { className: 'next' }, 'Next'),
      h('button', { className: 'reset' }, 'Start over'),
      extraView?.(state))
  }
  Flow.uses = { wizard: flow }
  Flow.initialState = { session: 's1' }
  Flow.intent = ({ DOM }) => ({ SESSION: DOM.click('.session').mapTo('s2') })
  Flow.model = { SESSION: (s, session) => ({ ...s, session }) }
  return Flow
}

const type = async (sel, value) => {
  const el = t.query(sel)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}
const click = async (sel) => { t.query(sel).click(); await tick() }

describe('wizard + Outlet', () => {
  it('mounts only the current step; the draft is shared; a step keeps its own slice across Back, its visit fields reset', async () => {
    log = []
    t = renderComponent(host(makeFlow()), { dom: 'real' })
    await t.ready(); await tick()
    expect(t.query('.source')).toBeTruthy()
    expect(t.query('.review')).toBeFalsy()
    expect(log).toEqual(['source:BOOT'])
    expect(t.state.wizard).toMatchObject({ step: 'source', visit: 1, index: 0, count: 2, canBack: false, canNext: false })

    // Next refused while the step isn't valid
    await click('.next')
    expect(t.state.wizard.step).toBe('source')

    await type('.title', 'Hello')
    await type('.note', 'mine')
    await click('.busy')
    expect(t.state.wizard.draft).toEqual({ title: 'Hello' })
    expect(t.state.wizard.local.source).toEqual({ note: 'mine', busy: true })
    expect(t.state.wizard.canNext).toBe(true)

    await click('.next')
    expect(t.query('.source')).toBeFalsy()
    expect(t.query('.shown').textContent).toBe('Hello')
    expect(log).toEqual(['source:BOOT', 'source:DISPOSE', 'review:BOOT'])
    expect(t.state.wizard.steps.map(s => s.status)).toEqual(['done', 'current'])
    expect(t.queryAll('li').map(l => l.getAttribute('aria-current'))).toEqual([null, 'step'])

    await click('.data')
    expect(t.state.wizard.local.review).toEqual({ data: 'review data' })

    await click('.back')
    expect(log.slice(3)).toEqual(['review:DISPOSE', 'source:BOOT'])
    expect(t.query('.title').value).toBe('Hello')
    expect(t.query('.note').value).toBe('mine')          // the step's own slice survived
    expect(t.query('.busy').textContent).toBe('false')   // its visit field reset on entry
    // per-step slices: the review step's `data` isn't the source step's
    expect(t.state.wizard.local.source.data).toBeUndefined()

    // GOTO a reachable step by clicking the stepper
    await click('[data-step="review"]')
    expect(t.state.wizard.step).toBe('review')
    expect(t.query('.data').textContent).toBe('review data')
  })

  it('a flow key change and a reset make the flow anew', async () => {
    const Flow = host(makeFlow({ key: (s) => s.session, draft: (s) => ({ title: 'for ' + s.session }) }),
      () => h('button', { className: 'session' }, 'other session'))
    t = renderComponent(Flow, { dom: 'real' })
    await t.ready(); await tick()
    expect(t.state.wizard).toMatchObject({ key: 's1', draft: { title: 'for s1' } })
    await type('.note', 'x')
    await click('.next')
    expect(t.state.wizard.step).toBe('review')

    await click('.session')
    expect(t.state.wizard).toMatchObject({ key: 's2', step: 'source', draft: { title: 'for s2' }, local: { source: { busy: false } } })
    expect(t.query('.note').value).toBe('')
    expect(t.query('.title').value).toBe('for s2')

    await type('.note', 'y')
    await click('.next')
    await click('.reset')
    expect(t.state.wizard).toMatchObject({ key: 's2', step: 'source', draft: { title: 'for s2' }, visited: ['source'] })
    expect(t.query('.note').value).toBe('')
  })

  it('finish: Next on the last step dispatches the host action with the draft', async () => {
    const Flow = host(makeFlow({ finish: 'CREATE' }))
    Flow.model = { ...Flow.model, CREATE: (s, draft) => ({ ...s, created: draft.title }) }
    t = renderComponent(Flow, { dom: 'real' })
    await t.ready(); await tick()
    await type('.title', 'Done')
    await click('.next')
    expect(t.state.wizard.canNext).toBe(true)
    await click('.next')
    expect(t.state.created).toBe('Done')
  })

  it('moves focus to the new step heading (not on the first mount)', async () => {
    t = renderComponent(host(makeFlow()), { dom: 'real' })
    await t.ready(); await tick()
    expect(document.activeElement?.tagName).not.toBe('H2')
    await type('.title', 'Hi')
    await click('.next')
    await tick(40)
    expect(document.activeElement?.textContent).toBe('Review')
    expect(document.activeElement.getAttribute('tabindex')).toBe('-1')
  })

  it('when: a skipped step is left out of the moves and marked skipped', async () => {
    function Extra() { return h('div', { className: 'extra' }, 'extra') }
    const flow = wizard({
      steps: { source: { valid: (s) => !!s.draft.title }, extra: { when: (s) => s.draft.title === 'more' }, review: {} },
      draft: { title: '' }, next: '.next', back: '.back',
    })
    function Flow({ state }) {
      return h('section', null, h(Outlet, { of: { ...STEPS, extra: Extra }, from: 'wizard' }), h('button', { className: 'next' }), h('button', { className: 'back' }))
    }
    Flow.uses = { wizard: flow }
    t = renderComponent(Flow, { dom: 'real' })
    await t.ready(); await tick()
    await type('.title', 'less')
    expect(t.state.wizard.steps.map(s => s.status)).toEqual(['current', 'skipped', 'upcoming'])
    await click('.next')
    expect(t.state.wizard.step).toBe('review')
    await click('.back')
    await type('.title', 'more')
    await click('.next')
    expect(t.state.wizard.step).toBe('extra')
  })
})

describe('wizard: URL binding and the leave guard', () => {
  const router = makeRouter({ routes: { home: '/', step: '/new/:step', notFound: '*' } })

  function App({ state }) {
    return state.route.name === 'step'
      ? h(NewThing, { state: 'flow' })
      : h('p', { className: 'home' }, 'home')
  }
  App.route = 'ROUTE'
  App.initialState = { route: router.current('/'), flow: {} }
  App.model = { ROUTE: (s, route) => ({ ...s, route, flow: { ...s.flow, route } }) }

  function NewThing({ state }) {
    return h('section', null,
      h(Outlet, { of: STEPS, from: 'wizard', focus: false }),
      h('button', { className: 'back' }, 'Back'),
      h('button', { className: 'next' }, 'Next'),
      state.wizard.leaving && h('p', { className: 'confirm' }, h('button', { className: 'leave' }, 'Discard'), h('button', { className: 'stay' }, 'Stay')))
  }
  NewThing.uses = {
    wizard: wizard({
      steps: { source: { valid: (s) => !!s.draft.title }, review: {} },
      draft: { title: '' },
      key: (s) => s.route?.query?.session,
      url: { route: 'step', param: 'step', key: 'session' },
      dirty: (w) => !!w.draft.title,
      next: '.next', back: '.back', leave: '.leave', stay: '.stay',
    }),
  }

  it('the step follows the route; moves navigate; a deep link to an unreachable step is replaced', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/new/review?session=a' })
    await t.ready(); await tick(40)
    expect(t.location.path).toBe('/new/source')
    expect(t.state.flow.wizard).toMatchObject({ step: 'source', key: 'a' })

    await type('.title', 'T')
    await click('.next')
    await tick(40)
    expect(t.location.path).toBe('/new/review')
    expect(t.location.query).toEqual({ session: 'a' })
    expect(t.query('.shown').textContent).toBe('T')

    // in-flow navigation passes the guard (dirty: a title)
    await t.back(); await tick(40)
    expect(t.state.flow.wizard.step).toBe('source')
    expect(t.query('.title').value).toBe('T')
  })

  it('leaving the flow while dirty is held until Discard; Stay keeps the flow', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/new/source?session=a' })
    await t.ready(); await tick(40)
    await type('.title', 'unsaved')
    await t.navigate('/'); await tick(40)
    expect(t.location.path).toBe('/new/source')
    expect(t.query('.confirm')).toBeTruthy()

    await click('.stay')
    expect(t.query('.confirm')).toBeFalsy()
    expect(t.location.path).toBe('/new/source')

    await t.navigate('/'); await tick(40)
    await click('.leave'); await tick(40)
    expect(t.location.path).toBe('/')
    expect(t.query('.home')).toBeTruthy()
    // discard started the flow over (the slice is kept in the parent's state)
    expect(t.state.flow.wizard.draft).toEqual({ title: '' })
  })
})

describe('Outlet route mode', () => {
  const router = makeRouter({ routes: { list: '/', task: '/tasks/:id', notFound: '*' } })
  let boots
  function Task({ context }) { return h('h1', null, 'task') }
  Task.model = { BOOTSTRAP: { EFFECT: () => { boots++ } } }
  function List() { return h('h1', null, 'list') }
  function App({ state }) {
    return h('main', null, h(Outlet, { of: { list: List, task: Task, notFound: List }, route: state.route, query: ['session'] }))
  }
  App.route = 'ROUTE'
  App.initialState = { route: router.current('/') }
  App.model = { ROUTE: (s, route) => ({ ...s, route }) }

  it('identity is name + path + the named query keys', async () => {
    boots = 0
    t = renderComponent(App, { dom: 'real', router, url: '/tasks/1' })
    await t.ready(); await tick()
    expect(boots).toBe(1)
    await t.navigate('/tasks/1?sort=a'); await tick()
    expect(boots).toBe(1)
    await t.navigate('/tasks/1?session=x'); await tick()
    expect(boots).toBe(2)
    await t.navigate('/tasks/2?session=x'); await tick()
    expect(boots).toBe(3)
    await t.navigate('/'); await tick()
    expect(t.query('h1').textContent).toBe('list')
  })
})

describe('router: a blocked back/forward whose proceed is sent at once', () => {
  // found by the wizard spike: the router replied to the blocker before undoing the traversal, so a
  // proceed sent at once ({ go: -1, force: true }) was queued before the undo and was lost
  const router = makeRouter({ routes: { a: '/a', b: '/b', notFound: '*' } })
  function App({ state }) { return h('p', null, state.route.name) }
  App.route = 'ROUTE'
  App.initialState = { route: router.current('/a') }
  App.intent = ({ DOM }) => ({ ARM: DOM.click('p') })
  App.model = {
    ROUTE: (s, route) => ({ ...s, route }),
    ARM: { ROUTER: () => ({ block: 'ASK' }) },
    ASK: { ROUTER: (_s, attempt) => ({ ...attempt.proceed, block: 'ASK' }) },
  }

  it('lands where the traversal was going', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/a' })
    await t.ready()
    await t.navigate('/b'); await tick()
    t.query('p').click(); await tick()
    await t.back(); await tick(40)
    expect(t.location.path).toBe('/a')
    expect(t.state.route.name).toBe('a')
  })
})

describe('Outlet diagnostics', () => {
  it('SYG455: from names no wizard; SYG456: no component for the current name (each once)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      function Nope({ state }) { return h('div', null, h(Outlet, { of: STEPS, from: 'flow' }), h(Outlet, { of: {}, current: state.n ? 'a' : 'b' }), h('button', { className: 'n' })) }
      Nope.initialState = { n: 0 }
      Nope.intent = ({ DOM }) => ({ N: DOM.click('.n') })
      Nope.model = { N: (s) => ({ ...s, n: s.n + 1 }) }
      t = renderComponent(Nope, { dom: 'real' })
      await t.ready(); await tick()
      t.query('.n').click(); await tick()
      t.query('.n').click(); await tick()
      const codes = spy.mock.calls.map(c => String(c[0]).match(/SYG\d+/)?.[0]).filter(Boolean)
      expect(codes.filter(c => c === 'SYG455')).toHaveLength(1)
      expect(codes.filter(c => c === 'SYG456')).toHaveLength(2)   // 'b', then 'a'
      expect(String(spy.mock.calls.find(c => String(c[0]).includes('SYG455'))[0])).toContain('from="flow"')
    } finally { spy.mockRestore() }
  })
})
