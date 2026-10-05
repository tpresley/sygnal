// @vitest-environment jsdom
// PLAN-4.5 P45-D item 1: lazy per-component wiring. A component no longer builds the streams it
// doesn't use: CHILD is made on the first CHILD.select(), READY only with READY model entries, a
// component without .context shares its parent's context stream, the hmrActions are sent without a
// stream, there are no sinks for non-driver sources, and the model, the action stream, the render
// parameters and the view pipeline are one stream each. A Collection item went from 122 streams to
// about 22. Risk table (PLAN-4.5 §7): each of these is used in a child, in a Collection item, and
// after a hot swap (app.hmr) of the root, in a child and in a Collection item.
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'
import { run, Collection, Suspense, Slot, makeHeadDriver } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 5 })
let apps = []
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''; document.title = '' })

const PLACES = ['child', 'collection item', 'child after HMR', 'collection item after HMR']

/**
 * Mount `C` under a root as a child (state 'c') or a Collection item (state 'items'), optionally
 * swapped once with app.hmr(); `root` adds statics to the root (initialState, intent, model,
 * context, view wrapper `wrap(node, state)`). Returns DOM helpers.
 */
async function place(where, C, root = {}, drivers = {}) {
  document.body.innerHTML = '<div id="root"></div>'
  function Root({ state }) {
    const inner = where.startsWith('child') ? h(C, { state: 'c' }) : h(Collection, { of: C, from: 'items' }, ...(root.collectionChildren?.(state) || []))
    return h('div', { className: 'root' }, h('button', { id: 'r-go' }, 'go'), h('b', { id: 'r-out' }, String(state.out ?? '')), root.wrap ? root.wrap(inner, state) : inner)
  }
  Root.initialState = { c: { id: 'c', n: 0 }, items: [{ id: 'x', n: 0 }], out: '', ...root.initialState }
  if (root.context) Root.context = root.context
  Root.intent = (s) => ({ RGO: s.DOM.click('#r-go'), ...root.intent?.(s) })
  Root.model = { RGO: (s) => ({ ...s, rgo: (s.rgo || 0) + 1 }), ...root.model }
  const app = run(Root, drivers, { mountPoint: '#root' })
  apps.push(app)
  await until(() => expect(document.querySelector('.root')).not.toBe(null))
  await sleep(20)
  if (where.endsWith('HMR')) {
    app.hmr(Root)
    await sleep(60)
    await until(() => expect(document.querySelector('.root')).not.toBe(null))
  }
  const $ = (s) => document.querySelector(s)
  return { app, $, text: (s) => $(s)?.textContent, click: (s) => $(s).click() }
}

