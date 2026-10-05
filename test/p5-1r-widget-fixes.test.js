// @vitest-environment jsdom
// PLAN-5 1-R: fixes from the 1-W review (G-359…G-364, G-367…G-369) for defineWidget hosts:
// Portal removal, host identity vs non-widget vnodes, the per-instance failure map, object host
// props, Transition hooks, class tokens a library adds, a throwing remount, ref, and the mock-DOM
// command check.
import { describe, it, expect, afterEach, vi } from 'vitest'
import flatpickr from 'flatpickr'
import { createElement as h } from '../src/pragma/index.js'
import { controls } from '../src/extra/controls.js'
import { defineWidget } from '../src/extra/widget.ts'
import run from '../src/extra/run.js'
import { renderComponent } from '../src/extra/testing.js'
import { Portal, Transition } from '../src/index.js'

const settle = (ms = 30) => new Promise(r => setTimeout(r, ms))
let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; vi.restoreAllMocks() })
const mount = (App, opts = {}) => {
  if (!document.querySelector('#root')) document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'off', ...opts })
  return app
}
const click = async (sel = '.t', ms) => { document.querySelector(sel).click(); await settle(ms) }
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('G-359: a widget inside a removed <Portal> is unmounted', () => {
  it('toggling a Portal with a flatpickr widget three times: one mount/unmount each, nothing left', async () => {
    document.body.innerHTML = '<div id="root"></div><div id="modals"></div>'
    const log = []
    const DP = defineWidget({ tag: 'input', mount: (el) => { log.push('m'); return flatpickr(el, {}) }, unmount: (fp) => { log.push('u'); fp.destroy() } })
    function C({ state }) {
      return h('div', null,
        state.open ? h(Portal, { target: '#modals' }, h('div', { className: 'modal' }, h(DP, { className: 'due' }))) : null,
        h('button', { className: 't' }, 't'))
    }
    C.initialState = { open: true }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => ({ open: !s.open }) }
    mount(C); await settle(60)
    expect(log).toEqual(['m'])
    expect(document.querySelectorAll('.flatpickr-calendar')).toHaveLength(1)
    await click('.t', 60)
    await click('.t', 60)
    await click('.t', 60)
    expect(log).toEqual(['m', 'u', 'm', 'u'])
    expect(document.querySelectorAll('.flatpickr-calendar')).toHaveLength(0)
    expect(document.querySelectorAll('.modal')).toHaveLength(0)
    expect(document.querySelector('#modals').children).toHaveLength(0)
  })
})

