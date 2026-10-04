// PLAN-4.5 P45-B item 1: the pragma rewrite (one pass over the props, no extend) must produce
// the same vnodes as the pragma it replaced. The fixture was written by the old pragma (base
// 9d5dfcd) with P45B_WRITE=1; each vnode is serialized structurally: functions by their tag (a
// user function) or as "fn" (a wrapper the pragma made), undefined as "<undef>" in a vnode's
// fields, its data, the data's buckets and children arrays (deeper, an undefined key counts as
// absent, as toEqual does: the old deep copy dropped them, by-reference objects keep them).
// Object identity is not compared: nested prop objects by reference is the intended change (D146).
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createElement as h, createElementWithModules } from '../src/pragma/index.js'
import { jsx } from '../src/jsx-runtime.js'
import { Fragment } from '../src/cycle/dom/snabbdom.js'
import { h as sh } from '../src/cycle/dom/snabbdom.js'
import { Collection } from '../src/collection.js'
import { Switchable } from '../src/switchable.js'
import { Portal } from '../src/portal.js'
import { Transition } from '../src/transition.js'
import { Suspense } from '../src/suspense.js'
import { Slot } from '../src/slot.js'
import { ClientOnly } from '../src/vike/ClientOnly.js'
import { controls } from '../src/extra/controls.js'
import component from '../src/component.js'

const FIXTURE = new URL('./fixtures/p45-b1-pragma-corpus.json', import.meta.url)

const tag = (name, f) => (f.__tag = name, f)
const U = '<undef>'
const BUCKETS = new Set(['attrs', 'props', 'class', 'style', 'dataset', 'on', 'hook'])

function loose(x, seen = new Set()) {
  if (typeof x === 'function') return x.__tag ? `fn:${x.__tag}` : 'fn'
  if (!x || typeof x !== 'object') return x === undefined ? U : x
  if (seen.has(x)) return '<cycle>'
  seen.add(x)
  let out
  if (Array.isArray(x)) {
    out = []
    for (let i = 0; i < x.length; i++) out.push(i in x ? loose(x[i], seen) : '<hole>')
  } else if (isVnode(x)) out = vnode(x, seen)
  else {
    out = {}
    for (const k of Object.keys(x).sort()) if (x[k] !== undefined) out[k] = loose(x[k], seen)
  }
  seen.delete(x)
  return out
}
const isVnode = (x) => x && typeof x === 'object' && 'sel' in x && 'children' in x && 'text' in x
function strictObj(o, seen, inner) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return loose(o, seen)
  const out = {}
  for (const k of Object.keys(o).sort()) out[k] = o[k] === undefined ? U : inner(k, o[k])
  return out
}
function vnode(v, seen = new Set()) {
  if (!v || typeof v !== 'object') return v === undefined ? U : v
  const out = {}
  for (const k of Object.keys(v).sort()) {
    const val = v[k]
    if (k === 'data') out.data = strictObj(val, seen, (b, bv) => BUCKETS.has(b) ? strictObj(bv, seen, (_, x) => loose(x, seen)) : loose(bv, seen))
    else if (k === 'children') out.children = Array.isArray(val) ? val.map(c => vnode(c, seen)) : (val === undefined ? U : loose(val, seen))
    else out[k] = val === undefined ? U : loose(val, seen)
  }
  return out
}

// ── the corpus ─────────────────────────────────────────────────────────────
const click = tag('click', () => {})
const input = tag('input', () => {})
const ins = tag('insertHook', () => {})
const refFn = tag('refFn', () => {})

function Child({ state }) { return h('div', null, 'child') }
Child.initialState = { n: 1, list: [1, 2], nested: { a: { b: 1 } } }
Child.model = tag('model', { INC: tag('INC', s => s) })
Child.intent = tag('intent', () => ({}))
Child.context = { x: tag('ctx', s => s) }
Child.calculated = { d: tag('calc', s => 1) }
function Item() { return h('li', null, 'i') }
const Factory = component({ name: 'Fact', view: tag('factView', () => h('i', null)) })
const lazyLike = tag('LazyView', function LazyView() {})
lazyLike.__sygnalLazy = true
lazyLike.__sygnalLazyLoaded = () => false
lazyLike.__sygnalLazyLoadedComponent = null
const { Draft, Box } = controls({ Draft: 'input', Box: { kind: 'box', vnode: (p, c, hh) => hh('section', p, ...c) } })
const hNoProps = createElementWithModules({ attrs: '', class: '', style: '', on: '', hook: '' })
const hDash = createElementWithModules({ attrs: '', props: '', data: 'dataset' })

