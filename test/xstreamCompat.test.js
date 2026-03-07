import { describe, it, expect } from 'vitest'
import xs, { Stream, resolveInteropDefault } from '../src/extra/xstreamCompat.js'

describe('extra/xstreamCompat', () => {
  describe('resolveInteropDefault', () => {
    it('returns double-nested default when present and is a function', () => {
      const fn = () => {}
      const input = { default: { default: fn } }
      expect(resolveInteropDefault(input)).toBe(fn)
    })

    it('returns single default when present (and no double nesting)', () => {
      const inner = { create: () => {} }
      const input = { default: inner }
      expect(resolveInteropDefault(input)).toBe(inner)
    })

    it('returns value as-is when no default property', () => {
      const input = { create: () => {}, of: () => {} }
      expect(resolveInteropDefault(input)).toBe(input)
    })

    it('returns value as-is for plain functions', () => {
      const fn = () => {}
      expect(resolveInteropDefault(fn)).toBe(fn)
    })

    it('returns value as-is for null', () => {
      expect(resolveInteropDefault(null)).toBeNull()
    })

    it('returns value as-is for undefined', () => {
      expect(resolveInteropDefault(undefined)).toBeUndefined()
    })

    it('returns single default when double default is not a function', () => {
      const input = { default: { default: 'not a function', other: 1 } }
      // default.default is not a function, so it returns default (which is { default: 'not a function', other: 1 })
      expect(resolveInteropDefault(input)).toEqual({ default: 'not a function', other: 1 })
    })
  })

  describe('xs (default export)', () => {
    it('exports xs with create method', () => {
      expect(typeof xs.create).toBe('function')
    })

    it('exports xs with of method', () => {
      expect(typeof xs.of).toBe('function')
    })

    it('exports xs with merge method', () => {
      expect(typeof xs.merge).toBe('function')
    })

    it('exports xs with never method', () => {
      expect(typeof xs.never).toBe('function')
    })

    it('exports xs with empty method', () => {
      expect(typeof xs.empty).toBe('function')
    })

    it('can create a basic stream', () => {
      const stream = xs.create()
      expect(stream).toBeDefined()
      expect(typeof stream.addListener).toBe('function')
      expect(typeof stream.map).toBe('function')
      expect(typeof stream.filter).toBe('function')
    })

    it('xs.of produces a stream that emits values', () => {
      const values = []
      const stream = xs.of(1, 2, 3)
      stream.addListener({
        next: v => values.push(v),
        error: () => {},
        complete: () => {},
      })
      expect(values).toEqual([1, 2, 3])
    })
  })

  describe('Stream (named export)', () => {
    it('exports Stream', () => {
      expect(Stream).toBeDefined()
    })

    it('Stream is a constructor/class', () => {
      // Stream should be a function (constructor)
      expect(typeof Stream).toBe('function')
    })
  })
})