describe('G-360: a host is never patched into a non-widget vnode', () => {
  it('a widget replaced by a plain element of the same tag and class unmounts; the element is a new one', async () => {
    const log = []
    const W = defineWidget({ tag: 'input', mount: (el, p) => { log.push('m'); return {} }, update() {}, unmount: () => log.push('u') })
    function C({ state }) { return h('div', null, state.w ? h(W, { className: 'x' }) : h('input', { className: 'x' }), h('button', { className: 't' }, 't')) }
    C.initialState = { w: true }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => ({ w: !s.w }) }
    mount(C); await settle()
    const el1 = document.querySelector('.x')
    await click()
    const el2 = document.querySelector('.x')
    expect(log).toEqual(['m', 'u'])
    expect(el2).not.toBe(el1)
    expect(el2.__sygnalWidget).toBe(undefined)
    await click()
    expect(log).toEqual(['m', 'u', 'm'])
  })

  it('a plain element replaced by a widget of the same tag: the widget gets a fresh element', async () => {
    const log = []
    const W = defineWidget({ tag: 'div', mount: (el) => { log.push('m'); el.appendChild(document.createElement('canvas')); return {} }, update: () => log.push('up'), unmount: () => log.push('u') })
    function C({ state }) { return h('section', null, state.w ? h(W, { className: 'x', v: state.n }) : h('div', { className: 'x' }, h('span', null, 'child')), h('button', { className: 't' }, 't')) }
    C.initialState = { w: false, n: 0 }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => ({ w: !s.w, n: s.n + 1 }) }
    mount(C); await settle()
    await click()
    expect(log).toEqual(['m'])
    expect(document.querySelector('.x').innerHTML).toBe('<canvas></canvas>')
    await click()
    expect(log).toEqual(['m', 'u'])
    expect(document.querySelector('.x').innerHTML).toBe('<span>child</span>')
  })

  it("the 'widget' error fallback (a <div>, as the host) replaces the host: the widget unmounts", async () => {
    quiet()
    const log = []
    const Chart = defineWidget({ mount: (el) => { log.push('m'); el.appendChild(document.createElement('canvas')); return {} }, update(i, p) { if (p.v) throw new Error('bad') }, unmount: () => log.push('u') })
    function C({ state }) { return h('section', null, h(Chart, { className: 'chart', v: state.v }), h('button', { className: 't' }, 't')) }
    C.initialState = { v: 0 }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: () => ({ v: 1 }) }
    C.onError = () => h('div', { className: 'fb' }, 'Chart failed')
    mount(C); await settle()
    await click('.t', 60)
    const fb = document.querySelector('.fb')
    expect(fb.textContent).toBe('Chart failed')
    expect(fb.querySelector('canvas')).toBe(null)
    expect(fb.__sygnalWidget).toBe(undefined)
    expect(log).toEqual(['m', 'u'])
  })

  it('two unkeyed instances side by side keep their own elements and instances', async () => {
    const log = []
    const W = defineWidget({ mount: (el, p) => { log.push('m' + p.n); return { n: p.n } }, update: (i, p) => log.push(`up${i.n}:${p.v}`), unmount: (i) => log.push('u' + i.n) })
    function C({ state }) { return h('div', null, h(W, { className: 'a', n: 1, v: 0 }), h(W, { className: 'b', n: 2, v: state.v }), h('button', { className: 't' }, 't')) }
    C.initialState = { v: 0 }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => ({ v: s.v + 1 }) }
    mount(C); await settle()
    const a = document.querySelector('.a'), b = document.querySelector('.b')
    await click()
    expect(log).toEqual(['m1', 'm2', 'up2:1'])
    expect(document.querySelector('.a')).toBe(a)
    expect(document.querySelector('.b')).toBe(b)
  })
})

describe('G-361: failures are per instance, and cleared', () => {
  it('an unkeyed sibling of the same widget is unaffected; the failed one recovers when its props change', async () => {
    quiet()
    const W = defineWidget({ mount(el, p) { if (p.bad) throw new Error('x'); el.textContent = 'ok'; return {} }, update() {} })
    function C({ state }) { return h('div', null, h(W, { className: 'a', bad: state.bad }), h(W, { className: 'b' }), h('button', { className: 't' }, 't')) }
    C.initialState = { bad: true }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: () => ({ bad: false }) }
    C.onError = () => h('em', { className: 'fb' }, 'fb')
    mount(C); await settle(60)
    expect(document.querySelectorAll('.fb')).toHaveLength(1)
    expect(document.querySelector('.a')).toBe(null)
    expect(document.querySelector('.b').textContent).toBe('ok')
    await click('.t', 60)
    expect(document.querySelector('.fb')).toBe(null)
    expect(document.querySelector('.a').textContent).toBe('ok')
    expect(document.querySelector('.b').textContent).toBe('ok')
  })

  it('the same key in another widget type is unaffected', async () => {
    quiet()
    const Bad = defineWidget({ mount() { throw new Error('x') } })
    const Good = defineWidget({ mount(el) { el.textContent = 'good'; return {} } })
    function C() { return h('div', null, h('ul', null, h(Bad, { key: 1, className: 'a' })), h('ol', null, h(Good, { key: 1, className: 'g' }))) }
    C.initialState = {}
    C.onError = () => h('em', { className: 'fb' }, 'fb')
    mount(C); await settle(60)
    expect(document.querySelectorAll('.fb')).toHaveLength(1)
    expect(document.querySelector('ul .fb')).toBeTruthy()
    expect(document.querySelector('.g').textContent).toBe('good')
  })

  it('a panel reopened after a failure tries the widget again', async () => {
    quiet()
    let fails = 1
    const W = defineWidget({ mount(el) { if (fails-- > 0) throw new Error('x'); el.textContent = 'ok'; return {} } })
    function C({ state }) { return h('div', null, state.open ? h('section', null, h(W, { className: 'w' })) : null, h('button', { className: 't' }, 't')) }
    C.initialState = { open: true }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => ({ open: !s.open }) }
    C.onError = () => h('em', { className: 'fb' }, 'fb')
    mount(C); await settle(60)
    expect(document.querySelector('.fb')).toBeTruthy()
    await click('.t', 60)
    expect(document.querySelector('section')).toBe(null)
    await click('.t', 60)
    expect(document.querySelector('.fb')).toBe(null)
    expect(document.querySelector('.w').textContent).toBe('ok')
  })
})

