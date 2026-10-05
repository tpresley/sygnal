// @vitest-environment jsdom
// PLAN-5 3-F: Toaster fixes (review 2-S). G-428 a focusout with no relatedTarget while the focus
// is still in the region (the window lost the focus) keeps it paused.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/index.js'
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
