// @vitest-environment jsdom
// PLAN-13 F-3 (#35, D604): Switchable `state={{ page: key | lens | byId }}`: each listed page binds
// its own target with a tag child's lifetime rules (a changed key or byId target makes that page
// again, a deleted target disposes it); unlisted pages share the owner's state.
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Switchable } from '../src/switchable.js'
import { byId } from '../src/extra/lens.js'

const log = []
function page(name) {
  const P = ({ state }) => h('section', null, h('button', { className: 'inc-' + name }, '+'), h('span', { className: 'v-' + name }, `${name}:${state?.n ?? '-'}`))
  P.intent = ({ DOM }) => ({ INC: DOM.click('.inc-' + name) })
  P.model = {
    INC: (s) => ({ ...s, n: (s.n ?? 0) + 1 }),
    BOOTSTRAP: { EFFECT: () => { log.push('made ' + name) } },
    DISPOSE: { EFFECT: (s) => { log.push(`disposed ${name} at ${s?.n}`) } },
  }
  return P
}
const A = page('a'), B = page('b'), C = page('c')

function app(stateMap) {
  function App({ state }) { return h('main', null, h(Switchable, { of: { a: A, b: B, c: C }, current: state.cur, state: stateMap(state) })) }
  App.initialState = { cur: 'a', aKey: 'pages.a', n: 7, pages: { a: { n: 0 }, b: { n: 10 }, a2: { n: 100 } }, list: [{ id: 1, n: 50 }, { id: 2, n: 60 }], sel: 1 }
  App.intent = ({ DOM }) => ({ SHOW: DOM.click('.show') })
  App.model = {
    SHOW: (s, cur) => ({ ...s, cur }),
    REBIND: (s) => ({ ...s, aKey: 'pages.a2' }),
    DELETE_A: (s) => { const { a, ...rest } = s.pages; return { ...s, pages: rest } },
    RESTORE_A: (s) => ({ ...s, pages: { ...s.pages, a: { n: 1 } } }),
    SELECT: (s, sel) => ({ ...s, sel }),
  }
  return App
}

describe('F-3: per-page Switchable state', () => {
  it('each listed page reads and writes its own slice; an unlisted one shares the owner state', async () => {
    const t = renderComponent(app((s) => ({ a: s.aKey, b: 'pages.b' })), { dom: 'real' })
    await t.ready()
    t.query('.inc-a').click()
    await t.next((s) => s.pages.a.n === 1)
    t.simulateAction('SHOW', 'b')
    await t.next((s) => s.cur === 'b')
    t.query('.inc-b').click()
    await t.next((s) => s.pages.b.n === 11)
    t.simulateAction('SHOW', 'c')
    await t.next((s) => s.cur === 'c')
    expect(t.query('.v-c').textContent).toBe('c:7')   // the owner's own state
    t.query('.inc-c').click()
    await t.next((s) => s.n === 8)
    expect(t.state.pages.a.n).toBe(1)
    t.dispose()
  })

  it('a changed key makes only that page again', async () => {
    log.length = 0
    const t = renderComponent(app((s) => ({ a: s.aKey, b: 'pages.b' })), { dom: 'real' })
    await t.ready()
    await t.settle()
    log.length = 0
    t.simulateAction('REBIND')
    await t.next((s) => s.aKey === 'pages.a2')
    await t.settle()
    expect(t.query('.v-a').textContent).toBe('a:100')
    expect(log).toEqual(['disposed a at 0', 'made a'])
    t.dispose()
  })

  it('a deleted target disposes the page on its last state; the new one renders once the target is back', async () => {
    log.length = 0
    const t = renderComponent(app((s) => ({ a: 'pages.a', b: 'pages.b' })), { dom: 'real' })
    await t.ready()
    t.query('.inc-a').click()
    await t.next((s) => s.pages.a.n === 1)
    await t.settle()
    log.length = 0
    t.simulateAction('DELETE_A')
    await t.next((s) => !('a' in s.pages))
    await t.settle()
    expect(log).toEqual(['disposed a at 1', 'made a'])
    expect(t.state.pages).not.toHaveProperty('a')   // the dying page didn't write it back
    expect(t.query('.v-a')).toBeNull()   // no state: not rendered, as a tag child bound to a missing key
    t.simulateAction('RESTORE_A')
    await t.next((s) => s.pages.a?.n === 1)
    expect(t.query('.v-a').textContent).toBe('a:1')
    t.dispose()
  })

  it('a byId entry follows its record; another id makes the page again; a lens entry works', async () => {
    log.length = 0
    const t = renderComponent(app((s) => ({ a: byId('list', s.sel), b: { get: (s) => s.pages.b, set: (s, v) => ({ ...s, pages: { ...s.pages, b: v } }) } })), { dom: 'real' })
    await t.ready()
    expect(t.query('.v-a').textContent).toBe('a:50')
    t.query('.inc-a').click()
    await t.next((s) => s.list[0].n === 51)
    await t.settle()
    log.length = 0
    t.simulateAction('SELECT', 2)
    await t.next((s) => s.sel === 2)
    await t.settle()
    expect(t.query('.v-a').textContent).toBe('a:60')
    expect(log).toEqual(['disposed a at 51', 'made a'])
    t.simulateAction('SHOW', 'b')
    await t.next((s) => s.cur === 'b')
    t.query('.inc-b').click()
    await t.next((s) => s.pages.b.n === 11)
    t.dispose()
  })

  it("a hidden page's resources read its own slice", async () => {
    const P = ({ state }) => h('p', null, String(state.r?.status))
    P.resources = { r: (s) => ({ url: `/api/${s.id}`, background: true }) }
    function App({ state }) { return h('main', null, h(Switchable, { of: { a: A, p: P }, current: 'a', state: { p: 'pages.p' } })) }
    App.initialState = { pages: { p: { id: 'x9' } } }
    const t = renderComponent(App)
    await t.ready()
    expect(t.requests('HTTP').map((r) => r.url)).toEqual(['/api/x9'])
    t.dispose()
  })
})

import { setupChecks, diagnostics } from './diagnostics/helpers.js'
describe('F-3: SYG429 (dev checks)', () => {
  it('a map key that names no page: warned once, with did-you-mean', async () => {
    setupChecks()
    function App({ state }) { return h('main', null, h(Switchable, { of: { projects: A, settings: B }, current: 'projects', state: { projects: 'pages.a', setings: 'pages.b' } })) }
    App.initialState = { pages: { a: { n: 0 }, b: { n: 1 } } }
    const t = renderComponent(App)
    await t.ready()
    const d = diagnostics('SYG429')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ severity: 'warn', component: 'App', data: { key: 'setings', pages: ['projects', 'settings'] } })
    expect(d[0].message).toContain("did you mean 'settings'")
    t.dispose()
  })
})
