// @vitest-environment jsdom
// PLAN-5 3-I G-458: the Toaster forgets where the focus came from when the focus comes back from
// nowhere by a press in the region (a click on the page had taken it): dismissing the last toast
// then doesn't focus (and scroll to) an element the user left long ago. A focus from nowhere
// without a press (G-432: a re-parent, a modal that closed) still keeps it. (Real engines:
// browser-tests ui-p5u.jsx.)
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/index.js'
import { toasterApp } from './p5-2u-fixtures.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

const start = async () => {
  HTMLElement.prototype.showPopover ||= function () {}
  t = renderComponent(toasterApp(), { dom: 'real' })
  await t.ready()
  t.simulateEvent('.notify', 'click')
  await t.settle()
  const plain = t.query('.plain'), b = t.query('.toast-dismiss')
  // into the region from .plain
  plain.focus()
  b.focus()
  return { plain, b }
}

describe('G-458: where the focus came from', () => {
  it('back from nowhere by a press in the region (a click on the page took the focus): forgotten', async () => {
    const { plain, b } = await start()
    // a click on the page: the focus goes to body
    b.blur()
    b.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    b.focus()
    b.click()
    expect(document.activeElement).toBe(document.body)
    expect(plain).not.toBe(document.activeElement)
  })

  it('back from nowhere without a press (G-432): kept', async () => {
    const { plain, b } = await start()
    b.blur()
    b.focus()
    b.click()
    expect(document.activeElement).toBe(plain)
  })

  it('a press that focused nothing (WebKit) leaves no mark: a later focus from nowhere keeps it', async () => {
    const { plain, b } = await start()
    b.blur()
    t.query('.toast-text').dispatchEvent(new Event('pointerdown', { bubbles: true }))
    t.query('.toast-text').click()
    b.focus()
    b.click()
    expect(document.activeElement).toBe(plain)
  })

  // PLAN-5 3-N G-499: a press that neither focused nor clicked (released outside, a touch scroll,
  // a right-click) leaves no mark either: a later return from nowhere (a modal closed) keeps it
  it('3-N G-499: a press released outside, a focus from nowhere over a second later: kept', async () => {
    const { plain, b } = await start()
    b.blur()
    const down = new Event('pointerdown', { bubbles: true })
    Object.defineProperty(down, 'timeStamp', { value: down.timeStamp - 2000 })
    b.dispatchEvent(down)
    b.focus()
    b.click()
    expect(document.activeElement).toBe(plain)
  })

  it('3-N G-499: a press the browser cancelled (a touch scroll), then a focus from nowhere: kept', async () => {
    const { plain, b } = await start()
    b.blur()
    b.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    b.dispatchEvent(new Event('pointercancel', { bubbles: true }))
    b.focus()
    b.click()
    expect(document.activeElement).toBe(plain)
  })
})
