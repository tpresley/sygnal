// Sygnal-arm harness for the hidden acceptance tests.
//
// The tests boot the app exactly the way the browser does: they create
// <div id="root">, then import src/main.js (which calls run(App, drivers), so
// any custom drivers the agent registered are included). Everything is driven
// through real DOM events in jsdom, so the full view -> DOM driver -> intent ->
// model -> view loop is exercised, including selector wiring and isolation
// boundaries. Nothing here touches Sygnal internals or test utilities, so the
// same tests keep working across framework refactors.
//
// Interaction helpers are async and pause HUMAN_PAUSE_MS afterwards; always
// await them. Under fake timers (vi.useFakeTimers(), the ergo tier) the pause
// advances the fake clock by HUMAN_PAUSE_MS instead of sleeping, and advance(ms)
// moves it further: the app's timers, debounces and renders run on that clock.
import { vi } from 'vitest'
import { sleep, waitFor, HUMAN_PAUSE_MS } from './queries.js'

export * from './queries.js'

const rendered = () => {
  const root = document.body.firstElementChild
  if (!root || root.textContent.trim() === '') throw new Error('app did not render')
}

export async function mountApp() {
  document.body.innerHTML = '<div id="root"></div>'
  vi.resetModules()
  await import('../src/main.js')
  if (vi.isFakeTimers()) {
    for (let i = 0; i < 100; i++) {
      await vi.advanceTimersByTimeAsync(10)
      try {
        rendered()
        break
      } catch {}
    }
    rendered()
    await vi.advanceTimersByTimeAsync(HUMAN_PAUSE_MS)
  } else {
    await waitFor(rendered)
  }
}

/** Fake timers: move the clock by `ms` (running due timers and the renders they cause). */
export async function advance(ms) {
  await vi.advanceTimersByTimeAsync(ms)
}

async function pause() {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(HUMAN_PAUSE_MS)
  else await sleep(HUMAN_PAUSE_MS)
}

export async function click(el) {
  el.click()
  await pause()
}

/** Type into a text field: set the value and fire `input` (and `change`). */
export async function typeInto(el, value) {
  el.focus?.()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await pause()
}

/** Toggle a checkbox like a user would: el.click() fires click, input and change. */
export async function setChecked(el, checked) {
  if (el.checked !== checked) el.click()
  await pause()
}

/** Leave a field like a user tabbing away: real focus, then blur (fires blur + focusout). */
export async function blur(el) {
  if (document.activeElement !== el) el.focus?.()
  el.blur()
  await pause()
}

/**
 * Press a key: keydown + keyup on `target` (default: the focused element, else <body>); both bubble to document.
 * `init` adds modifiers ({ ctrlKey, metaKey, shiftKey, altKey }). Returns the keydown event (e.g. for defaultPrevented).
 */
export async function pressKey(key, target = document.activeElement || document.body, init = {}) {
  const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(down)
  target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...init }))
  await pause()
  return down
}
