// @vitest-environment jsdom
// PLAN-4 2-A2 G-206: the uid root ('u') can be set per app, so two apps on one page get distinct
// ids: run(App, drivers, { uid: 'app2' }) and renderToString(App, { uid: 'app2' }) (SSR ids =
// hydration ids with the same root). Default stays 'u'.
import { describe, it, expect, afterEach } from 'vitest'
import run from '../src/extra/run.js'
import { renderToString } from '../src/extra/ssr.ts'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 2000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}
const idsIn = (root) => [...root.querySelectorAll('[id]')].map(e => e.id)

function Field({ uid, label }) {
  return h('p', null, h('label', { attrs: { for: uid('input') } }, label), h('input', { attrs: { id: uid('input') } }))
}
function Row({ state, uid }) {
  return h('li', { attrs: { id: uid() } }, state.text)
}
function Form({ uid }) {
  return h('form', { attrs: { id: uid('form') } },
    h(Field, { label: 'name' }),
    h('ul', null, h(Collection, { of: Row, from: 'rows' })))
}
Form.initialState = { rows: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }] }

const apps = []
afterEach(() => { for (const a of apps.splice(0)) a.dispose(); document.body.innerHTML = '' })

const mount = async (sel, options) => {
  const app = run(Form, {}, { mountPoint: sel, diagnostics: 'off', ...options })
  apps.push(app)
  await until(() => document.querySelectorAll(`${sel} li`).length === 2, sel)
  await sleep(20)
  return idsIn(document.querySelector(sel))
}

describe('G-206: uid root per app', () => {
  it("two apps on one page with run()'s uid option get distinct ids, prefixed by their root", async () => {
    document.body.innerHTML = '<div id="one"></div><div id="two"></div>'
    const one = await mount('#one', { uid: 'app1' })
    const two = await mount('#two', { uid: 'app2' })
    expect(one).toHaveLength(4)
    expect(two).toHaveLength(4)
    expect(one.every(id => id.startsWith('app1-'))).toBe(true)
    expect(two.every(id => id.startsWith('app2-'))).toBe(true)
    expect(new Set([...one, ...two]).size).toBe(8)
    // same structure: the ids differ only by the root
    expect(two).toEqual(one.map(id => id.replace(/^app1/, 'app2')))
  })

  it("without the option the root stays 'u'", async () => {
    document.body.innerHTML = '<div id="one"></div>'
    const ids = await mount('#one')
    expect(ids.every(id => id.startsWith('u-'))).toBe(true)
  })

  it('a root with characters outside [A-Za-z0-9_-] is sanitized as every uid is', async () => {
    document.body.innerHTML = '<div id="one"></div>'
    const ids = await mount('#one', { uid: 'my app.2' })
    expect(ids.every(id => id.startsWith('my_app_2-'))).toBe(true)
    expect(renderToString(Form, { uid: 'my app.2' })).toContain('id="my_app_2-form"')
  })

  it('renderToString with the same uid produces the ids the client hydrates to', async () => {
    const html = renderToString(Form, { uid: 'app2' })
    const ssrIds = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1])
    expect(ssrIds).toHaveLength(4)
    expect(ssrIds.every(id => id.startsWith('app2-'))).toBe(true)
    document.body.innerHTML = `<div id="root">${html}</div>`
    expect(await mount('#root', { uid: 'app2' })).toEqual(ssrIds)
    // and the default root on both sides is 'u'
    expect(renderToString(Form)).toContain('id="u-form"')
  })
})
