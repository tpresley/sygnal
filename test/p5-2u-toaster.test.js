// @vitest-environment jsdom
// PLAN-5 2-U (T-1, D198): the sygnal/ui <Toaster>. TOAST over EVENTS from anywhere, Collection
// items with a `timers` static for auto-dismiss (fake timers, no TIMER driver needed in tests),
// a Dismiss button, persistent role="status" / role="alert" regions, pause on hover / focus.
// The re-parenting into an open modal <dialog> needs a real browser (top layer, :modal): the
// browser suite (browser-tests/src/tests/ui-p5u.jsx) runs the 0-S4 matrix in three engines;
// here jsdom checks that the region's hooks are harmless without it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent, event } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { Toaster } from '../src/ui.ts'
import { toasterApp } from './p5-2u-fixtures.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const texts = (sel = '.toast') => t.queryAll(sel).map((e) => e.querySelector('.toast-text').textContent)
const region = (html, role) => {
  const i = html.indexOf(`role="${role}"`)
  return html.slice(i, html.indexOf('</div></div>', i))
}

describe('Toaster', () => {
  it('TOAST over EVENTS adds a toast; its Dismiss button removes it', async () => {
    t = renderComponent(toasterApp(), { strict: true })
    await t.ready()
    expect(t.html()).toContain('<section class="toaster" aria-label="Notifications" popover="manual">')
    t.simulateEvent('.notify', 'click')
    await t.settle()
    expect(texts()).toEqual(['Saved'])
    expect(t.emitted.map((e) => e.type)).toContain('TOAST')
    const toast = t.query('.toast')
    expect(toast.dataset.kind).toBe('success')
    expect(t.html()).toContain('aria-label="Dismiss: Saved"')
    t.simulateEvent('.toast-dismiss', 'click')
    await t.settle()
    expect(texts()).toEqual([])
    t.expectNoDiagnostics()
  })

  it('errors go to the role="alert" region, the rest to role="status" (both always rendered)', async () => {
    t = renderComponent(toasterApp())
    await t.ready()
    expect(t.html()).toContain('role="status" aria-live="polite"')
    expect(t.html()).toContain('role="alert"')
    t.simulateEvent('.notify', 'click')
    t.simulateEvent('.notify-error', 'click')
    await t.settle()
    const html = t.html()
    expect(region(html, 'status')).toContain('Saved')
    expect(region(html, 'status')).not.toContain('Upload failed')
    expect(region(html, 'alert')).toContain('Upload failed')
  })

  it('auto-dismiss through the item timers (fake timers); timeoutMs 0 stays; a string is the text', async () => {
    vi.useFakeTimers()
    t = renderComponent(toasterApp())
    await t.ready()
    t.simulateEvent('.notify-quick', 'click') // 400 ms
    t.simulateEvent('.notify', 'click') // 0: stays
    t.simulateEvent('.plain', 'click') // 'Hello': info, 5000 ms
    await t.settle()
    expect(texts()).toEqual(['Copied', 'Saved', 'Hello'])
    expect(t.timers().map((x) => `${x.component}.${x.name}:${x.after}:${x.action}`).sort())
      .toEqual(['ToastItem.expire:400:EXPIRE', 'ToastItem.expire:5000:EXPIRE'])
    await vi.advanceTimersByTimeAsync(300)
    expect(texts()).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(150)
    await t.settle()
    expect(texts()).toEqual(['Saved', 'Hello'])
    await vi.advanceTimersByTimeAsync(5000)
    await t.settle()
    expect(texts()).toEqual(['Saved'])
  })

  it('a TOAST with the id of a shown one replaces it in place and restarts its timer; TOAST_DISMISS removes one or all', async () => {
    vi.useFakeTimers()
    t = renderComponent(toasterApp())
    await t.ready()
    t.simulateEvent('.notify', 'click')
    t.simulateEvent('.saving', 'click')
    await t.settle()
    expect(texts()).toEqual(['Saved', 'Saving…'])
    expect(t.timers()).toEqual([])
    t.simulateEvent('.saved', 'click')
    await t.settle()
    expect(texts()).toEqual(['Saved', 'Saved'])
    expect(t.queryAll('.toast').map((e) => e.dataset.kind)).toEqual(['success', 'success'])
    expect(t.timers().map((x) => x.after)).toEqual([300])
    await vi.advanceTimersByTimeAsync(200)
    t.simulateEvent('.saved', 'click') // again: the timer starts over
    await t.settle()
    await vi.advanceTimersByTimeAsync(200)
    expect(texts()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(100)
    await t.settle()
    expect(texts()).toEqual(['Saved'])
    t.simulateEvent('.saving', 'click')
    t.simulateEvent('.notify-error', 'click')
    await t.settle()
    expect(texts()).toHaveLength(3)
    t.simulateEvent('.clear', 'click')
    await t.settle()
    expect(texts()).toEqual([])
  })

  it('pauses while hovered or focused (timers stop, then start over); pauseOnHover={false} turns it off', async () => {
    vi.useFakeTimers()
    t = renderComponent(toasterApp())
    await t.ready()
    t.simulateEvent('.notify-quick', 'click')
    await t.settle()
    await vi.advanceTimersByTimeAsync(300)
    t.simulateEvent('.toaster', 'pointerover')
    await t.settle()
    expect(t.query('.toaster').dataset.paused).toBe('')
    expect(t.timers()).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(texts()).toEqual(['Copied'])
    t.simulateEvent('.toaster', 'pointerout')
    await t.settle()
    expect(t.timers().map((x) => x.after)).toEqual([400])
    t.simulateEvent('.toaster', 'focusin')
    await t.settle()
    expect(t.timers()).toEqual([])
    t.simulateEvent('.toaster', 'focusout')
    await t.settle()
    await vi.advanceTimersByTimeAsync(400)
    await t.settle()
    expect(texts()).toEqual([])
    t.dispose()

    t = renderComponent(toasterApp({ pauseOnHover: false }))
    await t.ready()
    t.simulateEvent('.notify-quick', 'click')
    await t.settle()
    t.simulateEvent('.toaster', 'pointerover')
    await t.settle()
    expect(t.timers().map((x) => x.after)).toEqual([400])
  })

  it('props: label, dismissLabel, className; bound to a slice with state="toaster"', async () => {
    function App() { return h('div', null, h('button', { className: 'go' }, 'Go'), h(Toaster, { state: 'toaster', label: 'Alerts', dismissLabel: 'Close', className: 'corner' })) }
    App.initialState = {}
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: { EVENTS: event('TOAST', { text: 'Done', kind: 'warning' }) } }
    t = renderComponent(App)
    await t.ready()
    expect(t.state.toaster).toEqual({ toasts: [], next: 1, paused: false, hover: false, focus: false })
    t.simulateEvent('.go', 'click')
    await t.settle()
    expect(t.state.toaster.toasts).toEqual([{ id: 't1', kind: 'warning', text: 'Done', timeoutMs: 5000, paused: false, rev: 0 }])
    const html = t.html()
    expect(html).toContain('class="toaster corner" aria-label="Alerts"')
    expect(html).toContain('aria-label="Close: Done"')
    expect(html).toContain('>Close</button>')
  })

  it('real DOM (jsdom: no popover API, no :modal): renders and dismisses without errors', async () => {
    t = renderComponent(toasterApp(), { dom: 'real' })
    await t.ready()
    t.simulateEvent('.notify', 'click')
    await t.settle()
    expect(t.queryAll('.toast')).toHaveLength(1)
    expect(t.query('.toaster').__sygnalHome).toBe(t.query('.toaster-home'))
    t.simulateEvent('.toast-dismiss', 'click')
    await t.settle()
    await new Promise((r) => setTimeout(r, 250)) // the leave transition (duration 200)
    expect(t.queryAll('.toast')).toHaveLength(0)
    t.expectNoDiagnostics()
  })
})
