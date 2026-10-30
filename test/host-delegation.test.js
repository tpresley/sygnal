// sygnal/host: events(type, { preventDefault }) (sandbox §6.1, web-worker Q-WW-2) and delegation
// indexed by event type and isolation scope (sandbox §6.2): one walk per event, the same
// deliveries in the same order as a delegate-by-delegate walk.
import { describe, it, expect, afterEach } from 'vitest'
import { run, createElement as h, Collection } from 'sygnal'
import { HostDocument, HostEvent, makeHostDriver } from 'sygnal/host'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const apps = []
afterEach(() => apps.splice(0).forEach((a) => a.dispose()))
function mount(App) {
  const doc = new HostDocument()
  apps.push(run(App, { DOM: makeHostDriver(doc) }))
  return doc
}

describe('host driver: preventDefault', () => {
  function App({ state }) {
    return h('div', null, h('form', { className: 'f' }, h('input', { className: 'i' })), h('a', { className: 'a', href: '#x' }, 'x'), h('p', { className: 'log' }, state.log.join(',')))
  }
  App.initialState = { log: [] }
  App.intent = ({ DOM }) => ({
    SUBMIT: DOM.select('.f').events('submit', { preventDefault: true }),
    KEY: DOM.select('.i').events('keydown', { preventDefault: { key: 'Tab' } }),
    CLICK: DOM.select('.a').events('click', { preventDefault: (e) => !e.ctrlKey }),
  })
  App.model = {
    SUBMIT: (s, e) => ({ log: [...s.log, 'submit:' + e.defaultPrevented] }),
    KEY: (s, e) => ({ log: [...s.log, e.key + ':' + e.defaultPrevented] }),
    CLICK: (s, e) => ({ log: [...s.log, 'click:' + e.defaultPrevented] }),
  }

  it('true, a pattern of event fields and a predicate cancel before delivery, as the DOM driver does', async () => {
    const doc = mount(App)
    await tick()
    const q = (s) => doc.querySelector(s)
    expect(q('.f').dispatchEvent(new HostEvent('submit'))).toBe(false)
    expect(q('.i').dispatchEvent(new HostEvent('keydown', { key: 'Tab' }))).toBe(false)
    expect(q('.i').dispatchEvent(new HostEvent('keydown', { key: 'a' }))).toBe(true)
    expect(q('.a').dispatchEvent(new HostEvent('click'))).toBe(false)
    expect(q('.a').dispatchEvent(new HostEvent('click', { ctrlKey: true }))).toBe(true)
    // a bubbling event from inside the matched element is cancelled too
    expect(q('.i').dispatchEvent(new HostEvent('submit'))).toBe(false)
    await tick()
    expect(q('.log').textContent).toBe('submit:true,Tab:true,a:false,click:true,click:false,submit:true')
  })

  it('the declaration is readable on the delegate (a target that decides elsewhere: sygnal/worker)', async () => {
    const doc = mount(App)
    await tick()
    const decl = [...doc.delegates].filter((d) => d.preventDefault).map((d) => [d.type, d.selector, typeof d.preventDefault == 'function' ? 'fn' : d.preventDefault])
    expect(decl).toEqual([['submit', '.f', true], ['keydown', '.i', { key: 'Tab' }], ['click', '.a', 'fn']])
  })
})

describe('host driver: indexed delegation', () => {
  function Row({ state }) {
    return h('li', { className: 'row' }, h('button', { className: 'hit' }, String(state.n)))
  }
  Row.intent = ({ DOM }) => ({ HIT: DOM.select('.hit').events('click'), ROW: DOM.select('.row').events('click') })
  Row.model = { HIT: (s) => ({ ...s, n: s.n + 1 }), ROW: { PARENT: (s) => 'row' + s.id }, }
  function App({ state }) {
    return h('ul', { className: 'list' }, h(Collection, { of: Row, from: 'rows' }), h('li', { className: 'log' }, state.log.join(',')))
  }
  App.initialState = { rows: [{ id: 1, n: 0 }, { id: 2, n: 0 }, { id: 3, n: 0 }], log: [] }
  App.intent = ({ DOM, CHILD }) => ({
    LIST: DOM.select('.list').events('click'),
    ADD: DOM.select('.list').events('keydown'),
    // total isolation: the root's '.hit' never matches a row component's button
    HIT: DOM.select('.hit').events('click'),
    DOC: DOM.select('document').events('click'),
    ROWS: CHILD.select(Row),
  })
  App.model = {
    LIST: (s) => ({ ...s, log: [...s.log, 'list'] }),
    ADD: (s) => ({ ...s, rows: [...s.rows, { id: 4, n: 5 }] }),
    HIT: (s) => ({ ...s, log: [...s.log, 'root-hit'] }),
    DOC: (s, e) => ({ ...s, log: [...s.log, 'doc:' + e.target.localName] }),
    ROWS: (s, d) => ({ ...s, log: [...s.log, d] }),
  }

  it('delivers to each matching source once, in the order the sources subscribed, scoped by isolation', async () => {
    const doc = mount(App)
    await tick()
    const second = doc.querySelectorAll('.hit')[1]
    second.dispatchEvent(new HostEvent('click'))
    await tick()
    expect(doc.querySelectorAll('.hit').map((b) => b.textContent)).toEqual(['0', '1', '0'])
    expect(doc.querySelector('.log').textContent).toBe('list,doc:button,row2')
  })

  it('a delegate added outside the driver (a plain function) is still called, in order', async () => {
    const doc = mount(App)
    await tick()
    const seen = []
    const plain = Object.assign((e) => seen.push(e.type), { type: 'click', accepts: () => true })
    doc.delegates.add(plain)
    doc.querySelector('.hit').dispatchEvent(new HostEvent('click'))
    doc.delegates.delete(plain)
    doc.querySelector('.hit').dispatchEvent(new HostEvent('click'))
    expect(seen).toEqual(['click'])
  })

  it('rows added later get their own delegates (the index follows the set)', async () => {
    const doc = mount(App)
    await tick()
    doc.querySelector('.list').dispatchEvent(new HostEvent('keydown'))
    await tick()
    doc.querySelectorAll('.hit')[3].dispatchEvent(new HostEvent('click'))
    await tick()
    expect(doc.querySelectorAll('.hit')[3].textContent).toBe('6')
  })
})
