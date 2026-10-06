// PLAN-5 3-W G-536: undo() and a missing state key. A string key that was missing (undefined)
// is missing again on UNDO (no own `undefined` property, as with an array key, G-531); with an
// array key, a key that appears or goes (even as `undefined`) is a change; primitive state
// doesn't throw. The model's reducers are called directly.
import { describe, it, expect } from 'vitest'
import { undoable } from '../src/index.js'

describe('3-W G-536: a missing key', () => {
  it("string key: UNDO to a step where the key was missing removes it (no own undefined)", () => {
    const m = undoable({ A: (s) => ({ ...s, b: 1 }) }, { key: 'b' })
    const s1 = m.A({ a: 0 })
    expect(s1.history.past).toEqual([undefined])
    const s2 = m.UNDO(s1)
    expect('b' in s2).toBe(false)
    expect(s2.a).toBe(0)
    expect(m.REDO(s2).b).toBe(1)
  })

  it('string key: missing and own undefined are the same value (documented: no step)', () => {
    const m = undoable({ A: (s) => ({ ...s, b: undefined }) }, { key: 'b' })
    expect(m.A({ a: 0 }).history).toBe(undefined)
  })

  it('array key: a key that appears as undefined is a change (recorded), and UNDO removes it', () => {
    const m = undoable({ A: (s) => ({ ...s, b: undefined }) }, { key: ['a', 'b'] })
    const s1 = m.A({ a: 0 })
    expect(s1.history.past).toEqual([{ a: 0 }])
    const s2 = m.UNDO(s1)
    expect(Object.keys(s2)).not.toContain('b')
    expect(Object.keys(m.REDO(s2))).toContain('b')
  })

  it('array key: an own undefined that goes is a change too', () => {
    const m = undoable({ A: ({ b, ...s }) => s }, { key: ['a', 'b'] })
    const s1 = m.A({ a: 0, b: undefined })
    expect(s1.history.past.length).toBe(1)
    expect(Object.keys(m.UNDO(s1))).toContain('b')
  })

  it('array key: primitive state (before the first object) does not throw', () => {
    const m = undoable({ SET: (_s, d) => d }, { key: ['a'] })
    let s
    expect(() => { s = m.SET(5, { a: 1 }) }).not.toThrow()
    expect(s.history.past).toEqual([{}])
    expect(m.SET('x', 'y')).toBe('y')
    expect(m.UNDO(7)).toBeDefined()
  })
})
