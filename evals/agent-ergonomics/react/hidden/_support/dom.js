// React-arm harness for the hidden acceptance tests. Same exported API as the
// Sygnal arm's hidden/_support/dom.js, so the test files are identical.
//
// mountApp() renders the default export of src/App.jsx with
// @testing-library/react; interactions go through RTL's fireEvent (wrapped in
// act) so React's controlled inputs see real value changes. Under fake timers
// (vi.useFakeTimers(), the ergo tier) the pause advances the fake clock by
// HUMAN_PAUSE_MS inside act() instead of sleeping, and advance(ms) moves it further.
import { vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { sleep, waitFor, HUMAN_PAUSE_MS } from './queries.js'

export * from './queries.js'

afterEach(() => cleanup())

export async function mountApp() {
  cleanup()
  document.body.innerHTML = ''
  vi.resetModules()
  const { default: App } = await import('../src/App.jsx')
  await act(async () => {
    render(createElement(App))
  })
  if (vi.isFakeTimers()) await advance(HUMAN_PAUSE_MS)
  await waitFor(() => {
    if (document.body.textContent.trim() === '') throw new Error('app did not render')
  })
}

/** Fake timers: move the clock by `ms` (running due timers and the renders they cause). */
export async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function pause() {
  if (vi.isFakeTimers()) return advance(HUMAN_PAUSE_MS)
  await act(async () => {
    await sleep(HUMAN_PAUSE_MS)
  })
}

export async function click(el) {
  fireEvent.click(el)
  await pause()
}

/** Type into a text field (RTL sets the value through React's tracked setter). */
export async function typeInto(el, value) {
  el.focus?.()
  fireEvent.input(el, { target: { value } })
  await pause()
}

/** Pick an option of a <select> by its value (React's onChange on a select listens to `change`; PLAN-5 p5 tier). */
export async function choose(el, value) {
  el.focus?.()
  fireEvent.change(el, { target: { value } })
  await pause()
}

export async function setChecked(el, checked) {
  if (el.checked !== checked) fireEvent.click(el)
  await pause()
}

/** Leave a field like a user tabbing away: real focus, then blur (fires blur + focusout). */
export async function blur(el) {
  act(() => {
    if (document.activeElement !== el) el.focus?.()
    el.blur()
  })
  await pause()
}

/**
 * Press a key: keydown + keyup on `target` (default: the focused element, else <body>); both bubble to document.
 * `init` adds modifiers ({ ctrlKey, metaKey, shiftKey, altKey }). Returns the keydown event (e.g. for defaultPrevented).
 */
export async function pressKey(key, target = document.activeElement || document.body, init = {}) {
  const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(down)
    target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...init }))
  })
  await pause()
  return down
}
