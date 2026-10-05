// @vitest-environment jsdom
// PLAN-4.6 parity: D174, an isolatedState child bound to a slice (state="key"): initialState
// seeds the slice only while it is undefined; `resetState` replaces it at creation.
import { it, expect } from 'vitest'
import { parity, itNext, mount, h, click, until, sleep } from './harness.js'

function Editor({ state, ...props }) { return h('p', { className: 'ed', 'data-props': Object.keys(props).filter((k) => k != 'children' && k != 'slots' && k != 'context' && k != 'uid').sort().join() }, `${state.title}:${state.draft ?? '-'}`) }
Editor.isolatedState = true
Editor.initialState = { title: 'new', draft: '' }
Editor.intent = ({ DOM }) => ({ TYPE: DOM.click('.ed') })
Editor.model = { TYPE: (s) => ({ ...s, draft: s.draft + 'x' }) }

function host(reset) {
  function App({ state }) { return h('div', null, h('button', { className: 'toggle' }), state.open ? h(Editor, { state: 'doc', ...(reset && { resetState: true }) }) : null) }
  App.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
  App.model = { TOGGLE: (s) => ({ ...s, open: !s.open }) }
  return App
}

parity('parity: D174 isolatedState + state="key" seeds only a missing slice; resetState', () => {
  it('a missing slice is seeded with initialState (both cores)', async () => {
    const App = host(false)
    App.initialState = { open: true }
    const m = mount(App)
    await until(() => expect(m.text('.ed')).toBe('new:'))
    expect(m.state().doc).toEqual({ title: 'new', draft: '' })
  })

  itNext('D174 isolatedState keeps the parent\'s slice', "an existing slice is kept: the child shows the parent's data, and writes to it", async () => {
    const App = host(false)
    App.initialState = { open: true, doc: { title: 'kept', draft: 'ab' } }
    const m = mount(App)
    await until(() => expect(m.text('.ed')).toBe('kept:ab'))
    click(m.$('.ed'))
    await until(() => expect(m.state().doc).toEqual({ title: 'kept', draft: 'abx' }))
  })

  itNext('D174 isolatedState keeps the parent\'s slice', 'unmounted and mounted again, the child keeps what it wrote', async () => {
    const App = host(false)
    App.initialState = { open: true }
    const m = mount(App)
    await until(() => expect(m.text('.ed')).toBe('new:'))
    click(m.$('.ed'))
    await until(() => expect(m.text('.ed')).toBe('new:x'))
    click(m.$('.toggle'))
    await until(() => expect(m.$('.ed')).toBe(null))
    click(m.$('.toggle'))
    await until(() => expect(m.$('.ed')).toBeTruthy())
    await sleep(10)
    expect(m.text('.ed')).toBe('new:x')
  })

  it('resetState: the slice is replaced with initialState at creation (both cores)', async () => {
    const App = host(true)
    App.initialState = { open: false, doc: { title: 'old', draft: 'zz' } }
    const m = mount(App)
    await until(() => expect(m.$('.toggle')).toBeTruthy())
    click(m.$('.toggle'))
    await until(() => expect(m.text('.ed')).toBe('new:'))
    expect(m.state().doc).toEqual({ title: 'new', draft: '' })
  })

  itNext('D174 resetState is not a prop', 'resetState is read at creation, like state: the child does not get it as a prop', async () => {
    const App = host(true)
    App.initialState = { open: true }
    const m = mount(App)
    await until(() => expect(m.$('.ed')).toBeTruthy())
    expect(m.$('.ed').getAttribute('data-props')).toBe('')
  })
}, 'R2')
