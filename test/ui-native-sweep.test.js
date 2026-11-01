// @vitest-environment jsdom
// The sygnal/ui native parts driven from the host's own state (ui-sweep, dev-plans/research/ui-sweep/native.md):
// an accordion whose `expanded` a host reducer writes (numbers, a single value, a slice without
// `collapsible`), with renderComponent's real DOM.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { accordion, accordionAttrs, dialog, popover, tooltip, tooltips } from '../src/ui.ts'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})

// an accordion over `state.items` (ids as given); each test's SET reducer writes the slice
const host = (options = {}, items = [{ id: 1 }, { id: 2 }, { id: 12 }]) => {
  function Faq({ state, uid }) {
    const a = accordionAttrs(state.faq, uid)
    return h('div', null,
      h('button', { className: 'set' }, 'Set'),
      ...state.items.map((f) => h('div', null,
        h('button', { className: 'trig', ...a.trigger(f.id) }, String(f.id)),
        h('div', { className: 'panel', ...a.panel(f.id) }, 'p' + f.id))))
  }
  Faq.initialState = { items }
  Faq.uses = { faq: accordion({ trigger: '.trig', ...options }) }
  Faq.intent = ({ DOM }) => ({ SET: DOM.click('.set') })
  return Faq
}
const shown = () => t.queryAll('.panel').filter((p) => !p.hidden).map((p) => p.textContent)
const set = async () => {
  t.simulateEvent('.set', 'click')
  await t.settle()
}

describe('accordion driven from host state', () => {
  it('numbers in `expanded` open their panels, and a click on an open one closes it', async () => {
    const Faq = host()
    Faq.model = { SET: (s) => ({ ...s, faq: { ...s.faq, expanded: [2] } }) }
    t = renderComponent(Faq, { dom: 'real' })
    await t.ready()
    await set()
    expect(shown()).toEqual(['p2'])
    expect(t.query('.trig[data-value="2"]').getAttribute('aria-expanded')).toBe('true')
    t.query('.trig[data-value="2"]').click()
    await t.settle()
    expect(shown()).toEqual([])
    expect(t.state.faq.expanded).toEqual([])
  })

  it('a single value in `expanded` is that one panel, not every value containing it', async () => {
    const Faq = host()
    Faq.model = { SET: (s) => ({ ...s, faq: { ...s.faq, expanded: '12' } }) }
    t = renderComponent(Faq, { dom: 'real' })
    await t.ready()
    await set()
    expect(shown()).toEqual(['p12'])
    t.query('.trig[data-value="1"]').click()
    await t.settle()
    expect(t.state.faq.expanded).toEqual(['1'])
  })

  it('collapsible: false holds after a host reducer replaces the slice without it', async () => {
    const Faq = host({ collapsible: false, expanded: 1 })
    Faq.model = { SET: (s) => ({ ...s, faq: { expanded: ['2'] } }) }
    t = renderComponent(Faq, { dom: 'real' })
    await t.ready()
    await set()
    expect(t.state.faq.collapsible).toBe(false)
    expect(t.query('.trig[data-value="2"]').getAttribute('aria-disabled')).toBe('true')
    t.query('.trig[data-value="2"]').click()
    await t.settle()
    expect(shown()).toEqual(['p2'])
  })

  it('a host entry vetoes a toggle with props.previousState (ABORT keeps the behavior\'s update)', async () => {
    const Faq = host()
    Faq.model = { 'faq.TOGGLE': (s, v, _n, { previousState }) => (v == '2' ? previousState : s) }
    t = renderComponent(Faq, { dom: 'real' })
    await t.ready()
    t.query('.trig[data-value="2"]').click()
    await t.settle()
    expect(shown()).toEqual([])
    t.query('.trig[data-value="1"]').click()
    await t.settle()
    expect(shown()).toEqual(['p1'])
  })
})

// ── ui-sweep R2: a controlled `open` (Radix's open / onOpenChange) ────────────────────────
// `state.d.open` is the source of truth: a host reducer that writes it opens or closes the
// element; the element's own changes come back as actions, and a host entry for one of them that
// keeps `open: true` keeps it open. renderComponent's `dom: 'real'` fakes showModal / close / the
// popover methods on jsdom.
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms))

