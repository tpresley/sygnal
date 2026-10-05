// @vitest-environment jsdom
// PLAN-5 W-1 (D189/D190/D196): defineWidget as a tag (canonical: className + DOM.select) and as a
// control (alternative), with a real third-party widget (flatpickr) and hand-written widgets.
// From spike 0-S1; the diagnostics (SYG140–144, SYG660–662) are in p5-w1-widget-diagnostics.test.js.
import { describe, it, expect, afterEach, vi } from 'vitest'
import flatpickr from 'flatpickr'
import { createElement as h } from '../src/pragma/index.js'
import { controls } from '../src/extra/controls.js'
import { defineWidget } from '../src/extra/widget.ts'
import run from '../src/extra/run.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.ts'
import { Collection, Portal } from '../src/index.js'

const settle = (ms = 30) => new Promise(r => setTimeout(r, ms))
let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; vi.restoreAllMocks() })
const mount = (App, opts = {}) => {
  if (!document.querySelector('#root')) document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'off', ...opts })
  return app
}

// flatpickr: its own onChange also fires native 'change'/'input' events on the input, so the
// widget's event is named 'pick' (see the report: event names that the host fires natively)
const log = { mount: 0, update: [], unmount: 0 }
const DatePicker = defineWidget({
  tag: 'input',
  mount(el, props, emit) {
    log.mount++
    return flatpickr(el, { defaultDate: props.value, onChange: ([d]) => emit('pick', d) })
  },
  update(fp, props) { log.update.push(props); fp.setDate(props.value ?? null, false) },
  unmount(fp) { log.unmount++; fp.destroy() },
  events: ['pick'],
  commands: { open: (fp) => fp.open(), clear: (fp, o) => fp.clear(o.emit ?? true) },
})

const D1 = new Date(2026, 9, 5), D2 = new Date(2026, 9, 9)

function Form({ state }) {
  return h('form', null,
    h('label', null, 'Due ', h(DatePicker, { className: 'due', value: state.due })),
    h('button', { type: 'button', className: 'open' }, 'open'),
    h('button', { type: 'button', className: 'tick' }, 'tick'),
    h('p', { className: 'out' }, state.due ? state.due.toISOString().slice(0, 10) : 'none'),
    h('p', { className: 'n' }, String(state.n)))
}
Form.initialState = { due: D1, n: 0 }
Form.intent = ({ DOM }) => ({
  DUE: DOM.select('.due').events('pick').detail(),
  OPEN: DOM.click('.open'),
  TICK: DOM.click('.tick'),
})
Form.model = {
  DUE: (s, due) => ({ ...s, due }),
  OPEN: { ELEMENT: { open: '.due' } },
  TICK: (s) => ({ ...s, n: s.n + 1 }),
}

