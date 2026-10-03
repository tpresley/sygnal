// @vitest-environment jsdom
// PLAN-4 3-A (GS-2): element commands, the built-in ELEMENT sink. A command is
// { <method>: control | selector, ...options } (the first key is the method, D118), or an array.
// The target resolves in the sending instance's own DOM scope after the next patch; a control
// whose spec object declares `commands` is asked first (D102). SYG640: no match; SYG641: no such
// command. renderComponent records them (t.commands('ELEMENT')); with dom: 'real' they run (jsdom
// gets <dialog>, popover and scrollIntoView fakes).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { ABORT } from '../src/component.js'
import { controls } from '../src/extra/controls.js'
import { renderToString } from '../src/extra/ssr.js'
import { getCodeInfo } from '../src/extra/diagnostics/codes.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
  vi.restoreAllMocks()
})
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const codes = () => t.diagnostics.map(d => d.code)

// ─── components ─────────────────────────────────────────────────────────────

const { Name, Email, Submit } = controls({ Name: 'input', Email: 'input', Submit: 'button' })
const validate = (s) => ({
  ...(s.name ? {} : { name: 'Required' }),
  ...(s.email.includes('@') ? {} : { email: 'Enter an email address' }),
})
const firstInvalid = (errors) => (errors.name ? Name : errors.email ? Email : null)
function Signup({ state }) {
  return h('form', null,
    h(Name, { value: state.name }),
    state.errors.name ? h('p', { className: 'err' }, state.errors.name) : null,
    h(Email, { value: state.email }),
    state.errors.email ? h('p', { className: 'err' }, state.errors.email) : null,
    h(Submit, { type: 'button' }, 'Sign up'))
}
Signup.initialState = { name: 'Ada', email: 'nope', errors: {} }
Signup.intent = ({ DOM }) => ({ SUBMIT: DOM.click(Submit) })
Signup.model = {
  SUBMIT: {
    STATE: (s) => ({ ...s, errors: validate(s) }),
    ELEMENT: (s) => { const field = firstInvalid(validate(s)); return field ? { focus: field } : ABORT },
  },
}

const { HelpDialog, OpenHelp, CloseHelp } = controls({ HelpDialog: 'dialog', OpenHelp: 'button', CloseHelp: 'button' })
function Help({ state }) {
  return h('div', null,
    h(OpenHelp, null, 'Help'),
    h(HelpDialog, null, h('p', null, 'Help text'), h(CloseHelp, null, 'Close')),
    h('p', { className: 'log' }, state.log.join(',')))
}
Help.initialState = { log: [] }
Help.intent = ({ DOM }) => ({
  OPEN_HELP: DOM.click(OpenHelp),
  CLOSE_HELP: DOM.click(CloseHelp),
  HELP_CLOSED: DOM.close(HelpDialog).map(e => e.target.returnValue),
})
Help.model = {
  OPEN_HELP: { ELEMENT: { showModal: HelpDialog } },
  CLOSE_HELP: { ELEMENT: { close: HelpDialog, returnValue: 'done' } },
  HELP_CLOSED: (s, rv) => ({ ...s, log: [...s.log, `closed:${rv}`] }),
}

const { Tip, ShowTip, HideTip } = controls({ Tip: 'div', ShowTip: 'button', HideTip: 'button' })
function Tips({ state }) {
  return h('div', null,
    h(ShowTip, null, 'i'), h(HideTip, null, 'x'),
    h(Tip, { attrs: { popover: 'auto' } }, 'A tip'),
    h('p', { className: 'tip' }, state.tip))
}
Tips.initialState = { tip: 'closed' }
Tips.intent = ({ DOM }) => ({
  SHOW_TIP: DOM.click(ShowTip),
  HIDE_TIP: DOM.click(HideTip),
  TIP_TOGGLED: DOM.toggle(Tip).map(e => e.newState),
})
Tips.model = {
  SHOW_TIP: { ELEMENT: { showPopover: Tip } },
  HIDE_TIP: { ELEMENT: { hidePopover: Tip } },
  TOGGLE_TIP: { ELEMENT: { togglePopover: Tip } },
  FORCE_TIP: { ELEMENT: { togglePopover: Tip, force: true } },
  TIP_TOGGLED: (s, tip) => ({ ...s, tip }),
}