const dialogHost = (options = {}, extra = {}) => {
  function D({ state }) {
    return h('div', null,
      h('button', { className: 'open' }, 'Open'),
      h('button', { className: 'set-open' }, 'Set open'),
      h('dialog', { className: 'd', 'aria-label': 'D' },
        h('form', { method: 'dialog' },
          h('input', { className: 'name', 'aria-label': 'Name' }),
          h('button', { className: 'ok', value: 'ok' }, 'OK')),
        h('button', { className: 'set-closed' }, 'Set closed')),
      h('p', { className: 'out' }, `${state.d.open}:${state.d.returnValue}`))
  }
  D.initialState = { dirty: false }
  D.uses = { d: dialog({ dialog: '.d', trigger: '.open', ...options }) }
  D.intent = ({ DOM }) => ({ SET_OPEN: DOM.click('.set-open'), SET_CLOSED: DOM.click('.set-closed') })
  D.model = {
    SET_OPEN: (s) => ({ ...s, d: { ...s.d, open: true } }),
    SET_CLOSED: (s) => ({ ...s, d: { ...s.d, open: false, returnValue: 'by-host' } }),
    ...extra,
  }
  return D
}
const dlg = () => t.query('.d')
const escape = () => dlg().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
// the submit event a click on OK sends (jsdom doesn't submit method="dialog" forms)
const submit = () => {
  const e = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: t.query('.ok') })
  t.query('form').dispatchEvent(e)
  return e
}

