import { describe, it, expect } from 'vitest'
import xs, { Stream } from '../src/extra/xstreamCompat.js'

describe('extra/xstreamCompat', () => {
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
