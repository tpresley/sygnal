// @vitest-environment jsdom
// sygnal/worker + sygnal/worker/page (experimental; research: dev-plans/research/web-worker): the
// worker target and the page bridge on one real MessageChannel in jsdom. The first-version items
// (Q-WW-2 declared preventDefault, Q-WW-3 held submit, Q-WW-4 caret, Q-WW-7 coalescing), the
// rebase, no echo, and the page drivers. The whole-app mirror test (todomvc, 120 random actions)
// is examples/todomvc-worker's; the real Worker path is browser-tests' (worker-p72.jsx).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, createElement as h, Collection, xs } from 'sygnal'
import { createWorkerTarget } from 'sygnal/worker'
import { startBridge, rebase, caret } from 'sygnal/worker/page'

const settle = (ms = 30) => new Promise((ok) => setTimeout(ok, ms))
// the channel's round trips take longer on a loaded machine: wait for the outcome, not a fixed time
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 10 })
let env = null
afterEach(() => { env?.app.dispose(); env?.bridge.stop(); env?.ch.port1.close(); env?.ch.port2.close(); env = null })

function setup(App, { drivers = {}, remotes = {}, bridge: opts = {} } = {}) {
  document.body.innerHTML = '<div id="root"></div>'
  const mount = document.getElementById('root')
  const ch = new MessageChannel()
  const bridge = startBridge(ch.port2, mount, { drivers, ...opts })
  const target = createWorkerTarget(ch.port1)
  const extra = Object.fromEntries(Object.entries(remotes).map(([k, m]) => [k, target.remote(k, m)]))
  const app = run(App, { DOM: target.driver, ...extra })
  env = { mount, target, bridge, app, ch }
  return env
}
const typeInto = (el, text) => {
  for (const c of text) { el.value += c; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: c, inputType: 'insertText' })) }
}
const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

function Todos({ state }) {
  return h('div', null,
    h('form', { className: 'add' }, h('input', { className: 'new', value: state.text })),
    h('ul', null, ...state.items.map((t, i) => h('li', { key: i }, t))))
}
Todos.initialState = { text: '', items: [] }
Todos.intent = ({ DOM }) => ({ TYPE: DOM.select('.new').events('input').value(), ADD: DOM.select('.add').events('submit') })
Todos.model = {
  TYPE: (s, v) => ({ ...s, text: v }),
  ADD: (s) => (s.text ? { text: '', items: [...s.items, s.text] } : s),
}
const items = (mount) => Array.from(mount.querySelectorAll('li')).map((li) => li.textContent)

describe('sygnal/worker: fields', () => {
  it('a field value the page sent is not echoed back', async () => {
    const { mount, bridge } = setup(Todos)
    await bridge.ready
    const input = mount.querySelector('.new')
    let writes = 0
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    Object.defineProperty(input, 'value', { get() { return desc.get.call(this) }, set(v) { writes++; desc.set.call(this, v) }, configurable: true })
    input.value = 'ab'; writes = 0
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await until(() => expect(env.target.doc.querySelector('.new').value).toBe('ab'))
    // the worker's render of the same value (and the flush after it) is not written back
    await settle()
    expect(writes).toBe(0)
  })

  it('rebases a worker value onto what the user typed since, and the app state follows (an input event)', async () => {
    const { mount, bridge } = setup(Todos)
    await bridge.ready
    const input = mount.querySelector('.new')
    typeInto(input, 'Buy milk')
    submit(input.form)
    await settle(0)
    typeInto(input, 'W') // before the worker's clear arrives
    await until(() => expect(items(mount)).toEqual(['Buy milk']))
    await until(() => expect(input.value).toBe('W'))
    typeInto(input, 'alk')
    submit(input.form)
    await until(() => expect(items(mount)).toEqual(['Buy milk', 'Walk']))
    expect(input.value).toBe('')
  })

  it('Q-WW-3: a word and Enter inside one round trip still submit what was typed (the submit waits for the ack)', async () => {
    const { mount, bridge } = setup(Todos)
    await bridge.ready
    const input = mount.querySelector('.new')
    // all of it before the worker answers anything
    typeInto(input, 'Buy milk')
    submit(input.form)
    typeInto(input, 'Walk dog')
    submit(input.form)
    typeInto(input, 'Feed cat')
    await until(() => expect(items(mount)).toEqual(['Buy milk', 'Walk dog']))
    await until(() => expect(input.value).toBe('Feed cat'))
    expect(bridge.stats.held).toBeGreaterThan(0)
    submit(input.form)
    await until(() => expect(items(mount)).toEqual(['Buy milk', 'Walk dog', 'Feed cat']))
  })

  it('Q-WW-4: the caret keeps its place through a worker write and a rebase', async () => {
    function Trim({ state }) { return h('input', { className: 't', value: state.v }) }
    Trim.initialState = { v: '' }
    Trim.intent = ({ DOM }) => ({ V: DOM.select('.t').events('input').value() })
    Trim.model = { V: (s, v) => ({ v: v.replace(/^\s+/, '') }) }
    const { mount, bridge } = setup(Trim)
    await bridge.ready
    const input = mount.querySelector('.t')
    input.focus()
    input.value = '  abcd'
    input.setSelectionRange(4, 4) // between b and c
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await until(() => expect(input.value).toBe('abcd'))
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2])
    expect(caret('Buy milkW', 'W', 9)).toBe(1)
    expect(rebase('Buy milk', 'Buy milkW', '')).toBe('W')
  })
})