const { RowItem, AddRow } = controls({ RowItem: 'li', AddRow: 'button' })
function Row({ state }) { return h(RowItem, null, state.text) }
Row.model = { BOOTSTRAP: { ELEMENT: (s) => (s.fresh ? { scrollIntoView: RowItem, block: 'nearest' } : ABORT) } }
function Rows({ state }) {
  return h('div', null, h(AddRow, null, 'Add'), h('ul', null, h(Collection, { of: Row, from: 'rows' })))
}
Rows.initialState = { rows: [{ id: 1, text: 'one' }] }
Rows.intent = ({ DOM }) => ({ ADD: DOM.click(AddRow) })
Rows.model = { ADD: (s) => ({ ...s, rows: [...s.rows, { id: s.rows.length + 1, text: `row ${s.rows.length + 1}`, fresh: true }] }) }

// a test-only spec object (D101) with commands (D102); its focus overrides the native one
const opened = []
const dateSpec = {
  kind: 'test-date',
  vnode: (props, children, h) => h('div', { className: 'date' }, h('input', { className: 'inner', value: props.value || '' })),
  commands: {
    open: (el, options) => { opened.push([el, options]) },
    focus: (el) => el.querySelector('input.inner').focus(),
  },
}
const { DueDate, PickDate, FocusDate, CloseDate } = controls({ DueDate: dateSpec, PickDate: 'button', FocusDate: 'button', CloseDate: 'button' })
function Planner() {
  return h('div', null, h(DueDate, { value: '2026-10-03' }), h(PickDate, null, 'Pick'), h(FocusDate, null, 'Focus'), h(CloseDate, null, 'Close'))
}
Planner.initialState = {}
Planner.intent = ({ DOM }) => ({ PICK: DOM.click(PickDate), FOCUS_DATE: DOM.click(FocusDate), CLOSE_DATE: DOM.click(CloseDate) })
Planner.model = {
  PICK: { ELEMENT: { open: DueDate, at: 3 } },
  FOCUS_DATE: { ELEMENT: { focus: DueDate } },
  CLOSE_DATE: { ELEMENT: { close: DueDate } },
}

const { Query, Go } = controls({ Query: 'input', Go: 'button' })
function Search({ state }) { return h('div', null, h(Query, { value: state.q }), h(Go, null, 'Go')) }
Search.initialState = { q: 'sygnal' }
Search.intent = ({ DOM }) => ({ GO: DOM.click(Go) })
Search.model = { GO: { ELEMENT: [{ focus: Query }, { select: Query }] } }

const { Missing, Bad, Field, Edit } = controls({ Missing: 'input', Bad: 'button', Field: 'input', Edit: 'button' })
function Broken() { return h('div', null, h(Bad, null, 'Bad'), h('button', { className: 'gone' }, 'Gone'), h('button', { className: 'typo' }, 'Typo'), h('div', { className: 'plain' }, 'x')) }
Broken.initialState = {}
Broken.intent = ({ DOM }) => ({
  GONE: DOM.click('.gone'),
  TYPO: DOM.click('.typo'),
  NOT_DIALOG: DOM.click(Bad),
})
Broken.model = {
  REMOVE: { ELEMENT: { remove: '.plain' } },
  NOT_A_COMMAND: { ELEMENT: 'focus' },
  GONE: { ELEMENT: { focus: Missing } },
  TYPO: { ELEMENT: { fokus: '.plain' } },
  NOT_DIALOG: { ELEMENT: { showModal: '.plain' } },
}

// each Collection item focuses its own Field (isolation: the sender's scope)
function Item({ state }) { return h('li', null, h(Field, { value: state.text }), h(Edit, null, 'Edit')) }
Item.intent = ({ DOM }) => ({ EDIT: DOM.click(Edit) })
Item.model = { EDIT: { ELEMENT: { focus: Field } } }
function Items() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
Items.initialState = { items: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] }

// any other method of the element runs too (here a form's reset); media: { play: Player }
const { SignupForm, Clear, Player, Play } = controls({ SignupForm: 'form', Clear: 'button', Player: 'video', Play: 'button' })
function Resettable() {
  return h('div', null, h(SignupForm, null, h('input', { className: 'x' })), h(Clear, { type: 'button' }, 'Clear'), h(Player, null), h(Play, null, 'Play'))
}
Resettable.initialState = {}
Resettable.intent = ({ DOM }) => ({ CLEAR: DOM.click(Clear), PLAY: DOM.click(Play) })
Resettable.model = { CLEAR: { ELEMENT: { reset: SignupForm } }, PLAY: { ELEMENT: { play: Player } } }