describe('dialog: a controlled open (R2)', () => {
  it('a host reducer writing open: true / false opens and closes the dialog', async () => {
    t = renderComponent(dialogHost(), { dom: 'real' })
    await t.ready()
    t.query('.set-open').click()
    await t.settle(); await tick()
    expect(dlg().open).toBe(true)
    expect(t.actions.map((a) => a.type)).toEqual(['INITIALIZE', 'SET_OPEN', 'd.APPLY'])
    t.query('.set-closed').click()
    await t.settle(); await tick()
    expect(dlg().open).toBe(false)
    expect(dlg().returnValue).toBe('by-host')
    expect(t.state.d).toEqual({ open: false, returnValue: 'by-host' })
  })

  it('the open option opens it at the start', async () => {
    t = renderComponent(dialogHost({ open: true }), { dom: 'real' })
    await t.ready()
    await t.settle(); await tick()
    expect(dlg().open).toBe(true)
    expect(t.state.d.open).toBe(true)
  })

  it('Escape (the keydown: closedby="none") closes through the state; a host entry that keeps it open wins', async () => {
    t = renderComponent(dialogHost({}, { 'd.CANCEL': (_s, _e, _n, { previousState }) => previousState }), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await t.settle(); await tick()
    // (OPEN gave the modal dialog closedby="none": Escape is the keydown)
    expect(dlg().getAttribute('closedby')).toBe('none')
    escape()
    await t.settle(); await tick()
    expect(t.actions.map((a) => a.type)).toContain('d.CANCEL')
    expect(dlg().open).toBe(true)
    expect(t.state.d.open).toBe(true)
  })

  it('Escape with nothing refusing it closes the dialog', async () => {
    t = renderComponent(dialogHost(), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await t.settle(); await tick()
    escape()
    await t.settle(); await tick()
    expect(dlg().open).toBe(false)
    expect(t.state.d).toEqual({ open: false, returnValue: '' })
    expect(dlg().hasAttribute('closedby')).toBe(false)
  })

  it('a close the browser did on its own (CLOSED) that the host refuses opens it again', async () => {
    t = renderComponent(dialogHost({}, { 'd.CLOSED': (s) => ({ ...s, d: { ...s.d, open: true } }) }), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await t.settle(); await tick()
    dlg().close('native')
    await t.settle(); await tick()
    expect(dlg().open).toBe(true)
    expect(t.state.d.open).toBe(true)
  })

  it('a method="dialog" form submit is a CLOSE with the submitter\'s value (prevented, then closed by the model)', async () => {
    t = renderComponent(dialogHost(), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await t.settle(); await tick()
    submit()
    await t.settle(); await tick()
    expect(t.actions.map((a) => a.type)).toContain('d.CLOSE')
    expect(dlg().open).toBe(false)
    expect(t.state.d).toEqual({ open: false, returnValue: 'ok' })
    expect(dlg().returnValue).toBe('ok')
  })

  it('a host entry refusing the form submit keeps the dialog open', async () => {
    t = renderComponent(dialogHost({}, { 'd.CLOSE': (s, _rv, _n, { previousState }) => previousState }), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await t.settle(); await tick()
    expect(submit().defaultPrevented).toBe(true)
    await t.settle(); await tick()
    expect(dlg().open).toBe(true)
  })

  it('commandfor commands (show-modal, close, request-close) go through the model', async () => {
    t = renderComponent(dialogHost(), { dom: 'real' })
    await t.ready()
    const command = (name, value) => {
      const e = new Event('command', { cancelable: true })
      Object.defineProperties(e, { command: { value: name }, source: { value: Object.assign(document.createElement('button'), { value: value ?? '' }) } })
      dlg().dispatchEvent(e)
      return e
    }
    const e = command('show-modal')
    await t.settle(); await tick()
    expect(e.defaultPrevented).toBe(true)
    expect(dlg().open).toBe(true)
    command('close', 'done')
    await t.settle(); await tick()
    expect(t.state.d).toEqual({ open: false, returnValue: 'done' })
    command('show-modal')
    await t.settle(); await tick()
    command('request-close')
    await t.settle(); await tick()
    expect(t.actions.map((a) => a.type).filter((x) => x.startsWith('d.'))).toEqual(['d.OPEN', 'd.CLOSE', 'd.CLOSED', 'd.OPEN', 'd.CANCEL', 'd.CLOSED'])
    // a custom command is the host's
    expect(command('--other').defaultPrevented).toBe(false)
  })
})

describe('popover: a controlled open (R2)', () => {
  const popHost = (extra = {}) => {
    function P({ state }) {
      return h('div', null,
        h('button', { className: 'set' }, 'Set'),
        h('div', { className: 'p', attrs: { popover: 'auto' }, 'aria-label': 'P' }, 'x'),
        h('p', { className: 'out' }, String(state.p.open)))
    }
    P.uses = { p: popover({ popover: '.p' }) }
    P.intent = ({ DOM }) => ({ SET: DOM.click('.set') })
    P.model = { SET: (s) => ({ ...s, p: { open: !s.p.open } }), ...extra }
    return P
  }
  // (jsdom has no :popover-open: the commands sent; the browser suite checks the popover)
  const sent = () => t.commands('ELEMENT').map((c) => Object.keys(c)[0])

  it('a host reducer writing open shows it (hiding: the browser suite)', async () => {
    t = renderComponent(popHost(), { dom: 'real' })
    await t.ready()
    t.query('.set').click()
    await t.settle(); await tick()
    expect(sent()).toEqual(['showPopover'])
    expect(t.actions.map((a) => a.type)).toEqual(['INITIALIZE', 'SET', 'p.APPLY'])
  })

  it('a light dismiss the host refuses (TOGGLED) shows it again', async () => {
    t = renderComponent(popHost({ 'p.TOGGLED': (s) => ({ ...s, p: { open: true } }) }), { dom: 'real' })
    await t.ready()
    t.query('.set').click()
    await t.settle(); await tick()
    t.simulateEvent('.p', 'toggle', { newState: 'closed', oldState: 'open' })
    await t.settle(); await tick()
    expect(t.state.p.open).toBe(true)
    expect(sent().at(-1)).toBe('showPopover')
  })
})

// ── ui-sweep R3: a press on the trigger hides the tooltip (Radix) ─────────────────────────
describe('tooltip: a press on the trigger hides it until the pointer comes back (R3)', () => {
  function Bar({ uid }) {
    return h('div', null,
      h('button', { className: 'save', 'aria-describedby': uid('tip') }, 'Save'),
      h('div', { className: 'tip', id: uid('tip'), role: 'tooltip', attrs: { popover: 'manual' } }, 'Save the draft'))
  }
  Bar.uses = { tip: tooltip({ trigger: '.save', tip: '.tip' }) }

  it('pointerdown hides a shown tip at once; hovering on does not show it again; leaving and coming back does', async () => {
    vi.useFakeTimers()
    t = renderComponent(Bar)
    await t.ready()
    t.simulateEvent('.save', 'pointerenter')
    await vi.advanceTimersByTimeAsync(500)
    t.simulateEvent('.tip', 'toggle', { newState: 'open', oldState: 'closed' })
    await t.next((s) => s.tip.open)
    t.simulateEvent('.save', 'pointerdown')
    await t.next((s) => s.tip.pressed)
    expect(t.commands('ELEMENT').map((c) => Object.keys(c)[0]).at(-1)).toBe('hidePopover')
    t.simulateEvent('.tip', 'toggle', { newState: 'closed', oldState: 'open' })
    await t.next((s) => !s.tip.open)
    t.simulateEvent('.save', 'pointerenter')
    await vi.advanceTimersByTimeAsync(800)
    expect(t.state.tip.pending).toBe(null)
    expect(t.timers()).toEqual([])
    t.simulateEvent('.save', 'pointerleave')
    await t.next((s) => !s.tip.pressed)
    t.simulateEvent('.save', 'pointerenter')
    await t.next((s) => s.tip.pending == 'show')
  })

  it('a press before the show delay cancels it', async () => {
    vi.useFakeTimers()
    t = renderComponent(Bar)
    await t.ready()
    t.simulateEvent('.save', 'pointerenter')
    await t.next((s) => s.tip.pending == 'show')
    t.simulateEvent('.save', 'pointerdown')
    await t.next((s) => s.tip.pending == null)
    await vi.advanceTimersByTimeAsync(800)
    expect(t.actions.map((a) => a.type)).not.toContain('tip.SHOW')
  })
})

describe('tooltips: a press on a trigger hides its tip (R3)', () => {
  function Terms() {
    return h('p', null, ...['a', 'b'].flatMap((n) => [
      h('button', { className: 'term', 'aria-describedby': 'tip-' + n }, n),
      h('span', { className: 'term-tip', id: 'tip-' + n, role: 'tooltip', attrs: { popover: 'manual' } }, n),
    ]))
  }
  Terms.uses = { tips: tooltips({ trigger: '.term', tip: '.term-tip' }) }

  it('pointerdown hides it; another trigger still shows its own', async () => {
    vi.useFakeTimers()
    t = renderComponent(Terms, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.term[aria-describedby="tip-a"]', 'pointerenter')
    await vi.advanceTimersByTimeAsync(500)
    // (dom: 'real': the fake showPopover sends the toggle event)
    await t.waitForState((s) => s.tips.open == 'tip-a')
    t.simulateEvent('.term[aria-describedby="tip-a"]', 'pointerdown')
    await t.next((s) => s.tips.pressed)
    expect(String(Object.values(t.commands('ELEMENT').flatMap((c) => [].concat(c)).at(-1))[0])).toBe('[id="tip-a"]')
    t.simulateEvent('.term[aria-describedby="tip-b"]', 'pointerenter')
    await t.next((s) => s.tips.id == 'tip-b' && !s.tips.pressed)
  })
})

// ── ui-sweep round 3: controlled parts dismiss through the state (Radix DismissableLayer) ─────
// A dialog / popover with its `open` option given is controlled: no browser light dismiss (a
// manual popover, closedby="none"); Escape, a press outside and a focus outside come as the
// close request (popover DISMISS, dialog CANCEL) from the layer stack (src/ui/layers.ts), top
// layer first. (jsdom has no :popover-open, so APPLY sends showPopover again after an open: the
// actions are read without APPLY, the commands for hidePopover; the browser suite checks frames.)
describe('controlled popover: dismissed through the state (round 3)', () => {
  const pop = (extra = {}, opts = {}, inner = null) => {
    function P({ state }) {
      return h('div', null,
        h('button', { className: 'btn', attrs: { popovertarget: 'pp' } }, 'Open'),
        h('button', { className: 'outside' }, 'Out'),
        h('div', { className: 'p', id: 'pp', attrs: { popover: 'auto' }, 'aria-label': 'P' },
          h('button', { className: 'inside' }, 'In'),
          inner && h('button', { className: 'cbtn', attrs: { popovertarget: 'cc' } }, 'Child'),
          inner && h('div', { className: 'c', id: 'cc', attrs: { popover: 'auto' }, 'aria-label': 'C' }, h('button', { className: 'cin' }, 'x'))),
        h('p', { className: 'out' }, String(state.p.open)))
    }
    P.initialState = { pinned: false }
    P.uses = { p: popover({ popover: '.p', open: false, ...opts }), ...(inner && { c: popover({ popover: '.c', open: false }) }) }
    P.model = { ...extra }
    return P
  }
  const sent = () => [...new Set(t.commands('ELEMENT').map((c) => Object.keys(c)[0]))]
  const types = () => t.actions.map((a) => a.type).filter((a) => !a.endsWith('.APPLY'))
  const down = (el) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true }))
  const esc = (el = document.body) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  const step = async () => { await t.settle(); await tick() }
  const open = async (sel = '.btn') => { t.query(sel).click(); await step() }

  it('its popovertarget button opens it through the model (prevented), as a manual popover', async () => {
    t = renderComponent(pop(), { dom: 'real' })
    await t.ready()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    t.query('.btn').dispatchEvent(click)
    await step()
    expect(click.defaultPrevented).toBe(true)
    expect(types()).toEqual(['INITIALIZE', 'p.TOGGLE'])
    expect(sent()).toEqual(['showPopover'])
    expect(t.query('.p').getAttribute('popover')).toBe('manual')
    expect(t.state.p.open).toBe(true)
  })

  it('a press outside and Escape dismiss it (DISMISS, data: the event); a press inside or on its button does not', async () => {
    t = renderComponent(pop(), { dom: 'real' })
    await t.ready()
    await open()
    down(t.query('.inside'))
    down(t.query('.btn'))
    await step()
    expect(types()).toEqual(['INITIALIZE', 'p.TOGGLE'])
    down(t.query('.outside'))
    await step()
    expect(types().at(-1)).toBe('p.DISMISS')
    expect(t.actions.at(-1).data.type).toBe('pointerdown')
    expect(t.state.p.open).toBe(false)
    expect(sent().at(-1)).toBe('hidePopover')
    await open()
    esc()
    await step()
    expect(t.actions.at(-1).data.key).toBe('Escape')
    expect(t.state.p.open).toBe(false)
  })

  it('a refused dismiss never hides it: no hide command, no closing toggle', async () => {
    t = renderComponent(pop({ 'p.DISMISS': (s, _e, _n, { previousState }) => previousState }), { dom: 'real' })
    await t.ready()
    await open()
    const toggles = []
    t.query('.p').addEventListener('toggle', (e) => toggles.push(e.newState))
    down(t.query('.outside'))
    await step()
    esc()
    await step()
    t.query('.outside').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await step()
    expect(types().filter((a) => a == 'p.DISMISS')).toHaveLength(3)
    expect(t.state.p.open).toBe(true)
    expect(sent()).toEqual(['showPopover'])
    expect(toggles).toEqual([])
  })

  it('a touch press outside dismisses at the click after it (a scroll gesture, no click, doesn\'t)', async () => {
    t = renderComponent(pop(), { dom: 'real' })
    await t.ready()
    await open()
    const touch = () => t.query('.outside').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    touch()
    await step()
    expect(t.state.p.open).toBe(true)
    touch()
    t.query('.outside').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await step()
    expect(t.state.p.open).toBe(false)
    expect(t.actions.at(-1).data.type).toBe('pointerdown')
  })

  it('an Escape an element handled (defaultPrevented) is not a dismiss', async () => {
    t = renderComponent(pop(), { dom: 'real' })
    await t.ready()
    await open()
    t.query('.inside').addEventListener('keydown', (e) => e.preventDefault())
    esc(t.query('.inside'))
    await step()
    expect(t.state.p.open).toBe(true)
  })

  it('nested: Escape and a press on the parent close the child only; a press outside both closes both', async () => {
    t = renderComponent(pop({}, {}, true), { dom: 'real' })
    await t.ready()
    await open()
    await open('.cbtn')
    expect([t.state.p.open, t.state.c.open]).toEqual([true, true])
    esc(t.query('.cin'))
    await step()
    expect([t.state.p.open, t.state.c.open]).toEqual([true, false])
    await open('.cbtn')
    down(t.query('.cin'))
    await step()
    expect([t.state.p.open, t.state.c.open]).toEqual([true, true])
    down(t.query('.inside'))
    await step()
    expect([t.state.p.open, t.state.c.open]).toEqual([true, false])
    await open('.cbtn')
    down(t.query('.outside'))
    await step()
    expect([t.state.p.open, t.state.c.open]).toEqual([false, false])
  })

  it('without the open option it stays on the browser\'s light dismiss (no DISMISS, popover="auto")', async () => {
    function U({ state }) {
      return h('div', null,
        h('button', { className: 'btn', attrs: { popovertarget: 'uu' } }, 'Open'),
        h('button', { className: 'outside' }, 'Out'),
        h('div', { className: 'p', id: 'uu', attrs: { popover: 'auto' } }, 'x'),
        h('p', null, String(state.p.open)))
    }
    U.uses = { p: popover({ popover: '.p' }) }
    t = renderComponent(U, { dom: 'real' })
    await t.ready()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    t.query('.btn').dispatchEvent(click)
    down(t.query('.outside'))
    esc()
    await step()
    expect(click.defaultPrevented).toBe(false)
    expect(types()).toEqual(['INITIALIZE'])
    expect(t.query('.p').getAttribute('popover')).toBe('auto')
  })
})

describe('controlled dialog: dismissed through the state (round 3)', () => {
  const dlgHost = (opts = {}, extra = {}, attrs = {}, inner = false) => {
    function D({ state }) {
      return h('div', null,
        h('button', { className: 'open' }, 'Open'),
        h('button', { className: 'outside' }, 'Out'),
        h('dialog', { className: 'd', attrs, 'aria-label': 'D' },
          h('button', { className: 'in' }, 'In'),
          inner && h('button', { className: 'pbtn', attrs: { popovertarget: 'dp' } }, 'Menu'),
          inner && h('div', { className: 'p', id: 'dp', attrs: { popover: 'auto' } }, h('button', { className: 'pin' }, 'x'))),
        h('p', null, String(state.d.open)))
    }
    D.uses = { d: dialog({ dialog: '.d', trigger: '.open', ...opts }), ...(inner && { p: popover({ popover: '.p', open: false }) }) }
    D.model = { ...extra }
    return D
  }
  const types = () => t.actions.map((a) => a.type)
  const step = async () => { await t.settle(); await tick() }
  const esc = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  const down = (el, x = 0) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: x }))

  it('Escape comes from the layer stack as CANCEL; closedby="none" while open, the host\'s back after', async () => {
    t = renderComponent(dlgHost({ open: false }, {}, { closedby: 'closerequest' }), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await step()
    expect(t.query('.d').open).toBe(true)
    expect(t.query('.d').getAttribute('closedby')).toBe('none')
    // (closerequest: a press outside is not a dismiss)
    down(t.query('.d'), 5)
    await step()
    expect(t.state.d.open).toBe(true)
    esc(t.query('.in'))
    await step()
    expect(types().filter((a) => a == 'd.CANCEL')).toHaveLength(1)
    expect(t.query('.d').open).toBe(false)
    expect(t.query('.d').getAttribute('closedby')).toBe('closerequest')
  })

  it('closedby="any": a press on the backdrop (outside its box) is a CANCEL; a refused one leaves it open, never closed', async () => {
    t = renderComponent(dlgHost({ open: false }, { 'd.CANCEL': (s, _e, _n, { previousState }) => previousState }, { closedby: 'any' }), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await step()
    let closes = 0
    t.query('.d').addEventListener('close', () => closes++)
    down(t.query('.d'), 5)
    await step()
    esc(t.query('.in'))
    await step()
    expect(types().filter((a) => a == 'd.CANCEL')).toHaveLength(2)
    expect([t.state.d.open, t.query('.d').open, closes]).toEqual([true, true, 0])
  })

  it('a controlled popover inside an uncontrolled dialog takes the first Escape and the press on the dialog', async () => {
    t = renderComponent(dlgHost({}, {}, {}, true), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await step()
    t.query('.pbtn').click()
    await step()
    expect([t.state.d.open, t.state.p.open]).toEqual([true, true])
    esc(t.query('.pin'))
    await step()
    expect([t.state.d.open, t.state.p.open]).toEqual([true, false])
    expect(types()).not.toContain('d.CANCEL')
    t.query('.pbtn').click()
    await step()
    down(t.query('.in'), 5)
    await step()
    expect([t.state.d.open, t.state.p.open]).toEqual([true, false])
    esc(t.query('.in'))
    await step()
    expect(t.state.d.open).toBe(false)
  })
})
