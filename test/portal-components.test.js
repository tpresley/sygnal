// @vitest-environment jsdom
// A component inside a <Portal> is instantiated like any child (it rendered as a literal <kid>
// tag): its view renders into the target with its state, it re-renders, it sends PARENT, a
// Collection inside a portal follows its array, and it is disposed with the portal.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, renderComponent, createElement as h, Portal, Collection } from 'sygnal'

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
let cleanup = [], errors
beforeEach(() => { errors = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => {
  cleanup.splice(0).forEach((f) => f())
  document.body.innerHTML = ''
  const logged = errors.mock.calls
  vi.restoreAllMocks()
  expect(logged).toEqual([])
})

const disposed = []
function Kid({ state }) { return h('p', { className: 'kid' }, 'kid ' + state.n) }
Kid.model = { DISPOSE: (s) => { disposed.push(s.n); return s } }
function Row({ state }) { return h('li', null, state.label) }
function App({ state }) {
  return h('main', null,
    state.open && h(Portal, { target: '#modal' },
      h('section', { className: 'dialog' }, h(Kid, { state: 'kid' }), h('ul', null, h(Collection, { of: Row, from: 'rows' })))))
}
App.initialState = { open: true, kid: { n: 1 }, rows: [{ id: 1, label: 'a' }] }
App.model = {
  BUMP: (s) => ({ ...s, kid: { n: s.kid.n + 1 }, rows: [...s.rows, { id: s.rows.length + 1, label: 'r' + (s.rows.length + 1) }] }),
  CLOSE: (s) => ({ ...s, open: false }),
}

describe('components inside a Portal', () => {
  it('render into the target, follow their state, and are disposed with the portal (real DOM)', async () => {
    document.body.innerHTML = '<div id="root"></div><div id="modal"></div>'
    disposed.length = 0
    const app = run(App, {}, { mountPoint: '#root' })
    cleanup.push(() => app.dispose())
    await tick()
    const modal = document.getElementById('modal')
    expect(modal.querySelector('kid')).toBe(null)
    expect(modal.querySelector('.dialog .kid').textContent).toBe('kid 1')
    expect([...modal.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a'])
    app.__runtime.dispatch('root', 'BUMP')
    await tick()
    expect(modal.querySelector('.kid').textContent).toBe('kid 2')
    expect([...modal.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'r2'])
    app.__runtime.dispatch('root', 'CLOSE')
    await tick()
    expect(modal.querySelector('.kid')).toBe(null)
    expect(disposed).toEqual([2])
  })

  it('send PARENT, and their own intent hears their clicks (mock DOM)', async () => {
    function Btn({ state }) { return h('button', { className: 'ok' }, 'ok ' + state.n) }
    Btn.intent = ({ DOM }) => ({ OK: DOM.click('.ok') })
    Btn.model = { OK: { STATE: (s) => ({ ...s, n: s.n + 1 }), PARENT: (s) => s.n } }
    function Host({ state }) { return h('main', null, h('output', null, String(state.got)), h(Portal, { target: 'body' }, h(Btn, { state: 'btn' }))) }
    Host.initialState = { got: 0, btn: { n: 0 } }
    Host.intent = ({ CHILD }) => ({ GOT: CHILD.select(Btn) })
    Host.model = { GOT: (s, n) => ({ ...s, got: n }) }
    const t = renderComponent(Host)
    cleanup.push(() => t.dispose())
    await t.ready()
    await t.simulateEvent('.ok', 'click')
    expect(t.state).toMatchObject({ got: 1, btn: { n: 1 } })
    expect(t.query('.ok').textContent).toBe('ok 1')
  })
})
