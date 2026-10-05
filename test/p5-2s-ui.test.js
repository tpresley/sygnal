// @vitest-environment jsdom
// PLAN-5 2-S: sygnal/ui fixes (review 2-U). G-397 tabs whose selected tab was removed;
// G-400 / G-406 dialog and popover commands gated on the element's real state, and their state
// kept in sync when the element goes; G-403 tooltip hover and focus tracked apart, touch
// ignored, one document listener for Escape; G-405 dialog cancelable: false; G-407 Dialog
// returnFocus to the element that opened it, ids without collisions, a host reducer dropping the
// keyed() prefix.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent, Switchable, xs } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { dialog, popover, tooltip, tabs, tabsAttrs, disclosure, disclosureAttrs } from '../src/ui.ts'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})
const cmds = () => t.commands('ELEMENT').map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v == 'object' && v ? String(v) : v])))

// ── G-397: closable tabs ─────────────────────────────────────────────
const DOCS = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }]
const closable = (withValues) => {
  function Editor({ state, uid }) {
    const a = tabsAttrs(state.tabs, uid, withValues ? state.docs.map((d) => d.id) : undefined)
    return h('div', null,
      h('div', { className: 'tablist', ...a.list, 'aria-label': 'Files' },
        ...state.docs.map((d) => h('span', { className: 'wrap' },
          h('button', { className: 'tab', ...a.tab(d.id) }, d.title),
          h('button', { className: 'close', 'data-value': d.id }, 'x')))),
      ...state.docs.map((d) => h('section', { className: 'panel', ...a.panel(d.id) }, d.title)))
  }
  Editor.uses = { tabs: tabs({ tab: '.tab', selected: 'b' }) }
  Editor.initialState = { docs: DOCS }
  Editor.intent = ({ DOM }) => ({ CLOSE: DOM.click('.close').data('value') })
  Editor.model = {
    // the documented pattern: re-select a neighbour, move the focus to it (the close button is gone)
    CLOSE: {
      STATE: (s, v) => {
        const i = s.docs.findIndex((d) => d.id === v), docs = s.docs.filter((d) => d.id !== v)
        const next = s.tabs.selected === v ? (docs[Math.min(i, docs.length - 1)]?.id ?? null) : s.tabs.selected
        return { ...s, docs, tabs: { ...s.tabs, selected: next } }
      },
      ELEMENT: (s, v) => {
        const i = s.docs.findIndex((d) => d.id === v), docs = s.docs.filter((d) => d.id !== v)
        const next = docs[Math.min(i, docs.length - 1)]
        return next ? { focus: `.tab[data-value="${next.id}"]` } : undefined
      },
    },
    DROP: (s, v) => ({ ...s, docs: s.docs.filter((d) => d.id !== v) }),
  }
  return Editor
}

describe('G-397: tabs', () => {
  it('tabsAttrs with the values: a selected value that is not one of them shows the first selected', () => {
    const a = tabsAttrs({ id: 't', selected: 'gone' }, null, ['x', 'y'])
    expect(a.tab('x')['aria-selected']).toBe(true)
    expect(a.tab('x').tabindex).toBe('0')
    expect(a.panel('x').hidden).toBe(false)
    expect(a.tab('y')['aria-selected']).toBe(false)
    expect(a.panel('y').hidden).toBe(true)
    // a selected one that is there wins; numbers compare as strings
    expect(tabsAttrs({ selected: 2 }, null, [1, 2]).tab(2)['aria-selected']).toBe(true)
    // no values, no selection: the first rendered (as before)
    const b = tabsAttrs({ selected: null }, null)
    expect(b.tab('p')['aria-selected']).toBe(true)
    expect(b.tab('q')['aria-selected']).toBe(false)
  })

  it('a host reducer that drops the selected tab: the first tab is selected, focusable, its panel shown', async () => {
    t = renderComponent(closable(true))
    await t.ready()
    expect(t.query('.tab[data-value="b"]').getAttribute('aria-selected')).toBe('true')
    t.simulateAction('DROP', 'b')
    await t.settle()
    expect(t.state.tabs.selected).toBe('b')
    const tab = t.query('.tab[data-value="a"]')
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(tab.getAttribute('tabindex')).toBe('0')
    expect(t.queryAll('.panel').filter((p) => !p.hasAttribute('hidden')).map((p) => p.textContent)).toEqual(['A'])
  })

  it('without the values a removed selection leaves no tab focusable (why to pass them)', async () => {
    t = renderComponent(closable(false))
    await t.ready()
    t.simulateAction('DROP', 'b')
    await t.settle()
    expect(t.queryAll('.tab').map((e) => e.getAttribute('tabindex'))).toEqual(['-1', '-1'])
  })

  it('the documented close reducer re-selects the neighbour and moves the focus to it', async () => {
    t = renderComponent(closable(true))
    await t.ready()
    t.simulateEvent('.close', 'click', { within: '.wrap:nth-child(2)', data: { value: 'b' } })
    await t.settle()
    expect(t.state.tabs.selected).toBe('c')
    expect(cmds()).toEqual([{ focus: '.tab[data-value="c"]' }])
    expect(t.query('.tab[data-value="c"]').getAttribute('aria-selected')).toBe('true')
  })
})