describe('tag form (canonical), run() + real DOM + flatpickr', () => {
  it('mounts flatpickr on the host input, once; the host has no snabbdom children', async () => {
    log.mount = 0; log.update = []; log.unmount = 0
    mount(Form)
    await settle()
    const el = document.querySelector('.due')
    expect(el.tagName).toBe('INPUT')
    expect(el._flatpickr).toBeTruthy()
    expect(el.__sw.i).toBe(el._flatpickr)
    expect(el._flatpickr.selectedDates[0].getTime()).toBe(D1.getTime())
    expect(log.mount).toBe(1)
    // the label wraps the host (a11y: the input is labelable)
    expect(el.closest('label')).toBeTruthy()
  })

  it('emit() → bubbling CustomEvent → DOM.select(...).events(...).detail() → state', async () => {
    mount(Form)
    await settle()
    const fp = document.querySelector('.due')._flatpickr
    fp.setDate(D2, true)
    await settle()
    expect(document.querySelector('.out').textContent).toBe('2026-10-09')
  })

  it('the instance survives re-renders; update gets the newest props, only when they change', async () => {
    log.mount = 0; log.update = []; log.unmount = 0
    mount(Form)
    await settle()
    const el = document.querySelector('.due'), fp = el._flatpickr
    document.querySelector('.tick').click(); await settle()
    document.querySelector('.tick').click(); await settle()
    expect(document.querySelector('.n').textContent).toBe('2')
    expect(log.update).toEqual([])   // same props: no update
    fp.setDate(D2, true); await settle()
    expect(document.querySelector('.due')).toBe(el)
    expect(el._flatpickr).toBe(fp)
    expect(log.mount).toBe(1)
    expect(log.update.at(-1).value.getTime()).toBe(D2.getTime())
  })

  it('ELEMENT: { open: ".due" } runs the widget command through the host (tag form)', async () => {
    mount(Form)
    await settle()
    const fp = document.querySelector('.due')._flatpickr
    expect(fp.isOpen).toBe(false)
    document.querySelector('.open').click()
    await vi.waitFor(() => expect(fp.isOpen).toBe(true), { timeout: 1000, interval: 10 })
  })

  it('unmounts when the host leaves', async () => {
    log.unmount = 0
    function Toggle({ state }) {
      return h('div', null, state.on ? h(DatePicker, { className: 'due', value: D1 }) : h('span', null, 'off'), h('button', { className: 't' }, 't'))
    }
    Toggle.initialState = { on: true }
    Toggle.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    Toggle.model = { T: (s) => ({ on: !s.on }) }
    mount(Toggle)
    await settle()
    const el = document.querySelector('.due')
    expect(typeof el.open).toBe('function')
    document.querySelector('.t').click(); await settle()
    expect(document.querySelector('.due')).toBe(null)
    expect(log.unmount).toBe(1)
    expect(el.__sw).toBe(undefined)
  })
})

// a hand-written widget with flatpickr's lifecycle, for counting and keyed moves
const Counter = defineWidget({
  tag: 'div',
  mount(el, props, emit) {
    const inst = { n: props.start, label: props.label, id: Math.random() }
    el.textContent = `${inst.label}:${inst.n}`
    el.addEventListener('click', () => { inst.n++; el.textContent = `${inst.label}:${inst.n}`; emit('count', inst.n) })
    return inst
  },
  update(inst, props) { inst.label = props.label },
  events: ['count'],
  commands: { reset: (inst, o, el) => { inst.n = o.to ?? 0; el.textContent = `${inst.label}:${inst.n}` }, focus: (inst, o) => { inst.focused = (inst.focused || 0) + 1; inst.focusOpts = o } },
})

describe('control form (alternative)', () => {
  const { Due } = controls({ Due: DatePicker })
  function C({ state }) {
    return h('div', null, h('label', null, 'Due ', h(Due, { value: state.due })), h('button', { className: 'open' }, 'o'), h('p', { className: 'out' }, state.due ? state.due.toISOString().slice(0, 10) : 'none'))
  }
  C.initialState = { due: D1 }
  C.intent = ({ DOM }) => ({ DUE: DOM.select(Due).events('pick').detail(), OPEN: DOM.click('.open') })
  C.model = { DUE: (s, due) => ({ ...s, due }), OPEN: { ELEMENT: { open: Due } } }

  it('renders the host with data-control, emits through DOM.events(Control), runs spec.commands (D102)', async () => {
    mount(C)
    await settle()
    const el = document.querySelector(`${Due}`)
    expect(el.tagName).toBe('INPUT')
    expect(Due.kind).toBe('widget')
    const fp = el._flatpickr
    fp.setDate(D2, true); await settle()
    expect(document.querySelector('.out').textContent).toBe('2026-10-09')
    document.querySelector('.open').click()
    await vi.waitFor(() => expect(fp.isOpen).toBe(true), { timeout: 1000, interval: 10 })
  })

  it('spec.commands[name](hostElement, options) resolves the instance from the host', async () => {
    const { Clicks } = controls({ Clicks: Counter })
    function K() { return h('div', null, h(Clicks, { start: 5, label: 'c' }), h('button', { className: 'r' }, 'r')) }
    K.initialState = {}
    K.intent = ({ DOM }) => ({ R: DOM.click('.r') })
    K.model = { R: { ELEMENT: { reset: Clicks, to: 2 } } }
    mount(K)
    await settle()
    const el = document.querySelector(`${Clicks}`)
    el.click(); await settle()
    expect(el.textContent).toBe('c:6')
    document.querySelector('.r').click()
    await vi.waitFor(() => expect(el.textContent).toBe('c:2'), { timeout: 1000, interval: 10 })
  })
})

