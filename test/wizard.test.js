// @vitest-environment jsdom
// The wizard spike (dev-plans/research/wizard): the `wizard` behavior and <Outlet>.
import { describe, it, expect, afterEach, vi } from 'vitest'

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { ABORT, makeRouter, wizard, Outlet, xs } from '../src/index.js'

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
    ASK: { ROUTER: (_s, attempt) => (asks++, { ...attempt.proceed, block: 'ASK' }) },
  }
  let asks = 0

  it('lands where the traversal was going', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/a' })
    await t.ready()
    await t.navigate('/b'); await tick()
    t.query('p').click(); await tick()
    await t.back(); await tick(40)
    expect(t.location.path).toBe('/a')
    expect(t.state.route.name).toBe('a')
    // the next traversal is still guarded (nothing forced is left over): ASK again, then made
    asks = 0
    await t.forward(); await tick(40)
    expect(asks).toBe(1)
    expect(t.location.path).toBe('/b')
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

describe('Sift stress test fixes', () => {
  it('bug 2: a host mounted again (same key, same step) gives the step its visit scratch again', async () => {
    function S({ state }) { return h('p', null, h('button', { className: 'busy' }, String(state.busy))) }
    S.initialState = { busy: false }
    S.isolatedState = true
    S.intent = ({ DOM }) => ({ BUSY: DOM.click('.busy') })
    S.model = { BUSY: (s) => ({ ...s, busy: true }) }
    function Host() { return h('div', null, h(Outlet, { of: { s: S }, from: 'wizard' })) }
    Host.uses = { wizard: wizard({ steps: { s: { visit: { busy: false } } } }) }
    function Page({ state }) { return h('main', null, h('button', { className: 'toggle' }, 'toggle'), state.show ? h(Host, { state: 'host' }) : null) }
    Page.initialState = { show: true, host: {} }
    Page.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
    Page.model = { TOGGLE: (s) => ({ ...s, show: !s.show }) }
    t = renderComponent(Page, { dom: 'real' })
    await t.ready(); await tick()
    await click('.busy')
    expect(t.query('.busy').textContent).toBe('true')
    await click('.toggle')
    expect(t.query('.busy')).toBeFalsy()
    await click('.toggle')
    expect(t.query('.busy').textContent).toBe('false')
    expect(t.state.host.wizard.local.s.busy).toBe(false)
  })

  describe('URL mode, with a confirm dialog', () => {
    const router = makeRouter({ routes: { home: '/', step: '/new/:step', first: '/new', notFound: '*' } })
    const opened = []
    let restore
    afterEach(() => restore?.())
    const stubDialog = () => {
      const P = HTMLDialogElement.prototype, sm = P.showModal, cl = P.close
      P.showModal = function () { this.setAttribute('open', ''); opened.push('open') }
      P.close = function () { this.removeAttribute('open'); opened.push('close') }
      restore = () => { P.showModal = sm; P.close = cl }
    }
    function App({ state }) {
      return ['step', 'first'].includes(state.route.name) ? h(Flow, { state: 'flow' }) : h('p', { className: 'home' }, 'home')
    }
    App.route = 'ROUTE'
    App.initialState = { route: router.current('/'), flow: {} }
    App.model = { ROUTE: (s, route) => ({ ...s, route, flow: { ...s.flow, route } }) }
    function Flow({ state }) {
      return h('section', null, h(Outlet, { of: STEPS, from: 'wizard', focus: false }), h('button', { className: 'next' }, 'Next'),
        h('dialog', { className: 'leave-dialog' }, h('button', { className: 'leave' }, 'Discard'), h('button', { className: 'stay' }, 'Stay')))
    }
    Flow.uses = {
      wizard: wizard({
        steps: { source: { valid: (s) => !!s.draft.title }, review: {} },
        draft: { title: '' },
        key: (s) => s.route?.query?.k,
        // the first step's own route (no step param) maps to the step route
        url: { route: 'step', param: 'step', key: 'k', from: (s) => s.route?.name == 'first' ? { ...s.route, name: 'step', params: { step: 'source' } } : s.route },
        dirty: (w) => !!w.draft.title,
        next: '.next', confirm: '.leave-dialog', leave: '.leave', stay: '.stay',
      }),
    }

    it('bug 4: a route entering a step closes the open leave dialog', async () => {
      stubDialog(); opened.length = 0
      t = renderComponent(App, { dom: 'real', router, url: '/new/source?k=a' })
      await t.ready(); await tick(40)
      await type('.title', 'T')
      await click('.next'); await tick(40)
      expect(t.location.path).toBe('/new/review')
      await t.navigate('/'); await tick(40)
      expect(t.state.flow.wizard.leaving).toBeTruthy()
      expect(t.query('.leave-dialog').hasAttribute('open')).toBe(true)
      // the browser's back button while the modal is open: in the flow, so made
      await t.back(); await tick(60)
      expect(t.state.flow.wizard.step).toBe('source')
      expect(t.state.flow.wizard.leaving).toBe(null)
      expect(t.query('.leave-dialog').hasAttribute('open')).toBe(false)
    })

    it('bug 5: a navigation to a step through the route url.from maps is inside the flow', async () => {
      stubDialog(); opened.length = 0
      t = renderComponent(App, { dom: 'real', router, url: '/new/review?k=a' })
      await t.ready(); await tick(40)
      expect(t.location.path).toBe('/new/source')
      await type('.title', 'T')
      await click('.next'); await tick(40)
      expect(t.location.path).toBe('/new/review')
      await t.navigate('/new?k=a'); await tick(40)
      expect(opened).toEqual([])
      expect(t.state.flow.wizard.step).toBe('source')
      expect(t.location.path).toBe('/new')
    })
  })
})

describe('the decided API (Sift second pass)', () => {
  describe('a flow key born mid-flow (Sift: Define creates the session)', () => {
    const router = makeRouter({ routes: { home: '/', newFilter: '/new', step: '/new/:step', notFound: '*' } })
    const inWizard = (r) => r?.name === 'newFilter' || r?.name === 'step'
    let sent
    function Define({ state }) {
      return h('div', null, h('h2', null, 'Define'), h('input', { className: 'words', value: state.words }), h('button', { className: 'continue' }, 'Continue'))
    }
    Define.initialState = { words: '' }
    Define.isolatedState = true
    Define.intent = ({ DOM }) => ({ WORDS: DOM.input('.words').map(e => e.target.value), CONTINUE: DOM.click('.continue') })
    Define.model = {
      WORDS: (s, words) => ({ ...s, words, draft: { ...s.draft, words } }),
      // the session is created (the request elided): the step itself navigates to Describe for it
      CONTINUE: { ROUTER: () => ({ to: 'step', params: { step: 'describe' }, query: { session: 's1' } }) },
    }
    function Describe({ state }) { return h('div', null, h('h2', null, 'Describe'), h('p', { className: 'carried' }, state.draft.words)) }
    function App({ state }) { return inWizard(state.route) ? h(Flow, { state: 'flow' }) : h('p', { className: 'home' }, 'home') }
    App.route = 'ROUTE'
    App.initialState = { route: router.current('/'), flow: {} }
    App.model = { ROUTE: (s, route) => ({ ...s, route, flow: { ...s.flow, route } }) }
    function Flow() {
      return h('section', null, h(Outlet, { of: { define: Define, describe: Describe }, from: 'wizard', focus: false }),
        h('dialog', { className: 'leave-dialog' }, h('button', { className: 'leave' }, 'Discard'), h('button', { className: 'stay' }, 'Stay')))
    }
    Flow.uses = {
      wizard: wizard({
        steps: { define: { dirty: (s) => s.words !== '' }, describe: {} },
        draft: { words: '' },
        // undefined off the wizard's routes: not mine, the flow is kept
        key: (s) => inWizard(s.route) ? s.route.query.session ?? null : undefined,
        url: { route: 'step', param: 'step', key: 'session', from: (s) => s.route?.name === 'newFilter' ? { ...s.route, name: 'step', params: { step: 'define' } } : s.route },
        confirm: '.leave-dialog', leave: '.leave', stay: '.stay',
      }),
    }

    it('Define creates the session and moves to Describe: the draft and its slice survive, no dialog; leaving the flow is still held', async () => {
      t = renderComponent(App, { dom: 'real', router, url: '/new' })
      await t.ready(); await tick(40)
      expect(t.state.flow.wizard).toMatchObject({ step: 'define', key: null })
      await type('.words', 'my filter')
      expect(t.state.flow.wizard.local.define.words).toBe('my filter')
      await click('.continue'); await tick(60)
      expect(t.location.path).toBe('/new/describe')
      expect(t.state.flow.wizard).toMatchObject({ step: 'describe', key: 's1', leaving: null })
      expect(t.query('.carried').textContent).toBe('my filter')
      expect(t.state.flow.wizard.local.define.words).toBe('my filter')
      // back to Define (in the flow, the same key): its words are there; leaving the flow is held
      await t.back(); await tick(60)
      expect(t.state.flow.wizard.step).toBe('define')
      expect(t.query('.words').value).toBe('my filter')
      await t.navigate('/'); await tick(40)
      expect(t.state.flow.wizard.leaving).toBeTruthy()
      expect(t.location.path).toBe('/new')
    })
  })

  it('key: null -> value is adopted, none (null / undefined) keeps the flow and its key, value -> value starts over', async () => {
    const Flow = host(makeFlow({ key: (s) => s.session, draft: (s) => ({ title: 'for ' + s.session }) }),
      () => h('div', null, ...['none', 'undef', 'k1', 'k2'].map(v => h('button', { className: 'set-' + v }, v))))
    Flow.initialState = { session: null }
    Flow.intent = ({ DOM }) => ({ SET: xs.merge(...['none', 'undef', 'k1', 'k2'].map(v => DOM.click('.set-' + v).mapTo(v))) })
    Flow.model = { SET: (s, v) => ({ ...s, session: { none: null, undef: undefined, k1: 'k1', k2: 'k2' }[v] }) }
    t = renderComponent(Flow, { dom: 'real' })
    await t.ready(); await tick()
    expect(t.state.wizard).toMatchObject({ key: null, draft: { title: 'for null' } })
    await type('.note', 'kept')
    await click('.set-k1')
    // adopted: the flow kept; the draft's untouched field refilled from draft(state) (A2)
    expect(t.state.wizard).toMatchObject({ key: 'k1', draft: { title: 'for k1' } })
    expect(t.query('.note').value).toBe('kept')
    await click('.set-undef')
    expect(t.state.wizard).toMatchObject({ key: 'k1', draft: { title: 'for k1' } })     // not mine: kept
    await click('.set-k1')
    await click('.set-k2')
    expect(t.state.wizard).toMatchObject({ key: 'k2', draft: { title: 'for k2' } })     // another record
    expect(t.query('.note').value).toBe('')
    await type('.note', 'kept2')
    await click('.set-none')
    expect(t.state.wizard).toMatchObject({ key: 'k2', draft: { title: 'for k2' } })     // value -> none: kept
    expect(t.query('.note').value).toBe('kept2')
  })

  it('predicates get the step view (initialState merged) and the host state; label as a function; per-step dirty and discard; draftKey', async () => {
    const seen = []
    function Agree({ state }) { return h('div', null, h('button', { className: 'agree' }, String(state.agreed)), h('span', { className: 'f' }, state.flow.name)) }
    Agree.initialState = { agreed: false }
    Agree.isolatedState = true
    Agree.intent = ({ DOM }) => ({ AGREE: DOM.click('.agree') })
    Agree.model = { AGREE: (s) => ({ ...s, agreed: true, flow: { ...s.flow, name: 'x' } }) }
    function Done() { return h('p', { className: 'done' }, 'done') }
    const flow = wizard({
      draftKey: 'flow',
      steps: {
        agree: {
          label: (s, { state: h }) => s.agreed ? 'Agreed' : 'Agree ' + h.who,
          valid: (s, { state: h }) => (seen.push([s.agreed, h.who]), s.agreed),
          dirty: (s) => s.agreed,
          discard: (s) => ({ ...s, agreed: false, flow: { name: 'discarded' } }),
        },
        done: {},
      },
      draft: { name: '' }, next: '.next',
    })
    function Host({ state }) { return h('div', null, h(Outlet, { of: { agree: Agree, done: Done }, from: 'wizard' }), h('button', { className: 'next' }), h('b', { className: 'label' }, state.wizard.steps[0].label)) }
    Host.initialState = { who: 'Ada' }
    Host.uses = { wizard: flow }
    t = renderComponent(Host, { dom: 'real' })
    await t.ready(); await tick()
    expect(seen.some(([a, w]) => a === false && w === 'Ada')).toBe(true)   // initialState merged, host state
    expect(t.query('.label').textContent).toBe('Agree Ada')
    expect(t.state.wizard.canNext).toBe(false)
    await click('.agree')
    expect(t.state.wizard.draft).toEqual({ name: 'x' })                      // the draft under draftKey 'flow'
    expect(t.query('.f').textContent).toBe('x')
    expect(t.query('.label').textContent).toBe('Agreed')
    expect(t.state.wizard.canNext).toBe(true)
    // the step's own dirty holds the block; its own discard runs
    expect(t.sinkValues('ROUTER').at(-1)).toEqual({ block: 'wizard.LEAVE' })
    await t.simulateAction('wizard.DISCARD'); await tick()
    expect(t.state.wizard.draft).toEqual({ name: 'discarded' })
    expect(t.state.wizard.local.agree.agreed).toBe(false)
  })

  it('a step moves the flow with PARENT messages (NEXT, BACK, GOTO, RESET, FINISH); resetTo; Outlet fallback', async () => {
    function A({ state }) { return h('div', null, h('button', { className: 'a-next' }), h('button', { className: 'a-finish' }), h('input', { className: 'title', value: state.draft.title })) }
    A.intent = ({ DOM }) => ({ N: DOM.click('.a-next'), F: DOM.click('.a-finish'), TITLE: DOM.input('.title').map(e => e.target.value) })
    A.model = {
      N: { PARENT: () => ({ wizard: 'NEXT' }) },
      F: { PARENT: () => ({ wizard: 'FINISH' }) },
      TITLE: (s, title) => ({ ...s, draft: { ...s.draft, title } }),
    }
    function B() { return h('div', null, h('button', { className: 'b-back' }), h('button', { className: 'b-reset' }), h('button', { className: 'b-goto' })) }
    B.intent = ({ DOM }) => ({ BK: DOM.click('.b-back'), RS: DOM.click('.b-reset'), GT: DOM.click('.b-goto') })
    B.model = {
      BK: { PARENT: () => ({ wizard: 'BACK' }) },
      RS: { PARENT: () => ({ wizard: 'RESET', draft: { title: 'again' } }) },
      GT: { PARENT: () => ({ wizard: 'GOTO', step: 'c' }) },
    }
    function Missing() { return h('p', { className: 'fallback' }, 'not ported') }
    function Host({ state }) { return h('div', null, h(Outlet, { of: { a: A, b: B }, fallback: Missing, from: 'wizard' }), h('p', { className: 'made' }, state.made)) }
    Host.initialState = { made: '' }
    Host.uses = { wizard: wizard({ steps: { a: {}, b: {}, c: {} }, draft: { title: '' }, finish: 'MAKE', resetTo: { to: 'home' } }) }
    Host.model = { MAKE: (s, d) => ({ ...s, made: d.title }) }
    t = renderComponent(Host, { dom: 'real' })
    await t.ready(); await tick()
    await type('.title', 'T')
    await click('.a-finish')
    expect(t.query('.made').textContent).toBe('T')
    await click('.a-next')
    expect(t.state.wizard.step).toBe('b')
    await click('.b-back')
    expect(t.state.wizard.step).toBe('a')
    await click('.a-next')
    await click('.b-goto')
    expect(t.state.wizard.step).toBe('c')
    expect(t.query('.fallback').textContent).toBe('not ported')   // no `c` in of: the fallback
    await click('.fallback')
    t.dispose()
    // RESET from a step, with a draft; resetTo is sent on the router sink
    t = renderComponent(Host, { dom: 'real' })
    await t.ready(); await tick()
    await click('.a-next')
    await click('.b-reset')
    expect(t.state.wizard).toMatchObject({ step: 'a', draft: { title: 'again' } })
    expect(t.sinkValues('ROUTER')).toContainEqual({ to: 'home' })
  })
})

describe('SYNC costs nothing for unrelated changes', () => {
  it('N unrelated host actions are N states and N renders; SYNC is a built-in action', async () => {
    let renders = 0
    function Host({ state }) {
      renders++
      return h('div', null, h(Outlet, { of: STEPS, from: 'wizard', focus: false }), h('button', { className: 'bump' }, String(state.n)))
    }
    Host.initialState = { n: 0 }
    Host.uses = { wizard: makeFlow() }
    Host.intent = ({ DOM }) => ({ BUMP: DOM.click('.bump') })
    Host.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }
    t = renderComponent(Host, { dom: 'real' })
    await t.ready(); await tick()
    const r0 = renders, s0 = t.states.length
    for (let i = 0; i < 5; i++) await click('.bump')
    expect(t.state.n).toBe(5)
    expect(t.states.length - s0).toBe(5)
    expect(renders - r0).toBe(5)
    // a write that changes the derived fields still syncs them (the step's title makes it valid)
    await type('.title', 'x')
    expect(t.state.wizard.canNext).toBe(true)
    // the action log calls SYNC (and MOUNT) built-in, as sygnal/yjs's LOCAL / REMOTE
    const syncs = t.actions.filter(a => a.type === 'wizard.SYNC')
    expect(syncs.length).toBeGreaterThan(0)
    expect(syncs.every(a => a.cause === 'built-in')).toBe(true)
  })
})

