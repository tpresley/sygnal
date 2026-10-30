// @vitest-environment jsdom
// canvas-three (dev-plans/research/canvas-three): widgets with declarative children (islands),
// their accessibility, the controlled `value`, `tags`; and the fixes found on the way (core inject,
// components under <svg>, the agent-ui snapshot).
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { defineWidget } from '../src/extra/widget.ts'
import { Collection } from '../src/collection.ts'
import { ABORT } from '../src/shared.ts'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.ts'

afterEach(() => { document.body.innerHTML = '' })

// a "painter": records what sync() saw (each child's tag and props, as the view wrote them)
const Board = defineWidget({
  name: 'Board',
  children: true,
  mount: (el) => ({ syncs: 0, seen: [], focused: null, el }),
  sync: (inst, children) => {
    inst.syncs++
    const walk = (vs) => (vs || []).flatMap(v => v.sel ? [{ tag: v.sel.split(/[.#]/)[0], props: { ...v.data?.attrs, ...v.data?.props }, elm: v.elm }, ...walk(v.children)] : [])
    inst.seen = walk(children.children)
  },
  focus: (inst, child) => { inst.focused = child },
})
const boardOf = (t) => t.container.querySelector('[data-widget-children]').parentNode.__sw.i

function Piece({ state }) {
  return h('piece', { className: 'piece', position: [state.x, 0], tabIndex: 0, role: 'button', 'aria-label': `piece ${state.id}` })
}
Piece.intent = ({ DOM }) => ({ PICK: DOM.click('.piece') })
Piece.model = { PICK: (s) => ({ ...s, picked: !s.picked }) }

// the HUD's state is its own: a tick re-renders it, and the root only re-injects its new vnode
function Hud({ state }) { return h('div', null, h('p', { className: 'hud' }, `${state.ticks} ticks`), h('button', { className: 'tick' }, 'tick')) }
Hud.isolatedState = true
Hud.initialState = { ticks: 0 }
Hud.intent = ({ DOM }) => ({ TICK: DOM.click('.tick') })
Hud.model = { TICK: (s) => ({ ...s, ticks: s.ticks + 1 }) }

function Game({ state }) {
  return h('main', null,
    h(Hud),
    h(Board, { className: 'board' },
      h('ground', { size: 8 }),
      h(Collection, { of: Piece, from: 'pieces' })))
}
Game.initialState = { pieces: [{ id: 1, x: 0, picked: false }, { id: 2, x: 3, picked: false }] }

describe('defineWidget({ children: true, sync })', () => {
  it('children are components with their own intents; sync gets their vnodes', async () => {
    const t = renderComponent(Game, { dom: 'real' })
    await t.ready()
    const b = boardOf(t)
    expect(b.seen.map(x => x.tag)).toEqual(['ground', 'piece', 'piece'])
    expect(b.seen[2].props.position).toEqual([3, 0])          // an array, as written
    // an event dispatched on a child element reaches that item's intent only (isolation)
    b.seen[2].elm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await t.waitForState(s => s.pieces[1].picked)
    expect(t.state.pieces[0].picked).toBe(false)
    t.dispose()
  })

  it('a patch elsewhere (a sibling component) does not sync: the children vnodes are the same', async () => {
    const t = renderComponent(Game, { dom: 'real' })
    await t.ready()
    const b = boardOf(t), n = b.syncs
    t.container.querySelector('.tick').click()
    await t.settle()
    expect(t.container.querySelector('.hud').textContent).toBe('1 ticks')
    expect(b.syncs).toBe(n)
    b.seen[1].elm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await t.waitForState(s => s.pieces[0].picked)
    await t.settle()
    expect(b.syncs).toBe(n + 1)
    t.dispose()
  })

  it('accessible by default: visually hidden, Enter / Space click a focused child, focus() is told', async () => {
    const t = renderComponent(Game, { dom: 'real' })
    await t.ready()
    const c = t.container.querySelector('[data-widget-children]'), b = boardOf(t)
    expect(c.hidden).toBe(false)
    expect(c.style.clip).toMatch(/^rect\(0/)
    expect(c.style.position).toBe('absolute')
    const piece = c.querySelectorAll('piece')[0]
    piece.focus()
    expect(b.focused).toBe(piece)
    piece.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await t.waitForState(s => s.pieces[0].picked)
    piece.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    await t.waitForState(s => !s.pieces[0].picked)
    piece.blur()
    expect(b.focused).toBe(null)
    t.dispose()
  })

  it("children: 'hidden' opts out", async () => {
    const Quiet = defineWidget({ children: 'hidden', mount: () => ({}) })
    const App = () => h('div', null, h(Quiet, null, h('dot')))
    const t = renderComponent(App, { dom: 'real' })
    await t.ready()
    expect(t.container.querySelector('[data-widget-children]').hidden).toBe(true)
    t.dispose()
  })

  it('SSR renders the children (accessible markup before the client mounts)', () => {
    const App = () => h(Board, { className: 'board' }, h('piece', { 'aria-label': 'first' }))
    const html = renderToString(App)
    expect(html).toMatch(/data-widget-children/)
    expect(html).toMatch(/<piece[^>]*aria-label="first"/)
  })

  it('tags: the widget\'s vocabulary is not SVG (a map\'s <marker>)', () => {
    const before = h('marker', { position: [1, 2] })
    expect(before.data.ns).toBe('http://www.w3.org/2000/svg')
    defineWidget({ children: true, tags: ['marker'], mount: () => ({}) })
    const after = h('marker', { position: [1, 2] })
    expect(after.data.ns).toBeUndefined()
    expect(after.data.props.position).toEqual([1, 2])
    // under a literal <svg>, its own children are still SVG
    expect(h('svg', null, h('marker')).children[0].data.ns).toBe('http://www.w3.org/2000/svg')
  })
})

// the editor stand-in: an object holding text that the "user" edits
const Field = defineWidget({
  name: 'Field',
  events: ['change'],
  value: {
    write: (f, v) => { f.text = v; f.writes.push(v) },
    read: (f) => f.text,
  },
  mount: (el, props, dispatch) => {
    const f = { text: props.value, writes: [], type: (v) => { f.text = v; dispatch('change', v) } }
    el.__field = f
    return f
  },
})
const fieldOf = (t) => t.container.querySelector('.field').__field

function Form({ state }) {
  return h('div', null, h(Field, { className: 'field', value: state.text, strict: true }), h('button', { className: 'reset' }, 'reset'))
}
Form.initialState = { text: 'hi', edits: 0 }
Form.intent = ({ DOM }) => ({ EDIT: DOM.select('.field').events('change').value(), RESET: DOM.click('.reset') })
Form.model = {
  EDIT: (s, text) => /\d/.test(text) ? ABORT : { ...s, text: text.slice(0, 8), edits: s.edits + 1 },
  RESET: (s) => ({ ...s, text: '' }),
}

describe('defineWidget({ value }) (experimental): the controlled value', () => {
  it('own edits are not written back; the app\'s are, once', async () => {
    const t = renderComponent(Form, { dom: 'real' })
    await t.ready()
    const f = fieldOf(t)
    f.type('hi '); f.type('hi t'); f.type('hi there')
    await t.waitForState(s => s.text == 'hi there')
    await t.settle()
    expect(f.writes).toEqual([])
    expect(t.state.edits).toBe(3)
    t.simulateEvent('.reset', 'click')
    await t.waitForState(s => s.text == '')
    await t.settle()
    expect(f.writes).toEqual([''])
    f.type('a long sentence')                 // the model clamps to 8: the app's value, written
    await t.waitForState(s => s.text == 'a long s')
    await t.settle()
    expect(f.writes).toEqual(['', 'a long s'])
    t.dispose()
  })

  it('strict: an edit the model rejected is reverted after its turn', async () => {
    const t = renderComponent(Form, { dom: 'real' })
    await t.ready()
    const f = fieldOf(t)
    f.type('hi 2')
    await t.settle()
    await new Promise(r => setTimeout(r, 5))
    expect(f.text).toBe('hi')
    expect(f.writes).toEqual(['hi'])
    t.dispose()
  })
})

describe('the core: a re-inject keeps unchanged copies (canvas-three F2)', () => {
  it('an element above an unchanged component is not patched again when a sibling changes', async () => {
    let posts = 0
    function Other() { return h('span', null, 'other') }
    function App() {
      return h('main', null,
        h(Hud),
        h('section', { hook: { postpatch: () => posts++ } }, h(Other)))
    }
    const t = renderComponent(App, { dom: 'real' })
    await t.ready()
    await t.settle()
    const before = posts
    t.container.querySelector('.tick').click()
    await t.settle()
    t.container.querySelector('.tick').click()
    await t.settle()
    expect(t.container.querySelector('.hud').textContent).toBe('2 ticks')
    expect(posts).toBe(before)
    t.dispose()
  })
})

describe('agent-ui: a listened container with interactive children (canvas-three F1)', () => {
  it('keeps its children; a listened container without them stays one control', async () => {
    const { HostDocument, makeHostDriver } = await import('../src/host.ts')
    const { snapshotTree, formatSnapshot } = await import('../src/agent-ui.ts')
    const run = (await import('../src/extra/run.ts')).default
    function World() {
      return h('div', null,
        h('group', { className: 'world' }, h('p', null, 'score 1'), h('mesh', { className: 'cube', role: 'button', 'aria-label': 'cube 1' })),
        h('div', { className: 'card' }, h('p', null, 'A card')))
    }
    World.intent = ({ DOM }) => ({ HIT: DOM.click('.world'), CUBE: DOM.click('.cube'), CARD: DOM.click('.card') })
    World.initialState = {}
    World.model = { HIT: () => ABORT, CUBE: () => ABORT, CARD: () => ABORT }
    const doc = new HostDocument()
    const app = run(World, { DOM: makeHostDriver(doc) })
    await new Promise(r => setTimeout(r, 0))
    const snap = formatSnapshot(snapshotTree(doc))
    expect(snap).toMatch(/- generic \[ref=e\d+\] \[on=click\]:\n  - text: score 1\n  - button "cube 1" \[ref=e\d+\] \[on=click\]/)
    expect(snap).toMatch(/- generic "A card" \[ref=e\d+\] \[on=click\]$/)
    app.dispose()
  })
})

describe('the pragma: components inside a literal <svg> (found by canvas-three)', () => {
  it('a component and a Collection under <svg> keep their props; their output is SVG', async () => {
    function Dot({ state, r }) { return h('circle', { className: 'dot', cx: state.x, cy: 5, r }) }
    function Plot() { return h('svg', { width: 100, height: 10 }, h(Dot, { state: 'first', r: 4 }), h(Collection, { of: Dot, from: 'dots' })) }
    Plot.initialState = { first: { x: 1 }, dots: [{ id: 1, x: 10 }, { id: 2, x: 20 }] }
    const t = renderComponent(Plot, { dom: 'real' })
    await t.ready()
    const dots = [...t.container.querySelectorAll('circle.dot')]
    expect(dots.map(d => d.getAttribute('cx'))).toEqual(['1', '10', '20'])
    expect(dots[0].getAttribute('r')).toBe('4')
    expect(dots[0].namespaceURI).toBe('http://www.w3.org/2000/svg')
    t.dispose()
  })
})
