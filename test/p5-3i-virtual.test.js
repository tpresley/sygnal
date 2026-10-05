// @vitest-environment jsdom
// PLAN-5 3-I G-462: VirtualCollection. The container's prepatch hook recorded the focused element
// in the list (for G-424's refocus) also when the parent patched the cached container vnode again,
// where snabbdom calls no postpatch: the host kept the element (a detached row's, later) until the
// list itself changed. Now nothing is recorded then. (Zoom, scroll anchoring and a focus inside a
// shadow root in a row: browser-tests virtual-p5v1.jsx.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { VirtualCollection } from '../src/index.js'
import { VirtualHost } from '../src/extra/virtual.ts'

const settle = (ms = 30) => new Promise(r => setTimeout(r, ms))
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: 'r' + (i + 1) }))

const Row = ({ state }) => h('div', { className: 'row' }, h('button', { className: 'bump' }, state.label))
function Page({ state }) {
  return h('div', null,
    h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: 32 }),
    h('p', { className: 'n' }, String(state.n)))
}
Page.initialState = { rows: rows(50), n: 0 }
Page.model = { TICK: (s) => ({ ...s, n: s.n + 1 }) }

let app
const made = new Set()
beforeEach(() => {
  made.clear()
  const r = VirtualHost.prototype.render
  vi.spyOn(VirtualHost.prototype, 'render').mockImplementation(function () { made.add(this); return r.call(this) })
})
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('G-462: the focused element recorded before a patch', () => {
  it('a patch of the parent that keeps the list vnode records nothing (no element kept)', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    app = run(Page, {}, { mountPoint: '#root' })
    await settle(60)
    const [host] = made
    const btn = document.querySelector('[data-index="2"] .bump')
    btn.focus()
    expect(document.activeElement).toBe(btn)
    // the parent renders again; the list's vnode is the cached one
    app.__runtime.dispatch('root', 'TICK')
    await settle(60)
    expect(document.querySelector('.n').textContent).toBe('1')
    expect(host.fa).toBe(null)
    expect(document.activeElement).toBe(btn)
  })
})