// a dialog rendered by the same action that opens it
const { LateDialog, Late } = controls({ LateDialog: 'dialog', Late: 'button' })
function LateOpen({ state }) { return h('div', null, h(Late, null, 'Open'), state.show ? h(LateDialog, null, 'Hi') : null) }
LateOpen.initialState = { show: false }
LateOpen.intent = ({ DOM }) => ({ SHOW: DOM.click(Late) })
LateOpen.model = { SHOW: { STATE: (s) => ({ ...s, show: true }), ELEMENT: { showModal: LateDialog } } }

// ─── codes ──────────────────────────────────────────────────────────────────

describe('codes', () => {
  it('SYG640 (warn) and SYG641 (error) are registered', () => {
    expect(getCodeInfo('SYG640')).toBeUndefined() // dev codes: not in the core table
    return import('../src/extra/diagnostics/codes.js').then(({ DEV_CODE_SEVERITY, CODE_TITLES }) => {
      expect(DEV_CODE_SEVERITY.SYG640).toBe('warn')
      expect(DEV_CODE_SEVERITY.SYG641).toBe('error')
      expect(CODE_TITLES.SYG640).toMatch(/target not found/)
      expect(CODE_TITLES.SYG641).toMatch(/Unknown element command/)
    })
  })
})

// ─── mock DOM: recorded, not run ────────────────────────────────────────────

