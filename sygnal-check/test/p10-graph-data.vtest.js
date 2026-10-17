/**
 * PLAN-10 A-1..A-6, A-8 (static), T-3: the graph data the viewer needs, on the shop fixture
 * (test/fixtures/graph-shop, from dev-plans/research/graph-viz/fixture with a case per item):
 *   A-1  view-only components (viewOnly: true) and the literal `state` lens of a child
 *   A-2  package tags (external) and widget tags (widget: true) as child entries, not nodes
 *   A-3  ids on children, events (emitterIds / selectorIds) and diagnostics (componentId),
 *        resolved through the import (two components called Summary)
 *   A-4  line / column (+ file when not the component's) on actions, model entries, selectors,
 *        children, EVENTS sites, context entries, controls, commands, timers, agent actions
 *   A-5  childSelects: CHILD.select(Child) with the intent actions it feeds
 *   A-6  entry: run(), defineElement(), Vike +Page; 'unknown' when an entry is picked at run time
 *   A-8  the 'behavior' trigger; graphText rows; everything validates against the schema
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { graph, graphFiles, validateSchema } from '../src/index.js'
import { formatGraph } from '../src/graphText.js'
import { legacy } from './graph-helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const schema = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'schema/inspect.schema.json'), 'utf8'))
const SHOP = 'test/fixtures/graph-shop/src'
const shop = () => graph([SHOP], { cwd: pkgRoot })
const id = (file, line) => `${SHOP}/${file}:${line}`
const named = (g, name) => g.components.filter(c => c.name === name)
const one = (g, name, file) => g.components.find(c => c.name === name && (!file || c.file.endsWith(file)))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })
function project(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-p10-'))
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true })
    fs.writeFileSync(path.join(tmp, rel), src)
  }
  return graphFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp })
}

describe('the shop fixture', () => {
  it('validates against the schema', () => {
    expect(validateSchema(schema, shop())).toEqual([])
    expect(validateSchema(schema, graph([SHOP], { cwd: pkgRoot, strict: true }))).toEqual([])
  })

  it('A-1: view-only components are nodes, after the others; ProductCard is no longer a root', () => {
    const g = shop()
    expect(g.components.map(c => c.name)).toEqual(['App', 'Cart', 'CartLine', 'Checkout', 'Header', 'ProductCard', 'Summary', 'Summary', 'Greeting', 'Shop'])
    expect(one(g, 'Shop')).toEqual({
      name: 'Shop', id: id('App.jsx', 24), parentId: null, file: `${SHOP}/App.jsx`, kind: 'switchable', viewOnly: true,
      actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [],
      children: [{ name: 'ProductCard', via: 'collection', from: 'products', id: id('ProductCard.jsx', 3), line: 25, column: 32 }],
      selectors: [], diagnostics: [],
    })
    expect(one(g, 'Greeting')).toMatchObject({ kind: 'child', viewOnly: true })
    expect(one(g, 'ProductCard').kind).toBe('collection-item')
    expect(g.components.filter(c => c.kind === 'root').map(c => c.name)).toEqual(['App'])
    expect(one(g, 'App').children.find(c => c.name === 'Greeting')).toEqual({ name: 'Greeting', via: 'tag', id: id('App.jsx', 20), state: 'user', line: 12, column: 7 })
    expect(one(g, 'App').viewOnly).toBeUndefined()
  })

  it('A-2: package tags and widgets are child entries with external / widget, and id null', () => {
    const g = shop()
    expect(one(g, 'App').children.find(c => c.name === 'Toaster')).toEqual({ name: 'Toaster', via: 'tag', id: null, external: 'sygnal/ui', line: 13, column: 7 })
    expect(one(g, 'Header').children).toEqual([{ name: 'Menu', via: 'tag', id: null, external: 'sygnal/ui/menu', widget: true, line: 8, column: 7 }])
    expect(one(g, 'ProductCard').children).toEqual([{ name: 'Stars', via: 'tag', id: null, widget: true, line: 7, column: 7 }])
    expect(g.components.some(c => ['Toaster', 'Menu', 'Stars'].includes(c.name))).toBe(false)
  })

  it('A-3: ids follow the import, not the name (two Summary components)', () => {
    const g = shop()
    const [cartSummary, checkoutSummary] = named(g, 'Summary')
    expect(cartSummary.id).toBe(id('cart/Summary.jsx', 3))
    expect(checkoutSummary.id).toBe(id('checkout/Summary.jsx', 3))
    expect(one(g, 'Cart').children.find(c => c.name === 'Summary').id).toBe(cartSummary.id)
    expect(one(g, 'Checkout').children.find(c => c.name === 'Summary').id).toBe(checkoutSummary.id)
    // parallel lists: one entry per component, so a name can repeat
    expect(g.events.NAVIGATE).toEqual({
      emitters: ['Cart', 'Checkout', 'Header', 'Summary', 'Summary'],
      selectors: ['App'],
      emitterIds: [id('Cart.jsx', 4), id('Checkout.jsx', 3), id('Header.jsx', 3), cartSummary.id, checkoutSummary.id],
      selectorIds: [id('App.jsx', 8)],
    })
    expect(cartSummary.diagnostics).toEqual([])
    expect(checkoutSummary.diagnostics.map(d => [d.code, d.componentId])).toEqual([['SYG110', checkoutSummary.id]])
    for (const c of g.components) for (const d of c.diagnostics) expect(d.componentId).toBe(c.id)
  })

  it('A-4: locations on actions, model entries, selectors, EVENTS sites, context entries, agent actions', () => {
    const g = shop()
    const app = one(g, 'App')
    expect(app.actions.find(a => a.name === 'GO')).toEqual({ name: 'GO', trigger: 'intent', sinks: ['STATE'], line: 34, column: 3, modelAt: { line: 39, column: 3 } })
    // a model-only action: its location is the model entry
    expect(app.actions.find(a => a.name === 'SAVE_CART')).toMatchObject({ line: 42, column: 3, modelAt: { line: 42, column: 3 } })
    expect(app.contextEntries).toEqual([{ name: 'currency', line: 30, column: 3 }, { name: 'cartCount', line: 31, column: 3 }])
    expect(app.eventSites).toEqual([
      { type: 'NAVIGATE', role: 'select', line: 34, column: 21 },
      { type: 'ADD_TO_CART', role: 'select', line: 35, column: 30 },
      { type: 'REMOVE_ITEM', role: 'select', line: 36, column: 25 },
    ])
    expect(one(g, 'Header').selectors[0]).toEqual({ selector: '.logo', events: ['click'], matched: true, isolationHit: null, line: 13, column: 19 })
    expect(one(g, 'Header').eventSites.map(s => [s.type, s.role, s.line])).toEqual([['NAVIGATE', 'emit', 18], ['NAVIGATE', 'emit', 19], ['SEARCH', 'emit', 20]])
    expect(one(g, 'Checkout').agent.actions).toEqual([
      { name: 'EMAIL', consequential: false, input: true, line: 28, column: 14 },
      { name: 'PAY', consequential: true, input: false, line: 28, column: 52 },
    ])
  })

  it('A-5: CHILD.select(CartLine) in Cart is the receiver of CartLine\'s PARENT sink', () => {
    const g = shop()
    expect(one(g, 'Cart').childSelects).toEqual([{ child: 'CartLine', id: id('CartLine.jsx', 2), actions: ['LINE_QTY'], line: 17, column: 13 }])
    expect(one(g, 'CartLine').actions.find(a => a.name === 'QTY').sinks).toEqual(['PARENT'])
    expect(one(g, 'App').childSelects).toBeUndefined()
  })

  it('A-6: the component run() starts is the entry', () => {
    const g = shop()
    expect(g.components.filter(c => 'entry' in c).map(c => [c.name, c.entry])).toEqual([['App', true]])
  })

  it('graphText shows entries, view-only components, external / widget children, state lenses and PARENT links', () => {
    const text = formatGraph(shop())
    expect(text).toContain(`App  ${SHOP}/App.jsx:8  root  entry`)
    expect(text).toContain("children  Header (tag), Greeting (tag, state 'user'), Toaster (tag, sygnal/ui), Shop (switchable), Cart (switchable), Checkout (switchable)")
    expect(text).toContain('children  Menu (widget, sygnal/ui/menu)')
    expect(text).toContain('children  Stars (widget)')
    expect(text).toContain('parent    from CartLine → LINE_QTY')
    expect(text).toContain(`Shop  ${SHOP}/App.jsx:24  switchable  view only`)
  })

  it('the research copy: what the graph had before PLAN-10 is unchanged but for the kinds view-only parents fix', () => {
    const research = graph(['../dev-plans/research/graph-viz/fixture/src'], { cwd: pkgRoot })
    expect(validateSchema(schema, research)).toEqual([])
    const old = legacy(research)
    expect(old.components.map(c => [c.name, c.kind])).toEqual([
      ['App', 'root'], ['Cart', 'switchable'], ['CartLine', 'collection-item'], ['Checkout', 'switchable'], ['Header', 'child'],
      ['ProductCard', 'collection-item'], // was 'root': Shop, which renders it, wasn't a node
    ])
    expect(old.events.NAVIGATE).toEqual({ emitters: ['Cart', 'Checkout', 'Header'], selectors: ['App'] })
  })
})

describe('inline cases', () => {
  it('A-4: a location in another file names it; A-3: the diagnostics keep their component', () => {
    const g = project({
      'intent.js': `export const intent = ({ DOM }) => ({\n  ADD: DOM.click('.add'),\n})`,
      'App.jsx': `import { intent } from './intent.js'\nexport function App() { return <button className="add">+</button> }\nApp.intent = intent\nApp.model = { ADD: (s) => s }\nApp.initialState = {}`,
    })
    expect(validateSchema(schema, g)).toEqual([])
    const app = one(g, 'App')
    expect(app.actions).toEqual([{ name: 'ADD', trigger: 'intent', sinks: ['STATE'], line: 2, column: 3, file: 'intent.js', modelAt: { line: 4, column: 15 } }])
    expect(app.selectors[0]).toMatchObject({ selector: '.add', line: 2, column: 18, file: 'intent.js' })
  })

  it('A-6: defineElement(), a Vike +Page, and entry: unknown when run() gets a component picked at run time', () => {
    const g = project({
      'Card.jsx': `import { defineElement } from 'sygnal/element'\nexport function Card() { return <p>card</p> }\nCard.initialState = {}\ndefineElement('x-card', Card)`,
      'pages/index/+Page.jsx': `export default function Page() { return <h1>home</h1> }`,
      'Other.jsx': `export function Other() { return <p /> }\nOther.initialState = {}`,
      'start.js': `import { run } from 'sygnal'\nexport const start = (Picked) => run(Picked)`,
    })
    expect(validateSchema(schema, g)).toEqual([])
    expect(g.components.map(c => [c.name, c.entry, c.viewOnly])).toEqual([
      ['Card', true, undefined], ['Other', 'unknown', undefined], ['Page', true, true],
    ])
    expect(formatGraph(g)).toContain('Other  Other.jsx:1  root  entry?')
  })

  it("A-8: 'behavior' for a behavior's action only the behavior may dispatch (a package behavior, an open model); others unchanged", () => {
    const g = project({
      'Signup.jsx': [
        `import { form } from 'sygnal'`,
        `import { fancy } from 'fancy-behaviors'`,
        `const schema = {}`,
        `export function Signup({ state }) { return <form><input name="email" /></form> }`,
        `Signup.uses = { signup: form(schema, { submit: 'SAVE' }), f: fancy() }`,
        `Signup.model = { SAVE: (s) => s, 'signup.CHECKED_email': (s) => s, 'f.DONE': (s) => s, LOST: (s) => s }`,
      ].join('\n'),
    })
    expect(validateSchema(schema, g)).toEqual([])
    const t = Object.fromEntries(one(g, 'Signup').actions.map(a => [a.name, [a.trigger, a.behavior]]))
    expect(t).toEqual({
      SAVE: ['next', undefined],
      'signup.CHECKED_email': ['behavior', 'signup'],
      'f.DONE': ['behavior', 'f'],
      LOST: ['unknown', undefined],
    })
  })
})
