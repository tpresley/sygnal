// @vitest-environment jsdom
// PLAN-9 D471: the lowercase <collection> / <switchable> tags are deprecated in 6.3.0 (removed in
// the next major). The dev entry ('sygnal/diagnostics', checks/next.ts) warns SYG426 once per tag;
// the imported Collection / Switchable (their marker carries `data.m`) are not reported, and the
// tags keep working. The real DOM driver (run) and renderComponent's mock DOM.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import '../src/extra/diagnostics/checks/index.js'
import { run, createElement as h, Collection, Switchable } from '../src/index.js'
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
const syg426 = () => getDiagnostics().filter((d) => d.code === 'SYG426')

function Item({ state }) { return h('li', { className: 'item' }, state.text) }
function PageA() { return h('p', { className: 'page' }, 'A') }

describe('SYG426: a lowercase marker tag', () => {
  it('is a dev-entry warning with a title; an app bundle has none of it (0 production bytes)', async () => {
    expect(DEV_CODE_SEVERITY.SYG426).toBe('warn')
    expect(CODE_TITLES.SYG426).toBe('Deprecated lowercase marker tag')
    // the build, bundled into an app as its bundler would (Rollup; dependencies external)
    const dist = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'index.esm.js')
    const APP = ["import { run, createElement as h } from 'sygnal'", "function A() { return h('ul', null, h('collection', { of: A, from: 'x' })) }", 'run(A)'].join('\n')
    const b = await rollup({
      input: 'app',
      external: (id) => id !== 'app' && id !== 'sygnal' && id !== dist,
      plugins: [{ name: 'app', resolveId: (id) => (id === 'app' ? id : id === 'sygnal' ? dist : null), load: (id) => (id === 'app' ? APP : null) }],
      onwarn: () => {},
    })
    const { output } = await b.generate({ format: 'esm' })
    await b.close()
    expect(output[0].code.length).toBeGreaterThan(10000)
    expect(output[0].code).not.toContain('SYG426')
  }, 30000)

  it('<collection> and <switchable>: warned once per tag, and they still render', async () => {
    function App({ state }) {
      return h('div', null,
        h('ul', null, h('collection', { of: Item, from: 'items' })),
        h('ol', null, h('collection', { of: Item, from: 'items' })),
        h('switchable', { of: { a: PageA }, current: 'a' }),
        h('button', { className: 'go' }, String(state.n)))
    }
    App.initialState = { n: 0, items: [{ id: 1, text: 'one' }] }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: (s) => ({ ...s, n: s.n + 1 }) }
    await start(App)
    const d = syg426()
    expect(d.map((x) => x.data.tag).sort()).toEqual(['collection', 'switchable'])
    const c = d.find((x) => x.data.tag === 'collection')
    expect(c.severity).toBe('warn')
    expect(c.component).toBe('App')
    expect(c.message).toMatch(/App renders the lowercase <collection> tag, which is deprecated since Sygnal 6\.3\.0 and will be removed in the next major/)
    expect(c.fix).toMatch(/^import \{ Collection \} from 'sygnal' and write <Collection …>/)
    expect(c.data).toEqual({ tag: 'collection', component: 'Collection' })
    // still works
    expect([...document.querySelectorAll('.item')].map((e) => e.textContent)).toEqual(['one', 'one'])
    expect(document.querySelector('.page').textContent).toBe('A')
    document.querySelector('.go').click()
    await sleep(20)
    expect(syg426()).toHaveLength(2)
  })

  it('the imported Collection and Switchable are not reported', async () => {
    function App() {
      return h('div', null, h('ul', null, h(Collection, { of: Item, from: 'items' })), h(Switchable, { of: { a: PageA }, current: 'a' }))
    }
    App.initialState = { items: [{ id: 1, text: 'one' }] }
    await start(App)
    expect(document.querySelector('.item').textContent).toBe('one')
    expect(syg426()).toEqual([])
  })

  it('renderComponent (mock DOM) reports it too', async () => {
    function List() { return h('ul', null, h('collection', { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 1, text: 'one' }] }
    const t = renderComponent(List)
    await t.ready()
    expect(t.diagnostics.filter((d) => d.code === 'SYG426').map((d) => d.data.tag)).toEqual(['collection'])
    expect(() => t.expectNoDiagnostics()).toThrow(/SYG426/)
    t.dispose()
  })
})
