// PLAN-4.6 parity suite harness (R0).
//
// The suite under test/parity/ is the behaviour contract both component cores must meet. It uses
// the public API only (run, renderComponent, JSX via createElement, the public drivers) and never
// a core internal, so the same files run against the current core and the next one (R1-R4).
//
// Which core: SYGNAL_CORE=current (default) | next.
// - current: today's core (src/component.ts).
// - next:    the rewritten core (src/core/), selected inside run() / renderComponent() by an
//            internal flag that test/setup-core.js sets from SYGNAL_CORE=next (PLAN-4.6 §2 change 2;
//            deleted at R5). The exports are the same.
// The next core is built in phases (PLAN-4.6 §3). An area (parity(title, fn, phase)) or a test
// (needs(phase).it / .itNext) that needs a later phase is skipped on the next core with the phase
// in its title; NEXT_DONE lists the phases that have landed. On the current core nothing skips.
//
// Tests whose expected behaviour changes by decision (PLAN-4.6 §5) are written for the NEW
// behaviour and declared with itNext('D165 ...', title, fn): on the current core they run as
// `it.fails` (a pass there means the old behaviour changed, and vitest reports it), on the next
// core as a plain `it`. They are R1-R4's failing-first tests.
import { describe, it, vi, afterEach } from 'vitest'
import * as sygnal from '../../src/index.js'

export const CORE = (process.env.SYGNAL_CORE || 'current').toLowerCase()
if (CORE != 'current' && CORE != 'next') throw new Error(`SYGNAL_CORE=${CORE}: unknown core (current | next)`)
/** the PLAN-4.6 phases the next core implements */
export const NEXT_DONE = new Set(['R1', 'R2'])
const later = (phase) => CORE == 'next' && !NEXT_DONE.has(phase)
const skipNote = (phase) => `[next core: needs PLAN-4.6 ${phase}]`

const api = sygnal
export const {
  run, renderComponent, createElement: h, xs, Collection, Switchable, Suspense, lazy, ABORT,
  makeDOMDriver, makeTimerDriver, makeFetchDriver, undo, pager, selection, event,
} = api
export { api }

/** describe() for a parity area; `phase`: the PLAN-4.6 phase that brings it to the next core */
export function parity(title, fn, phase = 'R1') {
  if (later(phase)) return describe.skip(`${title} ${skipNote(phase)}`, fn)
  return describe(title, fn)
}

/**
 * A test of behaviour that changes by decision (PLAN-4.6 §5): written for the new core, expected
 * to fail on the current one. `decision` names it (e.g. 'D165 synchronous reducers').
 */
export function itNext(decision, title, fn, timeout) {
  if (CORE == 'next') return it(`${title} [${decision}]`, fn, timeout)
  return it.fails(`${title} [${decision}: new behaviour, expected to fail on the current core]`, fn, timeout)
}
itNext.each = (rows) => (title, fn) => rows.forEach((row) => itNext(row[0], title.replace('%s', row[1]), () => fn(...row.slice(1))))

/** a test in an R1 area that needs a later phase (e.g. it renders a Collection: R2) */
export function needs(phase) {
  if (!later(phase)) return { it, itNext }
  return {
    it: (title, fn, timeout) => it.skip(`${title} ${skipNote(phase)}`, fn, timeout),
    itNext: (decision, title, fn, timeout) => it.skip(`${title} [${decision}] ${skipNote(phase)}`, fn, timeout),
  }
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
