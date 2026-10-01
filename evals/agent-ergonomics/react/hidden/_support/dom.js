// React-arm harness for the hidden acceptance tests. Same exported API as the
// Sygnal arm's hidden/_support/dom.js, so the test files are identical.
//
// mountApp() renders the default export of src/App.jsx with
// @testing-library/react; interactions go through RTL's fireEvent (wrapped in
// act) so React's controlled inputs see real value changes.
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
  await waitFor(() => {
    if (document.body.textContent.trim() === '') throw new Error('app did not render')
  })
}

async function pause() {
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

/** Press a key: keydown + keyup on `target` (default: the focused element, else <body>); both bubble to document. */
export async function pressKey(key, target = document.activeElement || document.body) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
  })
  await pause()
}
