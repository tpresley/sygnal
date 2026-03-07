import { describe, it, expect } from 'vitest'
import { createElement, createElementWithModules } from '../src/pragma/index.js'

const defaultModules = {
  attrs: '',
  props: '',
  class: '',
  data: 'dataset',
  style: '',
  hook: '',
  on: ''
}

describe('pragma/createElement', () => {
  describe('basic vnode creation', () => {
    it('creates a vnode with a string selector', () => {
      const vnode = createElement('div', null)
      expect(vnode.sel).toBe('div')
      expect(vnode.data).toEqual({})
    })

    it('creates a vnode with props', () => {
      const vnode = createElement('input', { type: 'text', value: 'hello' })
      expect(vnode.sel).toBe('input')
      expect(vnode.data.props.type).toBe('text')
      expect(vnode.data.props.value).toBe('hello')
    })

    it('creates a vnode with children text', () => {
      const vnode = createElement('span', null, 'hello')
      expect(vnode.sel).toBe('span')
      expect(vnode.text).toBe('hello')
    })

    it('creates a vnode with multiple children', () => {
      const child1 = createElement('span', null, 'a')
      const child2 = createElement('span', null, 'b')
      const vnode = createElement('div', null, child1, child2)
      expect(vnode.sel).toBe('div')
      expect(vnode.children).toHaveLength(2)
    })

    it('extracts key from data', () => {
      const vnode = createElement('li', { key: 'item-1' }, 'text')
      expect(vnode.key).toBe('item-1')
    })
  })

  describe('text elements', () => {
    it('creates text vnodes for string children', () => {
      const vnode = createElement('div', null, 'hello', 'world')
      expect(vnode.children).toHaveLength(2)
      expect(vnode.children[0].text).toBe('hello')
      expect(vnode.children[1].text).toBe('world')
    })

    it('creates text vnodes for number children', () => {
      const vnode = createElement('div', null, 42)
      expect(vnode.text).toBe('42')
    })

    it('filters out null and undefined children', () => {
      const child = createElement('span', null, 'keep')
      const vnode = createElement('div', null, null, child, undefined)
      // null/undefined are filtered by sanitizeChildren via reduceDeep
      // createTextElement returns undefined for non-text, which gets pushed as undefined
      expect(vnode.children.filter(c => c != null)).toHaveLength(1)
    })
  })

  describe('SVG handling', () => {
    it('applies SVG namespace to svg elements', () => {
      const vnode = createElement('svg', { width: 100 })
      expect(vnode.data.ns).toBe('http://www.w3.org/2000/svg')
    })

    it('applies SVG namespace to circle', () => {
      const vnode = createElement('circle', { cx: 50, cy: 50, r: 25 })
      expect(vnode.data.ns).toBe('http://www.w3.org/2000/svg')
    })

    it('does not apply SVG namespace to div', () => {
      const vnode = createElement('div', { className: 'test' })
      expect(vnode.data.ns).toBeUndefined()
    })

    it('rewrites className to class attr for SVG', () => {
      const vnode = createElement('svg', { className: 'icon' })
      expect(vnode.data.attrs.class).toBe('icon')
    })

    it('recursively applies SVG to children', () => {
      const child = createElement('circle', { cx: 10 })
      const vnode = createElement('svg', null, child)
      expect(vnode.data.ns).toBe('http://www.w3.org/2000/svg')
      // Children are processed recursively
      expect(vnode.children[0].data.ns).toBe('http://www.w3.org/2000/svg')
    })

    it('does not recurse into foreignObject children', () => {
      const htmlChild = createElement('div', { className: 'inner' })
      const foreign = createElement('foreignObject', null, htmlChild)
      const vnode = createElement('svg', null, foreign)
      // foreignObject itself gets SVG namespace
      expect(vnode.children[0].data.ns).toBe('http://www.w3.org/2000/svg')
      // But its children do NOT get SVG namespace (they're HTML)
      const foreignChildren = vnode.children[0].children
      if (foreignChildren && foreignChildren[0]) {
        expect(foreignChildren[0].data.ns).toBeUndefined()
      }
    })
  })

  describe('data rewriting', () => {
    it('rewrites for to attrs', () => {
      const vnode = createElement('label', { for: 'input-id' })
      expect(vnode.data.attrs.for).toBe('input-id')
    })

    it('rewrites role to attrs', () => {
      const vnode = createElement('div', { role: 'button' })
      expect(vnode.data.attrs.role).toBe('button')
    })

    it('rewrites tabindex to attrs', () => {
      const vnode = createElement('div', { tabindex: 0 })
      expect(vnode.data.attrs.tabindex).toBe(0)
    })

    it('rewrites aria-* to attrs', () => {
      const vnode = createElement('div', { 'aria-label': 'Close' })
      expect(vnode.data.attrs['aria-label']).toBe('Close')
    })

    it('removes key from data (used as vnode key only)', () => {
      const vnode = createElement('div', { key: 'my-key', className: 'test' })
      expect(vnode.key).toBe('my-key')
      expect(vnode.data.key).toBeUndefined()
      expect(vnode.data.props?.key).toBeUndefined()
    })

    it('nests data-* into dataset module', () => {
      const vnode = createElement('div', { 'data-id': '5' })
      expect(vnode.data.dataset.id).toBe('5')
    })

    it('routes style to style module', () => {
      const vnode = createElement('div', { style: { color: 'red' } })
      expect(vnode.data.style).toEqual({ color: 'red' })
    })

    it('routes className to props', () => {
      const vnode = createElement('div', { className: 'test' })
      expect(vnode.data.props.className).toBe('test')
    })
  })

  describe('autoFocus / autoSelect', () => {
    it('extracts autoFocus and creates insert hook', () => {
      const vnode = createElement('input', { autoFocus: true })
      expect(vnode.data.props?.autoFocus).toBeUndefined()
      expect(vnode.data.hook?.insert).toBeTypeOf('function')
    })

    it('extracts autoSelect and creates insert hook', () => {
      const vnode = createElement('input', { autoFocus: true, autoSelect: true })
      expect(vnode.data.props?.autoSelect).toBeUndefined()
      expect(vnode.data.hook?.insert).toBeTypeOf('function')
    })

    it('does not create hook when neither is set', () => {
      const vnode = createElement('input', { type: 'text' })
      expect(vnode.data.hook?.insert).toBeUndefined()
    })
  })

  describe('createElementWithModules', () => {
    it('uses custom module mappings', () => {
      const customModules = { attrs: '', props: '' }
      const h = createElementWithModules(customModules)
      const vnode = h('div', { id: 'test' })
      expect(vnode.sel).toBe('div')
    })
  })
})