describe('host identity: keyed moves, Collection isolation', () => {
  it('keyed hosts move with their instances (no remount)', async () => {
    let mounts = 0
    const Box = defineWidget({ mount(el, p) { mounts++; el.textContent = p.id; return { id: p.id } }, update() {} })
    function L({ state }) { return h('div', null, ...state.ids.map(id => h(Box, { key: id, id, className: 'box' })), h('button', { className: 'rev' }, 'r')) }
    L.initialState = { ids: ['a', 'b', 'c'] }
    L.intent = ({ DOM }) => ({ REV: DOM.click('.rev') })
    L.model = { REV: (s) => ({ ids: [...s.ids].reverse() }) }
    mount(L)
    await settle()
    const before = [...document.querySelectorAll('.box')]
    expect(before.map(e => e.__sw.i.id)).toEqual(['a', 'b', 'c'])
    document.querySelector('.rev').click(); await settle()
    const after = [...document.querySelectorAll('.box')]
    expect(after.map(e => e.__sw.i.id)).toEqual(['c', 'b', 'a'])
    expect(after).toEqual([...before].reverse())
    expect(mounts).toBe(3)
  })

  it('a widget in a Collection item is selected only in its own item', async () => {
    function Item({ state }) { return h('li', null, h(Counter, { className: 'w', start: 0, label: state.name }), h('span', { className: 'got' }, String(state.got))) }
    Item.intent = ({ DOM }) => ({ GOT: DOM.select('.w').events('count').detail() })
    Item.model = { GOT: (s, n) => ({ ...s, got: n }) }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 1, name: 'x', got: 0 }, { id: 2, name: 'y', got: 0 }] }
    mount(List)
    await settle()
    const ws = document.querySelectorAll('.w')
    ws[1].click(); ws[1].click(); await settle()
    expect([...document.querySelectorAll('.got')].map(e => e.textContent)).toEqual(['0', '2'])
  })
})

describe('commands on the tag form', () => {
  it('a command whose name is a native method is not installed on the host (the element keeps its own)', async () => {
    function F() { return h('div', null, h(Counter, { className: 'w', start: 0, label: 'q' })) }
    F.initialState = {}
    mount(F)
    await settle()
    const el = document.querySelector('.w')
    expect(typeof el.reset).toBe('function')
    expect(Object.prototype.hasOwnProperty.call(el, 'focus')).toBe(false)
    expect(Object.keys(el)).not.toContain('__sw')   // non-enumerable
  })

  it('D196: ELEMENT { focus: ".w" } runs the widget\'s declared focus, not the native one', async () => {
    function F() { return h('div', null, h(Counter, { className: 'w', start: 0, label: 'q' }), h('button', { className: 'f' }, 'f')) }
    F.initialState = {}
    F.intent = ({ DOM }) => ({ F: DOM.click('.f') })
    F.model = { F: { ELEMENT: { focus: '.w', preventScroll: true } } }
    mount(F)
    await settle()
    const el = document.querySelector('.w')
    const native = vi.spyOn(HTMLElement.prototype, 'focus')
    document.querySelector('.f').click()
    await vi.waitFor(() => expect(el.__sw.i.focused).toBe(1), { timeout: 1000, interval: 10 })
    expect(el.__sw.i.focusOpts).toEqual({ preventScroll: true })
    expect(native).not.toHaveBeenCalled()
  })

  it('a native method the widget does not declare still runs natively ({ focus } on a widget without one)', async () => {
    const Plain = defineWidget({ tag: 'button', mount: (el) => { el.textContent = 'p'; return {} } })
    function F() { return h('div', null, h(Plain, { className: 'p' }), h('button', { className: 'go' }, 'go')) }
    F.initialState = {}
    F.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    F.model = { GO: { ELEMENT: { focus: '.p' } } }
    mount(F)
    await settle()
    document.querySelector('.go').click()
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('.p')), { timeout: 1000, interval: 10 })
  })
})