describe('Sift pass 2', () => {
  const router = makeRouter({ routes: { home: '/', step: '/flow/:step', notFound: '*' } })
  const A = () => h('h2', { className: 'a' }, 'a'), B = () => h('h2', { className: 'b' }, 'b'), C = () => h('h2', { className: 'c' }, 'c')
  function App({ state }) { return state.route.name === 'step' ? h(H, { state: 'flow' }) : h('p', null, 'home') }
  App.route = 'ROUTE'
  App.initialState = { route: router.current('/'), flow: {} }
  App.model = { ROUTE: (s, route) => ({ ...s, route, flow: { ...s.flow, route } }) }
  function H() { return h(Outlet, { of: { a: A, b: B, c: C }, from: 'wizard', focus: false }) }
  H.uses = {
    wizard: wizard({
      steps: { a: {}, b: { when: (s) => s.draft.x != null }, c: {} },
      draft: (st) => ({ x: st.route?.query?.x ?? null }),
      key: (st) => st.route?.query?.k,
      url: { route: 'step', param: 'step', key: 'k' },
    }),
  }

  it('bug A1: a route to a step skipped by `when` goes back to the step before it, not to the last step', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/flow/a' })
    await t.ready(); await tick(40)
    await t.navigate('/flow/b?k=1'); await tick(60)
    expect(t.location.path).toBe('/flow/a')
    expect(t.state.flow.wizard.step).toBe('a')
  })

  it('bug A2: an adopted key refills the draft fields still at their start from draft(state); a changed one is kept', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/flow/a' })
    await t.ready(); await tick(40)
    expect(t.state.flow.wizard).toMatchObject({ key: null, draft: { x: null }, initial: { x: null } })
    await t.navigate('/flow/b?k=1&x=7'); await tick(60)
    expect(t.location.path).toBe('/flow/b')
    expect(t.state.flow.wizard).toMatchObject({ step: 'b', key: '1', draft: { x: '7' }, initial: { x: '7' } })
  })

  it('bug A2: a draft field the user changed is not refilled on adoption', async () => {
    const flow = wizard({ steps: { a: {}, b: {} }, draft: (st) => ({ x: st.k ?? null, y: 'start' }), key: (st) => st.k })
    function S({ state }) { return h('button', { className: 'edit' }, String(state.draft.y)) }
    S.intent = ({ DOM }) => ({ EDIT: DOM.click('.edit') })
    S.model = { EDIT: (s) => ({ ...s, draft: { ...s.draft, x: 'mine', y: 'mine' } }) }
    function Host() { return h('div', null, h(Outlet, { of: { a: S, b: S }, from: 'wizard' }), h('button', { className: 'k' })) }
    Host.initialState = { k: null }
    Host.uses = { wizard: flow }
    Host.intent = ({ DOM }) => ({ K: DOM.click('.k') })
    Host.model = { K: (s) => ({ ...s, k: 'K1' }) }
    t = renderComponent(Host, { dom: 'real' })
    await t.ready(); await tick()
    await click('.edit')
    await click('.k')
    expect(t.state.wizard).toMatchObject({ key: 'K1', draft: { x: 'mine', y: 'mine' } })
  })

  it('bug B: a slice the parent seeded (no derived fields) has them in every view call, the first included', async () => {
    const seen = []
    // (the core's read-time hook: the host reads the slice normalized, before its first actions run)
    let statuses
    function Host({ state }) { seen.push(Array.isArray(state.wizard.steps)); statuses = state.wizard.steps?.map(x => x.status); return h(Outlet, { of: { a: A, b: B, c: C }, from: 'wizard' }) }
    Host.uses = { wizard: wizard({ steps: { a: {}, b: {}, c: {} } }) }
    function Root() { return h(Host, { state: 'page' }) }
    Root.initialState = { page: { wizard: { step: 'b', key: null, visit: 3, visited: ['a', 'b'], draft: {}, local: {}, leaving: null } } }
    t = renderComponent(Root, { dom: 'real' })
    await t.ready(); await tick()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(Boolean)).toBe(true)
    expect(statuses).toEqual(['done', 'current', 'upcoming'])
    expect(t.query('.b')).toBeTruthy()
  })
})

