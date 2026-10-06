// PLAN-4.5 P45-B item 1 (audit rec 6, D146 / P45-Q3): the pragma passes nested prop objects
// (style, attrs, props, on, hook, class, dataset and a component's object props) by reference
// instead of deep-copying them, as React, Vue and snabbdom do. It never writes into them: a
// bucket that gets more entries (attrs={...} plus aria-label) is a copy. An object with an
// undefined entry is copied without it, as before (the DOM modules would write "undefined").
// And the `extend` dependency is gone.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement as h } from '../src/pragma/index.js'

describe('P45-B: nested prop objects by reference', () => {
  it('style, attrs, props, on, hook, class and data objects are the objects passed', () => {
    const style = { color: 'red' }, attrs = { title: 't' }, props = { value: 'v' }, on = { click: () => {} }
    const hook = { insert: () => {} }, klass = { a: true }, data = { id: '1' }
    const v = h('div', { style, attrs, props, on, hook, class: klass, data })
    expect(v.data.style).toBe(style)
    expect(v.data.attrs).toBe(attrs)
    expect(v.data.props).toBe(props)
    expect(v.data.on).toBe(on)
    expect(v.data.hook).toBe(hook)
    expect(v.data.class).toBe(klass)
    expect(v.data.dataset).toBe(data)
  })

  it('a component prop object and the component statics are passed by reference', () => {
    function Child() { return h('div', null) }
    Child.initialState = { n: 1 }
    Child.model = { INC: s => s }
    const cfg = { deep: { x: 1 } }, items = [1, 2]
    const v = h(Child, { cfg, items })
    expect(v.data.props.cfg).toBe(cfg)
    expect(v.data.props.items).toBe(items)
    // R5: the statics travel on the component function itself (data.c), not copied into options
    expect(v.data.c).toBe(Child)
    expect(v.data.c.initialState).toBe(Child.initialState)
    expect(v.data.c.model).toBe(Child.model)
  })

  it('a bucket that gets more entries is a copy; the objects passed are not written to', () => {
    const attrs = { title: 't' }, props = { value: 'v' }, on = { click: () => {} }, data = { a: '1' }
    const v = h('label', { attrs, 'aria-label': 'L', role: 'x', props, checked: true, on, 'on-input': () => {}, data, 'data-b': '2' })
    expect(v.data.attrs).toEqual({ title: 't', 'aria-label': 'L', role: 'x' })
    expect(v.data.props).toEqual({ value: 'v', checked: true })
    expect(Object.keys(v.data.on)).toEqual(['click', 'input'])
    expect(v.data.dataset).toEqual({ a: '1', b: '2' })
    expect(attrs).toEqual({ title: 't' })
    expect(props).toEqual({ value: 'v' })
    expect(Object.keys(on)).toEqual(['click'])
    expect(data).toEqual({ a: '1' })
  })

  it('ref and autoFocus chain onto a copy of the hook object passed', () => {
    const insert = () => {}
    const hook = { insert }
    const v = h('input', { hook, ref: () => {}, autoFocus: true })
    expect(hook).toEqual({ insert })
    expect(v.data.hook).not.toBe(hook)
    // (u: the passed hook's own insert, without a postpatch; 3-M G-485)
    expect(Object.keys(v.data.hook).sort()).toEqual(['destroy', 'insert', 'postpatch', 'u'])
  })

  it('an undefined entry is dropped (a copy), the object passed is left alone', () => {
    const style = { color: undefined, margin: 0 }
    const v = h('div', { style })
    expect(v.data.style).toEqual({ margin: 0 })
    expect('color' in v.data.style).toBe(false)
    expect('color' in style).toBe(true)
  })

  it('SVG: the attributes are a merge of the props and attrs, the attrs passed are not written to', () => {
    const attrs = { width: 20 }
    const v = h('svg', { viewBox: '0 0 1 1', className: 'i', attrs })
    expect(v.data.attrs).toEqual({ viewBox: '0 0 1 1', class: 'i', width: 20 })
    expect(attrs).toEqual({ width: 20 })
    expect(v.data.props).toBeUndefined()
  })
})

describe('P45-B: no extend dependency', () => {
  it('package.json has no extend dependency and src does not import it', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(Object.keys(pkg.dependencies)).toEqual(['@tanstack/virtual-core', 'snabbdom', 'xstream'])  // D209
    expect(readFileSync(new URL('../src/pragma/index.ts', import.meta.url), 'utf8')).not.toMatch(/extend/)
    expect(readFileSync(new URL('../rollup.config.mjs', import.meta.url), 'utf8')).not.toMatch(/'extend'/)
  })
})
