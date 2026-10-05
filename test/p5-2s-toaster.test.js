// @vitest-environment jsdom
// PLAN-5 2-S: Toaster fixes (review 2-U). G-398 automatic ids in their own namespace, ids
// compared as strings; G-399 the pointer and the focus pause apart, a removed focused Dismiss
// button doesn't leave the region paused, the focus moves on after Dismiss; G-404 a region in a
// shadow root watches that root's dialogs (the modal move itself needs a browser: ui-p5u.jsx).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { Toaster } from '../src/ui.ts'
import { toasterApp } from './p5-2u-fixtures.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
const texts = () => t.queryAll('.toast-text').map((e) => e.textContent)
const ids = () => t.state.toasts.map((x) => x.id)
const paused = () => t.query('.toaster').hasAttribute('data-paused')

describe('G-398: toast ids', () => {
  it("automatic ids ('t1', 't2', …) never meet a user's id; 7 and '7' are one toast; DISMISS compares as strings", async () => {
    t = renderComponent(Toaster)
    await t.ready()
    t.simulateAction('TOAST', { id: 2, text: 'upload', timeoutMs: 0 })
    t.simulateAction('TOAST', 'first auto')
    t.simulateAction('TOAST', 'second auto')
    await t.settle()
    expect(ids()).toEqual([2, 't1', 't2'])
    expect(texts()).toEqual(['upload', 'first auto', 'second auto'])
    t.simulateAction('TOAST', { id: '7', text: 'str seven' })
    t.simulateAction('TOAST', { id: 7, text: 'num seven' })
    await t.settle()
    expect(t.state.toasts.filter((x) => '' + x.id === '7').map((x) => x.text)).toEqual(['num seven'])
    expect(texts()).toContain('num seven')
    expect(texts()).not.toContain('str seven')
    t.simulateAction('DISMISS', '2')
    t.simulateAction('DISMISS', 7)
    await t.settle()
    expect(ids()).toEqual(['t1', 't2'])
    // a user id that looks automatic: the next automatic one skips it
    t.simulateAction('TOAST', { id: 't3', text: 'mine' })
    t.simulateAction('TOAST', 'third auto')
    await t.settle()
    expect(ids()).toEqual(['t1', 't2', 't3', 't4'])
  })
})

describe('G-399: pausing', () => {
  it('pointer and focus apart: the pointer leaving while the focus is in keeps it paused (and the other way)', async () => {
    vi.useFakeTimers()
    t = renderComponent(toasterApp())
    await t.ready()
    t.simulateEvent('.notify-quick', 'click')
    await t.settle()
    t.simulateEvent('.toaster', 'focusin')
    t.simulateEvent('.toaster', 'pointerover')
    await t.settle()
    expect(paused()).toBe(true)
    t.simulateEvent('.toaster', 'pointerout')
    await t.settle()
    expect(paused()).toBe(true)
    expect(t.timers()).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(texts()).toEqual(['Copied'])
    t.simulateEvent('.toaster', 'pointerover')
    t.simulateEvent('.toaster', 'focusout')
    await t.settle()
    expect(paused()).toBe(true)
    t.simulateEvent('.toaster', 'pointerout')
    await t.settle()
    expect(paused()).toBe(false)
    expect(t.timers().map((x) => x.after)).toEqual([400])
  })

  it('real DOM: a focused Dismiss button removed some other way (TOAST_DISMISS) does not leave the region paused', async () => {
    HTMLElement.prototype.showPopover ||= function () {}
    t = renderComponent(toasterApp(), { dom: 'real' })
    await t.ready()
    t.simulateEvent('.notify', 'click')
    await t.settle()
    t.query('.toast-dismiss').focus()
    await t.settle()
    const st = () => document.querySelector('.toaster').hasAttribute('data-paused')
    expect(st()).toBe(true)
    t.simulateEvent('.clear', 'click')
    await t.settle()
    await new Promise((r) => setTimeout(r, 300)) // the leave transition, then the removal
    await t.settle()
    expect(document.querySelectorAll('.toast')).toHaveLength(0)
    expect(st()).toBe(false)
  })

  it('real DOM: Dismiss with the focus on it moves the focus to the next toast, then back where it came from', async () => {
    HTMLElement.prototype.showPopover ||= function () {}
    t = renderComponent(toasterApp(), { dom: 'real' })
    await t.ready()
    t.simulateEvent('.notify', 'click')
    t.simulateEvent('.notify-quick', 'click')
    await t.settle()
    const after = t.query('.plain')
    after.focus()
    const [b1, b2] = t.queryAll('.toast-dismiss')
    b1.focus()
    b1.click()
    expect(document.activeElement).toBe(b2)
    await t.settle()
    b2.click()
    expect(document.activeElement).toBe(after)
    await t.settle()
    await new Promise((r) => setTimeout(r, 300))
    await t.settle()
    expect(document.querySelector('.toaster').hasAttribute('data-paused')).toBe(false)
  })
})

describe('G-404: a region in a shadow root', () => {
  it("observes its root (where a sygnal/element app's dialogs are) as well as the document", async () => {
    HTMLElement.prototype.showPopover ||= function () {}
    const seen = []
    const orig = MutationObserver.prototype.observe
    vi.spyOn(MutationObserver.prototype, 'observe').mockImplementation(function (n, o) { seen.push(n); return orig.call(this, n, o) })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    const mountPoint = document.createElement('div')
    root.appendChild(mountPoint)
    const { default: run } = await import('../src/extra/run.js')
    function App() { return h('div', null, h('dialog', { className: 'modal' }), h(Toaster, {})) }
    const app = run(App, {}, { mountPoint })
    await new Promise((r) => setTimeout(r, 60))
    expect(root.querySelector('.toaster')).not.toBe(null)
    expect(seen).toContain(root)
    expect(seen).toContain(document.body)
    app.dispose()
  })
})
