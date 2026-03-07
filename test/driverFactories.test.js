import { describe, it, expect, vi } from 'vitest'
import { driverFromAsync } from '../src/extra/driverFactories.js'
import xs from '../src/extra/xstreamCompat.js'

// Helper: create a manually-controlled stream that doesn't auto-complete.
// xs.of() completes immediately which triggers the driver's completion warning.
function manualStream() {
  let _listener = null
  const stream = xs.create({
    start(listener) { _listener = listener },
    stop() { _listener = null },
  })
  return {
    stream,
    emit(value) { _listener?.next(value) },
  }
}

describe('extra/driverFactories', () => {
  describe('option validation', () => {
    const mockAsync = async () => ({})

    it('throws when args is a number', () => {
      expect(() => driverFromAsync(mockAsync, { args: 123 })).toThrow("'args' option")
    })

    it('throws when args is a boolean', () => {
      expect(() => driverFromAsync(mockAsync, { args: true })).toThrow("'args' option")
    })

    it('throws when args is an object', () => {
      expect(() => driverFromAsync(mockAsync, { args: {} })).toThrow("'args' option")
    })

    it('throws when args is an array with non-strings', () => {
      expect(() => driverFromAsync(mockAsync, { args: [1, 2] })).toThrow("'args' option")
    })

    it('accepts args as a string', () => {
      expect(() => driverFromAsync(mockAsync, { args: 'data' })).not.toThrow()
    })

    it('accepts args as an array of strings', () => {
      expect(() => driverFromAsync(mockAsync, { args: ['a', 'b'] })).not.toThrow()
    })

    it('accepts args as a function', () => {
      expect(() => driverFromAsync(mockAsync, { args: (v) => v })).not.toThrow()
    })

    it('throws when selector is not a string', () => {
      expect(() => driverFromAsync(mockAsync, { selector: 123 })).toThrow("'selector' option")
    })

    it('throws when selector is a function', () => {
      expect(() => driverFromAsync(mockAsync, { selector: () => {} })).toThrow("'selector' option")
    })

    it('accepts selector as a string', () => {
      expect(() => driverFromAsync(mockAsync, { selector: 'type' })).not.toThrow()
    })

    it('uses function name in error messages', () => {
      async function fetchUser() { return {} }
      expect(() => driverFromAsync(fetchUser, { args: 123 })).toThrow('fetchUser')
    })

    it('uses [anonymous function] for unnamed functions', () => {
      expect(() => driverFromAsync(async () => {}, { args: 123 })).toThrow('[anonymous function]')
    })
  })

  describe('driver creation', () => {
    it('returns a function (the driver)', () => {
      const driver = driverFromAsync(async () => ({}))
      expect(typeof driver).toBe('function')
    })

    it('driver returns an object with select method', () => {
      const driver = driverFromAsync(async () => ({}))
      const fromApp$ = xs.never()
      const result = driver(fromApp$)
      expect(typeof result.select).toBe('function')
    })

    it('select() with no args returns the output stream', () => {
      const driver = driverFromAsync(async () => ({}))
      const fromApp$ = xs.never()
      const result = driver(fromApp$)
      const stream = result.select()
      expect(typeof stream.addListener).toBe('function')
    })

    it('select() with function arg returns a filtered stream', () => {
      const driver = driverFromAsync(async () => ({}))
      const fromApp$ = xs.never()
      const result = driver(fromApp$)
      const stream = result.select(v => v.type === 'test')
      expect(typeof stream.addListener).toBe('function')
    })

    it('select() with string arg returns a filtered stream', () => {
      const driver = driverFromAsync(async () => ({}))
      const fromApp$ = xs.never()
      const result = driver(fromApp$)
      const stream = result.select('myCategory')
      expect(typeof stream.addListener).toBe('function')
    })
  })

  describe('argument extraction', () => {
    it('extracts single string arg key', async () => {
      const receivedArgs = []
      const mockFn = async (...args) => {
        receivedArgs.push(...args)
        return { result: 'ok' }
      }

      const { stream: input$, emit } = manualStream()
      const driver = driverFromAsync(mockFn, { args: 'data', return: 'value' })
      const output = driver(input$)

      // Attach listener so sendFn is initialized
      output.select().addListener({ next() {}, error() {}, complete() {} })

      emit({ category: 'test', data: 'hello' })

      await new Promise(r => setTimeout(r, 50))
      expect(receivedArgs).toEqual(['hello'])
    })

    it('extracts array of string arg keys', async () => {
      const receivedArgs = []
      const mockFn = async (...args) => {
        receivedArgs.push(...args)
        return { result: 'ok' }
      }

      const { stream: input$, emit } = manualStream()
      const driver = driverFromAsync(mockFn, { args: ['a', 'b'], return: 'value' })
      const output = driver(input$)

      output.select().addListener({ next() {}, error() {}, complete() {} })

      emit({ category: 'test', a: 1, b: 2 })

      await new Promise(r => setTimeout(r, 50))
      expect(receivedArgs).toEqual([1, 2])
    })

    it('extracts args via function extractor', async () => {
      const receivedArgs = []
      const mockFn = async (...args) => {
        receivedArgs.push(...args)
        return { result: 'ok' }
      }

      const { stream: input$, emit } = manualStream()
      const driver = driverFromAsync(mockFn, {
        args: (incoming) => [incoming.x + incoming.y],
        return: 'value',
      })
      const output = driver(input$)

      output.select().addListener({ next() {}, error() {}, complete() {} })

      emit({ category: 'test', x: 3, y: 4 })

      await new Promise(r => setTimeout(r, 50))
      expect(receivedArgs).toEqual([7])
    })
  })

  describe('reply construction', () => {
    it('wraps result with return property and selector', async () => {
      const mockFn = async () => 'result-value'
      const driver = driverFromAsync(mockFn, {
        args: 'data',
        return: 'value',
        selector: 'category',
      })

      const results = []
      const { stream: input$, emit } = manualStream()
      const output = driver(input$)

      output.select().addListener({
        next: v => results.push(v),
        error() {},
        complete() {},
      })

      emit({ category: 'myType', data: 'input' })

      await new Promise(r => setTimeout(r, 50))
      expect(results.length).toBe(1)
      expect(results[0].value).toBe('result-value')
      expect(results[0].category).toBe('myType')
    })

    it('select filters by selector value', async () => {
      const mockFn = async () => 'result'
      const driver = driverFromAsync(mockFn, {
        args: 'data',
        return: 'value',
        selector: 'category',
      })

      const matched = []
      const unmatched = []
      const { stream: input$, emit } = manualStream()
      const output = driver(input$)

      output.select('typeA').addListener({
        next: v => matched.push(v),
        error() {},
        complete() {},
      })
      output.select('typeB').addListener({
        next: v => unmatched.push(v),
        error() {},
        complete() {},
      })

      emit({ category: 'typeA', data: 'input' })

      await new Promise(r => setTimeout(r, 50))
      expect(matched.length).toBe(1)
      expect(unmatched.length).toBe(0)
    })
  })

  describe('pre and post processing', () => {
    it('applies pre function to incoming data', async () => {
      const receivedArgs = []
      const mockFn = async (...args) => {
        receivedArgs.push(...args)
        return 'ok'
      }

      const { stream: input$, emit } = manualStream()
      const driver = driverFromAsync(mockFn, {
        args: 'value',
        return: 'result',
        pre: (incoming) => ({ ...incoming, value: incoming.value * 2 }),
      })
      const output = driver(input$)

      output.select().addListener({ next() {}, error() {}, complete() {} })

      emit({ category: 'test', value: 5 })

      await new Promise(r => setTimeout(r, 50))
      expect(receivedArgs).toEqual([10])
    })

    it('applies post function to result before reply', async () => {
      const mockFn = async (x) => x * 3
      const driver = driverFromAsync(mockFn, {
        args: 'value',
        return: 'result',
        post: (result) => result + 100,
      })

      const results = []
      const { stream: input$, emit } = manualStream()
      const output = driver(input$)

      output.select().addListener({
        next: v => results.push(v),
        error() {},
        complete() {},
      })

      emit({ category: 'test', value: 5 })

      await new Promise(r => setTimeout(r, 50))
      expect(results.length).toBe(1)
      expect(results[0].result).toBe(115) // 5 * 3 = 15, + 100 = 115
    })
  })

  describe('error handling', () => {
    it('logs error when promise rejects', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockFn = async () => { throw new Error('async failure') }
      const driver = driverFromAsync(mockFn, { args: 'data' })

      const { stream: input$, emit } = manualStream()
      const output = driver(input$)

      output.select().addListener({ next() {}, error() {}, complete() {} })

      emit({ category: 'test', data: 'input' })

      await new Promise(r => setTimeout(r, 50))
      expect(errorSpy).toHaveBeenCalled()
      expect(errorSpy.mock.calls[0][0]).toContain('Error')
      errorSpy.mockRestore()
    })
  })
})
