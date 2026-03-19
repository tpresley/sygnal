import { describe, it, expect, afterEach } from 'vitest'
import { setup } from '../src/cycle/run/index'
import { withState } from '../src/cycle/state/index'
import { mockDOMSource } from '../src/cycle/dom/index'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import component from '../src/component.js'
import eventBusDriver from '../src/extra/eventDriver.js'
import logDriver from '../src/extra/logDriver.js'
import { createElement } from '../src/pragma/index.js'
import { Suspense } from '../src/suspense.js'

// ─── Test helper ───────────────────────────────────────────────────────────────

function createTestComponent(componentDef, mockConfig = {}) {
  const name = componentDef.name || 'TestComponent'
  const view = componentDef
  const {
    intent,
    model,
    context,
    initialState,
  } = componentDef

  const app = component({
    name,
    view,
    intent,
    model,
    context,
    initialState,
  })

  const wrapped = withState(app, 'STATE')

  const mockDOM = () => mockDOMSource(mockConfig)

  const { sources, sinks, run: _run } = setup(wrapped, {
    DOM: mockDOM,
    EVENTS: eventBusDriver,
    LOG: logDriver,
    READY: () => xs.never(),
  })

  const dispose = _run()

  const vnodes = []
  let vnodeListener
  if (sinks.DOM) {
    vnodeListener = {
      next: v => vnodes.push(v),
      error: () => {},
      complete: () => {},
    }
    sinks.DOM.addListener(vnodeListener)
  }

  return {
    sources,
    sinks,
    vnodes,
    dispose() {
      if (vnodeListener && sinks.DOM) {
        sinks.DOM.removeListener(vnodeListener)
      }
      dispose()
    },
  }
}

const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

// ─── Child components for testing ────────────────────────────────────────────

function ReadyChild({ state } = {}) {
  return createElement('div', { class: 'ready-child' }, 'I am ready')
}
ReadyChild.initialState = {}

function NotReadyChild({ state } = {}) {
  return createElement('div', { class: 'not-ready-child' }, 'Not ready yet')
}
NotReadyChild.initialState = {}
NotReadyChild.model = {
  BOOTSTRAP: {
    READY: () => false,
  }
}

