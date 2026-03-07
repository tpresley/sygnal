import { describe, it, expect } from 'vitest'
import processDrag from '../src/extra/processDrag.js'
import processForm from '../src/extra/processForm.js'
import collection from '../src/collection.js'


describe('input validation', () => {

  describe('processDrag', () => {
    it('throws when draggable has no .events() method', () => {
      expect(() => processDrag({ draggable: {} })).toThrow(
        'processDrag: draggable must have an .events() method'
      )
    })

    it('throws when draggable is a string', () => {
      expect(() => processDrag({ draggable: 'not-a-dom-element' })).toThrow(
        'processDrag: draggable must have an .events() method'
      )
    })

    it('throws when dropZone has no .events() method', () => {
      expect(() => processDrag({ dropZone: { select: () => {} } })).toThrow(
        'processDrag: dropZone must have an .events() method'
      )
    })

    it('throws when dropZone is a number', () => {
      expect(() => processDrag({ dropZone: 42 })).toThrow(
        'processDrag: dropZone must have an .events() method'
      )
    })

    it('does not throw when both params have .events()', () => {
      const mockDom = { events: () => ({ subscribe: () => {}, addListener: () => {}, map: () => mockDom.events(), mapTo: () => mockDom.events() }) }
      expect(() => processDrag({ draggable: mockDom, dropZone: mockDom })).not.toThrow()
    })

    it('does not throw when called with no arguments', () => {
      expect(() => processDrag()).not.toThrow()
    })

    it('does not throw when called with empty object', () => {
      expect(() => processDrag({})).not.toThrow()
    })

    it('does not throw when only draggable is provided with valid .events()', () => {
      const mockDom = { events: () => ({ subscribe: () => {}, addListener: () => {}, map: () => mockDom.events(), mapTo: () => mockDom.events() }) }
      expect(() => processDrag({ draggable: mockDom })).not.toThrow()
    })
  })


  describe('processForm', () => {
    it('throws when called with no arguments', () => {
      expect(() => processForm()).toThrow(
        'processForm: first argument must have an .events() method'
      )
    })

    it('throws when called with null', () => {
      expect(() => processForm(null)).toThrow(
        'processForm: first argument must have an .events() method'
      )
    })

    it('throws when called with a string', () => {
      expect(() => processForm('not-a-form')).toThrow(
        'processForm: first argument must have an .events() method'
      )
    })

    it('throws when called with an object without .events()', () => {
      expect(() => processForm({ select: () => {} })).toThrow(
        'processForm: first argument must have an .events() method'
      )
    })

    it('throws when .events is not a function', () => {
      expect(() => processForm({ events: 'not-a-function' })).toThrow(
        'processForm: first argument must have an .events() method'
      )
    })
  })


  describe('collection', () => {
    it('throws when component is not a function', () => {
      expect(() => collection('not-a-function', {})).toThrow(
        'collection: first argument (component) must be a function'
      )
    })

    it('throws when component is null', () => {
      expect(() => collection(null, {})).toThrow(
        'collection: first argument (component) must be a function'
      )
    })

    it('throws when component is an object', () => {
      expect(() => collection({}, {})).toThrow(
        'collection: first argument (component) must be a function'
      )
    })

    it('throws when component is undefined', () => {
      expect(() => collection(undefined, {})).toThrow(
        'collection: first argument (component) must be a function'
      )
    })

    it('does not throw when component is a function', () => {
      const mockComponent = () => ({})
      expect(() => collection(mockComponent, 'items')).not.toThrow()
    })
  })
})
