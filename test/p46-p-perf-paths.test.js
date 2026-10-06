// @vitest-environment jsdom
// P46-P (perf spike): the fast paths keep behaviour.
// - a view that runs again with the same plain output keeps its last vnode (the patch skips the
//   subtree by identity), and the flush still patches (onPatch, DOM source) as when it changed
// - the JSX runtime's element path builds the same vnodes as createElement
import { describe, it, expect, afterEach } from 'vitest'
import { run, createElement as h, Collection } from '../src/index.js'
import { jsx, jsxs } from '../src/jsx-runtime.ts'

const ticks = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }
let apps = []
afterEach(() => { apps.forEach((a) => a.dispose()); apps = []; document.body.innerHTML = '' })
function mount(App, options = {}) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  const app = run(App, {}, { mountPoint: '#root', ...options })
  apps.push(app)
  return { app, el, rt: app.__runtime }
}

describe('P46-P: same output, same vnode', () => {
  it('Collection items whose output is unchanged keep their vnode and element; the changed ones patch', async () => {
    const patched = []
    function Row({ state, context }) {
      return h('div', { className: context.selected === state.id ? 'row danger' : 'row' }, h('span', null, state.label))
    }
    function App() { return h('div', null, h('div', { className: 'table' }, h(Collection, { of: Row, from: 'rows' }))) }
    App.initialState = { rows: [1, 2, 3].map((id) => ({ id, label: 'r' + id })), selected: 0 }
    App.context = { selected: (s) => s.selected }
    const m = mount(App, { __hooks: { onPatch: (v) => patched.push(v) } })
    await m.rt.flushed(); await ticks()
    const rows0 = [...m.el.querySelectorAll('.row')]
    // root div > div.table > the Collection's fragment (4-H) > the items
    const kids = (v) => v.children[0].children[0].children
    const before = kids(patched.at(-1))
    m.rt.setState('root', (s) => ({ ...s, selected: 2 }))
    await m.rt.flushed(); await ticks()
    const after = kids(patched.at(-1))
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(after[2]).toBe(before[2])
    const rows1 = [...m.el.querySelectorAll('.row')]
    expect(rows1).toEqual(rows0)
    expect(rows1.map((r) => r.className)).toEqual(['row', 'row danger', 'row'])
    // and back: the reused vnodes patch like any other
    m.rt.setState('root', (s) => ({ ...s, selected: 3 }))
    await m.rt.flushed(); await ticks()
    expect([...m.el.querySelectorAll('.row')].map((r) => r.className)).toEqual(['row', 'row', 'row danger'])
  })

  it('a state change with the same view output still patches once (onPatch, onRender)', async () => {
    let patches = 0, renders = 0
    function App({ state }) { return h('p', { className: 'p' }, state.shown) }
    App.initialState = { shown: 'a', hidden: 0 }
    const m = mount(App, { __hooks: { onPatch: () => patches++, onRender: () => renders++ } })
    await m.rt.flushed(); await ticks()
    const p0 = patches, r0 = renders, el = m.el.querySelector('.p')
    m.rt.setState('root', (s) => ({ ...s, hidden: 1 }))
    await m.rt.flushed(); await ticks()
    expect(patches).toBe(p0 + 1)
    expect(renders).toBe(r0 + 1)
    expect(m.el.querySelector('.p')).toBe(el)
    m.rt.setState('root', (s) => ({ ...s, shown: 'b' }))
    await m.rt.flushed(); await ticks()
    expect(m.el.querySelector('.p').textContent).toBe('b')
  })
})

describe('P46-P: the JSX runtime element path', () => {
  const plain = (v) => JSON.parse(JSON.stringify(v))
  it('builds the vnodes createElement builds', () => {
    const cases = [
      [jsx('div', { className: 'a', 'data-task-id': 3, children: 'text' }, 'k'), h('div', { className: 'a', 'data-task-id': 3, key: 'k' }, 'text')],
      [jsxs('ul', { id: 'x', children: [jsx('li', { children: 1 }), [jsx('li', { children: 2 })], null, 'tail'] }), h('ul', { id: 'x' }, h('li', null, 1), [h('li', null, 2)], null, 'tail')],
      [jsx('label', { for: 'f', role: 'note', 'aria-label': 'L', 'attrs-title': 't', class: ['a', { b: true, c: false }] }), h('label', { for: 'f', role: 'note', 'aria-label': 'L', 'attrs-title': 't', class: ['a', { b: true, c: false }] })],
      [jsx('div', { style: { color: 'red' }, data: { id: 1 }, props: { title: 'p' }, title: undefined }), h('div', { style: { color: 'red' }, data: { id: 1 }, props: { title: 'p' }, title: undefined })],
      [jsx('svg', { viewBox: '0 0 1 1', className: 's', children: jsx('circle', { r: 1 }) }), h('svg', { viewBox: '0 0 1 1', className: 's' }, h('circle', { r: 1 }))],
      [jsx('input', { value: 'v' }), h('input', { value: 'v' })],
      [jsx('div', {}), h('div', {})],
    ]
    for (const [a, b] of cases) {
      expect(plain(a)).toEqual(plain(b))
      expect(!!a.$p).toBe(!!b.$p)
    }
  })
})
