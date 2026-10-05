// @vitest-environment jsdom
// PLAN-5 3-F: Toaster fixes (review 2-S). G-428 a focusout with no relatedTarget while the focus
// is still in the region (the window lost the focus) keeps it paused; G-426 in a shadow root the
// focus is the root's activeElement (the document's is the host); G-432 a re-parent with the
// focus inside keeps where the focus came from.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/index.js'
import run from '../src/extra/run.js'
import { toasterApp } from './p5-2u-fixtures.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
const regionPaused = () => document.querySelector('.toaster').hasAttribute('data-paused')

describe('G-428: a focusout with no relatedTarget', () => {
  it('real DOM: while the Dismiss button still has the focus (a window blur), the region stays paused', async () => {
    HTMLElement.prototype.showPopover ||= function () {}
    t = renderComponent(toasterApp(), { dom: 'real' })
    await t.ready()
    t.simulateEvent('.notify', 'click')
    await t.settle()
    const b = t.query('.toast-dismiss')
    b.focus()
    await t.settle()
    expect(regionPaused()).toBe(true)
    // what a window blur sends: the button stays the document's activeElement
    b.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    await t.settle()
    expect(document.activeElement).toBe(b)
    expect(regionPaused()).toBe(true)
    // the focus really leaves: not paused
    b.blur()
    await t.settle()
    expect(regionPaused()).toBe(false)
  })
})

const inShadow = async () => {
  HTMLElement.prototype.showPopover ||= function () {}
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  const mountPoint = document.createElement('div')
  root.appendChild(mountPoint)
  const app = run(toasterApp(), {}, { mountPoint })
  await new Promise((r) => setTimeout(r, 60))
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)]
  return { app, root, host, $, $$, wait: (ms = 30) => new Promise((r) => setTimeout(r, ms)) }
}

describe('G-426: a region in a shadow root', () => {
  it('a mutation while a Dismiss button has the focus sends no false focusout (the region stays paused)', async () => {
    const { app, root, host, $, $$, wait } = await inShadow()
    $('.notify').click()
    await wait()
    $$('.toast-dismiss')[0].focus()
    await wait()
    expect(document.activeElement).toBe(host)
    expect(root.activeElement).toBe($$('.toast-dismiss')[0])
    expect($('.toaster').hasAttribute('data-paused')).toBe(true)
    // another toast: the region's MutationObserver runs
    $('.plain').click()
    await wait(60)
    expect($$('.toast')).toHaveLength(2)
    expect($('.toaster')._f).toBe(1)
    expect($('.toaster').hasAttribute('data-paused')).toBe(true)
    app.dispose()
  })

  it('Dismiss with the focus on it moves the focus to the next toast', async () => {
    const { app, root, $, $$, wait } = await inShadow()
    $('.notify').click()
    $('.notify-error').click()
    await wait()
    const [b1, b2] = $$('.toast-dismiss')
    b1.focus()
    b1.click()
    expect(root.activeElement).toBe(b2)
    app.dispose()
  })
})