describe('mock DOM: t.commands records the commands sent', () => {
  it('focus the first invalid field after submit', async () => {
    t = renderComponent(Signup)
    await t.ready()
    t.simulateEvent(Submit, 'click')
    await t.waitForState(s => !!s.errors.email)
    expect(t.commands('ELEMENT')).toEqual([{ focus: Email }])
    expect(t.html()).toContain('Enter an email address')
  })

  it('open and close a dialog; its close event reaches intent', async () => {
    t = renderComponent(Help)
    await t.ready()
    t.simulateEvent(OpenHelp, 'click')
    t.simulateEvent(CloseHelp, 'click')
    await t.settle()
    expect(t.commands('ELEMENT')).toEqual([{ showModal: HelpDialog }, { close: HelpDialog, returnValue: 'done' }])
    t.simulateEvent(HelpDialog, 'close', { target: { returnValue: 'done' } })
    await t.waitForState(s => s.log.length > 0)
    expect(t.state.log).toEqual(['closed:done'])
  })

  it('a popover', async () => {
    t = renderComponent(Tips)
    await t.ready()
    t.simulateEvent(ShowTip, 'click')
    t.simulateEvent(HideTip, 'click')
    await t.settle()
    expect(t.commands('ELEMENT')).toEqual([{ showPopover: Tip }, { hidePopover: Tip }])
  })

  it('a new Collection row scrolls itself into view (commands of every instance in the tree)', async () => {
    t = renderComponent(Rows)
    await t.ready()
    t.simulateEvent(AddRow, 'click')
    await t.waitForState(s => s.rows.length == 2)
    await t.settle()
    await wait(30)
    expect(t.commands('ELEMENT')).toEqual([{ scrollIntoView: RowItem, block: 'nearest' }])
  })

  it('a spec command (D102)', async () => {
    t = renderComponent(Planner)
    await t.ready()
    t.simulateEvent(PickDate, 'click')
    await t.settle()
    expect(t.commands('ELEMENT')).toEqual([{ open: DueDate, at: 3 }])
    expect(t.diagnostics).toEqual([])
  })

  it('an array sends each command, in order', async () => {
    t = renderComponent(Search)
    await t.ready()
    t.simulateEvent(Go, 'click')
    await t.settle()
    expect(t.commands('ELEMENT')).toEqual([{ focus: Query }, { select: Query }])
  })

  it('ELEMENT is not a driver sink: no fake source, no SYG609', async () => {
    t = renderComponent(Search, { diagnostics: 'collect' })
    await t.ready()
    expect('ELEMENT' in t.sources).toBe(false)
    t.simulateEvent(Go, 'click')
    await t.settle()
    expect(t.sinkValues('ELEMENT')).toEqual([])
    expect(codes()).not.toContain('SYG609')
  })

  it('SYG641: an unknown method (reported when it is sent)', async () => {
    t = renderComponent(Broken)
    await t.ready()
    t.simulateEvent('.typo', 'click')
    await t.settle()
    expect(t.commands('ELEMENT')).toEqual([{ fokus: '.plain' }])
    const d = t.diagnostics.find(d => d.code == 'SYG641')
    expect(d && d.severity).toBe('error')
    expect(d.message).toMatch(/'fokus' is not an element command \(did you mean 'focus'\?\)/)
  })

  it('other element methods (play, reset...) are accepted: no SYG641', async () => {
    t = renderComponent(Resettable)
    await t.ready()
    t.simulateEvent(Clear, 'click')
    t.simulateEvent(Play, 'click')
    await t.settle()
    expect(t.commands('ELEMENT')).toEqual([{ reset: SignupForm }, { play: Player }])
    expect(codes()).toEqual([])
  })

  it('SYG641 when sent: a method that changes the DOM Sygnal renders, and a value that is not a command', async () => {
    t = renderComponent(Broken)
    await t.ready()
    t.simulateAction('REMOVE')
    t.simulateAction('NOT_A_COMMAND')
    await t.settle()
    expect(codes()).toEqual(['SYG641', 'SYG641'])
    expect(t.diagnostics[0].message).toMatch(/remove\(\) changes the DOM that Broken's view renders/)
    expect(t.diagnostics[1].message).toMatch(/Broken sent "focus" to the ELEMENT sink, which is not a command/)
  })

  it('SYG640: nothing matches the target (after 1 s)', async () => {
    t = renderComponent(Broken)
    await t.ready()
    t.simulateEvent('.gone', 'click')
    await wait(1100)
    const d = t.diagnostics.find(d => d.code == 'SYG640')
    expect(d && d.severity).toBe('warn')
    expect(d.message).toMatch(/matched no element: nothing in Broken's own view matches the control Missing/)
  })

  it('SYG641: a spec control with no such command names the commands it declares', async () => {
    t = renderComponent(Planner)
    await t.ready()
    t.simulateAction('PICK')
    t.simulateEvent(CloseDate, 'click')
    await t.settle()
    // close is native: the mock DOM can't know the element lacks it (the real DOM reports it)
    expect(codes()).not.toContain('SYG641')
  })
})

// ─── real DOM: the commands run ─────────────────────────────────────────────

describe('real DOM (jsdom): the commands run', () => {
  it('focus the first invalid field after submit', async () => {
    t = renderComponent(Signup, { dom: 'real' })
    await t.ready()
    t.simulateEvent(Submit, 'click')
    await t.waitForState(s => !!s.errors.email)
    await t.settle()
    expect(document.activeElement).toBe(t.query(Email))
    expect(t.commands('ELEMENT')).toEqual([{ focus: Email }])
  })

  it('open and close a native <dialog>; close (with its returnValue) reaches intent', async () => {
    t = renderComponent(Help, { dom: 'real' })
    await t.ready()
    expect(t.query(HelpDialog).open).toBe(false)
    t.simulateEvent(OpenHelp, 'click')
    await t.settle()
    expect(t.query(HelpDialog).open).toBe(true)
    t.simulateEvent(CloseHelp, 'click')
    await t.waitForState(s => s.log.length > 0)
    expect(t.query(HelpDialog).open).toBe(false)
    expect(t.state.log).toEqual(['closed:done'])
  })

  it('a popover: show and hide fire toggle', async () => {
    t = renderComponent(Tips, { dom: 'real' })
    await t.ready()
    t.simulateEvent(ShowTip, 'click')
    await t.waitForState(s => s.tip == 'open')
    t.simulateEvent(HideTip, 'click')
    await t.waitForState(s => s.tip == 'closed')
    await t.settle()
    expect(t.query('p.tip').textContent).toBe('closed')
  })

  it('togglePopover toggles; force (an option) keeps it shown', async () => {
    t = renderComponent(Tips, { dom: 'real' })
    await t.ready()
    t.simulateAction('TOGGLE_TIP')
    await t.waitForState(s => s.tip == 'open')
    t.simulateAction('FORCE_TIP')
    await t.settle()
    expect(t.state.tip).toBe('open')
    t.simulateAction('TOGGLE_TIP')
    await t.waitForState(s => s.tip == 'closed')
  })

  it('a new Collection row scrolls itself into view', async () => {
    t = renderComponent(Rows, { dom: 'real' })
    await t.ready()
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    t.simulateEvent(AddRow, 'click')
    await t.waitForState(s => s.rows.length == 2)
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.instances[0]).toBe(t.queryAll(RowItem)[1])
    expect(spy.mock.calls[0][0]).toEqual({ block: 'nearest' })
  })

  it('a spec command gets the host element and the options; a spec focus overrides the native one', async () => {
    opened.length = 0
    t = renderComponent(Planner, { dom: 'real' })
    await t.ready()
    t.simulateEvent(PickDate, 'click')
    await t.settle()
    expect(opened).toEqual([[t.query(DueDate), { at: 3 }]])
    t.simulateEvent(FocusDate, 'click')
    await t.settle()
    expect(document.activeElement).toBe(t.query('input.inner'))
    expect(t.diagnostics).toEqual([])
  })

  it('an array runs each command, in order', async () => {
    t = renderComponent(Search, { dom: 'real' })
    await t.ready()
    const calls = []
    const input = t.query(Query)
    vi.spyOn(input, 'focus').mockImplementation(function () { calls.push('focus') })
    vi.spyOn(input, 'select').mockImplementation(function () { calls.push('select') })
    t.simulateEvent(Go, 'click')
    await t.settle()
    expect(calls).toEqual(['focus', 'select'])
  })

  it('a command with no state change still runs (no patch: on the fallback)', async () => {
    t = renderComponent(Help, { dom: 'real' })
    await t.ready()
    t.simulateEvent(OpenHelp, 'click')
    await wait(40)
    expect(t.query(HelpDialog).open).toBe(true)
  })

  it('a dialog rendered by the same action opens', async () => {
    t = renderComponent(LateOpen, { dom: 'real' })
    await t.ready()
    expect(t.query(LateDialog)).toBe(null)
    t.simulateEvent(Late, 'click')
    await t.waitForState(s => s.show)
    await t.settle()
    expect(t.query(LateDialog).open).toBe(true)
  })

  it('the target resolves in the sending instance: a Collection item focuses its own field', async () => {
    t = renderComponent(Items, { dom: 'real' })
    await t.ready()
    t.simulateEvent(Edit, 'click', { within: 'li:nth-child(2)' })
    await t.settle()
    expect(document.activeElement).toBe(t.queryAll(Field)[1])
  })

  it('SYG640: nothing matches the target (after 1 s)', async () => {
    t = renderComponent(Broken, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.gone', 'click')
    await wait(1100)
    expect(codes()).toEqual(['SYG640'])
    expect(t.diagnostics[0].message).toMatch(/ELEMENT \{ focus: Missing \} in Broken matched no element/)
  })

  it('SYG641: an unknown method', async () => {
    t = renderComponent(Broken, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.typo', 'click')
    await t.settle()
    await wait(30)
    expect(codes()).toEqual(['SYG641'])
    expect(t.diagnostics[0].message).toMatch(/'fokus' is not an element command \(did you mean 'focus'\?\)/)
  })

  it('SYG641: a native method the element lacks (showModal on a <div>)', async () => {
    t = renderComponent(Broken, { dom: 'real' })
    await t.ready()
    t.simulateEvent(Bad, 'click')
    await t.settle()
    await wait(30)
    expect(codes()).toEqual(['SYG641'])
    expect(t.diagnostics[0].message).toMatch(/the matched <div> has no showModal\(\) method/)
    expect(t.diagnostics[0].fix).toMatch(/<dialog>/)
  })

  it('SYG641: a spec control with neither the command nor the native method names its commands', async () => {
    t = renderComponent(Planner, { dom: 'real' })
    await t.ready()
    t.simulateEvent(CloseDate, 'click')
    await t.settle()
    await wait(30)
    expect(codes()).toEqual(['SYG641'])
    expect(t.diagnostics[0].message).toMatch(/the control DueDate's spec declares no 'close' command \(it declares: open, focus\)/)
    expect(t.diagnostics[0].data.commands).toEqual(['open', 'focus'])
  })

  it('any other method of the element runs (a form reset)', async () => {
    t = renderComponent(Resettable, { dom: 'real' })
    await t.ready()
    const reset = vi.spyOn(HTMLFormElement.prototype, 'reset')
    t.simulateEvent(Clear, 'click')
    await t.settle()
    expect(reset).toHaveBeenCalledTimes(1)
    expect(reset.mock.instances[0]).toBe(t.query(SignupForm))
  })

  it('SYG641 when sent: remove() (the command still runs, as in production)', async () => {
    t = renderComponent(Broken, { dom: 'real' })
    await t.ready()
    t.simulateAction('REMOVE')
    await t.settle()
    expect(codes()).toEqual(['SYG641'])
  })

  it('a disposed instance runs nothing', async () => {
    t = renderComponent(Help, { dom: 'real' })
    await t.ready()
    const dialog = t.query(HelpDialog)
    t.simulateEvent(OpenHelp, 'click')
    t.dispose()
    t = null
    await wait(40)
    expect(dialog.open).toBe(false)
  })
})

// ─── SSR ────────────────────────────────────────────────────────────────────

describe('SSR', () => {
  it('renderToString ignores ELEMENT (no-op)', () => {
    expect(renderToString(Help)).toContain('<dialog')
  })
})
