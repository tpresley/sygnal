// P45-R G-265: P45-B's pragma makes the vnodes of plain subtrees with its own constructor (the
// `$p` flag is on its prototype), so Copy as test refused an action carrying JSX (e.g.
// event('TOAST', <b>Saved</b>)) as "a Plain" class instance. A pragma vnode is written as the
// object literal it is.
import { describe, it, expect } from 'vitest'
import { literal } from '../src/extra/copyAsTest.ts'
import { createElement as h } from '../src/pragma/index.js'

describe('P45-R G-265: Copy as test and pragma vnodes', () => {
  it('a JSX value in action data is written as an object literal', () => {
    const v = h('b', null, 'Saved')
    expect(Object.getPrototypeOf(v)).not.toBe(Object.prototype) // the pragma's own constructor
    const out = literal({ msg: v }, 'data')
    expect(out.code).toBe("{ msg: { sel: 'b', data: {}, text: 'Saved' } }")
  })

  it('a nested JSX tree too, and other class instances are still refused', () => {
    const out = literal(h('p', null, h('i', null, 'a'), 'b'), 'data')
    expect(out.code).toContain("sel: 'p'")
    expect(out.code).toContain("sel: 'i'")
    class Thing {}
    expect(() => literal({ t: new Thing() }, 'data')).toThrow(/Thing/)
  })
})
