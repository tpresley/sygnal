// PLAN-9 G-751: the markers' core handlers (Portal, Transition, Suspense, lazy) register when they
// are used (the pragma calls the marker's `$reg`; lazy() registers its resolver), not when their
// module loads, so an app that never uses a marker drops its handler (D157). Collection and
// Switchable stay registered on import: their lowercase tags (<collection>, <switchable>) are
// documented to work without an import. Bundles small apps against the build
// (dist/index.esm.js), as an app's bundler would:
// - Rollup: which registry entries each app keeps;
// - esbuild: an app with every marker, run in jsdom, renders each one through its handler.
import { describe, it, expect, afterAll } from 'vitest'
import { rollup } from 'rollup'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(repo, 'dist', 'index.esm.js')
const tmp = fs.mkdtempSync(path.join(repo, 'test/.tmp-g751-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

// Rollup, unminified: 'sygnal' is the build, xstream / snabbdom / the rest external
const bundle = async (contents) => {
  const b = await rollup({
    input: 'app',
    external: (id) => id !== 'app' && id !== 'sygnal' && id !== dist && !id.startsWith(path.join(repo, 'dist')),
    plugins: [{ name: 'app', resolveId: (id) => (id === 'app' ? id : id === 'sygnal' ? dist : null), load: (id) => (id === 'app' ? contents : null) }],
    onwarn: () => {},
  })
  const { output } = await b.generate({ format: 'esm' })
  await b.close()
  return output[0].code
}
// the registry entries a bundle sets (core/registry.ts: hosts / pres / posts) and the lazy resolver
const registered = (code) => {
  const out = new Set()
  for (const m of code.matchAll(/\b(?:hosts|pres|posts)\.(collection|switchable|portal|transition|suspense|clientonly)\s*=/g)) out.add(m[1])
  if (/resolvers\.push\(/.test(code)) out.add('lazy')
  return [...out].sort()
}

const ITEM = `function Item({ state }) { return h('li', null, String(state.id)) }\n`
const app = (imports, body, pre = '') => `import { run, createElement as h${imports.map(i => ', ' + i).join('')} } from 'sygnal'
${pre}function App({ state }) { return h('div', null, ${body}) }
App.initialState = { items: [{ id: 1 }], tab: 'a' }
run(App)
`
const CASES = {
  none: app([], "h('span', null, 'x')"),
  Portal: app(['Portal'], "h(Portal, { target: 'body' }, h('b', null, 'p'))"),
  Transition: app(['Transition'], "h(Transition, { name: 'fade' }, h('b', null, 't'))"),
  Suspense: app(['Suspense'], "h(Suspense, { fallback: 'l' }, h('b', null, 's'))"),
  Collection: app(['Collection'], "h(Collection, { of: Item, from: 'items' })", ITEM),
  Switchable: app(['Switchable'], "h(Switchable, { of: { a: Item }, current: state.tab })", ITEM),
  lazy: app(['lazy'], 'h(L)', "const L = lazy(() => Promise.resolve({ default: () => h('b', null, 'z') }))\n"),
}
// what each case must register: its own handler, plus Collection's and Switchable's, which every
// app keeps (the lowercase tags); ClientOnly's stays in the core (sygnal/vike is a separate entry
// with no access to the registry; it is a few bytes)
const ALWAYS = ['collection', 'switchable']
const OWN = { none: [], Portal: ['portal'], Transition: ['transition'], Suspense: ['suspense'], Collection: [], Switchable: [], lazy: ['lazy'] }
const expected = (name) => [...ALWAYS, ...OWN[name]].sort()

describe('G-751: marker handlers tree-shake (dist, Rollup)', () => {
  for (const [name, code] of Object.entries(CASES)) {
    it(`${name}: the bundle registers ${OWN[name].length ? OWN[name].join() + ' and ' : ''}only the always-on hosts`, async () => {
      expect(registered(await bundle(code)).filter(r => r !== 'clientonly')).toEqual(expected(name))
    }, 30000)
  }

  it('importing a marker without using it keeps no handler', async () => {
    const code = await bundle(app(['Portal', 'Collection', 'Suspense'], "h('span', null, 'x')"))
    expect(registered(code).filter(r => r !== 'clientonly')).toEqual(ALWAYS)
  }, 30000)
})

// the lowercase tags, with no marker imported at all
const LOWER = `import { run, createElement as h } from 'sygnal'
function Item({ state }) { return h('li', { className: 'item' }, String(state.id)) }
function PageA() { return h('p', { className: 'page-a' }, 'A') }
function App({ state }) { return h('div', null, h('ul', null, h('collection', { of: Item, from: 'items' })), h('switchable', { of: { a: PageA }, current: 'a' })) }
App.initialState = { items: [{ id: 1 }, { id: 2 }] }
run(App)
`

// every marker through its public import only, bundled (esbuild, IIFE) and run in jsdom
const ALL = `import { run, createElement as h, Portal, Transition, Suspense, Collection, Switchable, lazy, defineWidget } from 'sygnal'
const Late = lazy(() => Promise.resolve({ default: () => h('b', { className: 'lazy' }, 'loaded') }))
// a widget defined before any Portal is used, rendered inside one (its rewrite runs through the Portal's)
const Box = defineWidget({ mount: (el) => { el.textContent = 'widget'; return {} } })
function Item({ state }) { return h('li', { className: 'item' }, String(state.id)) }
function PageA() { return h('p', { className: 'page-a' }, 'A') }
function PageB() { return h('p', { className: 'page-b' }, 'B') }
function App({ state }) {
  return h('div', null,
    h(Portal, { target: '#elsewhere' }, h('i', { className: 'in-portal' }, 'p'), h(Box, { className: 'w' })),
    h(Transition, { name: 'fade' }, h('span', { className: 'tr' }, 't')),
    h(Suspense, { fallback: h('em', { className: 'fallback' }, '...') }, h(Late)),
    h('ul', null, h(Collection, { of: Item, from: 'items' })),
    h(Switchable, { of: { a: PageA, b: PageB }, current: state.tab }),
    h('button', { className: 'next' }, 'next'))
}
App.initialState = { items: [{ id: 1 }, { id: 2 }], tab: 'a' }
App.intent = ({ DOM }) => ({ NEXT: DOM.click('.next') })
App.model = { NEXT: (s) => ({ ...s, tab: 'b', items: [...s.items, { id: 3 }] }) }
run(App)
`

const runInJsdom = async (name, src) => {
  const entry = path.join(tmp, name + '.js')
  fs.writeFileSync(entry, src)
  const r = await build({ entryPoints: [entry], bundle: true, format: 'iife', write: false, absWorkingDir: repo, nodePaths: [path.join(repo, 'node_modules')], logLevel: 'silent', alias: { sygnal: dist } })
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="elsewhere"></div></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' })
  const errors = []
  dom.window.console.error = (...a) => errors.push(a.join(' '))
  dom.window.eval(r.outputFiles[0].text)
  return { w: dom.window, doc: dom.window.document, errors }
}

describe('G-751: every marker works through its public import (dist, esbuild, jsdom)', () => {
  it('the lowercase <collection> and <switchable> tags work with no import (documented)', async () => {
    const { w, doc, errors } = await runInJsdom('lower', LOWER)
    await new Promise(res => setTimeout(res, 30))
    expect([...doc.querySelectorAll('.item')].map(e => e.textContent)).toEqual(['1', '2'])
    expect(doc.querySelector('.page-a')).not.toBe(null)
    expect(doc.querySelector('collection, switchable')).toBe(null)
    expect(errors).toEqual([])
    w.close()
  }, 30000)

  it('Portal, Transition, Suspense, lazy, Collection, Switchable render through their handlers', async () => {
    const { w, doc, errors } = await runInJsdom('all', ALL)
    const tick = (ms = 20) => new Promise(res => setTimeout(res, ms))
    for (let i = 0; i < 20 && !doc.querySelector('.lazy'); i++) await tick()
    // no marker reached the DOM as an element of its own
    for (const sel of ['portal', 'transition', 'suspense', 'collection', 'switchable']) expect(doc.querySelector(sel), sel).toBe(null)
    expect(doc.querySelector('#elsewhere .in-portal')?.textContent).toBe('p')
    expect(doc.querySelector('#elsewhere .w')?.textContent).toBe('widget')
    expect(doc.querySelector('#root .in-portal')).toBe(null)
    expect(doc.querySelector('.tr')).not.toBe(null)
    expect(doc.querySelector('.lazy')?.textContent).toBe('loaded')
    expect(doc.querySelector('.fallback')).toBe(null)
    expect([...doc.querySelectorAll('.item')].map(e => e.textContent)).toEqual(['1', '2'])
    expect(doc.querySelector('.page-a')).not.toBe(null)
    doc.querySelector('.next').click()
    await tick()
    expect(doc.querySelector('.page-b')).not.toBe(null)
    expect(doc.querySelector('.page-a')).toBe(null)
    expect([...doc.querySelectorAll('.item')].map(e => e.textContent)).toEqual(['1', '2', '3'])
    expect(errors).toEqual([])
    w.close()
  }, 30000)
})
