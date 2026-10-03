// G-176: condition waits for tests that drive a real (jsdom) DOM.
//
// A Sygnal render lags its state by a few debounced timer hops, and a request can go out before
// the first render. On a loaded machine (a full vitest run, a parallel gate) those hops take far
// longer than a fixed sleep, so a test that clicks, or reads the DOM, after a sleep or right after
// a non-DOM condition (fetch called, a route seen) finds nothing. Wait on the condition instead.
import { vi } from 'vitest'

/** Retries `fn` until it stops throwing; resolves with its result. */
export const until = (fn, timeout = 5000) => vi.waitFor(fn, { timeout, interval: 5 })

/** The first element matching `sel`, once it is rendered. */
export const rendered = (sel, root = document) => until(() => {
  const el = root.querySelector(sel)
  if (!el) throw new Error(`nothing matches '${sel}' yet`)
  return el
})

/** Clicks the first element matching `sel` once it is rendered. */
export const clickWhenRendered = async (sel) => (await rendered(sel)).click()