describe('errors: phase "widget" (D105), the owner\'s onError fallback in its place', () => {
  const Broken = defineWidget({ mount() { throw new Error('mount broke') }, update() {} })
  const Flaky = defineWidget({ mount: () => ({}), update(_, p) { if (p.v > 1) throw new Error('update broke') } })

  it('mount throws: app onError(phase widget), the component boundary renders in its place', async () => {
    const onError = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function W() { return h('div', null, h('p', { className: 'keep' }, 'kept'), h(Broken, { className: 'b' })) }
    W.initialState = {}
    W.onError = (e) => h('em', { className: 'fallback' }, e.message)
    mount(W, { onError })
    await settle(60)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]).toMatchObject({ componentName: 'W', phase: 'widget' })
    expect(document.querySelector('.fallback').textContent).toBe('mount broke')
    expect(document.querySelector('.keep')).toBeTruthy()
    expect(document.querySelector('.b')).toBe(null)
  })

  it('update throws: the same path', async () => {
    const onError = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function W({ state }) { return h('div', null, h(Flaky, { className: 'f', v: state.v }), h('button', { className: 'inc' }, '+')) }
    W.initialState = { v: 0 }
    W.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
    W.model = { INC: (s) => ({ v: s.v + 1 }) }
    mount(W, { onError })
    await settle()
    document.querySelector('.inc').click(); await settle()
    expect(onError).not.toHaveBeenCalled()
    document.querySelector('.inc').click(); await settle(60)
    expect(onError.mock.calls[0][1]).toMatchObject({ phase: 'widget' })
    expect(document.querySelector('.f')).toBe(null)
    expect(document.querySelector('[data-sygnal-error]')).toBeTruthy()
  })
})

describe('SSR: the host (+ fallback), mounted on the client', () => {
  const Chart = defineWidget({
    tag: 'div',
    fallback: (p, h) => h('span', { className: 'loading' }, `loading ${p.series}`),
    mount(el, p) { const c = document.createElement('canvas'); el.appendChild(c); return { c, series: p.series } },
    update(i, p) { i.series = p.series },
  })
  function Page() { return h('main', null, h(Chart, { className: 'chart', series: 'sales', 'aria-label': 'Sales chart' })) }
  Page.initialState = {}

  it('renders the host element with its host props and the fallback; no widget props as attributes', () => {
    const html = renderToString(Page)
    expect(html).toBe('<main data-sygnal-ssr=""><div class="chart" aria-label="Sales chart"><span class="loading">loading sales</span></div></main>')
  })

  it('an input host renders as a void element (no fallback)', () => {
    function P() { return h('label', null, 'Due ', h(DatePicker, { className: 'due', name: 'due', value: D1 })) }
    P.initialState = {}
    expect(renderToString(P)).toBe('<label data-sygnal-ssr="">Due <input class="due" name="due"></label>')
  })

  it('the client patch replaces the fallback and mounts the widget', async () => {
    document.body.innerHTML = `<div id="root">${renderToString(Page)}</div>`
    const server = document.querySelector('.chart')
    mount(Page)
    await settle()
    const el = document.querySelector('.chart')
    expect(el.querySelector('.loading')).toBe(null)
    expect(el.querySelector('canvas')).toBeTruthy()
    expect(el.__sw.i.series).toBe('sales')
    expect(server).toBeTruthy()
  })
})

