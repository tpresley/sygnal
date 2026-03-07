import { describe, it, expect } from 'vitest'
import { extend, assign, reduceDeep, mapObject, deepifyKeys, flatifyKeys, omit } from '../src/pragma/fn.js'

describe('pragma/fn', () => {
  describe('extend (deep merge)', () => {
    it('merges flat objects', () => {
      expect(extend({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
    })
    it('deep merges nested objects', () => {
      const result = extend({ a: { x: 1 } }, { a: { y: 2 } })
      expect(result).toEqual({ a: { x: 1, y: 2 } })
    })
    it('overwrites primitives', () => {
      expect(extend({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
    })
    it('handles multiple objects', () => {
      expect(extend({ a: 1 }, { b: 2 }, { c: 3 })).toEqual({ a: 1, b: 2, c: 3 })
    })
  })

  describe('assign (shallow merge)', () => {
    it('merges flat objects', () => {
      expect(assign({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
    })
    it('overwrites nested objects (shallow)', () => {
      const result = assign({ a: { x: 1 } }, { a: { y: 2 } })
      expect(result).toEqual({ a: { y: 2 } })
    })
  })

  describe('reduceDeep', () => {
    it('reduces a flat array', () => {
      expect(reduceDeep([1, 2, 3], (acc, v) => acc + v, 0)).toBe(6)
    })
    it('flattens and reduces nested arrays', () => {
      expect(reduceDeep([1, [2, [3]]], (acc, v) => acc + v, 0)).toBe(6)
    })
    it('collects items from nested arrays', () => {
      expect(reduceDeep([1, [2, [3, 4]], 5], (acc, v) => [...acc, v], [])).toEqual([1, 2, 3, 4, 5])
    })
    it('handles empty array', () => {
      expect(reduceDeep([], (acc, v) => acc + v, 0)).toBe(0)
    })
    it('handles deeply nested empty arrays', () => {
      expect(reduceDeep([[], [[]]], (acc, v) => [...acc, v], [])).toEqual([])
    })
  })

  describe('mapObject', () => {
    it('maps over entries and merges', () => {
      const result = mapObject({ a: 1, b: 2 }, (key, val) => ({ [key]: val * 2 }))
      expect(result).toEqual({ a: 2, b: 4 })
    })
    it('can rename keys', () => {
      const result = mapObject({ old: 'value' }, (key, val) => ({ new: val }))
      expect(result).toEqual({ new: 'value' })
    })
  })

  describe('deepifyKeys', () => {
    const modules = { data: 'dataset', style: '', attrs: '' }

    it('nests dashed keys into module objects', () => {
      const result = deepifyKeys({ 'data-id': '5' }, modules)
      expect(result).toEqual({ data: { id: '5' } })
    })
    it('leaves non-dashed keys alone', () => {
      const result = deepifyKeys({ class: 'foo' }, modules)
      expect(result).toEqual({ class: 'foo' })
    })
    it('only nests if module prefix exists', () => {
      const result = deepifyKeys({ 'unknown-key': 'val' }, modules)
      expect(result).toEqual({ 'unknown-key': 'val' })
    })
    it('handles multiple keys', () => {
      const result = deepifyKeys({ 'data-x': 1, 'data-y': 2, plain: 3 }, modules)
      expect(result).toEqual({ data: { x: 1, y: 2 }, plain: 3 })
    })
  })

  describe('flatifyKeys', () => {
    it('flattens nested objects with dashes', () => {
      const result = flatifyKeys({ data: { id: '5' } })
      expect(result).toEqual({ 'data-id': '5' })
    })
    it('leaves flat keys alone', () => {
      const result = flatifyKeys({ class: 'foo' })
      expect(result).toEqual({ class: 'foo' })
    })
    it('flattens deeply nested', () => {
      const result = flatifyKeys({ a: { b: { c: 1 } } })
      expect(result).toEqual({ 'a-b-c': 1 })
    })
  })

  describe('omit', () => {
    it('removes the specified key', () => {
      expect(omit('b', { a: 1, b: 2, c: 3 })).toEqual({ a: 1, c: 3 })
    })
    it('returns same object if key not present', () => {
      expect(omit('z', { a: 1 })).toEqual({ a: 1 })
    })
    it('returns empty object when omitting only key', () => {
      expect(omit('a', { a: 1 })).toEqual({})
    })
  })
})
