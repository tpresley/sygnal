// @vitest-environment jsdom
// PLAN-9 SYG453 (D470): two children of one view with the same identity (component + key, else
// id) share one instance; the dev entry ('sygnal/diagnostics', checks/next.ts) warns, once per
// parent, component and key. The real DOM driver (run) and renderComponent's mock DOM.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import '../src/extra/diagnostics/checks/index.js'
import { run, createElement as h, Collection } from '../src/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.js'
import { resetChecks } from '../src/extra/diagnostics/checks/index.js'
import { CODE_TITLES, DEV_CODE_SEVERITY } from '../src/extra/diagnostics/codes.ts'
import { rollup } from 'rollup'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sleep = (ms = 10) => new Promise((r) => setTimeout(r, ms))
let apps = []
beforeEach(() => { clearDiagnostics(); resetChecks() })
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = ''; configureDiagnostics({ mode: undefined }) })
const start = async (App) => {
  document.body.innerHTML = '<div id="root"></div>'
  apps.push(run(App, {}, { mountPoint: '#root', diagnostics: 'collect' }))
  await sleep(20)
}
const syg453 = () => getDiagnostics().filter((d) => d.code === 'SYG453')

function Card({ state, label }) { return h('div', { className: 'card' }, label + ':' + state.n) }
Card.isolatedState = true
Card.initialState = { n: 0 }
function Badge({ label }) { return h('i', null, label) }

describe('SYG453: two children with the same identity', () => {
  it('is a dev-entry warning with a title; an app bundle has none of it (0 production bytes)', async () => {
    expect(DEV_CODE_SEVERITY.SYG453).toBe('warn')
    expect(CODE_TITLES.SYG453).toMatch(/same identity/)
    // the build, bundled into an app as its bundler would (Rollup; dependencies external)
    const dist = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'index.esm.js')
    const APP = ["import { run, createElement as h } from 'sygnal'", "function A() { return h('p', null, 'x') }", 'run(A)'].join('\n')
    const b = await rollup({
      input: 'app',
      external: (id) => id !== 'app' && id !== 'sygnal' && id !== dist,
      plugins: [{ name: 'app', resolveId: (id) => (id === 'app' ? id : id === 'sygnal' ? dist : null), load: (id) => (id === 'app' ? APP : null) }],
      onwarn: () => {},
    })
    const { output } = await b.generate({ format: 'esm' })
    await b.close()
    expect(output[0].code.length).toBeGreaterThan(10000)
    expect(output[0].code).not.toContain('SYG453')
  }, 30000)

  it('two siblings with the same key: warned once, naming the parent, the child and the key', async () => {
    function Board({ state }) { return h('div', null, h(Card, { key: 'a', label: 'x' }), h(Card, { key: 'a', label: 'y' }), h('button', { className: 'go' }, String(state.n))) }
    Board.initialState = { n: 0 }
    Board.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Board.model = { GO: (s) => ({ ...s, n: s.n + 1 }) }
    await start(Board)
    const d = syg453()
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warn')
    expect(d[0].component).toBe('Board')
    expect(d[0].message).toMatch(/Board renders <Card> in two places with the same identity \(key or id "a"\)/)
    expect(d[0].data).toEqual({ child: 'Card', key: 'a' })
    // both places show the one instance (the second tag's props)
    expect([...document.querySelectorAll('.card')].map((e) => e.textContent)).toEqual(['y:0', 'y:0'])
    // re-renders don't repeat it
    document.querySelector('.go').click()
    await sleep(20)
    expect(syg453()).toHaveLength(1)
  })

  it('the same id in two different parent elements of one view (identity is per view, not per element)', async () => {
    function Board() { return h('main', null, h('div', { className: 'l' }, h(Card, { id: 'c', label: 'l' })), h('div', { className: 'r' }, h(Card, { id: 'c', label: 'r' }))) }
    await start(Board)
    expect(syg453()).toHaveLength(1)
    expect(syg453()[0].data.key).toBe('c')
  })

  it('a stateless child (no isolatedState) and a fragment-rooted one are found too', async () => {
    function Frag({ label }) { return h('span', null, label) }
    function Board() { return h('div', null, h(Badge, { key: 1, label: 'p' }), h(Badge, { key: 1, label: 'q' }), h(Frag, { id: 'f', label: 'f' }), h(Frag, { id: 'f', label: 'g' })) }
    await start(Board)
    expect(syg453().map((d) => d.data).sort((a, b) => a.child.localeCompare(b.child))).toEqual([{ child: 'Badge', key: '1' }, { child: 'Frag', key: 'f' }])
  })

  it('no warning: different keys, the same key on different components, keyed Collection items, no keys', async () => {
    function Item({ state }) { return h('li', null, String(state.id)) }
    function Board() {
      return h('div', null,
        h(Card, { key: 'a', label: 'a' }), h(Card, { key: 'b', label: 'b' }),
        h(Badge, { key: 'a', label: 'same key, other component' }),
        h(Card, { label: 'by position' }), h(Card, { label: 'by position' }),
        h('ul', null, h(Collection, { of: Item, from: 'items' })))
    }
    Board.initialState = { items: [{ id: 1 }, { id: 2 }] }
    await start(Board)
    expect(syg453()).toEqual([])
  })

  it('renderComponent (mock DOM): the same warning, and expectNoDiagnostics fails on it', async () => {
    function Board() { return h('div', null, h(Card, { key: 'k', label: 'x' }), h(Card, { key: 'k', label: 'y' })) }
    const t = renderComponent(Board)
    await t.ready()
    expect(t.diagnostics.filter((d) => d.code === 'SYG453').map((d) => d.data)).toEqual([{ child: 'Card', key: 'k' }])
    expect(() => t.expectNoDiagnostics()).toThrow(/SYG453/)
    t.dispose()
  })

  it('off: nothing is reported', async () => {
    function Board() { return h('div', null, h(Card, { key: 'a', label: 'x' }), h(Card, { key: 'a', label: 'y' })) }
    document.body.innerHTML = '<div id="root"></div>'
    apps.push(run(Board, {}, { mountPoint: '#root', diagnostics: 'off' }))
    await sleep(20)
    expect(syg453()).toEqual([])
  })
})