// ── jsdom has no <dialog> methods and no Popover API: stand-ins that keep `open` / :popover-open
// and send close / toggle as the browser does (toggle in a task)
let restore = []
afterEach(() => { restore.reverse().forEach((f) => f()); restore = [] })
const stub = (o, k, v) => { const d = Object.getOwnPropertyDescriptor(o, k); restore.push(() => (d ? Object.defineProperty(o, k, d) : delete o[k])); Object.defineProperty(o, k, { configurable: true, writable: true, value: v }) }
const calls = []
function fakeDialogs() {
  calls.length = 0
  const P = HTMLDialogElement.prototype
  stub(P, 'showModal', function () { calls.push('showModal'); this.setAttribute('open', '') })
  stub(P, 'show', function () { calls.push('show'); this.setAttribute('open', '') })
  stub(P, 'close', function (rv) {
    calls.push('close')
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    if (rv !== undefined) this.returnValue = rv
    this.dispatchEvent(new Event('close'))
  })
}
function fakePopovers() {
  calls.length = 0
  const E = Element.prototype, H = HTMLElement.prototype, m = E.matches
  stub(E, 'matches', function (s) { return s == ':popover-open' ? !!this._pop : m.call(this, s) })
  const set = (el, on) => { el._pop = on; setTimeout(() => el.dispatchEvent(Object.assign(new Event('toggle'), { newState: on ? 'open' : 'closed' }))) }
  stub(H, 'showPopover', function () { calls.push('showPopover'); if (this._pop) throw new Error('already open'); set(this, true) })
  stub(H, 'hidePopover', function () { calls.push('hidePopover'); if (!this._pop) throw new Error('not open'); set(this, false) })
}
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('G-400: a dialog / popover unmounted while open', () => {
  const pages = (Page) => {
    function PageB() { return h('p', { className: 'b' }, 'B') }
    function App({ state }) { return h('main', null, h('button', { className: 'go' }, 'go'), h(Switchable, { of: { a: Page, b: PageB }, current: state.page })) }
    App.initialState = { page: 'a' }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: (s) => ({ ...s, page: s.page == 'a' ? 'b' : 'a' }) }
    return App
  }

  it('dialog: a Switchable page change while it is open, then back: it opens again', async () => {
    fakeDialogs()
    function PageA({ state }) {
      return h('div', null, h('button', { className: 'open' }, 'Open'), h('dialog', { className: 'd', 'aria-label': 'D' }, 'x'), h('p', { className: 'out' }, String(state.d.open)))
    }
    PageA.uses = { d: dialog({ dialog: '.d', trigger: '.open' }) }
    t = renderComponent(pages(PageA), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await t.settle(); await wait()
    expect(t.query('.d').hasAttribute('open')).toBe(true)
    t.query('.go').click()
    await t.settle(); await wait()
    expect(t.query('.d')).toBe(null)
    t.query('.go').click()
    await t.settle(); await wait()
    expect(t.query('.d').hasAttribute('open')).toBe(false)
    // the state followed the dialog away (SYNC), and OPEN opens it again
    expect(t.query('.out').textContent).toBe('false')
    t.query('.open').click()
    await t.settle(); await wait()
    expect(t.query('.d').hasAttribute('open')).toBe(true)
    expect(calls.filter((c) => c == 'showModal')).toHaveLength(2)
    expect(t.query('.out').textContent).toBe('true')
  })

  it('dialog: the commands check the dialog (no second showModal on an open one, no close on a closed one)', async () => {
    fakeDialogs()
    function D({ state }) { return h('div', null, h('dialog', { className: 'd', 'aria-label': 'D' }, 'x'), h('p', { className: 'out' }, String(state.d.open))) }
    D.uses = { d: dialog({ dialog: '.d' }) }
    t = renderComponent(D, { dom: 'real' })
    await t.ready()
    t.simulateAction('d.OPEN')
    t.simulateAction('d.OPEN')
    await t.settle(); await wait()
    t.simulateAction('d.CLOSE', 'a')
    t.simulateAction('d.CLOSE', 'b')
    await t.settle(); await wait()
    expect(calls).toEqual(['showModal', 'close'])
    expect(t.state.d).toEqual({ open: false, returnValue: 'a' })
  })

  it('popover: a Switchable page change while it is open, then back: OPEN shows it again', async () => {
    fakePopovers()
    function PageA({ state }) {
      return h('div', null, h('div', { className: 'p', attrs: { popover: 'auto' } }, 'x'), h('button', { className: 'show' }), h('p', { className: 'out' }, String(state.p.open)))
    }
    PageA.uses = { p: popover({ popover: '.p' }) }
    PageA.intent = ({ DOM }) => ({ 'p.OPEN': DOM.click('.show') })
    t = renderComponent(pages(PageA), { dom: 'real' })
    await t.ready()
    t.query('.show').click()
    await t.settle(); await wait()
    expect(t.query('.out').textContent).toBe('true')
    t.query('.go').click()
    await t.settle(); await wait()
    t.query('.go').click()
    await t.settle(); await wait()
    expect(t.query('.out').textContent).toBe('false')
    t.query('.show').click()
    await t.settle(); await wait()
    expect(t.query('.p')._pop).toBe(true)
    expect(t.query('.out').textContent).toBe('true')
  })
})