describe('renderComponent: t.widget(target)', () => {
  it('mock DOM: .props from the rendered host, .emit through simulateEvent (selector and control)', async () => {
    const t = renderComponent(Form)
    await t.ready()
    expect(t.widget('.due').props.value).toBe(D1)
    expect(t.widget('.due').instance).toBe(undefined)
    t.widget('.due').emit('pick', D2)
    await t.next(s => s.due === D2)
    expect(t.state.due).toBe(D2)
    expect(t.widget('.due').props.value).toBe(D2)
    expect(t.query('.out').textContent).toBe('2026-10-09')
    t.simulateEvent('.open', 'click')
    await t.settle()
    expect(t.commands()).toEqual([{ open: '.due' }])
    // F-c: the mock DOM knows the host's widget commands (no false SYG641)
    expect(t.diagnostics.map(d => d.code)).not.toContain('SYG641')
    expect(() => t.widget('.nope').props).toThrow(/no element matches it/)
    expect(() => t.widget('.out').props).toThrow(/no mounted widget is the matched <p>/)
    t.dispose()
  })

  it('mock DOM, control form', async () => {
    const { Due } = controls({ Due: DatePicker })
    function C({ state }) { return h('label', null, 'Due ', h(Due, { value: state.due })) }
    C.initialState = { due: D1 }
    C.intent = ({ DOM }) => ({ DUE: DOM.select(Due).events('pick').detail() })
    C.model = { DUE: (s, due) => ({ ...s, due }) }
    const t = renderComponent(C)
    await t.ready()
    expect(t.widget(Due).props.value).toBe(D1)
    t.widget(Due).emit('pick', D2)
    await t.next(s => s.due === D2)
    expect(t.widget(Due).props.value).toBe(D2)
    t.dispose()
  })

  it("dom: 'real': the widget mounts; .instance is what mount returned", async () => {
    const t = renderComponent(Form, { dom: 'real' })
    await t.ready()
    const el = t.query('.due')
    expect(el._flatpickr).toBeTruthy()
    expect(t.widget('.due').instance).toBe(el._flatpickr)
    t.widget('.due').emit('pick', D2)
    await t.next(s => s.due === D2)
    expect(t.state.due).toBe(D2)
    expect(t.widget('.due').props.value).toBe(D2)
    t.dispose()
  })
})

describe('.detail(fn?) enricher (W-3)', () => {
  it('maps e.detail, with an optional function', async () => {
    function E({ state }) { return h('div', null, h('i', { className: 'x' }, String(state.v))) }
    E.initialState = { v: 0 }
    E.intent = ({ DOM }) => ({ V: DOM.select('.x').events('pong').detail((d) => d.n * 2) })
    E.model = { V: (s, v) => ({ v }) }
    const t = renderComponent(E)
    await t.ready()
    t.simulateEvent('.x', 'pong', { detail: { n: 21 } })
    await t.next(s => s.v === 42)
    expect(t.state.v).toBe(42)
    t.dispose()
  })
})

describe('D190 guards (without the dev entry)', () => {
  it('commands named close / togglePopover define (D200: not reserved)', () => {
    expect(() => defineWidget({ mount: () => ({}), commands: { close: () => {} } })).not.toThrow()
  })

  it('the widget tag as a selector matches nothing (SYG143 in dev)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const W = defineWidget({ mount: (el, p, emit) => { el.onclick = () => emit('hit', 1); return {} }, events: ['hit'] })
    function A({ state }) { return h('div', null, h(W, { className: 'w' }), h('p', { className: 'n' }, String(state.n))) }
    A.initialState = { n: 0 }
    A.intent = ({ DOM }) => ({ HIT: DOM.select(W).events('hit') })
    A.model = { HIT: (s) => ({ n: s.n + 1 }) }
    mount(A)
    await settle()
    document.querySelector('.w').click(); await settle()
    expect(document.querySelector('.n').textContent).toBe('0')
    expect(String(W)).toBe(':not(*)')
    expect(warn).not.toHaveBeenCalled()
  })

  it('mock DOM: an undeclared command sent to a widget host is SYG142 (not SYG641), naming its commands', async () => {
    function F() { return h('label', null, 'Due ', h(DatePicker, { className: 'due' }), h('button', { className: 'go' }, 'go')) }
    F.initialState = {}
    F.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    F.model = { GO: { ELEMENT: { opne: '.due' } } }
    const t = renderComponent(F)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await t.settle()
    const d = t.diagnostics.filter(d => d.code === 'SYG142')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/did you mean 'open'\?/)
    expect(d[0].data.commands).toEqual(['open', 'clear'])
    expect(t.diagnostics.map(d => d.code)).not.toContain('SYG641')
    t.dispose()
  })

  it('mock DOM: a native method of the host (focus on an input host) is no finding', async () => {
    function F() { return h('label', null, 'Due ', h(DatePicker, { className: 'due' }), h('button', { className: 'go' }, 'go')) }
    F.initialState = {}
    F.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    F.model = { GO: { ELEMENT: [{ focus: '.due' }, { showPicker: '.due' }] } }
    const t = renderComponent(F)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await t.settle()
    expect(t.diagnostics.map(d => d.code)).toEqual([])
    t.dispose()
  })

  it('real DOM: an undeclared command is SYG142 through the element command check', async () => {
    function F() { return h('div', null, h(Counter, { className: 'w', start: 0, label: 'q' }), h('button', { className: 'go' }, 'go')) }
    F.initialState = {}
    F.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    F.model = { GO: { ELEMENT: { rset: '.w' } } }
    const t = renderComponent(F, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.go', 'click')
    await vi.waitFor(() => expect(t.diagnostics.map(d => d.code)).toContain('SYG142'), { timeout: 1500, interval: 20 })
    expect(t.diagnostics.find(d => d.code === 'SYG142').message).toMatch(/did you mean 'reset'/)
    t.dispose()
  })
})