describe('P45-D: lazy wiring, each source in a child, a Collection item and after HMR', () => {
  for (const where of PLACES) {
    describe(where, () => {
      it('context: shared from the parent, in the view and in reducers (props.context), updates', async () => {
        function Ctx({ state, context }) { return h('p', { className: 'ctx' }, `${context.theme}:${state.n}`, h('i', { className: 'ctx-go' }, 'go')) }
        Ctx.intent = ({ DOM }) => ({ GO: DOM.click('.ctx-go') })
        Ctx.model = { GO: (s, d, next, props) => ({ ...s, n: props.context.theme.length }) }
        const t = await place(where, Ctx, {
          initialState: { theme: 'dark' },
          context: { theme: (s) => s.theme },
          intent: ({ DOM }) => ({ THEME: DOM.click('#r-out') }),
          model: { THEME: (s) => ({ ...s, theme: 'light!' }) },
        })
        await until(() => expect(t.text('.ctx')).toBe('dark:0go'))
        t.click('.ctx-go')
        await until(() => expect(t.text('.ctx')).toBe('dark:4go'))
        t.click('#r-out')
        await until(() => expect(t.text('.ctx')).toBe('light!:4go'))
        t.click('.ctx-go')
        await until(() => expect(t.text('.ctx')).toBe('light!:6go'))
      })

      it('READY: an explicit READY holds the Suspense fallback until it is true', async () => {
        function Slow({ state }) { return h('p', { className: 'slow' }, 'loaded ' + state.id) }
        Slow.model = { BOOTSTRAP: { READY: () => false }, DONE: { READY: () => true } }
        Slow.intent = () => ({ DONE: xs.periodic(40).take(1) })
        const t = await place(where, Slow, { wrap: (inner) => h(Suspense, { fallback: h('i', { className: 'fb' }, 'wait') }, inner) })
        if (where == 'child') {
          // a child's READY is tracked by its parent (a Collection doesn't forward its items');
          // after a hot swap, place() has waited past the child's READY
          expect(t.$('.fb')).not.toBe(null)
        }
        await until(() => expect(t.$('.slow')).not.toBe(null))
        await until(() => expect(t.$('.fb')).toBe(null))
      })

      it('children and slots, and the children$ source', async () => {
        function Card({ state, children, slots }) {
          return h('div', { className: 'card' }, h('header', null, ...(slots.title || [])), h('main', null, ...(children || [])), h('em', null, String(state.kids ?? '')))
        }
        Card.intent = ({ children$ }) => ({ KIDS: children$.map(c => c.length) })
        Card.model = { KIDS: (s, kids) => ({ ...s, kids }) }
        const kids = (state) => [h(Slot, { name: 'title' }, 'T' + (state.rgo || 0)), h('span', { className: 'body' }, 'B' + (state.rgo || 0))]
        // as a child, the children are the child element's; as an item, the Collection's
        let t
        if (where.startsWith('child')) {
          t = await placeWithChildren(where, Card, kids)
        } else {
          t = await place(where, Card, { collectionChildren: kids })
        }
        await until(() => expect(t.text('.card header')).toBe('T0'))
        expect(t.text('.card main')).toBe('B0')
        await until(() => expect(t.text('.card em')).toBe('1'))
        t.click('#r-go')
        await until(() => expect(t.text('.card header')).toBe('T1'))
        expect(t.text('.card main')).toBe('B1')
      })

      it('statics (head): the declaration reaches its driver and follows the state', async () => {
        function Titled({ state }) { return h('p', { className: 'titled' }, h('i', { className: 'inc' }, String(state.n))) }
        Titled.head = (s) => ({ title: 'T' + s.n })
        Titled.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
        Titled.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
        const t = await place(where, Titled, {}, { HEAD: makeHeadDriver() })
        await until(() => expect(document.title).toBe('T0'))
        t.click('.inc')
        await until(() => expect(document.title).toBe('T1'))
      })

      it('EFFECT: runs on its action with the current state', async () => {
        const seen = []
        function Fx({ state }) { return h('p', { className: 'fx' }, h('i', { className: 'inc' }, String(state.n))) }
        Fx.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
        Fx.model = { INC: { STATE: (s) => ({ ...s, n: s.n + 1 }), EFFECT: (s) => { seen.push(s.id + s.n) } } }
        const t = await place(where, Fx)
        await until(() => expect(t.$('.fx .inc')).not.toBe(null))
        t.click('.inc')
        await until(() => expect(t.text('.fx')).toBe('1'))
        t.click('.inc')
        await until(() => expect(t.text('.fx')).toBe('2'))
        expect(seen).toEqual(where.startsWith('child') ? ['c0', 'c1'] : ['x0', 'x1'])
      })

      it('CHILD: the parent hears the PARENT values of this child', async () => {
        function Pick({ state }) { return h('p', { className: 'pick' }, 'pick') }
        Pick.intent = ({ DOM }) => ({ GO: DOM.click('.pick') })
        Pick.model = { GO: { PARENT: (s) => s.id } }
        const t = await place(where, Pick, {
          intent: ({ CHILD }) => ({ PICKED: CHILD.select(Pick) }),
          model: { PICKED: (s, id) => ({ ...s, out: s.out + id }) },
        })
        await until(() => expect(t.$('.pick')).not.toBe(null))
        await sleep(10)
        t.click('.pick')
        const id = where.startsWith('child') ? 'c' : 'x'
        await until(() => expect(t.text('#r-out')).toBe(id))
        t.click('.pick')
        await until(() => expect(t.text('#r-out')).toBe(id + id))
      })
    })
  }
})