const corpus = {
  'text child': () => h('div', null, 'hello'),
  'number child 0': () => h('span', null, 0),
  'number child 5': () => h('span', {}, 5),
  'no children': () => h('div', null),
  'empty props, no children': () => h('div', {}),
  'two text children': () => h('p', null, 'a', 'b'),
  'mixed children': () => h('p', null, 'a', h('b', null, 'x'), 3),
  'nested arrays': () => h('ul', null, [h('li', null, '1'), [h('li', null, '2'), [h('li', null, '3')]]], 'tail'),
  'single nested array of text': () => h('div', null, ['only']),
  'null/bool/undefined children': () => h('div', null, null, false, true, undefined, 'x', 0, ''),
  'only null child': () => h('div', null, null),
  'object non-vnode child': () => h('div', null, { text: 'x' }, { foo: 1 }),
  'key and id': () => h('li', { key: 'k1', id: 'i1' }, 'x'),
  'numeric key': () => h('li', { key: 3 }),
  'className': () => h('div', { className: 'a b' }),
  'className undefined': () => h('div', { className: undefined }),
  'className null': () => h('div', { className: null }),
  'class string': () => h('div', { class: 'a  b c' }),
  'class array': () => h('div', { class: ['a', false && 'b', null, 'c', ['d', { e: true, f: false }]] }),
  'class object': () => h('div', { class: { on: true, off: false, und: undefined } }),
  'class empty string': () => h('div', { class: '' }),
  'class-* keys': () => h('div', { 'class-active': true, 'class-hidden': false }),
  'style object': () => h('div', { style: { color: 'red', fontSize: '12px', '--v': 1, gone: undefined } }),
  'style delayed/remove': () => h('div', { style: { opacity: '0', delayed: { opacity: '1' }, remove: { opacity: '0' } } }),
  'style string': () => h('div', { style: 'color: red' }),
  'style-* keys': () => h('div', { 'style-color': 'blue', style: { margin: 0 } }),
  'attrs object': () => h('a', { attrs: { href: '/x', title: 't', gone: undefined } }),
  'attrs + aria + role + for + tabindex': () => h('label', { attrs: { a: 1 }, 'aria-label': 'L', 'aria-hidden': true, role: 'button', for: 'x', tabindex: 0 }),
  'attrs-* keys': () => h('a', { 'attrs-href': '/y', 'attrs-target': '_blank' }),
  'props object + loose props': () => h('input', { props: { value: 'v', x: { deep: 1 } }, checked: true, type: 'text' }),
  'props-* keys': () => h('div', { 'props-foo': 1 }),
  'loose props': () => h('a', { href: '/z', title: 't', tabIndex: 2, hidden: false, value: 0, obj: { a: [1, { b: 2 }] }, arr: [1, 2] }),
  'undefined loose props': () => h('input', { value: undefined, disabled: undefined, name: 'n' }),
  'null loose props': () => h('input', { value: null, checked: null }),
  'on object': () => h('button', { on: { click, input } }),
  'on-* keys': () => h('button', { 'on-click': click, on: { input } }),
  'on with array handler': () => h('button', { on: { click: [click, 1] } }),
  'hook object': () => h('div', { hook: { insert: ins } }),
  'hook-* keys': () => h('div', { 'hook-insert': ins }),
  'data object': () => h('div', { data: { id: '1', fooBar: 'x' } }),
  'data-* keys': () => h('div', { 'data-id': '7', 'data-task-id': 't', 'data-a-b-c': 1, 'data-x': undefined }),
  'data object + data-*': () => h('div', { data: { a: '1' }, 'data-b': '2' }),
  'dataset key (not a module)': () => h('div', { dataset: { a: 1 } }),
  'hyphenated non-module keys': () => h('div', { 'x-foo': 1, 'aria-x-y': 2, '-lead': 3 }),
  'ref function': () => h('div', { ref: refFn }),
  'ref object': () => h('div', { ref: { current: null } }),
  'ref with existing hook': () => h('div', { ref: refFn, hook: { insert: ins, destroy: ins } }),
  'ref null': () => h('div', { ref: null }),
  'autoFocus': () => h('input', { autoFocus: true, value: 'x' }),
  'autoSelect': () => h('input', { autoSelect: true }),
  'autoFocus false': () => h('input', { autoFocus: false }),
  'autoFocus + ref + hook': () => h('input', { autoFocus: true, ref: refFn, hook: { insert: ins } }),
  'textarea / select / option': () => h('select', { value: 'b' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b', selected: true }, 'B')),
  'textarea': () => h('textarea', { value: 'text', rows: 3 }),
  'selector sel': () => h('div#main.a.b', { className: 'c' }, 'x'),
  'svg': () => h('svg', { viewBox: '0 0 10 10', className: 'icon', width: 10, 'stroke-width': 2, attrs: { width: 20 } },
    h('path', { d: 'M0 0', fill: 'none', className: 'p' }),
    h('g', { transform: 't' }, h('title', null, 'T'), h('a', { href: '#x' }, h('text', null, 'label')), h('image', { href: 'i.png' })),
    h('foreignObject', { width: 5 }, h('div', { className: 'html' }, h('span', { title: 'keep' }, 'x')))),
  'svg with style/on/class/hook': () => h('svg', { style: { color: 'red' }, on: { click }, class: { a: true }, hook: { insert: ins }, key: 's' }, h('circle', { r: 1, cx: undefined })),
  'svg with selector sel (not in map)': () => h('svg.icon', { viewBox: '0 0 1 1' }, h('rect', { x: 1 })),
  'svg undefined className': () => h('svg', { className: undefined, fill: 'x' }),
  'svg text child': () => h('svg', null, h('text', { x: 1 }, 'hi')),
  'svg with h() children': () => h('svg', null, sh('rect', { props: { x: 1 }, attrs: { y: 2 } }), sh('g', {}, [sh('line', { props: { x1: 0 } })])),
  'html child with svg leaf': () => h('div', null, h('rect', { x: 1 })),
  'fragment root': () => h(Fragment, null, h('a', null), 'txt', [h('b', null)]),
  'fragment single text': () => h(Fragment, null, 'only'),
  'fragment in parent': () => h('div', null, h(Fragment, null, h('i', null), h('b', null))),
  'component': () => h(Child, { name: 'n', items: [1, { a: 2 }], cfg: { deep: { x: 1 } }, on: { click } }),
  'component with key/id/state': () => h(Child, { key: 'c1', id: 'cid', state: 'slice' }),
  'component with children': () => h(Child, null, h('p', null, 'kid'), 'text', null),
  'component with text child only': () => h(Child, null, 'just text'),
  'component no props': () => h(Child),
  'component className/class/style/attrs': () => h(Child, { className: 'x', class: ['a', 'b'], style: { c: 1 }, attrs: { t: 1 }, 'data-x': '1' }),
  'sygnal factory': () => h(Factory, { p: 1 }),
  'collection': () => h(Collection, { of: Item, from: 'items', className: 'list', filter: tag('filt', () => true), sort: 'name' }),
  'switchable': () => h(Switchable, { of: { a: Child, b: Item }, current: 'a', state: 'x' }),
  'portal': () => h(Portal, { target: '#modal' }, h('div', { className: 'dialog' }, 'hi')),
  'transition': () => h(Transition, { name: 'fade', duration: 200 }, h('div', { key: 't' }, 'x')),
  'suspense': () => h(Suspense, { fallback: h('div', null, 'loading') }, h(Child, null)),
  'suspense string fallback': () => h(Suspense, { fallback: 'wait' }, h('p', null, 'x')),
  'clientonly': () => h(ClientOnly, { fallback: 'ssr' }, h('div', null, 'client')),
  'slot': () => h(Slot, { name: 'header' }, h('h1', null, 'H')),
  'lazy marker': () => h(lazyLike, { a: 1 }),
  'control element': () => h(Draft, { value: 'v', className: 'draft', key: 'd' }),
  'control spec': () => h(Box, { className: 'b', attrs: { x: 1 } }, h('p', null, 'in')),
  'control no props': () => h(Draft, null),
  'createElementWithModules without props': () => hNoProps('div', { id: 'x', className: 'c', 'aria-label': 'l', for: 'f', key: 'k', attrs: { a: 1 }, 'data-x': '1', 'on-click': click }),
  'createElementWithModules with data module': () => hDash('div', { id: 'x', 'data-a-b': 1, 'style-color': 'red', 'on-click': click }),
  'jsx runtime: children array + key': () => jsx('ul', { className: 'l', children: [jsx('li', { children: 'a' }, 'k1'), jsx('li', { children: 'b' }, 'k2')] }, 'root'),
  'jsx runtime: single child': () => jsx('p', { children: 'x' }),
  'jsx runtime: no props': () => jsx('br', null),
  'jsx runtime: component': () => jsx(Child, { a: 1, children: jsx('b', { children: 1 }) }, 'ck'),
  'jsx runtime: svg': () => jsx('svg', { viewBox: '0 0 1 1', children: jsx('path', { d: 'M', className: 'p' }) }),
  'deep tree': () => h('div', { className: 'app' },
    h('header', null, h('h1', { className: 'title' }, 'T'), h('nav', null, [1, 2, 3].map(i => h('a', { key: i, href: `#${i}`, class: { active: i === 2 } }, `L${i}`)))),
    h('main', null, h('input', { className: 'draft', value: 'x', on: { input } }), h(Child, { n: 1 }), h('ul', null, ['a', 'b'].map(t => h('li', { key: t, 'data-id': t }, t))))),
}

// undefined tag: SYG420 is printed; silence it
function build(name) {
  return corpus[name]()
}

describe('P45-B item 1: pragma output characterization', () => {
  it('the undefined tag renders <UNDEFINED>', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const v = h(undefined, { className: 'x' }, 'y')
    err.mockRestore()
    expect(vnode(v)).toEqual({ children: U, data: { props: { className: 'x' } }, elm: U, key: U, sel: 'UNDEFINED', text: 'y' })
  })

  const results = {}
  for (const name of Object.keys(corpus)) results[name] = vnode(build(name))

  if (process.env.P45B_WRITE) {
    writeFileSync(FIXTURE, JSON.stringify(results, null, 1) + '\n')
    it.skip('fixture written', () => {})
    return
  }
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'))

  it('covers the same corpus as the fixture', () => {
    expect(Object.keys(results).sort()).toEqual(Object.keys(fixture).sort())
  })
  for (const name of Object.keys(corpus)) {
    it(name, () => {
      expect(results[name]).toEqual(fixture[name])
    })
  }
})
