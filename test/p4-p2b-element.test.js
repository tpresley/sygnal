// @vitest-environment jsdom
// PLAN-4 P-2b (GS-13, D127): 'sygnal/element' defineElement, in jsdom (the real-browser
// suite, browser-tests/src/tests/element-p2b.jsx, covers shadow styles and layout).
// The first block pins the core internals the entry relies on.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, ABORT } from '../src/index.ts'
import { createElement as h } from '../src/pragma/index.js'
import { defineElement } from '../src/element.ts'
import { getDiagnosticsMode, _resetDiagnostics } from '../src/extra/diagnostics/index.js'

// PLAN-4.6 R4 (06 §2): the pins port to the runtime API on the next core (app.__runtime:
// setState / getState); the current core's sink / stream internals otherwise
const setState = (app, f) => (app.__runtime ? app.__runtime.setState('root', f) : app.sinks.STATE.shamefullySendNext(f))
const getState = (app) => (app.__runtime ? app.__runtime.getState() : app.sources.STATE.stream._v)


const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 2000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}
let n = 0
const tag = (name) => `p2b-${name}-${++n}`
const meta = (root) => root.querySelector('.meta')?.textContent

function Board({ state, uid }) {
  return h('div', { className: 'board', attrs: { id: uid('board') } },
    h('h3', { className: 'title' }, state.heading),
    h('p', { className: 'meta' }, `${state.count}|${state.readonly}|${state.tasks.length}|${state.clicks}`),
    h('ul', null, ...state.tasks.map(t => h('li', { className: 'task', attrs: { 'data-id': t.id } }, t.name))),
    h('button', { className: 'btn' }, '+'))
}
Board.initialState = { heading: 'none', count: 0, readonly: false, tasks: [], clicks: 0 }
Board.intent = ({ DOM }) => ({
  CLICK: DOM.select('.btn').events('click'),
  PICK: DOM.select('.task').events('click').map(e => e.target.dataset.id),
})
Board.model = {
  CLICK: state => ({ ...state, clicks: state.clicks + 1 }),
  PICK: { PARENT: (state, id) => ({ id }), SAVE: (state, id) => 'saved ' + id },
}
const props = { heading: String, count: Number, readonly: Boolean, tasks: Array }
const events = { PARENT: 'task-picked', SAVE: 'task-saved' }

const apps = []
afterEach(async () => {
  for (const a of apps.splice(0)) a.dispose()
  document.body.innerHTML = ''
  delete globalThis.__SYGNAL_DEV__
  delete window.__SYGNAL_HMR_UPDATING
  delete window.__SYGNAL_DEVTOOLS_APP__
  _resetDiagnostics()
  vi.restoreAllMocks()
  await sleep(20)
})

describe('core internals sygnal/element relies on (pinned)', () => {
  it("a root component's PARENT sink emits { name, component, value }", async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const seen = []
    const app = run(Board, { PARENT: s$ => { s$.addListener({ next: v => seen.push(v) }) } }, { mountPoint: '#root' })
    apps.push(app)
    await until(() => document.querySelector('.btn'), 'render')
    setState(app, s => ({ ...s, tasks: [{ id: 'a', name: 'A' }] }))
    await until(() => document.querySelector('.task'), 'task')
    document.querySelector('.task').click()
    await until(() => seen.length === 1, 'PARENT value')
    expect(Object.keys(seen[0]).sort()).toEqual(['component', 'name', 'value'])
    expect(seen[0].value).toEqual({ id: 'a' })
  })

  it('run().sinks.STATE.shamefullySendNext(reducer) updates state; sources.STATE.stream._v is the current state; hmr(C, state)', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(Board, {}, { mountPoint: '#root' })
    apps.push(app)
    await until(() => meta(document) === '0|false|0|0', 'render')
    setState(app, s => ({ ...s, count: 5 }))
    await until(() => meta(document) === '5|false|0|0', 'reducer applied')
    expect(getState(app).count).toBe(5)
    setState(app, () => ABORT)
    expect(typeof app.hmr).toBe('function')
  })
})

