// Regression tests for PLAN-1 workstream 1G (rendering/state bug fixes).
import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { pickCombine } from '../src/cycle/state/pickCombine.js'
import { createElement as h } from '../src/pragma/index.js'

// ─── B-010: pickCombine re-emits on a pure reorder ───────────────────────────

describe('B-010: pickCombine follows a permutation of the instances', () => {
  const item = (key) => ({ _key: key, DOM: xs.of(key).remember() })
  const inst = (items) => ({ dict: new Map(items.map(i => [i._key, i])), arr: items })

  it('emits the new order for swap, reverse and move without any item emission', () => {
    const a = item('a'), b = item('b'), c = item('c')
    const inst$ = xs.create()
    const out = []
    inst$.compose(pickCombine('DOM')).addListener({ next: v => out.push(v.join('')) })
    inst$.shamefullySendNext(inst([a, b, c]))
    inst$.shamefullySendNext(inst([b, a, c]))   // swap
    inst$.shamefullySendNext(inst([c, a, b]))   // reverse
    inst$.shamefullySendNext(inst([a, b, c]))   // move c to the end
    expect(out[out.length - 1]).toBe('abc')
    expect(out).toContain('bac')
    expect(out).toContain('cab')
  })

  it('does not re-emit when the order is unchanged', () => {
    const a = item('a'), b = item('b')
    const inst$ = xs.create()
    const out = []
    inst$.compose(pickCombine('DOM')).addListener({ next: v => out.push(v.join('')) })
    inst$.shamefullySendNext(inst([a, b]))
    const n = out.length
    inst$.shamefullySendNext(inst([a, b]))
    expect(out.length).toBe(n)
  })

  it('reorders the survivors after a removal in the same update', () => {
    const a = item('a'), b = item('b'), c = item('c')
    const inst$ = xs.create()
    const out = []
    inst$.compose(pickCombine('DOM')).addListener({ next: v => out.push(v.join('')) })
    inst$.shamefullySendNext(inst([a, b, c]))
    inst$.shamefullySendNext(inst([c, a]))
    expect(out[out.length - 1]).toBe('ca')
  })
})

// ─── B-011: JSX vnodes are always snabbdom-valid ─────────────────────────────

describe('B-011: an element with a single text child', () => {
  it('has text and no children (like snabbdom h)', () => {
    const v = h('p', null, 'Select a task.')
    expect(v.text).toBe('Select a task.')
    expect(v.children).toBeUndefined()
  })

  it('with several children has a children array and no text', () => {
    const v = h('p', null, 'Status: ', 'Open')
    expect(v.text).toBeUndefined()
    expect(Array.isArray(v.children)).toBe(true)
    expect(v.children.map(c => c.text)).toEqual(['Status: ', 'Open'])
  })

  it('passed to a component keeps the text as a children array', () => {
    function Box({ children }) { return h('div', null, children) }
    const v = h(Box, null, 'hello')
    expect(Array.isArray(v.children)).toBe(true)
    expect(v.children[0].text).toBe('hello')
  })

  it('inside a preventInstantiation component (Suspense/Portal/...) is a children array', () => {
    function Marker() {}
    Marker.preventInstantiation = true
    const v = h(Marker, null, 'hi')
    expect(Array.isArray(v.children)).toBe(true)
    expect(v.children[0].text).toBe('hi')
  })
})