describe('Outlet: a per-page state map (plain mode)', () => {
  it('each page binds its own entry; a page not in the map shares the owner state', async () => {
    function Admin({ state }) { return h('p', { className: 'admin' }, String(state.n)) }
    function Home({ state }) { return h('p', { className: 'home' }, String(state.page)) }
    function App({ state }) {
      return h('main', null, h('button', { className: 'go' }), h(Outlet, { of: { admin: Admin, home: Home }, current: state.page, state: { admin: 'pages.admin' }, focus: false }))
    }
    App.initialState = { page: 'home', pages: { admin: { n: 7 } } }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: (s) => ({ ...s, page: s.page === 'home' ? 'admin' : 'home' }) }
    t = renderComponent(App, { dom: 'real' })
    await t.ready(); await tick()
    expect(t.query('.home').textContent).toBe('home')
    await click('.go')
    expect(t.query('.admin').textContent).toBe('7')
  })
})

describe('pass 3: the decided API', () => {
  const router = makeRouter({ routes: { home: '/', newFilter: '/new', step: '/new/:step', notFound: '*' } })
  const inWizard = (r) => r?.name === 'newFilter' || r?.name === 'step'
  function Define({ state }) {
    return h('div', null, h('h2', null, 'Define'), h('input', { className: 'words', value: state.words }), h('button', { className: 'continue' }, 'Continue'))
  }
  Define.initialState = { words: '' }
  Define.isolatedState = true
  Define.intent = ({ DOM }) => ({ WORDS: DOM.input('.words').map(e => e.target.value), CONTINUE: DOM.click('.continue') })
  Define.model = {
    WORDS: (s, words) => ({ ...s, words }),
    // a session is opened; the first time the flow adopts it (a route), later it moves to a new one
    CONTINUE: { PARENT: (s, _d, _n, { context }) => ({ wizard: 'GOTO', step: 'describe', key: s.words }) },
  }
  function Describe() { return h('div', null, h('h2', null, 'Describe'), h('button', { className: 'create' }, 'Create')) }
  Describe.intent = ({ DOM }) => ({ CREATE: DOM.click('.create') })
  Describe.model = { CREATE: { PARENT: () => ({ wizard: 'GOTO', step: 'created' }) } }
  function Analyze() { return h('h2', null, 'Analyze') }
  function Created() { return h('h2', { className: 'created' }, 'Created') }
  function App({ state }) { return inWizard(state.route) ? h(Flow, { state: 'flow' }) : h('p', { className: 'home' }, 'home') }
  App.route = 'ROUTE'
  App.initialState = { route: router.current('/'), flow: {} }
  App.model = { ROUTE: (s, route) => ({ ...s, route, flow: { ...s.flow, route } }) }
  const resets = []
  function Flow({ state }) {
    const w = state.wizard
    return h('section', null,
      h('ol', null, ...w.stepper.map(e => h('li', { 'data-status': e.status, 'data-step': e.step }, e.label))),
      h(Outlet, { of: { define: Define, analyze: Analyze, describe: Describe, created: Created }, from: 'wizard', focus: false }),
      h('dialog', { className: 'leave-dialog' }, h('p', { className: 'copy' }, w.dialog?.title ?? ''), h('button', { className: 'leave' }), h('button', { className: 'stay' })),
      h('button', { className: 'back' }), h('button', { className: 'restart' }))
  }
  Flow.uses = {
    wizard: wizard({
      steps: {
        define: { label: 'Source', dirty: (s) => s.words !== '', dialog: { title: 'Discard what you typed?' } },
        analyze: { group: 'build', label: 'Analyze', when: (s, { state: st }) => st.route?.query?.report != null },
        describe: { group: 'build', label: 'Describe', when: (s, { state: st }) => st.route?.query?.report == null },
        created: { outcome: true },
      },
      groups: { build: { label: 'Build the filter' } },
      dialog: { title: 'Leave?' },
      key: (s) => inWizard(s.route) ? s.route.query.session ?? null : undefined,
      url: { route: 'step', param: 'step', key: 'session', from: (s) => s.route?.name === 'newFilter' ? { ...s.route, name: 'step', params: { step: 'define' } } : s.route },
      confirm: '.leave-dialog', leave: '.leave', stay: '.stay', back: '.back', reset: '.restart',
      resetTo: (prev) => (resets.push(prev.key), { to: 'newFilter' }),
    }),
  }
  const statuses = () => t.queryAll('li').map(l => `${l.textContent}:${l.dataset.status}`)
  const P = HTMLDialogElement.prototype, sm = P.showModal, cl = P.close
  afterEach(() => { P.showModal = sm; P.close = cl })

  it('GOTO with a key: a second session from inside the flow passes the guard and starts the flow over; groups; outcome; dialog copy; resetTo(previous)', async () => {
    P.showModal = function () { this.setAttribute('open', '') }
    P.close = function () { this.removeAttribute('open') }
    t = renderComponent(App, { dom: 'real', router, url: '/new' })
    await t.ready(); await tick(40)
    expect(statuses()).toEqual(['Source:current', 'Build the filter:upcoming'])
    expect(t.state.flow.wizard.dialog).toEqual({ title: 'Discard what you typed?' })
    await type('.words', 'S1')
    await click('.continue'); await tick(60)
    expect(t.location.path).toBe('/new/describe')
    expect(t.location.query).toEqual({ session: 'S1' })
    expect(t.state.flow.wizard).toMatchObject({ step: 'describe', key: 'S1', leaving: null })
    expect(t.state.flow.wizard.local.define.words).toBe('S1')   // adopted: the flow had no key
    expect(statuses()).toEqual(['Source:done', 'Build the filter:current'])
    expect(t.state.flow.wizard.stepper[1].step).toBe('describe')
    expect(t.state.flow.wizard.dialog).toEqual({ title: 'Leave?' })
    // Back to Define (key S1 kept), type again (dirty), Continue with a new session: no dialog
    await t.back(); await tick(60)
    expect(t.state.flow.wizard.step).toBe('define')
    await type('.words', 'S2')
    await click('.continue'); await tick(60)
    expect(t.state.flow.wizard).toMatchObject({ step: 'describe', key: 'S2', leaving: null })
    expect(t.location.query).toEqual({ session: 'S2' })
    expect(t.state.flow.wizard.local.define).toBeUndefined()   // the flow started over for S2
    expect(t.query('.leave-dialog').hasAttribute('open')).toBe(false)
    // the outcome: all steps done, not in the stepper, Back refused, a route back is replaced
    await click('.create'); await tick(60)
    expect(t.location.path).toBe('/new/created')
    expect(t.query('.created')).toBeTruthy()
    expect(t.state.flow.wizard).toMatchObject({ outcome: 'created', canBack: false, canNext: false })
    expect(statuses()).toEqual(['Source:done', 'Build the filter:done'])
    await click('.back')
    expect(t.state.flow.wizard.step).toBe('created')
    await t.back(); await tick(60)
    expect(t.state.flow.wizard.step).toBe('created')
    expect(t.location.path).toBe('/new/created')
    // start over: resetTo gets the slice being reset (key S2)
    await click('.restart'); await tick(60)
    expect(resets).toEqual(['S2'])
    expect(t.location.path).toBe('/new')
    expect(t.state.flow.wizard.step).toBe('define')
  })

  it('a group shows the alternative that applies (Analyze when there is a report)', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/new/analyze?session=A&report=R' })
    await t.ready(); await tick(40)
    expect(t.state.flow.wizard.stepper.map(e => [e.name, e.step, e.steps.join('|')])).toEqual([['define', 'define', 'define'], ['build', 'analyze', 'analyze|describe']])
  })
})

