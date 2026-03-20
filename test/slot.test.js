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
import { Slot } from '../src/slot.js'

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

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('Slot', () => {
  let env

  afterEach(() => {
    if (env) {
      env.dispose()
      env = null
    }
  })

  describe('extractSlots via component rendering', () => {

    it('should pass named slots to child component view', async () => {
      let receivedSlots = null

      function Child({ state, slots }) {
        receivedSlots = slots
        return createElement('div', { class: 'child' },
          createElement('header', null, ...(slots.header || [])),
          createElement('main', null, ...(slots.default || [])),
        )
      }
      Child.initialState = { ready: true }
      Child.isolatedState = true

      function Parent({ state }) {
        return createElement('div', null,
          createElement(Child, null,
            createElement(Slot, { name: 'header' },
              createElement('h1', null, 'Title'),
            ),
            createElement('p', null, 'Body content'),
          ),
        )
      }
      Parent.initialState = { active: true }

      env = createTestComponent(Parent)
      await settle()

      expect(receivedSlots).toBeTruthy()
      expect(receivedSlots.header).toBeDefined()
      expect(receivedSlots.header.length).toBe(1)
      expect(receivedSlots.header[0].sel).toBe('h1')
      expect(receivedSlots.default).toBeDefined()
      expect(receivedSlots.default.some(c => c.sel === 'p')).toBe(true)
    })

    it('should handle multiple named slots', async () => {
      let receivedSlots = null

      function MultiSlotChild({ state, slots }) {
        receivedSlots = slots
        return createElement('div', { class: 'layout' },
          createElement('header', null, ...(slots.header || [])),
          createElement('footer', null, ...(slots.footer || [])),
          createElement('main', null, ...(slots.default || [])),
        )
      }
      MultiSlotChild.initialState = { ready: true }
      MultiSlotChild.isolatedState = true

      function Parent({ state }) {
        return createElement('div', null,
          createElement(MultiSlotChild, null,
            createElement(Slot, { name: 'header' },
              createElement('h1', null, 'Header'),
            ),
            createElement(Slot, { name: 'footer' },
              createElement('span', null, 'Footer'),
            ),
            createElement('p', null, 'Main content'),
          ),
        )
      }
      Parent.initialState = { active: true }

      env = createTestComponent(Parent)
      await settle()

      expect(receivedSlots).toBeTruthy()
      expect(receivedSlots.header).toBeDefined()
      expect(receivedSlots.header.length).toBe(1)
      expect(receivedSlots.header[0].sel).toBe('h1')
      expect(receivedSlots.footer).toBeDefined()
      expect(receivedSlots.footer.length).toBe(1)
      expect(receivedSlots.footer[0].sel).toBe('span')
      expect(receivedSlots.default).toBeDefined()
      expect(receivedSlots.default.some(c => c.sel === 'p')).toBe(true)
    })

    it('should handle only unnamed children (backward compatible)', async () => {
      let receivedSlots = null
      let receivedChildren = null

      function PlainChild({ state, children, slots }) {
        receivedSlots = slots
        receivedChildren = children
        return createElement('div', null, ...children)
      }
      PlainChild.initialState = { ready: true }
      PlainChild.isolatedState = true

      function Parent({ state }) {
        return createElement('div', null,
          createElement(PlainChild, null,
            createElement('p', null, 'First'),
            createElement('p', null, 'Second'),
          ),
        )
      }
      Parent.initialState = { active: true }

      env = createTestComponent(Parent)
      await settle()

      // children should be the same as before (all unnamed children)
      expect(receivedChildren).toBeDefined()
      expect(receivedChildren.length).toBe(2)
      // slots.default should contain the same children
      expect(receivedSlots).toBeDefined()
      expect(receivedSlots.default).toBeDefined()
      expect(receivedSlots.default.length).toBe(2)
      // no named slots
      expect(Object.keys(receivedSlots)).toEqual(['default'])
    })

    it('should handle component with no children', async () => {
      let receivedSlots = null
      let receivedChildren = null

      function EmptyChild({ state, children, slots }) {
        receivedSlots = slots
        receivedChildren = children
        return createElement('div', null, 'Empty')
      }
      EmptyChild.initialState = { ready: true }
      EmptyChild.isolatedState = true

      function Parent({ state }) {
        return createElement('div', null,
          createElement(EmptyChild, null),
        )
      }
      Parent.initialState = { active: true }

      env = createTestComponent(Parent)
      await settle()

      expect(receivedSlots).toEqual({})
      expect(receivedChildren).toEqual([])
    })

    it('should handle multiple children in a single named slot', async () => {
      let receivedSlots = null

      function ActionsChild({ state, slots }) {
        receivedSlots = slots
        return createElement('div', null,
          createElement('div', { class: 'actions' }, ...(slots.actions || [])),
        )
      }
      ActionsChild.initialState = { ready: true }
      ActionsChild.isolatedState = true

      function Parent({ state }) {
        return createElement('div', null,
          createElement(ActionsChild, null,
            createElement(Slot, { name: 'actions' },
              createElement('button', null, 'Save'),
              createElement('button', null, 'Cancel'),
            ),
          ),
        )
      }
      Parent.initialState = { active: true }

      env = createTestComponent(Parent)
      await settle()

      expect(receivedSlots).toBeTruthy()
      expect(receivedSlots.actions).toBeDefined()
      expect(receivedSlots.actions.length).toBe(2)
      expect(receivedSlots.actions[0].sel).toBe('button')
      expect(receivedSlots.actions[1].sel).toBe('button')
    })

    it('should handle a Slot with no name as default slot', async () => {
      let receivedSlots = null

      function Child({ state, slots }) {
        receivedSlots = slots
        return createElement('div', null, ...(slots.default || []))
      }
      Child.initialState = { ready: true }
      Child.isolatedState = true

      function Parent({ state }) {
        return createElement('div', null,
          createElement(Child, null,
            createElement(Slot, null,
              createElement('p', null, 'Explicit default'),
            ),
          ),
        )
      }
      Parent.initialState = { active: true }

      env = createTestComponent(Parent)
      await settle()

      expect(receivedSlots).toBeTruthy()
      expect(receivedSlots.default).toBeDefined()
      expect(receivedSlots.default.length).toBe(1)
      expect(receivedSlots.default[0].sel).toBe('p')
    })

    it('should merge explicit default Slot with unnamed children', async () => {
      let receivedSlots = null

      function Child({ state, slots }) {
        receivedSlots = slots
        return createElement('div', null, ...(slots.default || []))
      }
      Child.initialState = { ready: true }
      Child.isolatedState = true

      function Parent({ state }) {
        return createElement('div', null,
          createElement(Child, null,
            createElement(Slot, null,
              createElement('p', null, 'From slot'),
            ),
            createElement('span', null, 'Unnamed'),
          ),
        )
      }
      Parent.initialState = { active: true }

      env = createTestComponent(Parent)
      await settle()

      expect(receivedSlots).toBeTruthy()
      expect(receivedSlots.default).toBeDefined()
      // Should contain both the explicit default slot content and the unnamed child
      expect(receivedSlots.default.length).toBe(2)
    })
  })

  describe('Slot component', () => {
    it('should have preventInstantiation set', () => {
      expect(Slot.preventInstantiation).toBe(true)
    })

    it('should have label set to slot', () => {
      expect(Slot.label).toBe('slot')
    })

    it('should produce a VNode with sel "slot"', () => {
      const vnode = Slot({ name: 'header', children: [createElement('h1', null, 'Title')] })
      expect(vnode.sel).toBe('slot')
      expect(vnode.data.props.name).toBe('header')
    })
  })
})
