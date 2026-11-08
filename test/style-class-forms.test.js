// @vitest-environment jsdom
// The forms the types and class= allow, in every layer that must agree: the pragma (and compiled
// views' __cv), the style module on a real element, SSR, sygnal/host and the worker path.
// CSS-1: style="a: b"; CSS-2: class keys with spaces; CSS-3: a boolean style value; CSS-5: className
// arrays and objects; CSS-7: SSR's property names.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h, __cv } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.js'
import { HostDocument } from '../src/host/dom.js'
import { webStyle } from '../src/primitives.js'

let t
afterEach(() => { t?.dispose(); t = null })
const Child = () => h('div')
const real = async (view, initialState) => {
  const C = view
  C.initialState = initialState
  C.intent = ({ DOM }) => ({ SET: DOM.click('.never') })
  C.model = { SET: (s, d) => d }
  t = renderComponent(C, { dom: 'real' })
  await t.ready()
  return t
}
const set = async (state) => { await t.simulateAction('SET', state); await t.settle() }

describe('pragma', () => {
  it('CSS-1: a string style on an element is { cssText }; a component keeps its prop', () => {
    expect(h('div', { style: 'color: red' }).data.style).toEqual({ cssText: 'color: red' })
    expect(h(Child, { style: 'color: red' }).data.style).toBe('color: red')
    const o = { color: 'red' }
    expect(h('div', { style: o }).data.style).toBe(o)
  })
  it('CSS-2: a class key that is not one name is split; a clean object is kept as passed', () => {
    expect(h('div', { class: { 'p-4 m-2': true, b: false } }).data.class).toEqual({ 'p-4': true, 'm-2': true })
    expect(h('div', { class: { 'p-4 m-2': false } }).data.class).toEqual({})
    expect(h('div', { class: { '': true, a: true } }).data.class).toEqual({ a: true })
    const o = { a: true, b: false }
    expect(h('div', { class: o }).data.class).toBe(o)
  })
  it('CSS-5: className takes an array or object; a string and a component are as written', () => {
    expect(h('div', { className: ['a', 'b c', false, ['d']] }).data.props.className).toBe('a b c d')
    expect(h('div', { className: { a: true, 'b c': 1, d: 0 } }).data.props.className).toBe('a b c')
    expect(h('div', { className: 'a  b' }).data.props.className).toBe('a  b')
    expect(h('div', { className: null }).data.props.className).toBe(null)
    const a = ['x']
    expect(h(Child, { className: a }).data.props.className).toBe(a)
  })
  it('compiled views take the same path', () => {
    const r = __cv.r(['style', 'class', 'className'])
    expect(__cv.d(r, ['a: b', { 'c d': true }, ['e', 'f']])).toEqual({ style: { cssText: 'a: b' }, class: { c: true, d: true }, props: { className: 'e f' } })
    expect(__cv.sd({ style: 'a: b' }).style).toEqual({ cssText: 'a: b' })
  })
  it('webStyle (primitives) passes a string through as cssText', () => {
    expect(webStyle('color: red')).toEqual({ cssText: 'color: red' })
  })
})

describe('real element', () => {
  it('CSS-1: a string renders; string, object and none keep the element right', async () => {
    await real(({ state }) => h('p', { className: 'x', style: state.s }, 'p'), { s: 'color: red; margin-top: 2px' })
    const el = () => t.query('.x')
    expect(el().style.color).toBe('red')
    expect(el().style.marginTop).toBe('2px')
    await set({ s: { color: 'blue' } })
    expect(el().style.color).toBe('blue')
    expect(el().style.marginTop).toBe('')
    await set({ s: 'padding-top: 1px' })
    expect(el().style.color).toBe('')
    expect(el().style.paddingTop).toBe('1px')
    await set({ s: undefined })
    expect(el().style.cssText).toBe('')
  })
  it("CSS-1: a new text keeps the object's own keys (a merged { cssText, ... })", async () => {
    await real(({ state }) => h('p', { className: 'x', style: { cssText: state.s, zIndex: '3' } }, 'p'), { s: 'color: red' })
    expect(t.query('.x').style.zIndex).toBe('3')
    await set({ s: 'color: blue' })
    expect(t.query('.x').style.color).toBe('blue')
    expect(t.query('.x').style.zIndex).toBe('3')
  })
  it('CSS-2: class object with spaces patches on and off', async () => {
    await real(({ state }) => h('p', { className: 'x', class: { 'p-4 m-2': state.on } }, 'p'), { on: true })
    expect([...t.query('.x').classList].sort()).toEqual(['m-2', 'p-4', 'x'])
    await set({ on: false })
    expect([...t.query('.x').classList]).toEqual(['x'])
  })
  it('CSS-3: a boolean clears the property, also a custom one', async () => {
    await real(({ state }) => h('p', { className: 'x', style: { color: state.on && 'red', '--a': state.on && '1' } }, 'p'), { on: true })
    expect(t.query('.x').style.color).toBe('red')
    expect(t.query('.x').style.getPropertyValue('--a')).toBe('1')
    await set({ on: false })
    expect(t.query('.x').style.color).toBe('')
    expect(t.query('.x').style.getPropertyValue('--a')).toBe('')
  })
  it('CSS-5: className array applies as classes', async () => {
    await real(() => h('p', { className: ['x', 'y'] }, 'p'), {})
    expect(t.query('.x').className).toBe('x y')
  })
})

describe('SSR', () => {
  const html = (v) => renderToString(function C() { return v })
  it('CSS-1: a string style is written; CSS-3: booleans are not', () => {
    expect(html(h('div', { style: 'color: red;' }))).toContain('style="color: red"')
    expect(html(h('div', { style: { color: false, top: true, left: 0 } }))).toContain('style="left: 0"')
  })
  it('CSS-2, CSS-5: normalized classes reach the attribute', () => {
    expect(html(h('div', { class: { 'a b': true } }))).toContain('class="a b"')
    expect(html(h('div', { className: ['c', 'd'] }))).toContain('class="c d"')
  })
  it('CSS-7: property names match the client', () => {
    const s = (o) => html(h('div', { style: o }))
    expect(s({ '--myVar': '1' })).toContain('style="--myVar: 1"')
    expect(s({ cssFloat: 'left' })).toContain('style="float: left"')
    expect(s({ msTransform: 'none', WebkitTransform: 'none' })).toContain('-ms-transform: none; -webkit-transform: none')
    expect(s({ 'background-color': 'red' })).toContain('style="background-color: red"')
  })
})

describe('sygnal/host', () => {
  it('CSS-1: cssText becomes the declarations, a change of the element', () => {
    const doc = new HostDocument()
    const el = doc.createElement('div')
    const before = el.attrRevision
    el.style.cssText = 'display: none; background-image: url(a;b); --my-x: 1; color: red !important'
    expect({ ...el.style }).toEqual({ display: 'none', backgroundImage: 'url(a;b)', '--my-x': '1', color: 'red' })
    expect(el.attrRevision).not.toBe(before)
    el.style.cssText = ''
    expect({ ...el.style }).toEqual({})
  })
})