describe('Sift pass 3: N1, N2, N4', () => {
  const router = makeRouter({ routes: { first: '/flow', step: '/flow/:step', home: '/', notFound: '*' } })
  const inW = (r) => r?.name === 'first' || r?.name === 'step'
  function A() { return h('div', null, h('h2', null, 'a'), h('button', { className: 'two' }), h('button', { className: 'two-d' }), h('button', { className: 'restart' })) }
  A.intent = ({ DOM }) => ({ TWO: DOM.click('.two'), TWOD: DOM.click('.two-d'), RS: DOM.click('.restart') })
  A.model = {
    TWO: { PARENT: () => ({ wizard: 'GOTO', step: 'b', key: '2', query: { r: 'R2' } }) },
    TWOD: { PARENT: () => ({ wizard: 'GOTO', step: 'b', key: '3', draft: { r: 'given' } }) },
    RS: { PARENT: () => ({ wizard: 'RESET' }) },
  }
  function B() { return h('div', null, h('h2', null, 'b'), h('button', { className: 'restart' })) }
  B.intent = ({ DOM }) => ({ RS: DOM.click('.restart') })
  B.model = { RS: { PARENT: () => ({ wizard: 'RESET' }) } }
  function App({ state }) { return inW(state.route) ? h(H, { state: 'flow' }) : h('p', null, 'home') }
  App.route = 'ROUTE'
  App.initialState = { route: router.current('/'), flow: {} }
  App.model = { ROUTE: (s, route) => ({ ...s, route, flow: { ...s.flow, route } }) }
  function H() { return h(Outlet, { of: { a: A, b: B }, from: 'wizard', focus: false }) }
  H.uses = {
    wizard: wizard({
      steps: { a: { visit: { scratch: 1 } }, b: {} },
      draft: (st) => ({ r: st.route?.query?.r ?? null, door: st.route?.query?.door ?? null }),
      key: (st) => inW(st.route) ? st.route.query.k ?? null : undefined,
      url: { route: 'step', param: 'step', key: 'k', from: (s) => s.route?.name === 'first' ? { ...s.route, name: 'step', params: { step: 'a' } } : s.route },
      resetTo: { to: 'first' },
    }),
  }

  it('N1: GOTO with a key and a query: the route keeps its other values, the draft comes from the route entered; N4: no step-one scratch', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/flow/b?k=1&door=agent' })
    await t.ready(); await tick(40)
    await t.navigate('/flow/a?k=1&door=agent'); await tick(40)
    await click('.two'); await tick(60)
    expect(t.location.path).toBe('/flow/b')
    expect(t.location.query).toEqual({ k: '2', door: 'agent', r: 'R2' })
    expect(t.state.flow.wizard).toMatchObject({ step: 'b', key: '2', draft: { r: 'R2', door: 'agent' }, reseed: null })
    expect(t.state.flow.wizard.local.a).toBeUndefined()
  })

  it('N1: GOTO with a key and a draft seeds the new flow', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/flow/a?k=1' })
    await t.ready(); await tick(40)
    await click('.two-d'); await tick(60)
    expect(t.state.flow.wizard).toMatchObject({ step: 'b', key: '3', draft: { r: 'given' } })
    expect(t.location.query).toEqual({ k: '3' })
  })

  it("N2: Start over takes its draft (and key) from the route it goes to, not the one left", async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/flow/b?k=1&r=R' })
    await t.ready(); await tick(40)
    expect(t.state.flow.wizard).toMatchObject({ key: '1', draft: { r: 'R' } })
    await click('.restart'); await tick(60)
    expect(t.location.path).toBe('/flow')
    expect(t.state.flow.wizard).toMatchObject({ step: 'a', key: null, draft: { r: null }, reseed: null })
  })
})

