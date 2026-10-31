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
