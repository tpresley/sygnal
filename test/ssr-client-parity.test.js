// @vitest-environment jsdom
// renderToString gives a child the state the client gives it (core/cell.ts): without a `state`
// prop the parent's state (it got its own initialState, undefined, so a view reading state threw
// into the error fallback), a path key (`"a.b"`, `"a[0].b"`), a lens's get() (it got the lens
// object), an isolatedState child its own initialState. A Switchable renders its `current` page of
// `of` with its props, children and `state` binding (it rendered an empty <div>: the server read
// prop names the client no longer has). Each is hydrated: the client adopts the server's elements.
// ClientOnly with no children renders nothing on the client.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, renderToString, createElement as h, Switchable } from 'sygnal'
import { ClientOnly } from 'sygnal/vike/ClientOnly'

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

/** server HTML, then hydration: the client's HTML is the server's (attributes aside) and its elements are kept */
async function hydrate(App) {
  const html = renderToString(App)
  document.body.innerHTML = `<div id="root">${html}</div>`
  const root = document.getElementById('root'), before = [...root.querySelectorAll('*')]
  const app = run(App, {}, { mountPoint: '#root' })
  cleanup.push(() => app.dispose())
  await tick()
  expect(root.innerHTML).toBe(html.replace(' data-sygnal-ssr=""', ''))
  expect([...root.querySelectorAll('*')]).toEqual(before)
  return { html, app, root }
}

const Name = ({ state }) => h('b', null, state.name)
describe("renderToString: a child's state, as on the client", () => {
  it("no state prop: the parent's state", async () => {
    function App() { return h('main', null, h(Name)) }
    App.initialState = { name: 'Ada' }
    expect((await hydrate(App)).html).toBe('<main data-sygnal-ssr=""><b>Ada</b></main>')
  })

  it('a path key, a lens, and an isolatedState child', async () => {
    function Local({ state }) { return h('i', null, String(state.n)) }
    Local.isolatedState = true
    Local.initialState = { n: 7 }
    const second = { get: (s) => s.people[1], set: (s, v) => ({ ...s, people: [s.people[0], v] }) }
    function App() { return h('main', null, h(Name, { state: 'team.lead' }), h(Name, { state: 'people[0]' }), h(Name, { state: second }), h(Local)) }
    App.initialState = { team: { lead: { name: 'Lin' } }, people: [{ name: 'Bo' }, { name: 'Cy' }] }
    expect((await hydrate(App)).html).toBe('<main data-sygnal-ssr=""><b>Lin</b><b>Bo</b><b>Cy</b><i>7</i></main>')
  })
})

describe('renderToString: Switchable', () => {
  function Home({ state, tone }) { return h('p', { className: tone }, 'home ' + state.name) }
  function Task({ state, children }) { return h('section', null, 'task ' + state.title, ...children) }
  it("the current page, with the Switchable's props, children and state binding", async () => {
    function App({ state }) {
      return h('main', null, h(Switchable, { of: { home: Home, task: Task }, current: state.page, tone: 'warm', state: { task: 'task' } }, h('em', null, 'kid')))
    }
    App.initialState = { page: 'home', name: 'Ada', task: { title: 'Write' } }
    const { root, app } = await hydrate(App)
    expect(root.innerHTML).toBe('<main><p class="warm">home Ada</p></main>')
    app.__runtime.dispatch('root', 'GO', 'task')
    function App2(p) { return App(p) }
    App2.initialState = { ...App.initialState, page: 'task' }
    expect(renderToString(App2)).toBe('<main data-sygnal-ssr=""><section>task Write<em>kid</em></section></main>')
  })

  it('a current that is not a page renders nothing', () => {
    function App() { return h('main', null, h(Switchable, { of: { home: Home }, current: 'nope' })) }
    App.initialState = {}
    expect(renderToString(App)).toBe('<main data-sygnal-ssr=""></main>')
  })
})

describe('ClientOnly', () => {
  it('with no children renders nothing on the client; one child stands in its place', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    function App({ state }) { return h('main', null, h(ClientOnly, null), h(ClientOnly, null, state.on ? h('b', null, 'on') : null)) }
    App.initialState = { on: true }
    const app = run(App, {}, { mountPoint: '#root' })
    cleanup.push(() => app.dispose())
    await tick()
    expect(document.querySelector('main').innerHTML).toBe('<!----><b>on</b>')
  })
})