function DelayedReadyChild({ state } = {}) {
  return createElement('div', { class: 'delayed-child' },
    state.ready ? 'Now ready!' : 'Still loading...'
  )
}
DelayedReadyChild.initialState = { ready: false }
DelayedReadyChild.intent = ({ dispose$ }) => ({
  BECOME_READY: xs.periodic(50).take(1),
})
DelayedReadyChild.model = {
  BOOTSTRAP: {
    READY: () => false,
  },
  BECOME_READY: {
    STATE: (state) => ({ ...state, ready: true }),
    READY: () => true,
  },
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('Suspense', () => {

  describe('Suspense marker component', () => {
    it('has preventInstantiation set', () => {
      expect(Suspense.preventInstantiation).toBe(true)
    })

    it('has label set to suspense', () => {
      expect(Suspense.label).toBe('suspense')
    })

    it('produces a vnode with sel "suspense"', () => {
      const vnode = Suspense({ fallback: null, children: [] })
      expect(vnode.sel).toBe('suspense')
    })

    it('passes fallback as a prop', () => {
      const fallback = { sel: 'span', data: {}, children: [{ text: 'Loading...' }] }
      const vnode = Suspense({ fallback, children: [] })
      expect(vnode.data.props.fallback).toBe(fallback)
    })
  })

  describe('READY sink behavior', () => {
    let handle

    afterEach(() => {
      if (handle) {
        handle.dispose()
        handle = undefined
      }
    })

    it('renders children when all are ready (no explicit READY model = auto-ready)', async () => {
      function App() {
        return createElement(Suspense, { fallback: createElement('div', null, 'Loading...') },
          createElement(ReadyChild)
        )
      }
      App.initialState = {}
      App.initialState = App.initialState || {}
      handle = createTestComponent(App)
      await settle()

      expect(handle.vnodes.length).toBeGreaterThan(0)
      const vnode = handle.vnodes[handle.vnodes.length - 1]
      const text = extractText(vnode)
      expect(text).toContain('I am ready')
      expect(text).not.toContain('Loading...')
    })

    it('renders fallback when a child emits READY=false', async () => {
      function App() {
        return createElement(Suspense, { fallback: createElement('div', null, 'Loading...') },
          createElement(NotReadyChild)
        )
      }
      App.initialState = App.initialState || {}
      handle = createTestComponent(App)
      await settle()

      expect(handle.vnodes.length).toBeGreaterThan(0)
      const vnode = handle.vnodes[handle.vnodes.length - 1]
      const text = extractText(vnode)
      expect(text).toContain('Loading...')
    })

    it('wraps fallback in a div with data-sygnal-suspense="pending"', async () => {
      function App() {
        return createElement(Suspense, { fallback: createElement('span', null, 'Loading') },
          createElement(NotReadyChild)
        )
      }
      App.initialState = App.initialState || {}
      handle = createTestComponent(App)
      await settle()

      const vnode = handle.vnodes[handle.vnodes.length - 1]
      const suspenseNode = findByAttr(vnode, 'data-sygnal-suspense', 'pending')
      expect(suspenseNode).not.toBeNull()
    })

    it('marks resolved suspense with data-sygnal-suspense="resolved" for multiple children', async () => {
      function App() {
        return createElement(Suspense, { fallback: createElement('div', null, 'Loading') },
          createElement('div', null, 'Child 1'),
          createElement('div', null, 'Child 2')
        )
      }
      App.initialState = App.initialState || {}
      handle = createTestComponent(App)
      await settle()

      const vnode = handle.vnodes[handle.vnodes.length - 1]
      const suspenseNode = findByAttr(vnode, 'data-sygnal-suspense', 'resolved')
      expect(suspenseNode).not.toBeNull()
    })

    it('renders children without wrapper when single child and resolved', async () => {
      function App() {
        return createElement(Suspense, { fallback: createElement('div', null, 'Loading') },
          createElement('p', { class: 'solo' }, 'Only child')
        )
      }
      App.initialState = App.initialState || {}
      handle = createTestComponent(App)
      await settle()

      const vnode = handle.vnodes[handle.vnodes.length - 1]
      const pNode = findBySel(vnode, 'p')
      expect(pNode).not.toBeNull()
      expect(extractText(pNode)).toContain('Only child')
    })

    it('renders children when no fallback provided even if not ready', async () => {
      function App() {
        return createElement(Suspense, {},
          createElement(NotReadyChild)
        )
      }
      App.initialState = App.initialState || {}
      handle = createTestComponent(App)
      await settle()

      const vnode = handle.vnodes[handle.vnodes.length - 1]
      // Without fallback, should pass through children even when not ready
      const text = extractText(vnode)
      expect(text).toContain('Not ready yet')
    })

    it('handles string fallback', async () => {
      function App() {
        return createElement(Suspense, { fallback: 'Loading text' },
          createElement(NotReadyChild)
        )
      }
      App.initialState = App.initialState || {}
      handle = createTestComponent(App)
      await settle()

      const vnode = handle.vnodes[handle.vnodes.length - 1]
      const suspenseNode = findByAttr(vnode, 'data-sygnal-suspense', 'pending')
      expect(suspenseNode).not.toBeNull()
      const text = extractText(suspenseNode)
      expect(text).toContain('Loading text')
    })

    it('transitions from fallback to content when child becomes ready', async () => {
      function App() {
        return createElement(Suspense, { fallback: createElement('div', null, 'Please wait...') },
          createElement(DelayedReadyChild)
        )
      }
      App.initialState = App.initialState || {}
      handle = createTestComponent(App)

      // Initially should show fallback
      await settle(30)
      const earlyVnode = handle.vnodes[handle.vnodes.length - 1]
      const earlyText = extractText(earlyVnode)
      expect(earlyText).toContain('Please wait...')

      // After delay, should show content
      await settle(300)
      const lateVnode = handle.vnodes[handle.vnodes.length - 1]
      const lateText = extractText(lateVnode)
      expect(lateText).toContain('Now ready!')
      expect(lateText).not.toContain('Please wait...')
    })
  })
})

// ─── VNode helpers ──────────────────────────────────────────────────────────────

function extractText(vnode) {
  if (!vnode) return ''
  if (vnode.text) return vnode.text
  let result = ''
  if (vnode.children) {
    for (const child of vnode.children) {
      result += extractText(child)
    }
  }
  return result
}

function findByAttr(vnode, attr, value) {
  if (!vnode) return null
  if (vnode.data?.attrs?.[attr] === value) return vnode
  if (vnode.children) {
    for (const child of vnode.children) {
      const found = findByAttr(child, attr, value)
      if (found) return found
    }
  }
  return null
}

function findBySel(vnode, sel) {
  if (!vnode) return null
  if (vnode.sel === sel) return vnode
  if (vnode.children) {
    for (const child of vnode.children) {
      const found = findBySel(child, sel)
      if (found) return found
    }
  }
  return null
}
