// React DOM's booleanish string attributes (spellcheck, draggable, contenteditable) are attributes,
// with true / false written as "true" / "false" (Sift console port: spellcheck="false" was set as
// the spellcheck property, which a non-empty string makes true). Any case (spellCheck,
// contentEditable) gives the lowercase attribute, as React's. The default mock DOM shows them in
// outerHTML / t.html(); sygnal/host gets the same attributes.
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { jsx } from '../src/jsx-runtime.js'
import { init } from '../src/cycle/dom/snabbdom.ts'
import modules from '../src/cycle/dom/modules.ts'
import { renderComponent } from '../src/extra/testing.js'
import run from '../src/extra/run.ts'
import { HostDocument, makeHostDriver } from '../src/host.ts'
import processDrag from '../src/extra/processDrag.ts'
import { Scene, sceneOf } from '../src/three.ts'

const NAMES = ['spellcheck', 'draggable', 'contenteditable']

describe('booleanish attributes: the pragma', () => {
  for (const name of NAMES) it(`${name}: attrs, true / false / "false" as "true" / "false"`, () => {
    expect(h('div', { [name]: false }).data).toEqual({ attrs: { [name]: 'false' } })
    expect(h('div', { [name]: true }).data).toEqual({ attrs: { [name]: 'true' } })
    expect(h('div', { [name]: 'false' }).data).toEqual({ attrs: { [name]: 'false' } })
    expect(jsx('div', { [name]: false }).data).toEqual({ attrs: { [name]: 'false' } })
  })
  it('React casing gives the lowercase attribute; null removes it; undefined is skipped', () => {
    expect(h('textarea', { spellCheck: false, contentEditable: 'plaintext-only' }).data.attrs).toEqual({ spellcheck: 'false', contenteditable: 'plaintext-only' })
    expect(h('div', { draggable: null }).data.attrs).toEqual({ draggable: false })
    expect(h('div', { draggable: undefined }).data.attrs).toBeUndefined()
  })
  it('a component placeholder keeps them as props; SVG keeps them as attributes', () => {
    const C = () => null
    expect(h(C, { spellcheck: false }).data.props).toEqual({ spellcheck: false })
    expect(h('svg', { draggable: true }).data.attrs).toEqual({ draggable: 'true' })
  })
})

describe('booleanish attributes: the DOM (Sygnal\'s modules)', () => {
  const patch = init(modules)
  const mount = (v) => { const root = document.createElement('div'); document.body.appendChild(root); return patch(root, v) }
  it('spellcheck="false" and spellcheck={false} turn spellcheck off', () => {
    for (const val of ['false', false]) {
      const v = mount(h('input', { spellcheck: val }))
      expect(v.elm.getAttribute('spellcheck')).toBe('false')
      expect(v.elm.outerHTML).toBe('<input spellcheck="false">')
    }
  })
  it('draggable / contenteditable "false" are false, "true" true; changes and removal patch the attribute', () => {
    let v = mount(h('div', { draggable: 'false', contenteditable: false }))
    expect(v.elm.getAttribute('draggable')).toBe('false')
    expect(v.elm.getAttribute('contenteditable')).toBe('false')
    v = patch(v, h('div', { draggable: true, contenteditable: 'true' }))
    expect(v.elm.draggable).toBe(true)
    expect(v.elm.getAttribute('contenteditable')).toBe('true')
    v = patch(v, h('div', { draggable: false }))
    expect(v.elm.draggable).toBe(false)
    expect(v.elm.getAttribute('draggable')).toBe('false')
    expect(v.elm.hasAttribute('contenteditable')).toBe(false)
  })
})

describe('booleanish attributes: renderComponent', () => {
  function Editor({ state }) {
    return h('div', {}, h('textarea', { className: 'code', spellcheck: 'false', draggable: state.drag }), h('p', { contentEditable: true }, 'x'))
  }
  Editor.initialState = { drag: false }
  Editor.model = { DRAG: (s) => ({ ...s, drag: true }) }
  Editor.intent = () => ({})

  it('the mock DOM shows them in html() / outerHTML and getAttribute()', async () => {
    const t = renderComponent(Editor)
    await t.ready()
    expect(t.html()).toBe('<div><textarea class="code" spellcheck="false" draggable="false"></textarea><p contenteditable="true">x</p></div>')
    const ta = t.query('.code')
    expect(ta.getAttribute('spellcheck')).toBe('false')
    expect(ta.outerHTML).toContain('spellcheck="false"')
    await t.simulateAction('DRAG')
    expect(t.query('.code').getAttribute('draggable')).toBe('true')
    t.dispose()
  })
  it("dom: 'real' writes the attributes", async () => {
    const t = renderComponent(Editor, { dom: 'real' })
    await t.ready()
    const ta = t.container.querySelector('.code')
    expect(ta.getAttribute('spellcheck')).toBe('false')
    expect(ta.getAttribute('draggable')).toBe('false')
    expect(t.container.querySelector('p').getAttribute('contenteditable')).toBe('true')
    t.dispose()
  })
})

describe('booleanish attributes: sygnal/host', () => {
  it('the host tree gets the same lowercase attributes', async () => {
    const doc = new HostDocument()
    function App() { return h('div', {}, h('input', { spellCheck: false, draggable: true })) }
    const app = run(App, { DOM: makeHostDriver(doc) })
    await new Promise((r) => setTimeout(r, 10))
    const input = doc.body.querySelector('input')
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect(input.getAttribute('draggable')).toBe('true')
    app.dispose()
  })
})

describe('booleanish attributes: sygnal/three', () => {
  it('draggable={false} ("false" in attrs) is not a drag source; draggable is', async () => {
    function Bin({ state }) {
      return h(Scene, { className: 'viewport', width: 400, height: 300, frameloop: 'never' },
        h('mesh', { className: 'box', draggable: state.on, position: [-1.5, 0, 0] }, h('boxGeometry'), h('meshBasicMaterial')),
        h('mesh', { className: 'bin', position: [1.5, 0, 0] }, h('boxGeometry', { args: [1, 1, 1] }), h('meshBasicMaterial')))
    }
    Bin.initialState = { on: false, started: 0 }
    Bin.intent = ({ DOM }) => ({ START: processDrag({ draggable: DOM.select('.box'), dropZone: DOM.select('.bin') }).dragStart$ })
    Bin.model = { START: (s) => ({ ...s, started: s.started + 1 }), ON: (s) => ({ ...s, on: true }) }
    const t = renderComponent(Bin, { dom: 'real' })
    await t.ready()
    const s = sceneOf(t.container.querySelector('.viewport'))
    s.drag(t.container.querySelector('.box'), t.container.querySelector('.bin'), { steps: 5 })
    await t.settle()
    expect(t.state.started).toBe(0)
    await t.simulateAction('ON')
    s.drag(t.container.querySelector('.box'), t.container.querySelector('.bin'), { steps: 5 })
    await t.settle()
    expect(t.state.started).toBe(1)
    t.dispose()
  })
})