describe('props, hosts and lifecycle', () => {
  it('host props go on the element; every prop but key/ref reaches the widget (ref is the host, G-368); hostProps adds names', async () => {
    let got
    const W = defineWidget({ tag: 'section', hostProps: ['lang2'], mount: (el, p) => { got = p; return {} } })
    const ref = { current: null }
    function A() { return h('div', null, h(W, { key: 'k', ref, id: 'w1', className: 'w', 'aria-label': 'Chart', 'data-kind': 'bar', title: 'T', series: [1, 2], lang2: 'x' })) }
    A.initialState = {}
    mount(A)
    await settle()
    const el = document.querySelector('#w1')
    expect(el.tagName).toBe('SECTION')
    expect(el.className).toBe('w')
    expect(el.getAttribute('aria-label')).toBe('Chart')
    expect(el.dataset.kind).toBe('bar')
    expect(el.title).toBe('T')
    expect(el.series).toBe(undefined)
    expect(el.lang2).toBe('x')
    expect(ref.current).toBe(el)
    expect(Object.keys(got).sort()).toEqual(['aria-label', 'className', 'data-kind', 'id', 'lang2', 'series', 'title'])
    expect(got.series).toEqual([1, 2])
  })

  it('without update, a props change remounts (unmount, then mount with the new props)', async () => {
    const log = []
    const W = defineWidget({ mount: (el, p) => { log.push(`mount ${p.v}`); return {} }, unmount: () => log.push('unmount') })
    function A({ state }) { return h('div', null, h(W, { className: 'w', v: state.v }), h('button', { className: 'inc' }, '+'), h('button', { className: 'tick' }, 't')) }
    A.initialState = { v: 1, n: 0 }
    A.intent = ({ DOM }) => ({ INC: DOM.click('.inc'), TICK: DOM.click('.tick') })
    A.model = { INC: (s) => ({ ...s, v: s.v + 1 }), TICK: (s) => ({ ...s, n: s.n + 1 }) }
    mount(A)
    await settle()
    document.querySelector('.tick').click(); await settle()
    document.querySelector('.inc').click(); await settle()
    expect(log).toEqual(['mount 1', 'unmount', 'mount 2'])
  })

  it('another widget with the same host tag in the same place (unkeyed): the first unmounts, the second mounts on a new element', async () => {
    const log = []
    const A1 = defineWidget({ mount: (el) => { log.push('mount a'); return { name: 'a' } }, update: () => log.push('update a'), unmount: () => log.push('unmount a'), commands: { ping: (i) => log.push(`ping ${i.name}`) } })
    const B1 = defineWidget({ mount: (el) => { log.push('mount b'); return { name: 'b' } }, update: () => log.push('update b'), unmount: () => log.push('unmount b'), commands: { ping: (i) => log.push(`ping ${i.name}`) } })
    function S({ state }) { return h('div', null, state.b ? h(B1, { className: 'w', v: 1 }) : h(A1, { className: 'w', v: 1 }), h('button', { className: 't' }, 't')) }
    S.initialState = { b: false }
    S.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    S.model = { T: (s) => ({ b: !s.b }) }
    mount(S)
    await settle()
    const el = document.querySelector('.w')
    document.querySelector('.t').click(); await settle()
    // 1-R (G-360): the host's key names its widget, so the element is replaced, not patched
    const el2 = document.querySelector('.w')
    expect(el2).not.toBe(el)
    expect(log).toEqual(['mount a', 'unmount a', 'mount b'])
    expect(el2.__sw.i.name).toBe('b')
    el2.ping()
    expect(log.at(-1)).toBe('ping b')
  })

  it('emit dispatches a bubbling CustomEvent on the host (a parent element hears it)', async () => {
    let emit
    const W = defineWidget({ mount: (el, p, e) => { emit = e; return {} }, events: ['ping'] })
    function A({ state }) { return h('div', { className: 'outer' }, h(W, { className: 'w' }), h('p', { className: 'n' }, String(state.got))) }
    A.initialState = { got: null }
    A.intent = ({ DOM }) => ({ P: DOM.select('.outer').events('ping').detail() })
    A.model = { P: (s, got) => ({ got }) }
    mount(A)
    await settle()
    const seen = []
    document.querySelector('.w').addEventListener('ping', e => seen.push([e.constructor.name, e.bubbles, e.detail]))
    emit('ping', 7)
    await settle()
    expect(seen).toEqual([['CustomEvent', true, 7]])
    expect(document.querySelector('.n').textContent).toBe('7')
  })

  it('without an onError, a failing widget renders the error <div> in its place', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = defineWidget({ mount() { throw new Error('nope') } })
    function W() { return h('div', null, h(Broken, { className: 'b' }), h('i', { className: 'keep' }, 'k')) }
    W.initialState = {}
    mount(W)
    await settle(60)
    expect(document.querySelector('[data-sygnal-error="W"]')).toBeTruthy()
    expect(document.querySelector('.keep')).toBeTruthy()
    expect(console.error.mock.calls.some(c => c[0] === '[Sygnal SYG660]' && c[1].message === 'nope')).toBe(true)
  })

  it('unmount throwing is reported to onError (phase widget); the host still leaves', async () => {
    const onError = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const W = defineWidget({ mount: () => ({}), unmount() { throw new Error('unmount broke') } })
    function A({ state }) { return h('div', null, state.on ? h(W, { className: 'w' }) : null, h('button', { className: 't' }, 't')) }
    A.initialState = { on: true }
    A.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    A.model = { T: (s) => ({ on: !s.on }) }
    mount(A, { onError })
    await settle()
    document.querySelector('.t').click(); await settle()
    expect(document.querySelector('.w')).toBe(null)
    expect(onError.mock.calls[0][0].message).toBe('unmount broke')
    expect(onError.mock.calls[0][1]).toMatchObject({ phase: 'widget', componentName: 'A' })
    expect(document.querySelector('[data-sygnal-error]')).toBe(null)
  })

  it('a widget inside <Portal> mounts in the target and its events reach the intent', async () => {
    document.body.innerHTML = '<div id="root"></div><div id="layer"></div>'
    let emit
    const W = defineWidget({ mount: (el, p, e) => { emit = e; el.textContent = p.label; return { label: p.label } }, update: (i, p) => { i.label = p.label }, events: ['ping'] })
    function A({ state }) {
      return h('div', null,
        h(Portal, { target: '#layer' }, h('div', { className: 'box' }, h(W, { className: 'pw', label: state.label }))),
        h('button', { className: 'b' }, 'b'),
        h('p', { className: 'n' }, String(state.got)))
    }
    A.initialState = { label: 'one', got: 0 }
    // portal content is outside the component's scope: document delegation, as for any portal content
    A.intent = ({ DOM }) => ({ B: DOM.click('.b'), P: DOM.select('document').select('.pw').events('ping').detail() })
    A.model = { B: (s) => ({ ...s, label: 'two' }), P: (s, got) => ({ ...s, got }) }
    mount(A)
    await settle(60)
    const el = document.querySelector('#layer .pw')
    expect(el).toBeTruthy()
    expect(el.__sw.i.label).toBe('one')
    document.querySelector('.b').click(); await settle(60)
    expect(document.querySelector('#layer .pw')).toBe(el)
    expect(el.__sw.i.label).toBe('two')
    emit('ping', 5); await settle(60)
    expect(document.querySelector('.n').textContent).toBe('5')
  })
})
