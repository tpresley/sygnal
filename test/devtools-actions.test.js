// @vitest-environment jsdom
// PLAN-4 3-E (GS-10): the DevTools action log, "Copy as test" and the Redux DevTools bridge in
// the dev-only 'sygnal/devtools' entry. Runs against the built package (npm run build).
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import * as core from '../dist/index.esm.js'

const { h, run, set, createElement, Collection } = core
const EXT = '__SYGNAL_DEVTOOLS_EXTENSION__'
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

let dev
beforeAll(async () => { dev = await import('../dist/devtools.esm.js') })

function Counter({ state }) {
  return h('div', [h('button.inc', '+'), h('span.count', String(state.count))])
}
Counter.initialState = { count: 0, last: null }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc'), PING: DOM.click('.count') })
Counter.model = {
  INC: { STATE: (s) => ({ ...s, count: s.count + 1 }), EFFECT: (s, _d, next) => next('NOTE', s.count + 1) },
  NOTE: set((_s, n) => ({ last: n })),
  PING: { LOG: () => 'ping' },
}

function Item({ state }) {
  return h('li', [h('button.toggle', state.done ? 'done' : 'todo'), h('span.title', state.title)])
}
Item.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
Item.model = { TOGGLE: set((s) => ({ done: !s.done })) }

function List() {
  return h('div', [h('button.add', 'add'), createElement(Collection, { of: Item, from: 'items' })])
}
List.initialState = { items: [{ id: 1, title: 'a', done: false }], next: 2 }
List.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
List.model = {
  ADD: (s) => ({ ...s, next: s.next + 1, items: [...s.items, { id: s.next, title: 'n' + s.next, done: false }] }),
}