describe('defineElement', () => {
  it('attributes → typed state; properties; kebab attribute ↔ camelCase prop', async () => {
    const t = tag('attrs')
    defineElement(t, Board, { props: { ...props, dueDate: String }, events })
    document.body.innerHTML = `<${t} heading="Hi" count="41" readonly tasks='[{"id":"a","name":"A"}]' due-date="today"></${t}>`
    const el = document.body.firstElementChild
    await until(() => meta(el) === '41|true|1|0', 'attributes in state')
    expect(el.querySelector('.title').textContent).toBe('Hi')
    expect(el.dueDate).toBe('today')
    el.setAttribute('count', '9'); el.removeAttribute('readonly')
    await until(() => meta(el) === '9|false|1|0', 'attribute changes')
    el.tasks = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }]
    await until(() => meta(el) === '9|false|2|0', 'property change')
    expect(el.tasks).toHaveLength(2)
    el.setAttribute('tasks', '{bad json')
    await sleep(20)
    expect(el.tasks).toHaveLength(2)
  })

  it('an array of prop names means all String', async () => {
    const t = tag('names')
    function Name({ state }) { return h('p', { className: 'meta' }, `${state.first} ${state.lastName}`) }
    defineElement(t, Name, { props: ['first', 'lastName'] })
    document.body.innerHTML = `<${t} first="Ada" last-name="Lovelace"></${t}>`
    await until(() => meta(document) === 'Ada Lovelace', 'string props')
  })

  it('a property set before the tag is defined reaches state (lazy property)', async () => {
    const t = tag('lazy')
    const el = document.createElement(t)
    el.tasks = [{ id: 'z', name: 'Z' }]
    document.body.appendChild(el)
    defineElement(t, Board, { props, events })
    await until(() => meta(el) === '0|false|1|0', 'lazy property')
    expect(Object.prototype.hasOwnProperty.call(el, 'tasks')).toBe(false)
  })

  it('sinks → CustomEvents (PARENT unwrapped; other sinks as is), bubbling and composed', async () => {
    const t = tag('events')
    defineElement(t, Board, { props, events })
    document.body.innerHTML = `<${t} tasks='[{"id":"t1","name":"T1"}]'></${t}>`
    const got = []
    document.addEventListener('task-picked', e => got.push(e))
    document.addEventListener('task-saved', e => got.push(e))
    await until(() => document.querySelector('.task'), 'render')
    document.querySelector('.task').click()
    await until(() => got.length === 2, 'events')
    const picked = got.find(e => e.type === 'task-picked')
    expect(picked.detail).toEqual({ id: 't1' })
    expect(picked.bubbles && picked.composed).toBe(true)
    expect(got.find(e => e.type === 'task-saved').detail).toBe('saved t1')
  })

  it('shadow root: renders inside it, delegated DOM events work, events are retargeted to the host', async () => {
    const t = tag('shadow')
    defineElement(t, Board, { props, events, shadow: true })
    document.body.innerHTML = `<${t} tasks='[{"id":"s1","name":"S1"}]'></${t}>`
    const el = document.body.firstElementChild
    const root = el.shadowRoot
    await until(() => meta(root) === '0|false|1|0', 'shadow render')
    expect(el.querySelector('.board')).toBeNull()
    root.querySelector('.btn').click()
    await until(() => meta(root) === '0|false|1|1', 'click in shadow root')
    let got = null
    document.addEventListener('task-picked', e => { got = e })
    root.querySelector('.task').click()
    await until(() => got, 'event')
    expect(got.target).toBe(el)
  })

  it("shadow: 'closed' keeps the root private", async () => {
    const t = tag('closed')
    defineElement(t, Board, { props, shadow: 'closed' })
    document.body.innerHTML = `<${t}></${t}>`
    await sleep(30)
    expect(document.body.firstElementChild.shadowRoot).toBeNull()
    expect(document.querySelector('.board')).toBeNull()
  })

  it('removal disposes and clears; a move keeps state; reconnecting starts fresh', async () => {
    const t = tag('life')
    defineElement(t, Board, { props, events })
    document.body.innerHTML = `<${t}></${t}><div id="other"></div>`
    const el = document.body.firstElementChild
    await until(() => meta(el) === '0|false|0|0', 'render')
    el.querySelector('.btn').click()
    await until(() => meta(el) === '0|false|0|1', 'click')
    document.getElementById('other').appendChild(el)
    await sleep(20)
    expect(meta(el)).toBe('0|false|0|1')
    el.querySelector('.btn').click()
    await until(() => meta(el) === '0|false|0|2', 'still running after the move')
    el.remove()
    await sleep(20)
    expect(el.childElementCount).toBe(0)
    document.body.appendChild(el)
    await until(() => meta(el) === '0|false|0|0', 'fresh start')
    el.querySelector('.btn').click()
    await until(() => meta(el) === '0|false|0|1', 'events work after reconnect')
  })

  it('HMR: defineElement again swaps every live instance, keeping each one\'s state, and returns the same constructor', async () => {
    const t = tag('hmr')
    const Ctor = defineElement(t, Board, { props, events })
    document.body.innerHTML = `<${t} heading="one"></${t}><${t} heading="two"></${t}>`
    const [a, b] = document.body.children
    await until(() => meta(a) && meta(b), 'render')
    a.querySelector('.btn').click()
    await until(() => meta(a) === '0|false|0|1', 'click a')
    function Board2({ state }) {
      return h('div', null, h('h3', { className: 'title' }, 'v2:' + state.heading), h('p', { className: 'meta' }, String(state.clicks)), h('button', { className: 'btn' }, '+'))
    }
    Object.assign(Board2, { initialState: Board.initialState, intent: Board.intent, model: Board.model })
    expect(defineElement(t, Board2, { props, events })).toBe(Ctor)
    await until(() => a.querySelector('.title')?.textContent === 'v2:one' && b.querySelector('.title')?.textContent === 'v2:two', 'swapped')
    await sleep(60)
    expect([meta(a), meta(b)]).toEqual(['1', '0'])
    b.querySelector('.btn').click()
    await until(() => meta(b) === '1', 'b works after the swap')
    a.heading = 'uno'
    await until(() => a.querySelector('.title').textContent === 'v2:uno', 'props after the swap')
    await sleep(150)
  })

  it('instance fields are private: props named like the spike\'s fields (p, app, root, set) work', async () => {
    const t = tag('private')
    function Fields({ state }) { return h('p', { className: 'meta' }, [state.p, state.app, state.root, state.set].join(',')) }
    const El = defineElement(t, Fields, { props: ['p', 'app', 'root', 'set'] })
    document.body.innerHTML = `<${t} p="1" app="2" root="3" set="4"></${t}>`
    const el = document.body.firstElementChild
    await until(() => meta(el) === '1,2,3,4', 'render')
    el.set = 'x'
    await until(() => meta(el) === '1,2,3,x', 'prop named set')
    expect(Object.getOwnPropertyNames(el)).toEqual([])
    expect(Object.getOwnPropertyNames(El.prototype).sort()).toEqual(['app', 'attributeChangedCallback', 'connectedCallback', 'constructor', 'disconnectedCallback', 'p', 'root', 'set'])
  })

  it('each instance gets its own uid root (no duplicate ids in the light DOM)', async () => {
    const t = tag('uid')
    defineElement(t, Board, { props })
    document.body.innerHTML = `<${t}></${t}><${t}></${t}>`
    await until(() => document.querySelectorAll('.board').length === 2, 'render')
    const ids = [...document.querySelectorAll('.board')].map(e => e.id)
    expect(ids[0]).not.toBe(ids[1])
    expect(ids[0].startsWith(t + '-')).toBe(true)
  })

  it('dev warning (once per tag, only with __SYGNAL_DEV__) for a prop that hides an HTMLElement member', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const quiet = tag('quiet')
    defineElement(quiet, Board, { props: { title: String } })
    document.body.innerHTML = `<${quiet}></${quiet}>`
    await sleep(20)
    expect(warn).not.toHaveBeenCalled()

    globalThis.__SYGNAL_DEV__ = true
    const t = tag('warn')
    defineElement(t, Board, { props: { title: String, hidden: Boolean, heading: String } })
    document.body.innerHTML = `<${t}></${t}><${t}></${t}>`
    await sleep(20)
    const calls = warn.mock.calls.filter(c => String(c[0]).includes('[sygnal/element]'))
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toContain(`<${t}>`)
    expect(calls[0][0]).toContain('title, hidden')
    expect(calls[0][0]).not.toContain('heading')
  })

  it('rejects DOM/STATE/EVENTS as event sinks, and component() results', () => {
    for (const sink of ['DOM', 'STATE', 'EVENTS']) {
      expect(() => defineElement(tag('bad'), Board, { events: { [sink]: 'x' } })).toThrow(/driver of the element's app/)
    }
    const built = Object.assign(() => null, { isSygnalComponent: true })
    expect(() => defineElement(tag('bad'), built)).toThrow(/plain function component/)
  })

  it('G-212: an element keeps the host app\'s diagnostics mode and DevTools registration', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const host = run(Board, {}, { mountPoint: '#root', diagnostics: 'collect' })
    apps.push(host)
    const t = tag('host')
    defineElement(t, Board, { props })
    document.body.insertAdjacentHTML('beforeend', `<${t}></${t}>`)
    await until(() => document.querySelectorAll('.board').length === 2, 'render')
    expect(getDiagnosticsMode()).toBe('collect')
    expect(window.__SYGNAL_DEVTOOLS_APP__).toBe(host)
  })

  it('an element that starts before the host app leaves the DevTools slot to the host', async () => {
    const t = tag('first')
    defineElement(t, Board, { props })
    document.body.innerHTML = `<${t}></${t}><div id="root"></div>`
    await until(() => document.querySelector('.board'), 'element')
    expect(window.__SYGNAL_DEVTOOLS_APP__).toBeUndefined()
    const host = run(Board, {}, { mountPoint: '#root' })
    apps.push(host)
    expect(window.__SYGNAL_DEVTOOLS_APP__).toBe(host)
  })

  it("starts at once with its own state while a host app is hot-swapping (G-216: the swap is the host's own)", async () => {
    const t = tag('wait')
    defineElement(t, Board, { props })
    document.body.innerHTML = `<div id="root"></div><div id="el"></div>`
    const host = run(Board, {}, { mountPoint: '#root' })
    apps.push(host)
    await until(() => document.querySelector('#root .board'), 'host')
    setState(host, s => ({ ...s, heading: 'host', count: 9 }))
    await until(() => meta(document.querySelector('#root')) === '9|false|0|0', 'host count 9')
    host.hmr(Board)
    document.querySelector('#el').innerHTML = `<${t} count="3"></${t}>`
    await until(() => meta(document.querySelector('#el')) === '3|false|0|0', 'element with its own state')
    await sleep(150)
    expect(meta(document.querySelector('#el'))).toBe('3|false|0|0')
    expect(document.querySelector('#el .title').textContent).toBe('none')
    expect(meta(document.querySelector('#root'))).toBe('9|false|0|0')
  })
})
