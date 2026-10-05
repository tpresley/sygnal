// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import processDrag from '../src/extra/processDrag.js'
import processForm from '../src/extra/processForm.js'
import { run, createElement as h, Collection } from '../src/index.js'


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


  // R5: the collection() factory is gone; <Collection of={...}> is validated by the core (SYG411):
  // the owner renders its error fallback
  describe('Collection of', () => {
    let app
    afterEach(() => { app?.dispose(); app = undefined; document.body.innerHTML = ''; vi.restoreAllMocks() })
    const render = async (of) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      document.body.innerHTML = '<div id="root"></div>'
      function App() { return h('div', null, h(Collection, { of, from: 'items' })) }
      App.initialState = { items: [{ id: 1 }] }
      app = run(App)
      await app.__runtime.flushed()
      return console.error.mock.calls.filter((c) => String(c[0]).includes('SYG411'))
    }

    for (const [label, of] of [['a string', 'not-a-function'], ['null', null], ['an object', {}], ['undefined', undefined]]) {
      it(`reports SYG411 when of is ${label}`, async () => {
        expect((await render(of)).length).toBeGreaterThan(0)
        expect(document.querySelector('[data-sygnal-error]')).toBeTruthy()
      })
    }

    it('does not report when of is a component function', async () => {
      expect(await render(() => h('i', null, 'item'))).toEqual([])
      expect(document.querySelector('i').textContent).toBe('item')
    })
  })
})