describe('testing a step alone', () => {
  it("its wizard messages are in t.sent('PARENT') (and t.sinkValues('PARENT'))", async () => {
    function Step() { return h('button', { className: 'go' }, 'Next') }
    Step.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Step.model = { GO: { PARENT: () => ({ wizard: 'NEXT' }) } }
    t = renderComponent(Step, { dom: 'real', initialState: {} })
    await t.ready()
    await click('.go')
    expect(t.sent('PARENT')).toEqual([{ wizard: 'NEXT' }])
    expect(t.sinkValues('PARENT')).toEqual([{ wizard: 'NEXT' }])
  })
})

describe('guide: start the outcome step\'s work in the outcome (F1)', () => {
  it('Created sends the build from the draft once, and its reply reaches Created', async () => {
    function Review() { return h('button', { className: 'create' }, 'Create') }
    Review.intent = ({ DOM }) => ({ CREATED: DOM.click('.create').mapTo({ id: 7 }) })
    Review.model = {
      CREATED: { STATE: (s, f) => ({ ...s, draft: { ...s.draft, created: { id: f.id, startBuild: true } } }), PARENT: () => ({ wizard: 'GOTO', step: 'created' }) },
    }
    function Created({ state }) { return h('p', { className: 'created' }, `${state.draft.created?.id}:${state.build ?? 'building'}`) }
    Created.model = {
      BOOTSTRAP: {
        STATE: (s) => s.draft.created?.startBuild ? { ...s, draft: { ...s.draft, created: { ...s.draft.created, startBuild: false } } } : s,
        HTTP: (s, data, next, { previousState: p }) => p.draft.created?.startBuild ? { url: `/api/filters/${p.draft.created.id}/gold-set`, method: 'POST', ok: 'BUILT', error: 'BUILD_FAILED' } : ABORT,
      },
      BUILT: (s) => ({ ...s, build: 'done' }),
    }
    function Host() { return h(Outlet, { of: { review: Review, created: Created }, from: 'wizard', focus: false }) }
    Host.uses = { wizard: wizard({ steps: { review: {}, created: { outcome: true } }, draft: {} }) }
    t = renderComponent(Host, { dom: 'real' })
    await t.ready(); await tick()
    await click('.create'); await tick(40)
    expect(t.query('.created').textContent).toBe('7:building')
    expect(t.requests('HTTP').map(r => r.url)).toEqual(['/api/filters/7/gold-set'])
    expect(t.state.wizard.draft.created.startBuild).toBe(false)
    await t.respond('HTTP', { ok: true })
    await tick()
    expect(t.query('.created').textContent).toBe('7:done')
  })
})
