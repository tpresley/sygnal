// The kanban example for the copied test (PLAN-4 3-E): the root vitest compiles the example's
// .jsx as classic React.createElement calls, so React is sygnal's createElement here.
import { createElement } from 'sygnal'

if (typeof globalThis.React === 'undefined') globalThis.React = { createElement }

export const { default: RootComponent } = await import('../../examples/kanban/src/RootComponent.jsx')
export const { mockDragDriver } = await import('../../examples/kanban/src/testHelpers.js')
