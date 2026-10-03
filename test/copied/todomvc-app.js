// The TodoMVC example for the copied test (PLAN-4 3-E): the root vitest compiles its .tsx as
// classic React.createElement calls, so React is sygnal's createElement here.
import { createElement, xs } from 'sygnal'

if (typeof globalThis.React === 'undefined') globalThis.React = { createElement }

export const { default: APP } = await import('../../examples/todomvc/app.tsx')
export const { default: localStorageDriver } = await import('../../examples/todomvc/lib/localStorageDriver.ts')

/** a ROUTER driver that takes the routes and never navigates (the app's own uses director) */
export function silentRouter(route$) {
  route$.addListener({ next() {}, error() {}, complete() {} })
  return xs.never()
}
