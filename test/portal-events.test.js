// @vitest-environment jsdom
// Sift (preview.5 #4): events from a Portal's content reach the intents of the components it is
// rendered in, as React's portals: they bubble from the content to the placeholder, through the
// components around it. DOM.select(sel).elements() and non-bubbling events find the content too;
// components inside the Portal keep their own scope.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, Portal, xs } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })
let apps = []
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = '' })

function start(App, { target = true, diagnostics } = {}) {
  document.body.innerHTML = `<div id="root"></div>${target ? '<div id="modal-root"></div>' : ''}`
  apps.push(run(App, {}, { mountPoint: '#root', ...(diagnostics && { diagnostics }) }))
}
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

function Item({ state }) { return h('button', { className: 'go' }, `item ${state.n}`) }
Item.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Item.model = { GO: (s) => ({ ...s, n: s.n + 1 }) }

function Owner({ state }) {
  return h('div', { className: 'owner' },
    h('p', { className: 'count' }, `${state.hints}/${state.wraps}/${state.toggles}/${state.found}`),
    h(Portal, { target: '#modal-root' },
      h('div', { className: 'panel' },
        h('button', { className: 'hint' }, 'Hint'),
        h('details', { className: 'more' }, h('summary', null, 'more')),
        h(Item, { state: 'item' }))))
}
Owner.initialState = { hints: 0, wraps: 0, toggles: 0, found: 0, item: { n: 0 } }
Owner.intent = ({ DOM }) => ({
  HINT: DOM.click('.hint'),
  WRAP: DOM.select('.owner').events('click'),
  TOGGLE: DOM.select('.more').events('toggle'),
  FOUND: DOM.select('.hint').elements().map((els) => els.length).filter((n) => n > 0).take(1),
  STRAY: DOM.click('.go'),
})
Owner.model = {
  HINT: (s) => ({ ...s, hints: s.hints + 1 }),
  WRAP: (s) => ({ ...s, wraps: s.wraps + 1 }),
  TOGGLE: (s) => ({ ...s, toggles: s.toggles + 1 }),
  FOUND: (s, n) => ({ ...s, found: n }),
  STRAY: (s) => ({ ...s, stray: (s.stray || 0) + 1 }),
}

describe("an intent hears its own Portal's content", () => {
  it('a click bubbles to the owner (its selector, then an element around the placeholder)', async () => {
    start(Owner)
    await until(() => expect(document.querySelector('#modal-root .hint')).toBeTruthy())
    click(document.querySelector('#modal-root .hint'))
    await until(() => expect(document.querySelector('.count').textContent).toBe('1/1/0/1'))
  })

  it('a non-bubbling event (toggle) and elements() find the content', async () => {
    start(Owner)
    await until(() => expect(document.querySelector('.count').textContent).toBe('0/0/0/1'))
    const d = document.querySelector('#modal-root .more')
    d.open = true   // jsdom fires toggle, as browsers do
    await until(() => expect(document.querySelector('.count').textContent).toBe('0/0/1/1'))
  })

  it('a component inside the Portal keeps its scope: its intent hears it, the owner\'s selector does not match it', async () => {
    start(Owner)
    await until(() => expect(document.querySelector('#modal-root .go')).toBeTruthy())
    click(document.querySelector('#modal-root .go'))
    await until(() => expect(document.querySelector('#modal-root .go').textContent).toBe('item 1'))
    // the click bubbles out of Item to the owner's element around it, as from any child
    await until(() => expect(document.querySelector('.count').textContent).toBe('0/1/0/1'))
    expect(apps[0].__runtime.getState().stray).toBeUndefined()
  })

  it('a Portal whose target is inside the app delivers each event once', async () => {
    function App({ state }) {
      return h('main', null,
        h('p', { className: 'n' }, String(state.n)),
        h('div', { id: 'inner-target' }),
        h(Portal, { target: '#inner-target' }, h('button', { className: 'b' }, 'b')))
    }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ B: DOM.click('.b') })
    App.model = { B: (s) => ({ n: s.n + 1 }) }
    start(App, { target: false })
    await until(() => expect(document.querySelector('#inner-target .b')).toBeTruthy())
    click(document.querySelector('#inner-target .b'))
    await until(() => expect(document.querySelector('.n').textContent).toBe('1'))
    await new Promise((r) => setTimeout(r, 20))
    expect(document.querySelector('.n').textContent).toBe('1')
  })

  it('the listeners go with the Portal', async () => {
    function App({ state }) {
      return h('div', null, h('p', { className: 'n' }, String(state.n)),
        state.open && h(Portal, { target: '#modal-root' }, h('button', { className: 'b' }, 'b')))
    }
    App.initialState = { n: 0, open: true }
    App.intent = ({ DOM }) => ({ B: DOM.click('.b'), CLOSE: xs.never() })
    App.model = { B: (s) => ({ ...s, n: s.n + 1, open: false }) }
    start(App)
    await until(() => expect(document.querySelector('#modal-root .b')).toBeTruthy())
    const b = document.querySelector('#modal-root .b')
    click(b)
    await until(() => expect(document.querySelector('#modal-root .b')).toBeNull())
    document.querySelector('#modal-root').appendChild(b)
    click(b)
    await new Promise((r) => setTimeout(r, 20))
    expect(document.querySelector('.n').textContent).toBe('1')
  })
})

describe("SYG103 and a Portal's content", () => {
  it("a selector that matches only in the component's Portal is matched (not reported)", async () => {
    const { configureChecks } = await import('../src/extra/diagnostics/checks/index.js')
    const { getDiagnostics, clearDiagnostics } = await import('../src/extra/diagnostics/index.js')
    configureChecks({ settleMs: 5 })
    clearDiagnostics()
    // the class is built at run time, so SYG103's view-source filter doesn't hide a miss
    const cls = ['p', 'ok'].join('')
    function Dlg() { return h('div', null, h(Portal, { target: '#modal-root' }, h('button', { className: cls }, 'ok'))) }
    Dlg.initialState = {}
    Dlg.intent = ({ DOM }) => ({ OK: DOM.click('.' + cls) })
    Dlg.model = { OK: (s) => s }
    start(Dlg, { diagnostics: 'collect' })
    await until(() => expect(document.querySelector('#modal-root .pok')).toBeTruthy())
    await new Promise((r) => setTimeout(r, 60))
    expect(getDiagnostics().filter((d) => d.code === 'SYG103')).toEqual([])
    configureChecks({ settleMs: 50 })
  })
})

describe("renderComponent: the owner hears its Portal's content", () => {
  for (const dom of ['mock', 'real']) {
    it(`${dom} DOM`, async () => {
      const { renderComponent } = await import('../src/extra/testing.js')
      document.body.innerHTML = '<div id="modal-root"></div>'
      using t = renderComponent(Owner, { dom })
      await t.ready()
      await t.simulateEvent('.hint', 'click')
      expect(t.state.hints).toBe(1)
      await t.simulateEvent('.go', 'click')
      expect(t.state.item.n).toBe(1)
      expect(t.state.stray).toBeUndefined()
    })
  }
})
