// @vitest-environment jsdom
// PLAN-5 2-U: the sygnal/ui behaviors (Dialog, Popover, Tooltip, Tabs, Accordion, Disclosure) with
// renderComponent: the mock DOM (the default; it records ELEMENT commands without running them,
// so native events such as close / toggle are simulated as the browser sends them) and, for
// keyboard navigation (it reads the DOM order of the items), `dom: 'real'` (jsdom). Fake timers
// for the tooltip delays. The browser suite (browser-tests/src/tests/ui-p5u.jsx) runs the same
// parts in Chromium, Firefox and WebKit with real input.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { dialog, popover, tooltip, tabs, tabsAttrs, accordion, accordionAttrs, disclosure, disclosureAttrs } from '../src/ui.ts'
import {
  Help, dialogHost, Filters, Toolbar, tabsHost, accordionHost, disclosureHost, Cards,
} from './p5-2u-fixtures.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})
const cmds = () => t.commands('ELEMENT').map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v == 'object' && v ? String(v) : v])))
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('dialog', () => {
  it('opens as a modal through ELEMENT and mirrors the close event', async () => {
    t = renderComponent(Help, { strict: true })
    await t.ready()
    expect(t.state.help).toEqual({ open: false, returnValue: '' })
    t.simulateEvent('.open-help', 'click')
    await t.next((s) => s.help.open)
    await t.settle()
    expect(cmds()).toEqual([{ showModal: '.help' }])
    // a second OPEN on an open dialog sends nothing
    t.simulateEvent('.open-help', 'click')
    await t.settle()
    expect(cmds()).toHaveLength(1)
    t.simulateEvent('.save', 'click')
    await t.settle()
    expect(cmds().at(-1)).toEqual({ close: '.help', returnValue: 'saved' })
    t.simulateEvent('.help', 'close', { target: { returnValue: 'saved' } })
    await t.next((s) => !s.help.open)
    expect(t.state.help).toEqual({ open: false, returnValue: 'saved' })
    expect(t.html()).toContain('closed:saved')
    expect(t.actions.map((a) => a.type)).toEqual(expect.arrayContaining(['help.OPEN', 'SAVE', 'help.CLOSED']))
    t.expectNoDiagnostics()
  })

  it('the close option closes with an empty returnValue; Escape (cancel, then close) closes too', async () => {
    t = renderComponent(Help)
    await t.ready()
    t.simulateAction('help.OPEN')
    await t.next((s) => s.help.open)
    t.simulateEvent('.close-help', 'click')
    await t.settle()
    expect(cmds().at(-1)).toEqual({ close: '.help', returnValue: '' })
    t.simulateEvent('.help', 'cancel')
    t.simulateEvent('.help', 'close', { target: { returnValue: '' } })
    await t.next((s) => !s.help.open)
    expect(t.actions.some((a) => a.type == 'help.CANCEL')).toBe(true)
    // CLOSE on a closed dialog sends nothing
    const n = cmds().length
    t.simulateAction('help.CLOSE', 'x')
    await t.settle()
    expect(cmds().filter((c) => 'close' in c)).toHaveLength(cmds().filter((c) => 'close' in c).length)
    expect(cmds().slice(n).some((c) => 'close' in c)).toBe(false)
  })

  it('returnFocus: on close, the trigger is focused only when focus was lost (WebKit, mouse); false turns it off; a selector picks another element', async () => {
    t = renderComponent(dialogHost({}))
    await t.ready()
    t.simulateEvent('.open', 'click')
    await t.next((s) => s.d.open)
    t.simulateEvent('.d', 'close', { target: { returnValue: '' } })
    await t.next((s) => !s.d.open)
    await t.settle()
    expect(cmds().at(-1)).toEqual({ focus: '.open' })
    t.dispose()

    t = renderComponent(dialogHost({ returnFocus: false }))
    await t.ready()
    t.simulateAction('d.OPEN')
    await t.next((s) => s.d.open)
    t.simulateEvent('.d', 'close', { target: { returnValue: '' } })
    await t.next((s) => !s.d.open)
    await t.settle()
    expect(cmds()).toEqual([{ showModal: '.d' }])
    t.dispose()

    t = renderComponent(dialogHost({ returnFocus: '.elsewhere', modal: false }))
    await t.ready()
    t.simulateAction('d.OPEN')
    await t.next((s) => s.d.open)
    t.simulateEvent('.d', 'close', { target: { returnValue: '' } })
    await t.next((s) => !s.d.open)
    await t.settle()
    expect(cmds()).toEqual([{ show: '.d' }, { focus: '.elsewhere' }])
  })

  it('real DOM: the returnFocus command focuses the trigger when focus is on body, and leaves it alone otherwise', async () => {
    t = renderComponent(dialogHost({}), { dom: 'real' })
    await t.ready()
    const cmd = dialog({ dialog: '.d', trigger: '.open' })
    expect(cmd).toBeTruthy()
    t.simulateAction('d.OPEN')
    await t.next((s) => s.d.open)
    t.query('.elsewhere').focus()
    t.simulateEvent('.d', 'close')
    await t.next((s) => !s.d.open)
    await t.settle(); await tick()
    expect(document.activeElement).toBe(t.query('.elsewhere'))
    t.simulateAction('d.OPEN')
    await t.next((s) => s.d.open)
    document.activeElement.blur()
    t.simulateEvent('.d', 'close')
    await t.next((s) => !s.d.open)
    await t.settle(); await tick()
    expect(document.activeElement).toBe(t.query('.open'))
  })

  it('a dialog opened natively (commandfor, toggle event) updates the state; cancelable: false prevents Escape', async () => {
    t = renderComponent(dialogHost({ cancelable: false }), { dom: 'real' })
    await t.ready()
    t.simulateEvent('.d', 'toggle', { newState: 'open', oldState: 'closed' })
    await t.next((s) => s.d.open)
    // toggle 'closed' is left to the close event (it carries the returnValue)
    t.simulateEvent('.d', 'toggle', { newState: 'closed', oldState: 'open' })
    await t.settle()
    expect(t.state.d.open).toBe(true)
    const ev = new Event('cancel', { cancelable: true })
    t.query('.d').dispatchEvent(ev)
    await t.settle()
    expect(ev.defaultPrevented).toBe(true)
  })

  it('the factory ignores an `open` option (the browser owns it)', () => {
    expect(dialog({ dialog: '.d', open: true }).state).toEqual({ open: false, returnValue: '' })
  })
})

