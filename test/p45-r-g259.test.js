// @vitest-environment jsdom
// P45-R G-259: the G-146 bypass (an equal state still renders after an input, so a controlled
// field is put back to the model's value: D155) read a global input counter, so after any
// keystroke every component that got an equal state rendered again (a 20-row Collection next to
// an input: each row once per keystroke). It now applies only to a component whose last view
// had a form field.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, Collection } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })

let apps = []
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = '' })

function mount(App) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  apps.push(run(App, {}, { mountPoint: '#root' }))
  return { $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)] }
}
const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }

describe('P45-R G-259: renders after an input', () => {
  it('a keystroke does not re-render Collection rows whose state is unchanged', async () => {
    let rowRenders = 0
    function Row({ state }) { rowRenders++; return h('li', { className: 'row' }, state.label) }
    function App({ state }) {
      return h('div', null, h('input', { className: 'q', value: state.q }), h('ul', null, h(Collection, { of: Row, from: 'rows' })))
    }
    App.initialState = { q: '', rows: Array.from({ length: 20 }, (_, i) => ({ id: i, label: 'r' + i })) }
    App.intent = ({ DOM }) => ({ Q: DOM.input('.q').map(e => e.target.value) })
    App.model = { Q: (s, q) => ({ ...s, q }) }
    const m = mount(App)
    await until(() => expect(m.$$('.row').length).toBe(20))
    await sleep(20)
    rowRenders = 0
    for (const v of ['a', 'ab', 'abc']) { type(m.$('.q'), v); await sleep(5) }
    await sleep(20)
    expect(m.$('.q').value).toBe('abc')
    expect(rowRenders).toBe(0)
  })

  it('D155 kept: a model that keeps the state equal still puts the field back', async () => {
    function App({ state }) { return h('input', { className: 'q', value: state.q }) }
    App.initialState = { q: 'abc' }
    // a length cap: the 4th character is cut (a new state object, equal to the old one)
    App.intent = ({ DOM }) => ({ Q: DOM.input('.q').map(e => e.target.value) })
    App.model = { Q: (s, q) => ({ q: q.slice(0, 3) }) }
    const m = mount(App)
    await until(() => expect(m.$('.q')).toBeTruthy())
    await sleep(20)
    type(m.$('.q'), 'abcd')
    await until(() => expect(m.$('.q').value).toBe('abc'))
  })

  it('D155 kept in a child: a field in a Collection row is put back', async () => {
    function Row({ state }) { return h('input', { className: 'f', value: state.v }) }
    Row.intent = ({ DOM }) => ({ V: DOM.input('.f').map(e => e.target.value) })
    Row.model = { V: (s, v) => ({ ...s, v: v.slice(0, 2) }) }
    function App() { return h('div', null, h(Collection, { of: Row, from: 'rows' })) }
    App.initialState = { rows: [{ id: 1, v: 'ab' }, { id: 2, v: 'cd' }] }
    const m = mount(App)
    await until(() => expect(m.$$('.f').length).toBe(2))
    await sleep(20)
    type(m.$$('.f')[1], 'cde')
    await until(() => expect(m.$$('.f')[1].value).toBe('cd'))
  })
})
