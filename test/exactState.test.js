import { describe, it, expect } from 'vitest'
import exactState from '../src/extra/exactState.js'

describe('extra/exactState', () => {
  it('returns a function', () => {
    const result = exactState()
    expect(typeof result).toBe('function')
  })

  it('returned function returns its input unchanged (identity)', () => {
    const identity = exactState()
    const state = { count: 5, name: 'test' }
    expect(identity(state)).toBe(state)
  })

  it('preserves object identity (same reference)', () => {
    const identity = exactState()
    const obj = { a: 1, b: [2, 3], c: { nested: true } }
    const result = identity(obj)
    expect(result).toBe(obj)
    expect(result.b).toBe(obj.b)
    expect(result.c).toBe(obj.c)
  })

  it('works with primitive values', () => {
    const identity = exactState()
    expect(identity(42)).toBe(42)
    expect(identity('hello')).toBe('hello')
    expect(identity(null)).toBeNull()
    expect(identity(undefined)).toBeUndefined()
    expect(identity(true)).toBe(true)
  })

  it('works with arrays', () => {
    const identity = exactState()
    const arr = [1, 2, 3]
    expect(identity(arr)).toBe(arr)
  })

  it('each call to exactState returns a new function', () => {
    const fn1 = exactState()
    const fn2 = exactState()
    expect(fn1).not.toBe(fn2)
  })
})