describe('G-406: popover OPEN then CLOSE in one tick', () => {
  it('ends closed (the commands check :popover-open, not the state that follows the toggle event later)', async () => {
    fakePopovers()
    function P({ state }) { return h('div', null, h('div', { className: 'p', attrs: { popover: 'auto' } }, 'x'), h('p', { className: 'out' }, String(state.p.open))) }
    P.uses = { p: popover({ popover: '.p' }) }
    t = renderComponent(P, { dom: 'real' })
    await t.ready()
    t.simulateAction('p.OPEN')
    t.simulateAction('p.CLOSE')
    await t.settle(); await wait(); await t.settle()
    expect(calls).toEqual(['showPopover', 'hidePopover'])
    expect(t.query('.p')._pop).toBe(false)
    expect(t.query('.out').textContent).toBe('false')
    // CLOSE on a closed one and OPEN twice: the browser's methods are called only when they apply
    t.simulateAction('p.CLOSE')
    t.simulateAction('p.OPEN')
    t.simulateAction('p.OPEN')
    await t.settle(); await wait()
    expect(calls).toEqual(['showPopover', 'hidePopover', 'showPopover'])
  })
})

describe('G-405 / G-407: dialog cancelable and returnFocus', () => {
  it('cancelable: false sets closedby="none" when it opens (Chromium closes on a second Escape otherwise)', async () => {
    fakeDialogs()
    function D() { return h('div', null, h('button', { className: 'open' }), h('dialog', { className: 'd', 'aria-label': 'D' }, 'x')) }
    D.uses = { d: dialog({ dialog: '.d', trigger: '.open', cancelable: false }) }
    t = renderComponent(D, { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await t.settle(); await wait()
    expect(t.query('.d').getAttribute('closedby')).toBe('none')
  })

  it('returnFocus goes back to the trigger that opened it, not the first one', async () => {
    fakeDialogs()
    function Rows() {
      return h('div', null,
        h('button', { className: 'edit', 'data-row': '1' }, 'Edit 1'),
        h('button', { className: 'edit', 'data-row': '2' }, 'Edit 2'),
        h('dialog', { className: 'd', 'aria-label': 'D' }, h('button', { className: 'done' }, 'Done')))
    }
    Rows.uses = { d: dialog({ dialog: '.d', trigger: '.edit', close: '.done' }) }
    t = renderComponent(Rows, { dom: 'real' })
    await t.ready()
    const second = t.queryAll('.edit')[1]
    second.click()
    await t.settle(); await wait()
    t.query('.done').focus()
    t.query('.done').click()
    // the browser moves the focus out of the closed dialog (to body here)
    t.query('.done').blur()
    await t.settle(); await wait()
    expect(t.state.d.open).toBe(false)
    expect(document.activeElement).toBe(second)
  })
})

describe('G-407: ids', () => {
  it("values that differ only in whitespace or '_' get different ids", () => {
    const a = tabsAttrs({ id: 'x' }, null)
    expect(a.tab('a b').id).not.toBe(a.tab('a_b').id)
    expect(a.tab('a b').id).not.toMatch(/\s/)
    expect(a.tab('plain-value').id).toBe('x-tab-plain-value')
  })

  it('a host reducer that replaces the slice without its id keeps the ids (the id is derived again)', async () => {
    function More({ state, uid }) {
      const a = disclosureAttrs(state.more, uid)
      return h('div', null, h('button', { className: 'm', ...a.trigger }, 'More'), h('div', { className: 'panel', ...a.panel }, 'x'), h('button', { className: 'reset' }))
    }
    More.uses = { more: disclosure({ trigger: '.m' }) }
    More.intent = ({ DOM }) => ({ RESET: DOM.click('.reset') })
    More.model = { RESET: (s) => ({ ...s, more: { open: true } }) }
    t = renderComponent(More)
    await t.ready()
    const id = t.query('.panel').id
    expect(id).toMatch(/-more-panel$/)
    t.simulateEvent('.reset', 'click')
    await t.settle()
    expect(t.state.more.id).toBe('more')
    expect(t.query('.panel').id).toBe(id)
    expect(t.query('.m').getAttribute('aria-controls')).toBe(id)
  })
})

describe('G-403: tooltip', () => {
  const tipHost = () => {
    function T({ state }) {
      return h('div', null, h('button', { className: 'b', 'aria-describedby': 'q' }, 'B'), h('div', { className: 'q', id: 'q', role: 'tooltip', attrs: { popover: 'manual' } }, 'Q'), h('p', { className: 'out' }, `${state.tip.open}:${state.tip.pending}`))
    }
    T.uses = { tip: tooltip({ trigger: '.b', tip: '.q' }) }
    return T
  }

  it('a touch pointerenter is ignored; the pointer leaving a focused trigger keeps the tip', async () => {
    vi.useFakeTimers()
    t = renderComponent(tipHost())
    await t.ready()
    t.simulateEvent('.b', 'pointerenter', { pointerType: 'touch' })
    await t.settle()
    expect(t.state.tip.pending).toBe(null)
    t.simulateEvent('.b', 'focus')
    t.simulateEvent('.b', 'pointerenter', { pointerType: 'mouse' })
    await t.settle()
    await vi.advanceTimersByTimeAsync(500)
    await t.settle()
    expect(cmds()).toEqual([{ showPopover: '.q' }])
    t.simulateAction('tip.TOGGLED', true)
    await t.next((s) => s.tip.open)
    t.simulateEvent('.b', 'pointerleave', { pointerType: 'mouse' })
    await t.settle()
    expect(t.state.tip).toMatchObject({ open: true, pending: null, hover: false, focus: true })
    t.simulateEvent('.b', 'blur')
    await t.settle()
    expect(t.state.tip.pending).toBe('hide')
    // the focus leaving while the pointer is on it keeps it too
    t.simulateEvent('.b', 'pointerenter')
    t.simulateEvent('.b', 'focus')
    t.simulateEvent('.b', 'blur')
    await t.settle()
    expect(t.state.tip).toMatchObject({ pending: null, hover: true, focus: false })
  })

  it('real DOM: no document keydown listener while no tip is shown; one while one is', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const rm = vi.spyOn(document, 'removeEventListener')
    // the listeners on now (added minus removed)
    const keydowns = () => add.mock.calls.filter((c) => c[0] == 'keydown').length - rm.mock.calls.filter((c) => c[0] == 'keydown').length
    const T = tipHost()
    function Three() {
      return h('div', null, h(T, { state: 'a' }), h(T, { state: 'b' }), h(T, { state: 'c' }))
    }
    Three.initialState = { a: {}, b: {}, c: {} }
    t = renderComponent(Three, { dom: 'real' })
    await t.ready()
    expect(keydowns()).toBe(0)
    t.queryAll('.b')[1].dispatchEvent(new Event('pointerenter'))
    await t.settle()
    expect(keydowns()).toBe(1)
  })
})