describe('sygnal/worker: declared preventDefault (Q-WW-2), on the page synchronously', () => {
  function Row({ state }) {
    return h('li', null, h('a', { className: 'go', href: '#' + state.id }, 'row'), h('input', { className: 'k' }))
  }
  Row.intent = ({ DOM }) => ({
    GO: DOM.select('.go').events('click', { preventDefault: true }),
    KEY: DOM.select('.k').events('keydown', { preventDefault: { key: 'Tab' } }),
  })
  Row.model = { GO: (s) => s, KEY: (s) => s }
  function List() {
    return h('div', null, h('a', { className: 'go', href: '#top' }, 'top'), h('ul', null, h(Collection, { of: Row, from: 'rows' })))
  }
  List.initialState = { rows: [{ id: 1 }, { id: 2 }] }
  // the root's own '.go' listens without preventing: isolation keeps the rows' declaration off it
  List.intent = ({ DOM }) => ({ TOP: DOM.select('.go').events('click') })
  List.model = { TOP: (s) => s }

  it('applies an intent\'s declaration inside its isolation scope only; a pattern matches event fields', async () => {
    const { mount, bridge } = setup(List)
    await until(() => expect(mount.querySelectorAll('.go').length).toBe(3))
    const click = (el) => { const e = new MouseEvent('click', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented }
    const key = (el, k) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: k }); el.dispatchEvent(e); return e.defaultPrevented }
    const [top, row1] = mount.querySelectorAll('.go')
    expect(click(row1)).toBe(true)
    expect(click(top)).toBe(false)
    const k = mount.querySelector('.k')
    expect(key(k, 'Tab')).toBe(true)
    expect(key(k, 'a')).toBe(false)
  })

  it('a submit is prevented by default', async () => {
    const { mount, bridge } = setup(Todos)
    await bridge.ready
    const ev = new Event('submit', { bubbles: true, cancelable: true })
    mount.querySelector('form').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })
})

describe('sygnal/worker: high-frequency events (Q-WW-7)', () => {
  function Pad({ state }) { return h('div', { className: 'pad' }, h('p', null, state.log.join(','))) }
  Pad.initialState = { log: [] }
  Pad.intent = ({ DOM }) => ({
    MOVE: DOM.select('.pad').events('pointermove').map((e) => 'm' + e.clientX),
    WHEEL: DOM.select('.pad').events('wheel').map((e) => 'w' + e.deltaY),
    CLICK: DOM.select('.pad').events('click').map(() => 'c'),
  })
  const add = (s, x) => ({ log: [...s.log, x] })
  Pad.model = { MOVE: add, WHEEL: add, CLICK: add }

  it('sends the latest pointermove and the summed wheel once a frame; another event sends them first', async () => {
    const { mount, bridge } = setup(Pad)
    await bridge.ready
    const pad = mount.querySelector('.pad')
    for (let x = 1; x <= 10; x++) pad.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x }))
    for (let i = 0; i < 4; i++) pad.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 5 }))
    await until(() => expect(mount.querySelector('p').textContent).toBe('m10,w20'))
    pad.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 42 }))
    pad.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await until(() => expect(mount.querySelector('p').textContent).toBe('m10,w20,m42,c'))
  })
})

describe('sygnal/worker: page drivers', () => {
  it('remote(name, methods): a page driver\'s source methods and sink, by message', async () => {
    const written = []
    const STORE = (sink$) => { sink$.addListener({ next: (v) => written.push(v) }); return { get: (k) => xs.of('saved:' + k) } }
    function App({ state }) { return h('p', null, state.v) }
    App.initialState = { v: '' }
    App.intent = ({ STORE }) => ({ LOADED: STORE.get('a') })
    App.model = { LOADED: { STATE: (s, v) => ({ v }), STORE: (s, v) => ({ wrote: v }) } }
    const { mount, bridge } = setup(App, { drivers: { STORE }, remotes: { STORE: ['get'] } })
    await bridge.ready
    await until(() => expect(mount.textContent).toBe('saved:a'))
    expect(written).toEqual([{ wrote: 'saved:a' }])
  })
})