let app
function mount(App, drivers = {}) {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, drivers, { mountPoint: '#root' })
  return app
}
afterEach(() => { app?.dispose(); app = undefined })
const click = (sel, i = 0) => document.querySelectorAll(sel)[i].dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('sygnal/devtools action log (PLAN-4 3-E)', () => {
  it('records every action with { type, data, component, instance, sinks, cause, at } and the state around it', async () => {
    expect(dev.isRecording()).toBe(true)
    mount(Counter)
    await tick(20)
    dev.clearActions()
    click('.inc')
    await tick(30)
    const list = dev.getActions({ component: 'Counter' })
    expect(list.map(a => [a.type, a.cause])).toEqual([['INC', 'intent'], ['NOTE', 'next']])
    const [inc, note] = list
    expect(inc.sinks).toEqual(['STATE', 'EFFECT'])
    expect(inc.data).toBeInstanceOf(MouseEvent)
    expect(inc.before).toEqual({ count: 0, last: null })
    expect(inc.after).toEqual({ count: 1, last: null })
    expect(note).toMatchObject({ data: 1, sinks: ['STATE'], before: { count: 1, last: null }, after: { count: 1, last: 1 } })
    expect(typeof inc.at).toBe('number')
    expect(inc.instance).toBe(note.instance)
    expect(dev.getActions({ type: 'NOTE' })).toHaveLength(1)
    expect(dev.getActions({ cause: 'next' }).map(a => a.type)).toEqual(['NOTE'])
    expect(dev.getActions({ type: /^IN/ }).map(a => a.type)).toEqual(['INC'])
    // an action that changes no state has no before / after
    click('.count')
    await tick(20)
    const ping = dev.getActions({ type: 'PING' })[0]
    expect(ping.sinks).toEqual(['LOG'])
    expect('after' in ping).toBe(false)
  })

  it('copyAsTest replays intent actions (not next ones) and asserts the final state', async () => {
    mount(Counter)
    await tick(20)
    dev.clearActions()
    click('.inc')
    click('.inc')
    await tick(30)
    const r = dev.copyAsTestResult(app, { componentImport: "import Counter from './Counter.js'" })
    expect(r.complete).toBe(true)
    expect(r.replayed).toBe(2)
    expect(r.code).toContain("import { renderComponent } from 'sygnal'")
    expect(r.code).toContain("import Counter from './Counter.js'")
    // the session started after INITIALIZE: its initial state is the state at clearActions()
    expect(r.code).not.toContain('initialState')
    expect(r.code.match(/t\.simulateAction\('INC', \{ type: 'click' \}\)/g)).toHaveLength(2)
    expect(r.code).not.toContain("'NOTE'")
    expect(r.code).toContain('expect(t.state).toEqual({ count: 2, last: 2 })')
    expect(dev.copyAsTest(app, { componentImport: "import Counter from './Counter.js'" })).toBe(r.code)
  })

  it("leaves the assertion out when a child changed the state through its own actions; the child's session replays", async () => {
    mount(List)
    await tick(30)
    dev.clearActions()
    click('.add')
    await tick(30)
    click('.toggle', 1)
    await tick(30)
    const root = dev.copyAsTestResult(List)
    expect(root.complete).toBe(false)
    expect(root.code).toContain("t.simulateAction('ADD', { type: 'click' })")
    expect(root.code).toMatch(/No final-state assertion: child components changed the state through their own actions \(Item#\d+ TOGGLE\)/)
    expect(root.code).not.toContain('expect(t.state)')

    const item = dev.getActions({ component: 'Item', type: 'TOGGLE' })[0]
    const child = dev.copyAsTestResult(item.instance, { componentImport: "import Item from './Item.js'" })
    expect(child.complete).toBe(true)
    expect(child.code).toContain("initialState: { id: 2, title: 'n2', done: false }")
    expect(child.code).toContain("t.simulateAction('TOGGLE', { type: 'click' })")
    expect(child.code).toContain("expect(t.state).toEqual({ id: 2, title: 'n2', done: true })")
  })

  it("doesn't replay an intent over the component's own state (STATE.stream): the replay sends it again", async () => {
    function Saver({ state }) { return h('button.inc', String(state.n)) }
    Saver.initialState = { n: 0 }
    Saver.intent = ({ DOM, STATE }) => ({ INC: DOM.click('.inc'), SAVE: STATE.stream.drop(1) })
    Saver.model = { INC: (s) => ({ n: s.n + 1 }), SAVE: { LOG: (s) => 'saved ' + s.n } }
    mount(Saver)
    await tick(20)
    click('.inc')
    await tick(30)
    const save = dev.getActions({ component: 'Saver', type: 'SAVE' })
    expect(save.map(a => [a.cause, a.echo])).toEqual([['intent', true]])
    const r = dev.copyAsTestResult(Saver)
    expect(r.code).not.toContain("'SAVE'")
    expect(r.code).toContain('expect(t.state).toEqual({ n: 1 })')
  })

  it('getSession() is plain data, and copyAsTest takes it back', async () => {
    mount(Counter)
    await tick(20)
    dev.clearActions()
    click('.inc')
    await tick(30)
    const s = dev.getSession(Counter)
    expect(s).toMatchObject({ version: 1, component: 'Counter', initialState: { count: 0, last: null }, finalState: { count: 1, last: 1 } })
    expect(s.actions.map(a => [a.type, a.cause])).toEqual([['INC', 'intent'], ['NOTE', 'next']])
    expect(s.actionNames).toEqual(expect.arrayContaining(['INC', 'NOTE', 'PING']))
    expect(dev.copyAsTest(s)).toContain('expect(t.state).toEqual({ count: 1, last: 1 })')
  })
})

describe('copyAsTest from a recording (code generation)', () => {
  const base = (over = {}) => ({
    version: 1, component: 'Form', instance: '7', initialState: { a: 1 }, definitionInitialState: { a: 1 },
    finalState: { a: 2 }, actionNames: ['SET', 'SAVE', 'SAVED', 'FAILED', 'GOT'], drivers: [], fakeable: [], actions: [], foreign: [], ...over,
  })
  const act = (type, data, cause = 'intent', sinks = ['STATE'], extra = {}) => ({ type, data, cause, sinks, at: 0, ...extra })

  it('writes JSON values, Date, Map, Set, NaN and bigint as literals, and stubs DOM events and elements', () => {
    const input = document.createElement('input')
    input.value = 'hi'
    input.dataset.id = 'x1'
    const ev = new KeyboardEvent('keydown', { key: 'Enter' })
    Object.defineProperty(ev, 'target', { value: input })
    const { code, complete } = dev.copyAsTestResult(base({
      actions: [
        act('SET', { when: new Date('2026-01-02T03:04:05.000Z'), tags: new Set(['a']), m: new Map([['k', 1]]) }),
        act('SET', { n: NaN, big: 10n, 'odd-key': -0, list: [1, 'two', null, undefined] }),
        act('SET', ev),
        act('SET', { zone: input, before: null }),
      ],
    }))
    expect(complete).toBe(true)
    expect(code).toContain(`t.simulateAction('SET', { when: new Date('2026-01-02T03:04:05.000Z'), tags: new Set(['a']), m: new Map([['k', 1]]) })`)
    expect(code).toContain(`t.simulateAction('SET', { n: NaN, big: 10n, 'odd-key': -0, list: [1, 'two', null, undefined] })`)
    expect(code).toContain(`t.simulateAction('SET', { type: 'keydown', key: 'Enter', target: { dataset: { id: 'x1' }, value: 'hi' } })`)
    expect(code).toContain(`t.simulateAction('SET', { zone: { dataset: { id: 'x1' }, value: 'hi' }, before: null })`)
    expect(code).toContain('// SET: DOM event/element data as a stub')
  })

  it("doesn't replay next / built-in actions, nor intent actions with no model entry", () => {
    const { code, replayed } = dev.copyAsTestResult(base({
      actions: [act('BOOTSTRAP', undefined, 'built-in', []), act('SET', 2), act('GOT', 3, 'next'), act('UNUSED', 1, 'intent', [])],
    }))
    expect(replayed).toBe(1)
    expect(code).toContain("t.simulateAction('SET', 2)")
    expect(code).not.toMatch(/BOOTSTRAP|'GOT'|UNUSED/)
  })

  it('leaves out data it cannot write, and then the assertion when that action changed the state', () => {
    const r = dev.copyAsTestResult(base({ actions: [act('SET', { fn: () => 1 })] }))
    expect(r.code).toContain("t.simulateAction('SET') // data left out: it held a function (fn)")
    expect(r.complete).toBe(false)
    expect(r.code).toContain("No final-state assertion: SET's data could not be written (a function (fn))")
    // a class instance, and an action that changed no state (the assertion stays)
    class Thing {}
    const r2 = dev.copyAsTestResult(base({ actions: [act('SAVE', new Thing(), 'intent', ['HTTP'])] }))
    expect(r2.code).toContain('// data left out: it held a Thing')
    expect(r2.complete).toBe(true)
  })

  it('answers makeFetchDriver replies with t.respond / t.fail; other replies are a comment', () => {
    const req = { url: '/x', ok: 'SAVED', error: 'FAILED' }
    const err = Object.assign(new Error('HTTP 422: /x'), { status: 422, body: { message: 'bad' } })
    const r = dev.copyAsTestResult(base({
      drivers: ['HTTP', 'WS'], fakeable: ['HTTP'],
      actions: [
        act('SAVE', undefined, 'intent', ['HTTP']),
        act('FAILED', { error: err, request: req, status: 422, body: { message: 'bad' } }, 'reply', ['STATE'], { replySink: 'HTTP', replyKind: 'fetch' }),
        act('SAVE', undefined, 'intent', ['HTTP']),
        act('FAILED', { error: Object.assign(new Error('HTTP 500: /x'), { status: 500 }), request: req, status: 500 }, 'reply', ['STATE'], { replySink: 'HTTP', replyKind: 'fetch' }),
        act('SAVE', undefined, 'intent', ['HTTP']),
        act('FAILED', { error: new TypeError('Failed to fetch'), request: req }, 'reply', ['STATE'], { replySink: 'HTTP', replyKind: 'fetch' }),
        act('SAVE', undefined, 'intent', ['HTTP']),
        act('SAVED', { id: 1 }, 'reply', ['STATE'], { replySink: 'HTTP', replyKind: 'fetch' }),
      ],
    }))
    expect(r.code).toContain(`await t.fail('HTTP', 422, { request: (r) => r.error === 'FAILED', body: { message: 'bad' } })`)
    expect(r.code).toContain(`await t.fail('HTTP', 500, 'FAILED')`)
    expect(r.code).toContain(`await t.fail('HTTP', new Error('Failed to fetch'), 'FAILED')`)
    expect(r.code).toContain(`await t.respond('HTTP', { id: 1 }, 'SAVED')`)
    // settles the queued actions first: their requests may leave after the call would look
    expect(r.code).toContain(`    t.simulateAction('SAVE')\n    await t.settle()\n    await t.respond('HTTP', { id: 1 }, 'SAVED')`)
    expect(r.complete).toBe(true)
    // WS isn't fakeable by this generator and wasn't passed: a note, not a driver
    expect(r.code).toContain('// NOTE: the app had a driver for WS')
    expect(r.code).toContain('const t = renderComponent(Form)\n')

    const other = dev.copyAsTestResult(base({ actions: [act('GOT', { m: 1 }, 'reply', ['STATE'], { replySink: 'WS', replyKind: 'other' })] }))
    expect(other.code).toContain('// reply GOT from WS: not replayed')
    expect(other.complete).toBe(false)
  })

  it('writes initialState only when it differs from the component\'s own, and the drivers it is given', () => {
    const same = dev.copyAsTest(base())
    expect(same).toContain('const t = renderComponent(Form)')
    const r = dev.copyAsTestResult(base({ initialState: { a: 5 }, drivers: ['DND'] }), {
      drivers: { DND: 'fakeDnd()' }, imports: ["import { fakeDnd } from './helpers.js'"], environment: 'jsdom', testName: 'replays', renderOptions: 'strict: true',
    })
    expect(r.code.split('\n')[0]).toBe('// @vitest-environment jsdom')
    expect(r.code).toContain("import { fakeDnd } from './helpers.js'")
    expect(r.code).toContain("it('replays', async () => {")
    expect(r.code).toContain('initialState: { a: 5 },\n    drivers: { DND: fakeDnd() },\n    strict: true,')
    expect(r.warnings).toEqual([])
  })

  it('a truncated session, or a final state it cannot write, has no assertion', () => {
    expect(dev.copyAsTestResult(base({ truncated: true })).code).toContain('No final-state assertion: the session lost its oldest actions')
    const r = dev.copyAsTestResult(base({ finalState: { el: document.createElement('div') } }))
    expect(r.complete).toBe(false)
    expect(r.code).toContain('No final-state assertion: the final state holds a DOM element')
  })
})

describe('sygnal/devtools bridge: action log messages (PLAN-4 3-E)', () => {
  it('posts ACTIONS to the connected extension, resets on CLEAR_ACTIONS, and answers COPY_AS_TEST', async () => {
    const dt = window.__SYGNAL_DEVTOOLS__
    const posted = []
    const realPost = window.postMessage.bind(window)
    window.postMessage = (msg, ...rest) => { if (msg?.source === '__SYGNAL_DEVTOOLS_PAGE__') posted.push(msg); else realPost(msg, ...rest) }
    const send = (type, payload = {}) => window.dispatchEvent(new MessageEvent('message', { data: { source: EXT, type, payload }, source: window }))
    try {
      mount(Counter)
      await tick(20)
      send('CONNECT')
      expect(posted.some(m => m.type === 'ACTIONS_RESET')).toBe(true)
      send('CLEAR_ACTIONS')
      expect(posted.at(-1)).toMatchObject({ type: 'ACTIONS_RESET', payload: { actions: [] } })
      click('.inc')
      await tick(30)
      const batches = posted.filter(m => m.type === 'ACTIONS').flatMap(m => m.payload.actions)
      const inc = batches.filter(a => a.type === 'INC').at(-1)
      expect(inc).toMatchObject({ component: 'Counter', cause: 'intent', sinks: ['STATE', 'EFFECT'], data: '[MouseEvent click]', before: { count: 0, last: null }, after: { count: 1, last: null } })
      expect(batches.some(a => a.type === 'NOTE' && a.cause === 'next')).toBe(true)

      dt.configureCopyAsTest({ componentImport: "import Counter from './Counter.js'" })
      send('COPY_AS_TEST', {})
      const res = posted.filter(m => m.type === 'COPY_AS_TEST_RESULT').at(-1).payload
      expect(res.complete).toBe(true)
      expect(res.code).toContain("import Counter from './Counter.js'")
      expect(res.code).toContain('expect(t.state).toEqual({ count: 1, last: 1 })')
      send('COPY_AS_TEST', { instance: 'nope' })
      expect(posted.filter(m => m.type === 'COPY_AS_TEST_RESULT').at(-1).payload.error).toMatch(/no live component instance/)
    } finally {
      send('DISCONNECT')
      window.postMessage = realPost
    }
  })
})

describe('Redux DevTools bridge (PLAN-4 3-E stretch)', () => {
  it('sends actions with the root state, and jumps to a state the extension picks', async () => {
    const sent = [], inits = []
    let listener
    window.__REDUX_DEVTOOLS_EXTENSION__ = {
      connect: () => ({ init: (s) => inits.push(s), send: (a, s) => sent.push([a, s]), subscribe: (fn) => { listener = fn; return () => { listener = undefined } } }),
    }
    let off
    try {
      mount(Counter)
      await tick(20)
      off = dev.connectReduxDevtools(app)
      click('.inc')
      await tick(30)
      expect(inits).toEqual([{ count: 0, last: null }])
      expect(sent.map(([a]) => a.type)).toEqual(['Counter/INC', 'Counter/NOTE'])
      expect(sent[0][0]).toMatchObject({ payload: '[MouseEvent click]', cause: 'intent' })
      expect(sent[0][1]).toEqual({ count: 1, last: null })
      expect(sent[1][1]).toEqual({ count: 1, last: 1 })
      listener({ type: 'DISPATCH', payload: { type: 'JUMP_TO_STATE' }, state: JSON.stringify({ count: 7, last: null }) })
      await tick(30)
      expect(document.querySelector('.count').textContent).toBe('7')
      off()
      expect(listener).toBeUndefined()
    } finally {
      delete window.__REDUX_DEVTOOLS_EXTENSION__
    }
    // no extension: a no-op
    expect(typeof dev.connectReduxDevtools({ sources: {} }, {})).toBe('function')
  })

  it('the default connection (what sygnal/vite injects, maybe in several files) is made once, before run()', async () => {
    const inits = [], sent = []
    let connects = 0
    window.__REDUX_DEVTOOLS_EXTENSION__ = {
      connect: () => { connects++; return { init: (s) => inits.push(s), send: (a) => sent.push(a.type), subscribe: () => () => {} } },
    }
    let off
    try {
      off = dev.connectReduxDevtools()
      expect(dev.connectReduxDevtools()).toBe(off)
      expect(connects).toBe(1)
      mount(Counter)
      await tick(20)
      click('.inc')
      await tick(30)
      expect(inits).toEqual([{ count: 0, last: null }])
      expect(sent).toEqual(['Counter/INC', 'Counter/NOTE'])
    } finally {
      off?.()
      delete window.__REDUX_DEVTOOLS_EXTENSION__
    }
  })
})