/** place(), with `kids(state)` as the child element's children */
async function placeWithChildren(where, C, kids) {
  document.body.innerHTML = '<div id="root"></div>'
  function Root({ state }) {
    return h('div', { className: 'root' }, h('button', { id: 'r-go' }, 'go'), h(C, { state: 'c' }, ...kids(state)))
  }
  Root.initialState = { c: { id: 'c', n: 0 } }
  Root.intent = ({ DOM }) => ({ RGO: DOM.click('#r-go') })
  Root.model = { RGO: (s) => ({ ...s, rgo: (s.rgo || 0) + 1 }) }
  const app = run(Root, {}, { mountPoint: '#root' })
  apps.push(app)
  await until(() => expect(document.querySelector('.root')).not.toBe(null))
  await sleep(20)
  if (where.endsWith('HMR')) { app.hmr(Root); await sleep(60) }
  const $ = (s) => document.querySelector(s)
  return { app, $, text: (s) => $(s)?.textContent, click: (s) => $(s).click() }
}

describe('P45-D: what a component no longer builds', () => {
  it('CHILD.select() made late still gets the current children', async () => {
    function Kid({ state }) { return h('i', { className: 'kid' }, 'k') }
    Kid.intent = ({ DOM }) => ({ GO: DOM.click('.kid') })
    Kid.model = { GO: { PARENT: () => 'hi' } }
    let picked = []
    function Root({ state }) { return h('div', null, h('b', { className: 'arm' }, 'arm'), state.armed ? h(Kid, {}) : h(Kid, {})) }
    Root.initialState = { armed: false }
    // the CHILD stream is selected only 30 ms after the child exists
    Root.intent = ({ CHILD }) => ({ HEARD: xs.periodic(30).take(1).map(() => CHILD.select(Kid)).flatten() })
    Root.model = { HEARD: (s, v) => (picked.push(v), s) }
    document.body.innerHTML = '<div id="root"></div>'
    apps.push(run(Root, {}, { mountPoint: '#root' }))
    await until(() => expect(document.querySelector('.kid')).not.toBe(null))
    await sleep(50)
    document.querySelector('.kid').click()
    await until(() => expect(picked).toEqual(['hi']))
  })

  it('components created in one task start together: one timer per delay, not one each', async () => {
    function Item({ state }) { return h('li', { className: 'it' }, h('i', { className: 'inc' }, String(state.n))) }
    Item.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
    Item.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    function List() { return h('ul', null, h('b', { className: 'add' }, '+'), h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [] }
    List.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
    List.model = { ADD: (s) => ({ ...s, items: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, n: 0 })) }) }
    document.body.innerHTML = '<div id="root"></div>'
    apps.push(run(List, {}, { mountPoint: '#root' }))
    await until(() => expect(document.querySelector('.add')).not.toBe(null))
    await sleep(20)
    const st = globalThis.setTimeout
    let n = 0
    globalThis.setTimeout = function (...a) { n++; return st.apply(this, a) }
    try {
      document.querySelector('.add').click()
      await until(() => expect(document.querySelectorAll('.it').length).toBe(100))
      await sleep(20)
    } finally { globalThis.setTimeout = st }
    expect(n).toBeLessThan(15)
    // and every item listens
    document.querySelectorAll('.it .inc')[42].click()
    await until(() => expect(document.querySelectorAll('.it')[42].textContent).toBe('1'))
  })
})
