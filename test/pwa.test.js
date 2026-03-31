import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import xs from 'xstream'

// Set up window/navigator shims BEFORE importing the pwa module.
// onlineStatus$ is now a module-level constant, so the stream is created
// at import time — window must be shimmed first.

const windowEvents = {}
const fakeWindow = {
  addEventListener: vi.fn((type, handler) => {
    if (!windowEvents[type]) windowEvents[type] = []
    windowEvents[type].push(handler)
  }),
  removeEventListener: vi.fn((type, handler) => {
    if (windowEvents[type]) {
      windowEvents[type] = windowEvents[type].filter(h => h !== handler)
    }
  }),
  dispatchEvent: vi.fn((event) => {
    const handlers = windowEvents[event.type] || []
    handlers.forEach(h => h(event))
  }),
}

globalThis.window = fakeWindow
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { onLine: true, serviceWorker: undefined }
} else if (globalThis.navigator.onLine === undefined) {
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
}

// Dynamic import AFTER shims are in place
const { onlineStatus$, createInstallPrompt, makeServiceWorkerDriver } = await import('../src/extra/pwa')

describe('onlineStatus$', () => {
  it('is a stream (not a function)', () => {
    expect(typeof onlineStatus$.addListener).toBe('function')
    expect(typeof onlineStatus$).not.toBe('function')
  })

  it('emits values and responds to online/offline events', () => {
    const values = []
    const listener = { next: v => values.push(v) }
    onlineStatus$.addListener(listener)

    // Should emit navigator.onLine immediately
    expect(values).toEqual([true])

    // Should respond to offline/online events
    fakeWindow.dispatchEvent(new Event('offline'))
    fakeWindow.dispatchEvent(new Event('online'))
    expect(values).toEqual([true, false, true])

    onlineStatus$.removeListener(listener)
  })
})

describe('createInstallPrompt', () => {
  beforeEach(() => {
    Object.keys(windowEvents).forEach(k => delete windowEvents[k])
    fakeWindow.addEventListener.mockClear()
  })

  it('returns object with select and prompt methods', () => {
    const ip = createInstallPrompt()
    expect(typeof ip.select).toBe('function')
    expect(typeof ip.prompt).toBe('function')
  })

  it('select("beforeinstallprompt") emits when beforeinstallprompt fires', () => {
    const ip = createInstallPrompt()
    const values = []
    ip.select('beforeinstallprompt').addListener({ next: v => values.push(v) })

    const event = new Event('beforeinstallprompt')
    event.prompt = vi.fn()
    fakeWindow.dispatchEvent(event)

    expect(values).toEqual([true])
  })

  it('select("appinstalled") emits when appinstalled fires', () => {
    const ip = createInstallPrompt()
    const values = []
    ip.select('appinstalled').addListener({ next: v => values.push(v) })

    fakeWindow.dispatchEvent(new Event('appinstalled'))
    expect(values).toEqual([true])
  })

  it('prompt() calls deferred prompt after beforeinstallprompt', () => {
    const ip = createInstallPrompt()
    ip.select('beforeinstallprompt').addListener({ next: () => {} })

    const mockPrompt = vi.fn().mockResolvedValue({ outcome: 'accepted' })
    const event = new Event('beforeinstallprompt')
    event.prompt = mockPrompt
    fakeWindow.dispatchEvent(event)

    ip.prompt()
    expect(mockPrompt).toHaveBeenCalled()
  })

  it('prompt() returns undefined when no deferred prompt', () => {
    const ip = createInstallPrompt()
    expect(ip.prompt()).toBeUndefined()
  })

  it('select filters by type correctly', () => {
    const ip = createInstallPrompt()
    const installs = []
    const prompts = []
    ip.select('appinstalled').addListener({ next: v => installs.push(v) })
    ip.select('beforeinstallprompt').addListener({ next: v => prompts.push(v) })

    const event = new Event('beforeinstallprompt')
    event.prompt = vi.fn()
    fakeWindow.dispatchEvent(event)
    fakeWindow.dispatchEvent(new Event('appinstalled'))

    expect(prompts).toEqual([true])
    expect(installs).toEqual([true])
  })
})

describe('makeServiceWorkerDriver', () => {
  let originalSW

  beforeEach(() => {
    originalSW = navigator.serviceWorker
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: originalSW,
      configurable: true,
    })
  })

  it('returns a driver function', () => {
    const driver = makeServiceWorkerDriver('/sw.js')
    expect(typeof driver).toBe('function')
  })

  it('driver returns source with select method', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          installing: null,
          waiting: null,
          active: null,
          addEventListener: vi.fn(),
        }),
        addEventListener: vi.fn(),
        ready: Promise.resolve({ active: null, waiting: null }),
      },
      configurable: true,
    })

    const driver = makeServiceWorkerDriver('/sw.js')
    const sink$ = xs.never()
    const source = driver(sink$)
    expect(typeof source.select).toBe('function')
  })

  it('emits error when registration fails', async () => {
    const regError = new Error('Registration failed')
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockRejectedValue(regError),
        addEventListener: vi.fn(),
        ready: Promise.resolve({ active: null, waiting: null }),
      },
      configurable: true,
    })

    const driver = makeServiceWorkerDriver('/sw.js')
    const source = driver(xs.never())
    const errors = []
    source.select('error').addListener({ next: v => errors.push(v) })

    await new Promise(r => setTimeout(r, 10))
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('Registration failed')
  })

  it('emits activated when active worker exists', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          installing: null,
          waiting: null,
          active: { state: 'activated' },
          addEventListener: vi.fn(),
        }),
        addEventListener: vi.fn(),
        ready: Promise.resolve({ active: null, waiting: null }),
      },
      configurable: true,
    })

    const driver = makeServiceWorkerDriver('/sw.js')
    const source = driver(xs.never())
    const values = []
    source.select('activated').addListener({ next: v => values.push(v) })

    await new Promise(r => setTimeout(r, 10))
    expect(values).toEqual([true])
  })

  it('handles skipWaiting command', async () => {
    const mockWaiting = { postMessage: vi.fn() }
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          installing: null,
          waiting: null,
          active: null,
          addEventListener: vi.fn(),
        }),
        addEventListener: vi.fn(),
        ready: Promise.resolve({ active: null, waiting: mockWaiting }),
      },
      configurable: true,
    })

    const sink$ = xs.of({ action: 'skipWaiting' })
    const driver = makeServiceWorkerDriver('/sw.js')
    driver(sink$)

    await new Promise(r => setTimeout(r, 10))
    expect(mockWaiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('select with no type receives all events', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          installing: null,
          waiting: null,
          active: { state: 'activated' },
          addEventListener: vi.fn(),
        }),
        addEventListener: vi.fn(),
        ready: Promise.resolve({ active: null, waiting: null }),
      },
      configurable: true,
    })

    const driver = makeServiceWorkerDriver('/sw.js')
    const source = driver(xs.never())
    const values = []
    source.select().addListener({ next: v => values.push(v) })

    await new Promise(r => setTimeout(r, 10))
    expect(values.length).toBeGreaterThan(0)
  })
})