describe('popover', () => {
  it('mirrors toggle; CLOSE / OPEN through ELEMENT; popovertarget is an attribute', async () => {
    t = renderComponent(Filters, { strict: true })
    await t.ready()
    expect(t.state.filters).toEqual({ open: false })
    expect(t.html()).toMatch(/<button class="filters-btn" popovertarget="[^"]+-filters">/)
    t.simulateEvent('.filters', 'toggle', { newState: 'open', oldState: 'closed' })
    await t.next((s) => s.filters.open)
    t.simulateEvent('.filters-done', 'click')
    await t.settle()
    expect(cmds()).toEqual([{ hidePopover: '.filters' }])
    t.simulateEvent('.filters', 'toggle', { newState: 'closed', oldState: 'open' })
    await t.next((s) => !s.filters.open)
    // the host's own trigger for the behavior action
    t.simulateEvent('.open-filters', 'click')
    await t.settle()
    expect(cmds().at(-1)).toEqual({ showPopover: '.filters' })
    t.expectNoDiagnostics()
  })
})

describe('tooltip (fake timers)', () => {
  it('shows after the delay on hover, hides after the hide delay', async () => {
    vi.useFakeTimers()
    t = renderComponent(Toolbar, { strict: true })
    await t.ready()
    const start = Date.now()
    t.simulateEvent('.save-btn', 'pointerenter')
    await t.next((s) => s.tip.pending == 'show')
    expect(t.timers()).toEqual([{ name: 'tip.show', after: 500, action: 'tip.SHOW', component: 'Toolbar' }])
    await vi.advanceTimersByTimeAsync(499 - (Date.now() - start))
    expect(cmds()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await t.settle()
    expect(cmds()).toEqual([{ showPopover: '.save-tip' }])
    t.simulateEvent('.save-tip', 'toggle', { newState: 'open' })
    await t.next((s) => s.tip.open)
    t.simulateEvent('.save-btn', 'pointerleave')
    await t.next((s) => s.tip.pending == 'hide')
    expect(t.timers()).toEqual([{ name: 'tip.hide', after: 100, action: 'tip.HIDE', component: 'Toolbar' }])
    await vi.advanceTimersByTimeAsync(100)
    await t.settle()
    expect(cmds().at(-1)).toEqual({ hidePopover: '.save-tip' })
    t.expectNoDiagnostics()
  })

  it('leaving before the delay cancels the show timer', async () => {
    vi.useFakeTimers()
    t = renderComponent(Toolbar)
    await t.ready()
    t.simulateEvent('.save-btn', 'focus')
    await t.next((s) => s.tip.pending == 'show')
    await vi.advanceTimersByTimeAsync(300)
    t.simulateEvent('.save-btn', 'blur')
    await t.next((s) => s.tip.pending == null)
    expect(t.timers()).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(cmds()).toEqual([])
    expect(t.actions.some((a) => a.type == 'tip.SHOW')).toBe(false)
  })

  it('the pointer moving onto the tip keeps it open (WCAG 1.4.13 hoverable)', async () => {
    vi.useFakeTimers()
    t = renderComponent(Toolbar)
    await t.ready()
    t.simulateAction('tip.TOGGLED', true)
    await t.next((s) => s.tip.open)
    t.simulateEvent('.save-btn', 'pointerleave')
    await t.next((s) => s.tip.pending == 'hide')
    t.simulateEvent('.save-tip', 'pointerenter')
    await t.next((s) => s.tip.pending == null)
    await vi.advanceTimersByTimeAsync(500)
    expect(cmds()).toEqual([])
    t.simulateEvent('.save-tip', 'pointerleave')
    await t.next((s) => s.tip.pending == 'hide')
  })

  it('Escape hides an open tip at once; the delays are options', async () => {
    vi.useFakeTimers()
    t = renderComponent(Toolbar)
    await t.ready()
    t.simulateAction('tip.TOGGLED', true)
    await t.next((s) => s.tip.open)
    t.simulateEvent('document', 'keydown', { key: 'Escape' })
    await t.settle()
    expect(cmds()).toEqual([{ hidePopover: '.save-tip' }])
    t.dispose()

    function Quick() { return h('div', null, h('button', { className: 'b', 'aria-describedby': 'q' }, 'B'), h('div', { className: 'q', id: 'q', role: 'tooltip', attrs: { popover: 'manual' } }, 'Q')) }
    Quick.uses = { q: tooltip({ trigger: '.b', tip: '.q', showDelay: 50, hideDelay: 0 }) }
    t = renderComponent(Quick)
    await t.ready()
    t.simulateEvent('.b', 'pointerenter')
    await t.next((s) => s.q.pending == 'show')
    expect(t.timers()[0].after).toBe(50)
  })
})

describe('tabs', () => {
  it('attribute objects: roles, ids from uid, aria-selected / aria-controls / aria-labelledby, roving tabindex, hidden panels', async () => {
    t = renderComponent(tabsHost(), { strict: true })
    await t.ready()
    expect(t.state.tabs).toEqual({ id: 'tabs', selected: null, orientation: 'horizontal' })
    const html = t.html()
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-orientation="horizontal"')
    // no `selected` yet: the first tab rendered is the selected one
    const tab = (v) => t.query(`.tab[data-value="${v}"]`)
    expect(tab('general').getAttribute('aria-selected')).toBe('true')
    expect(tab('general').getAttribute('tabindex')).toBe('0')
    expect(tab('privacy').getAttribute('aria-selected')).toBe('false')
    expect(tab('privacy').getAttribute('tabindex')).toBe('-1')
    const panelId = tab('privacy').getAttribute('aria-controls')
    expect(panelId).toMatch(/-tabs-panel-privacy$/)
    expect(html).toContain(`<section class="panel" id="${panelId}" hidden role="tabpanel" aria-labelledby="${tab('privacy').id}" tabindex="0" data-state="inactive">`)
    expect(tab('general').getAttribute('type')).toBe('button')
    t.expectNoDiagnostics()
  })

  it('a click selects; `selected` sets the start; SELECT takes a value', async () => {
    t = renderComponent(tabsHost({ selected: 'privacy' }))
    await t.ready()
    expect(t.html()).toContain('<p class="selected">privacy</p>')
    t.simulateEvent('.tab', 'click', { within: '.tablist', data: { value: 'advanced' } })
    await t.next((s) => s.tabs.selected == 'advanced')
    t.simulateAction('tabs.SELECT', 'general')
    await t.next((s) => s.tabs.selected == 'general')
    // the same one again: no change
    const n = t.actions.length
    t.simulateAction('tabs.SELECT', 'general')
    await t.settle()
    expect(t.actions.length).toBe(n + 1)
  })

  it('real DOM: arrow keys move the focus and select (automatic activation), wrap, Home / End, skip disabled tabs', async () => {
    t = renderComponent(tabsHost({}, ['advanced']), { dom: 'real' })
    await t.ready()
    const tab = (v) => t.query(`.tab[data-value="${v}"]`)
    tab('general').focus()
    t.simulateEvent('.tab[data-value="general"]', 'keydown', { key: 'ArrowRight' })
    await t.next((s) => s.tabs.selected == 'privacy')
    await t.settle(); await tick()
    expect(document.activeElement).toBe(tab('privacy'))
    expect(tab('privacy').getAttribute('tabindex')).toBe('0')
    // advanced is disabled: ArrowRight wraps to general
    t.simulateEvent('.tab[data-value="privacy"]', 'keydown', { key: 'ArrowRight' })
    await t.next((s) => s.tabs.selected == 'general')
    await t.settle(); await tick()
    expect(document.activeElement).toBe(tab('general'))
    t.simulateEvent('.tab[data-value="general"]', 'keydown', { key: 'End' })
    await t.next((s) => s.tabs.selected == 'privacy')
    t.simulateEvent('.tab[data-value="privacy"]', 'keydown', { key: 'Home' })
    await t.next((s) => s.tabs.selected == 'general')
    // other keys: nothing, and their default is not prevented
    const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    tab('general').dispatchEvent(ev)
    await t.settle()
    expect(ev.defaultPrevented).toBe(false)
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    tab('general').dispatchEvent(arrow)
    await t.next((s) => s.tabs.selected == 'privacy')
    expect(arrow.defaultPrevented).toBe(true)
  })

  it('real DOM: manual activation moves the focus only; vertical uses Up / Down; loop: false stops at the ends', async () => {
    t = renderComponent(tabsHost({ activation: 'manual', orientation: 'vertical', loop: false }), { dom: 'real' })
    await t.ready()
    expect(t.query('.tablist').getAttribute('aria-orientation')).toBe('vertical')
    const tab = (v) => t.query(`.tab[data-value="${v}"]`)
    t.simulateEvent('.tab[data-value="general"]', 'keydown', { key: 'ArrowRight' })
    await t.settle(); await tick()
    expect(document.activeElement).not.toBe(tab('privacy'))
    t.simulateEvent('.tab[data-value="general"]', 'keydown', { key: 'ArrowDown' })
    await t.settle(); await tick()
    expect(document.activeElement).toBe(tab('privacy'))
    expect(t.state.tabs.selected).toBe(null)
    t.simulateEvent('.tab[data-value="general"]', 'keydown', { key: 'ArrowUp' })
    await t.settle(); await tick()
    expect(document.activeElement).toBe(tab('privacy'))
  })

  it('every instance gets its own ids (uid), in a Collection too', async () => {
    t = renderComponent(Cards)
    await t.ready()
    const ids = t.queryAll('.tab').map((b) => b.id)
    expect(new Set(ids).size).toBe(4)
    t.expectNoDiagnostics()
  })

  it('an `id` option names the ids; tabsAttrs works on a missing slice', () => {
    expect(tabs({ tab: '.t', id: 'main' }).state.id).toBe('main')
    const a = tabsAttrs(undefined, (n) => 'u-' + n)
    expect(a.tab('x')).toMatchObject({ id: 'u-tabs-tab-x', role: 'tab', 'aria-selected': true })
    expect(a.tab('y')['aria-selected']).toBe(false)
    expect(a.panel('a b').id).toBe('u-tabs-panel-a_b')
  })
})

describe('accordion', () => {
  it('attribute objects; a click toggles one panel (the other closes)', async () => {
    t = renderComponent(accordionHost(), { strict: true })
    await t.ready()
    expect(t.state.faq).toEqual({ id: 'faq', expanded: [], collapsible: true })
    const trig = (v) => t.query(`.faq-trigger[data-value="${v}"]`)
    expect(trig('ship').getAttribute('aria-expanded')).toBe('false')
    const panel = t.query(`#${trig('ship').getAttribute('aria-controls')}`)
    expect(panel.getAttribute('role')).toBe('region')
    expect(panel.getAttribute('aria-labelledby')).toBe(trig('ship').id)
    expect(panel.hidden).toBe(true)
    t.simulateEvent('.faq-trigger', 'click', { data: { value: 'ship' } })
    await t.next((s) => s.faq.expanded.join() == 'ship')
    expect(t.query('.faq-trigger[data-value="ship"]').getAttribute('aria-expanded')).toBe('true')
    expect(t.query('.faq-trigger[data-value="ship"]').dataset.state).toBe('open')
    t.simulateAction('faq.TOGGLE', 'returns')
    await t.next((s) => s.faq.expanded.join() == 'returns')
    t.simulateAction('faq.TOGGLE', 'returns')
    await t.next((s) => s.faq.expanded.length == 0)
    t.expectNoDiagnostics()
  })

  it('multiple; expanded as a string or array; collapsible: false keeps one open (aria-disabled)', async () => {
    t = renderComponent(accordionHost({ multiple: true, expanded: 'ship' }))
    await t.ready()
    expect(t.state.faq.expanded).toEqual(['ship'])
    t.simulateAction('faq.TOGGLE', 'returns')
    await t.next((s) => s.faq.expanded.join() == 'ship,returns')
    t.simulateAction('faq.COLLAPSE', 'ship')
    await t.next((s) => s.faq.expanded.join() == 'returns')
    t.simulateAction('faq.EXPAND', 'warranty')
    await t.next((s) => s.faq.expanded.join() == 'returns,warranty')
    t.dispose()

    t = renderComponent(accordionHost({ collapsible: false, expanded: ['ship'] }))
    await t.ready()
    expect(t.query('.faq-trigger[data-value="ship"]').getAttribute('aria-disabled')).toBe('true')
    t.simulateAction('faq.TOGGLE', 'ship')
    await t.settle()
    expect(t.state.faq.expanded).toEqual(['ship'])
    t.simulateAction('faq.TOGGLE', 'returns')
    await t.next((s) => s.faq.expanded.join() == 'returns')
    expect(t.query('.faq-trigger[data-value="ship"]').getAttribute('aria-disabled')).toBe(null)
  })

  it('real DOM: Up / Down / Home / End move the focus between the triggers', async () => {
    t = renderComponent(accordionHost(), { dom: 'real' })
    await t.ready()
    const trig = (v) => t.query(`.faq-trigger[data-value="${v}"]`)
    t.simulateEvent('.faq-trigger[data-value="ship"]', 'keydown', { key: 'ArrowDown' })
    await t.settle(); await tick()
    expect(document.activeElement).toBe(trig('returns'))
    t.simulateEvent('.faq-trigger[data-value="returns"]', 'keydown', { key: 'End' })
    await t.settle(); await tick()
    expect(document.activeElement).toBe(trig('warranty'))
    t.simulateEvent('.faq-trigger[data-value="warranty"]', 'keydown', { key: 'ArrowDown' })
    await t.settle(); await tick()
    expect(document.activeElement).toBe(trig('ship'))
    expect(t.state.faq.expanded).toEqual([])
  })

  it('accordionAttrs on a missing slice', () => {
    const a = accordionAttrs(undefined, (n) => n)
    expect(a.trigger('x')).toMatchObject({ id: 'accordion-trigger-x', 'aria-expanded': false, 'aria-controls': 'accordion-panel-x', type: 'button' })
    expect(accordion({ trigger: '.x', expanded: 'a' }).state.expanded).toEqual(['a'])
  })
})

describe('disclosure', () => {
  it('a click toggles; attribute objects; `open` starts it open; OPEN / CLOSE', async () => {
    t = renderComponent(disclosureHost(), { strict: true })
    await t.ready()
    expect(t.state.more).toEqual({ id: 'more', open: false })
    const btn = () => t.query('.more-toggle')
    expect(btn().getAttribute('aria-expanded')).toBe('false')
    expect(btn().getAttribute('aria-controls')).toBe(t.query('.more-panel').id)
    expect(t.query('.more-panel').hidden).toBe(true)
    t.simulateEvent('.more-toggle', 'click')
    await t.next((s) => s.more.open)
    expect(btn().getAttribute('aria-expanded')).toBe('true')
    expect(t.query('.more-panel').hidden).toBe(false)
    expect(t.query('.more-panel').dataset.state).toBe('open')
    t.simulateAction('more.CLOSE')
    await t.next((s) => !s.more.open)
    const n = t.actions.length
    t.simulateAction('more.CLOSE')
    await t.settle()
    expect(t.state.more.open).toBe(false)
    expect(t.actions.length).toBe(n + 1)
    t.expectNoDiagnostics()
    t.dispose()

    t = renderComponent(disclosureHost({ open: true }))
    await t.ready()
    expect(t.query('.more-panel').hidden).toBe(false)
    expect(disclosureAttrs(undefined, (n) => n).trigger['aria-controls']).toBe('disclosure-panel')
    expect(disclosure({ trigger: '.x' }).state).toEqual({ id: null, open: false })
  })
})

describe('popover factory', () => {
  it('ignores an `open` option', () => {
    expect(popover({ popover: '.p', open: true }).state).toEqual({ open: false })
    expect(tooltip({ trigger: '.a', tip: '.b', open: true, pending: 'show' }).state).toEqual({ open: false, pending: null })
  })
})
