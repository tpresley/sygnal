import { describe, it, expect } from 'vitest'
import classes from '../src/extra/classes.js'

describe('classes', () => {
  describe('string arguments', () => {
    it('returns a single class name', () => {
      expect(classes('foo')).toBe('foo')
    })
    it('returns multiple space-separated classes', () => {
      expect(classes('foo bar')).toBe('foo bar')
    })
    it('handles multiple string arguments', () => {
      expect(classes('foo', 'bar')).toBe('foo bar')
    })
    it('deduplicates identical strings', () => {
      expect(classes('foo', 'foo')).toBe('foo')
    })
  })

  describe('array arguments', () => {
    it('flattens array of class strings', () => {
      expect(classes(['foo', 'bar'])).toBe('foo bar')
    })
    it('handles mixed string and array args', () => {
      expect(classes('foo', ['bar', 'baz'])).toBe('foo bar baz')
    })
  })

  describe('object arguments', () => {
    it('includes keys with truthy values', () => {
      expect(classes({ foo: true, bar: false })).toBe('foo')
    })
    it('includes keys where function returns truthy', () => {
      expect(classes({ active: () => true, hidden: () => false })).toBe('active')
    })
    it('handles all truthy values', () => {
      expect(classes({ a: true, b: 1, c: 'yes' })).toBe('a b c')
    })
    it('excludes all falsy values', () => {
      expect(classes({ a: false, b: 0, c: null, d: undefined, e: '' })).toBe('')
    })
  })

  describe('mixed arguments', () => {
    it('handles string, array, and object together', () => {
      const result = classes('base', ['extra'], { conditional: true, hidden: false })
      expect(result).toBe('base extra conditional')
    })
  })

  describe('validation', () => {
    it('accepts any token without whitespace (CSS-6: Tailwind names)', () => {
      expect(classes('foo.bar', 'hover:bg-red-500', 'w-1/2', '[&>a]:underline')).toBe('foo.bar hover:bg-red-500 w-1/2 [&>a]:underline')
      expect(classes(['md:flex'], { 'w-1.5': true })).toBe('md:flex w-1.5')
    })
    it('splits several names in a string on any whitespace, and in an object key', () => {
      expect(classes('a\tb\n c')).toBe('a b c')
      expect(classes({ 'foo bar': true, 'x y': false })).toBe('foo bar')
    })
    it('accepts hyphens and underscores', () => {
      expect(classes('my-class', 'my_class')).toBe('my-class my_class')
    })
    it('accepts alphanumeric classes', () => {
      expect(classes('h1', 'col2')).toBe('h1 col2')
    })
  })

  describe('edge cases', () => {
    it('returns empty string for no arguments', () => {
      expect(classes()).toBe('')
    })
    it('handles extra whitespace in strings', () => {
      expect(classes('foo  bar')).toBe('foo bar')
    })
  })
})
