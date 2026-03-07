import { describe, it, expect } from 'vitest'
import * as is from '../src/pragma/is.js'

describe('pragma/is', () => {
  describe('nullv', () => {
    it('returns true for null', () => {
      expect(is.nullv(null)).toBe(true)
    })
    it('returns false for undefined', () => {
      expect(is.nullv(undefined)).toBe(false)
    })
    it('returns false for 0', () => {
      expect(is.nullv(0)).toBe(false)
    })
    it('returns false for empty string', () => {
      expect(is.nullv('')).toBe(false)
    })
  })

  describe('undefinedv', () => {
    it('returns true for undefined', () => {
      expect(is.undefinedv(undefined)).toBe(true)
    })
    it('returns false for null', () => {
      expect(is.undefinedv(null)).toBe(false)
    })
    it('returns false for 0', () => {
      expect(is.undefinedv(0)).toBe(false)
    })
  })

  describe('number', () => {
    it('returns true for integers', () => {
      expect(is.number(42)).toBe(true)
    })
    it('returns true for floats', () => {
      expect(is.number(3.14)).toBe(true)
    })
    it('returns true for 0', () => {
      expect(is.number(0)).toBe(true)
    })
    it('returns true for NaN', () => {
      expect(is.number(NaN)).toBe(true)
    })
    it('returns false for numeric string', () => {
      expect(is.number('42')).toBe(false)
    })
    it('returns false for null', () => {
      expect(is.number(null)).toBe(false)
    })
  })

  describe('string', () => {
    it('returns true for strings', () => {
      expect(is.string('hello')).toBe(true)
    })
    it('returns true for empty string', () => {
      expect(is.string('')).toBe(true)
    })
    it('returns false for numbers', () => {
      expect(is.string(42)).toBe(false)
    })
    it('returns false for null', () => {
      expect(is.string(null)).toBe(false)
    })
  })

  describe('text', () => {
    it('returns true for strings', () => {
      expect(is.text('hello')).toBe(true)
    })
    it('returns true for numbers', () => {
      expect(is.text(42)).toBe(true)
    })
    it('returns false for booleans', () => {
      expect(is.text(true)).toBe(false)
    })
    it('returns false for objects', () => {
      expect(is.text({})).toBe(false)
    })
    it('returns false for null', () => {
      expect(is.text(null)).toBe(false)
    })
    it('returns false for undefined', () => {
      expect(is.text(undefined)).toBe(false)
    })
  })

  describe('array', () => {
    it('returns true for arrays', () => {
      expect(is.array([1, 2])).toBe(true)
    })
    it('returns true for empty arrays', () => {
      expect(is.array([])).toBe(true)
    })
    it('returns false for objects', () => {
      expect(is.array({})).toBe(false)
    })
    it('returns false for strings', () => {
      expect(is.array('hello')).toBe(false)
    })
  })

  describe('object', () => {
    it('returns true for plain objects', () => {
      expect(is.object({})).toBe(true)
    })
    it('returns true for arrays (typeof object)', () => {
      expect(is.object([])).toBe(true)
    })
    it('returns false for null', () => {
      expect(is.object(null)).toBe(false)
    })
    it('returns false for strings', () => {
      expect(is.object('hello')).toBe(false)
    })
    it('returns false for numbers', () => {
      expect(is.object(42)).toBe(false)
    })
    it('returns false for functions', () => {
      expect(is.object(() => {})).toBe(false)
    })
  })

  describe('fun', () => {
    it('returns true for functions', () => {
      expect(is.fun(() => {})).toBe(true)
    })
    it('returns true for named functions', () => {
      expect(is.fun(function named() {})).toBe(true)
    })
    it('returns false for objects', () => {
      expect(is.fun({})).toBe(false)
    })
    it('returns false for null', () => {
      expect(is.fun(null)).toBe(false)
    })
  })

  describe('vnode', () => {
    it('returns true for valid vnode shape', () => {
      expect(is.vnode({ sel: 'div', data: {}, children: [], text: undefined })).toBe(true)
    })
    it('returns false when missing sel', () => {
      expect(is.vnode({ data: {}, children: [], text: undefined })).toBe(false)
    })
    it('returns false when missing data', () => {
      expect(is.vnode({ sel: 'div', children: [], text: undefined })).toBe(false)
    })
    it('returns false when missing children', () => {
      expect(is.vnode({ sel: 'div', data: {}, text: undefined })).toBe(false)
    })
    it('returns false when missing text', () => {
      expect(is.vnode({ sel: 'div', data: {}, children: [] })).toBe(false)
    })
    it('returns false for non-objects', () => {
      expect(is.vnode('not a vnode')).toBe(false)
    })
    it('returns false for null', () => {
      expect(is.vnode(null)).toBe(false)
    })
  })

  describe('svg', () => {
    it('returns true for svg elements', () => {
      expect(is.svg({ sel: 'svg' })).toBe(true)
    })
    it('returns true for circle', () => {
      expect(is.svg({ sel: 'circle' })).toBe(true)
    })
    it('returns true for path', () => {
      expect(is.svg({ sel: 'path' })).toBe(true)
    })
    it('returns true for g', () => {
      expect(is.svg({ sel: 'g' })).toBe(true)
    })
    it('returns true for foreignObject', () => {
      expect(is.svg({ sel: 'foreignObject' })).toBe(true)
    })
    it('returns false for div', () => {
      expect(is.svg({ sel: 'div' })).toBe(false)
    })
    it('returns false for span', () => {
      expect(is.svg({ sel: 'span' })).toBe(false)
    })
    it('returns false for title (HTML collision)', () => {
      expect(is.svg({ sel: 'title' })).toBe(false)
    })
  })
})