describe('G-362: object host props compare by value', () => {
  it('a new style / attrs object with the same entries neither remounts nor updates', async () => {
    const log = []
    const NoUp = defineWidget({ tag: 'input', mount: (el, p) => { log.push('m'); return {} }, unmount: () => log.push('u') })
    const Up = defineWidget({ tag: 'input', mount: () => ({}), update: (i, p) => log.push('up:' + p.style.width) })
    function C({ state }) {
      return h('div', null,
        h(NoUp, { className: 'x', v: 1, style: { width: '10px' }, attrs: { 'data-a': '1' } }),
        h(Up, { className: 'y', style: { width: state.w } }),
        h('button', { className: 't' }, String(state.n)))
    }
    C.initialState = { n: 0, w: '1px' }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t'), W: DOM.click('.x') })
    C.model = { T: (s) => ({ ...s, n: s.n + 1 }), W: (s) => ({ ...s, w: '2px' }) }
    mount(C); await settle()
    await click()
    await click()
    expect(log).toEqual(['m'])
    expect(document.querySelector('.x').style.width).toBe('10px')
    await click('.x')
    expect(log).toEqual(['m', 'up:2px'])
    expect(document.querySelector('.y').style.width).toBe('2px')
  })
})

describe('G-363: <Transition> around a widget', () => {
  it('the host gets the enter classes, and the leave classes before it goes; the widget mounts and unmounts', async () => {
    globalThis.requestAnimationFrame ||= (f) => setTimeout(f, 0)
    const log = []
    const W = defineWidget({ tag: 'div', mount: (el) => { log.push('m'); return {} }, unmount: () => log.push('u') })
    function C({ state }) { return h('div', null, state.on ? h(Transition, { name: 'fade', duration: 40 }, h(W, { className: 'w' })) : null, h('button', { className: 't' }, 't')) }
    C.initialState = { on: false }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => ({ on: !s.on }) }
    mount(C); await settle()
    await click('.t', 10)
    const el = document.querySelector('.w')
    expect(log).toEqual(['m'])
    expect(el.classList.contains('fade-enter-active')).toBe(true)
    await settle(80)
    expect(el.className).toBe('w')
    await click('.t', 10)
    expect(el.classList.contains('fade-leave-active')).toBe(true)
    expect(log).toEqual(['m', 'u'])
    await settle(80)
    expect(document.querySelector('.w')).toBe(null)
  })
})

describe('G-364: className toggles only its own tokens', () => {
  it('flatpickr keeps flatpickr-input when the className changes', async () => {
    const DP = defineWidget({ tag: 'input', mount: (el) => flatpickr(el, {}), update() {}, unmount: (fp) => fp.destroy() })
    function C({ state }) { return h('div', null, h(DP, { className: state.err ? 'due err' : 'due' }), h('button', { className: 't' }, 't')) }
    C.initialState = { err: false }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => ({ err: !s.err }) }
    mount(C); await settle()
    const el = document.querySelector('.due')
    expect(el.classList.contains('flatpickr-input')).toBe(true)
    await click()
    expect([...el.classList].sort()).toEqual(['due', 'err', 'flatpickr-input'])
    await click()
    expect([...el.classList].sort()).toEqual(['due', 'flatpickr-input'])
  })

  it('className and a class map together', async () => {
    const W = defineWidget({ mount: (el) => { el.classList.add('lib'); return {} } })
    function C({ state }) { return h('div', null, h(W, { className: 'w', class: { on: state.on } }), h('button', { className: 't' }, 't')) }
    C.initialState = { on: true }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => ({ on: !s.on }) }
    mount(C); await settle()
    const el = document.querySelector('.w')
    expect([...el.classList].sort()).toEqual(['lib', 'on', 'w'])
    await click()
    expect([...el.classList].sort()).toEqual(['lib', 'w'])
  })
})

