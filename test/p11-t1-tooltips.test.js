// @vitest-environment jsdom
// PLAN-11 T-1: tooltips(), every tooltip of a component as one behavior (one slice, two timers),
// each trigger naming its tip with aria-describedby. Real DOM (jsdom) so the events carry their
// elements; ELEMENT commands are recorded (t.commands). The browser suite runs it with real input.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { tooltips } from '../src/ui.ts'

const TERMS = ['MVI', 'Driver', 'Sink']
function Glossary() {
  return h('p', null, ...TERMS.flatMap((term) => [
    h('button', { className: 'term', 'aria-describedby': 'tip-' + term }, term),
    h('span', { className: 'term-tip', id: 'tip-' + term, role: 'tooltip', attrs: { popover: 'manual' } }, term + ' means…'),
  ]))
}
Glossary.uses = { tips: tooltips({ trigger: '.term', tip: '.term-tip' }) }

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})
const cmds = () => t.commands('ELEMENT').flatMap((c) => [].concat(c)).map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])))
const term = (n) => `.term[aria-describedby="tip-${n}"]`
const tip = (n) => `#tip-${n}`

describe('tooltips (one behavior for many triggers)', () => {
  it('one slice and one pair of timers; shows the hovered term\'s tip after the delay, hides it after', async () => {
    vi.useFakeTimers()
    t = renderComponent(Glossary, { dom: 'real', strict: true })
    await t.ready()
    expect(t.state.tips).toEqual({ id: null, open: null, pending: null, hover: false, focus: false, pressed: false })
    t.simulateEvent(term('Driver'), 'pointerenter')
    await t.waitForState((s) => s.tips.pending == 'show')
    expect(t.state.tips.id).toBe('tip-Driver')
    expect(t.timers()).toEqual([{ name: 'tips.show', after: 500, action: 'tips.SHOW', component: 'Glossary' }])
    await vi.advanceTimersByTimeAsync(500)
    await t.settle()
    expect(cmds()).toEqual([{ showPopover: '[id="tip-Driver"]' }])
    t.simulateEvent(tip('Driver'), 'toggle', { newState: 'open' })
    await t.waitForState((s) => s.tips.open == 'tip-Driver')
    t.simulateEvent(term('Driver'), 'pointerleave')
    await t.waitForState((s) => s.tips.pending == 'hide')
    await vi.advanceTimersByTimeAsync(100)
    await t.settle()
    expect(cmds().at(-1)).toEqual({ hidePopover: '[id="tip-Driver"]' })
    t.expectNoDiagnostics()
  })

  it('moving to another term while a tip shows switches at once', async () => {
    vi.useFakeTimers()
    t = renderComponent(Glossary, { dom: 'real' })
    await t.ready()
    t.simulateEvent(term('MVI'), 'focus')
    await t.waitForState((s) => s.tips.pending == 'show')
    await vi.advanceTimersByTimeAsync(500)
    t.simulateEvent(tip('MVI'), 'toggle', { newState: 'open' })
    await t.waitForState((s) => s.tips.open == 'tip-MVI')
    t.simulateEvent(term('MVI'), 'blur')
    t.simulateEvent(term('Sink'), 'focus')
    await t.waitForState((s) => s.tips.id == 'tip-Sink')
    await t.settle()
    expect(t.state.tips.pending).toBe(null)
    expect(cmds().slice(-2)).toEqual([{ hidePopover: '[id="tip-MVI"]' }, { showPopover: '[id="tip-Sink"]' }])
  })

  it('a leave of another term changes nothing; the pointer on the tip keeps it open; Escape hides', async () => {
    vi.useFakeTimers()
    t = renderComponent(Glossary, { dom: 'real' })
    await t.ready()
    t.simulateAction('tips.TOGGLED', { id: 'tip-Sink', open: true })
    t.simulateAction('tips.ENTER', { via: 'hover', id: 'tip-Sink' })
    await t.waitForState((s) => s.tips.open == 'tip-Sink' && s.tips.hover)
    t.simulateEvent(term('MVI'), 'pointerleave')
    await t.settle()
    expect(t.state.tips.pending).toBe(null)
    t.simulateEvent(term('Sink'), 'pointerleave')
    await t.waitForState((s) => s.tips.pending == 'hide')
    t.simulateEvent(tip('Sink'), 'pointerenter')
    await t.settle()
    expect(t.state.tips).toMatchObject({ pending: null, hover: true, open: 'tip-Sink' })
    t.simulateEvent('document', 'keydown', { key: 'Escape' })
    await t.settle()
    expect(cmds().at(-1)).toEqual({ hidePopover: '[id="tip-Sink"]' })
  })
})
