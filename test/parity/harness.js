// PLAN-4.6 parity suite harness (R0).
//
// The suite under test/parity/ is the behaviour contract of the component core (src/core/). It
// uses the public API only (run, renderComponent, JSX via createElement, the public drivers) and
// never a core internal. During R1-R4 the same files ran against the old core and the new one;
// since R5 there is one core. A test of behaviour a PLAN-4.6 decision changed names the decision
// in its title (e.g. `[D165 synchronous reducers]`).
import { describe, vi, afterEach } from 'vitest'
import * as sygnal from '../../src/index.js'

const api = sygnal
export const {
  run, renderComponent, createElement: h, xs, Collection, Switchable, Suspense, lazy, ABORT,
  makeDOMDriver, makeTimerDriver, makeFetchDriver, undo, pager, selection, event,
} = api
export { api }

/** describe() for a parity area */
export function parity(title, fn) {
  return describe(title, fn)
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const until = (fn, timeout = 2000) => vi.waitFor(fn, { timeout, interval: 2 })
/** n microtask turns (no timer): what "settles without a timer" waits for */
export const microtasks = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve() }

let apps = []
afterEach(() => {
  vi.useRealTimers()
  apps.forEach((a) => { try { a.dispose() } catch (_) {} })
  apps = []
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
/** forget an app the test disposed itself */
export const forget = (app) => { apps = apps.filter((a) => a !== app) }

/**
 * run() an app into #root with the public API. patches(): the vnodes the DOM driver received
 * (one per patch); state(): the latest root state, read from STATE.stream (public).
 */
export function mount(App, drivers = {}, options = {}) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  let patches = 0
  const inner = makeDOMDriver('#root')
  const DOM = (vnode$, name) => inner(vnode$.map((v) => (patches++, v)), name)
  const app = run(App, { DOM, ...drivers }, { mountPoint: '#root', ...options })
  apps.push(app)
  let last
  const states = []
  app.sources.STATE.stream.addListener({ next: (s) => { last = s; states.push(s) }, error: () => {} })
  return {
    app,
    el,
    states,
    patches: () => patches,
    state: () => last,
    $: (s) => el.querySelector(s),
    $$: (s) => [...el.querySelectorAll(s)],
    text: (s) => el.querySelector(s)?.textContent,
  }
}

export const click = (el) => (typeof el == 'string' ? document.querySelector(el) : el).dispatchEvent(new MouseEvent('click', { bubbles: true }))
export const dblclick = (el) => (typeof el == 'string' ? document.querySelector(el) : el).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