describe('G-367: a remount (no update) whose mount throws', () => {
  it('is SYG660 (mount), unmounts the old instance once, and leaves no record', async () => {
    const errs = []
    vi.spyOn(console, 'error').mockImplementation((m) => errs.push(String(m)))
    const log = []
    const W = defineWidget({ mount(el, p) { log.push('m' + p.v); if (p.v == 2) throw new Error('m2'); return { v: p.v } }, unmount(i) { log.push('u' + i.v) } })
    function C({ state }) { return h('div', null, state.show ? h(W, { className: 'a', v: state.v }) : null, h('button', { className: 't' }, 't')) }
    C.initialState = { v: 1, show: true }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => (s.v == 1 ? { ...s, v: 2 } : { ...s, show: false }) }
    const onError = vi.fn()
    mount(C, { onError }); await settle()
    await click('.t', 60)
    expect(log).toEqual(['m1', 'u1', 'm2'])
    expect(errs.some(e => e.includes('SYG660'))).toBe(true)
    expect(errs.some(e => e.includes('SYG661'))).toBe(false)
    expect(onError.mock.calls[0][1]).toMatchObject({ phase: 'widget' })
    await click('.t', 60)
    expect(log).toEqual(['m1', 'u1', 'm2'])
  })
})

describe('G-368: ref reaches the host element', () => {
  it('a ref object and a ref function get the host; null when it leaves', async () => {
    const r = { current: null }, seen = []
    const W = defineWidget({ mount: () => ({}) })
    function C({ state }) { return h('div', null, state.on ? h(W, { className: 'a', ref: r }) : null, state.on ? h(W, { className: 'b', ref: (el) => seen.push(el && el.className) }) : null, h('button', { className: 't' }, 't')) }
    C.initialState = { on: true }
    C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    C.model = { T: (s) => ({ on: !s.on }) }
    mount(C); await settle()
    expect(r.current).toBe(document.querySelector('.a'))
    expect(seen[0]).toBe('b')
    await click()
    expect(r.current).toBe(null)
    expect(seen.at(-1)).toBe(null)
  })
})

describe('G-369: the mock-DOM command check', () => {
  it('a control wrapping a <form> widget: a native form method is no finding', async () => {
    const DP = defineWidget({ tag: 'form', mount: () => ({}), commands: { open: () => {} } })
    const { Due } = controls({ Due: DP })
    function F() { return h('div', null, h(Due, {}), h('button', { className: 'go' }, 'go')) }
    F.initialState = {}
    F.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    F.model = { GO: { ELEMENT: [{ submit: Due }, { open: Due }] } }
    const t = renderComponent(F)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await t.settle()
    expect(t.diagnostics.map(d => d.code)).toEqual([])
    t.dispose()
  })

  it('a selector resolves the widget among the sender\'s own elements only', async () => {
    // the parent's .w (first in the tree) is a widget without `open`; the child's own .w has it
    const Other = defineWidget({ tag: 'input', mount: () => ({}), commands: { clear: () => {} } })
    const DP = defineWidget({ tag: 'input', mount: () => ({}), commands: { open: () => {} } })
    function Child() { return h('div', null, h(DP, { className: 'w' }), h('button', { className: 'go' }, 'go')) }
    Child.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Child.model = { GO: { ELEMENT: { open: '.w' } } }
    function P() { return h('div', null, h(Other, { className: 'w' }), h(Child, {})) }
    P.initialState = {}
    const t = renderComponent(P)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await t.settle()
    expect(t.diagnostics.map(d => d.code)).toEqual([])
    t.dispose()
  })
})
