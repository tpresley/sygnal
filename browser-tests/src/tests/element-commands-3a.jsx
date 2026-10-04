// PLAN-4 3-A (GS-2): element commands in a real browser. The built-in ELEMENT sink runs the
// command against the sending instance's own elements after the next patch: focus, real
// scrolling, a native <dialog> (its close event reaches intent), the Popover API, a spec
// object's commands (D102), arrays, and SYG640/SYG641 from the dev entry.
import { run, controls, Collection, ABORT, renderComponent, getDiagnostics, clearDiagnostics } from 'sygnal'
import 'sygnal/diagnostics'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Element commands (PLAN-4 3-A)'

const { Name, Email, Submit, HelpDialog, OpenHelp, CloseHelp, Tip, ShowTip, HideTip, AddRow, RowItem, Query, Go } = controls({
  Name: 'input', Email: 'input', Submit: 'button',
  HelpDialog: 'dialog', OpenHelp: 'button', CloseHelp: 'button',
  Tip: 'div', ShowTip: 'button', HideTip: 'button',
  AddRow: 'button', RowItem: 'li',
  Query: 'input', Go: 'button',
})

// focus the first invalid field after submit
const validate = (s) => ({ ...(s.name ? {} : { name: 'Required' }), ...(s.email.includes('@') ? {} : { email: 'Enter an email address' }) })
function Signup({ state }) {
  return (
    <form>
      <Name value={state.name} />
      {state.errors.name && <p className="err">{state.errors.name}</p>}
      <Email value={state.email} />
      {state.errors.email && <p className="err">{state.errors.email}</p>}
      <Submit type="button">Sign up</Submit>
    </form>
  )
}
Signup.initialState = { name: 'Ada', email: 'nope', errors: {} }
Signup.intent = ({ DOM }) => ({ SUBMIT: DOM.click(Submit) })
Signup.model = {
  SUBMIT: {
    STATE: (s) => ({ ...s, errors: validate(s) }),
    ELEMENT: (s) => { const e = validate(s); return e.name ? { focus: Name } : e.email ? { focus: Email } : ABORT },
  },
}

// a native dialog
function Help({ state }) {
  return (
    <div>
      <OpenHelp>Help</OpenHelp>
      <HelpDialog><p>Help text</p><CloseHelp>Close</CloseHelp></HelpDialog>
      <p className="log">{state.log.join(',')}</p>
    </div>
  )
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

// a popover
function Tips({ state }) {
  return (
    <div>
      <ShowTip>i</ShowTip><HideTip>x</HideTip>
      <Tip attrs={{ popover: 'auto' }}>A tip</Tip>
      <p className="tip">{state.tip}</p>
    </div>
  )
}
Tips.initialState = { tip: 'closed' }
Tips.intent = ({ DOM }) => ({ SHOW_TIP: DOM.click(ShowTip), HIDE_TIP: DOM.click(HideTip), TIP_TOGGLED: DOM.toggle(Tip).map(e => e.newState) })
Tips.model = {
  SHOW_TIP: { ELEMENT: { showPopover: Tip } },
  HIDE_TIP: { ELEMENT: { hidePopover: Tip } },
  TIP_TOGGLED: (s, tip) => ({ ...s, tip }),
}

// togglePopover: no force (undefined) without `force`, the boolean with it (a browser that only
// takes a boolean treats an options object as true)
const { Pop, TogglePop, ForceOff, ForceOn } = controls({ Pop: 'div', TogglePop: 'button', ForceOff: 'button', ForceOn: 'button' })
function Toggles() {
  return (
    <div>
      <TogglePop>t</TogglePop><ForceOff>off</ForceOff><ForceOn>on</ForceOn>
      <Pop attrs={{ popover: 'manual' }}>A popover</Pop>
    </div>
  )
}
Toggles.initialState = { n: 0 }
Toggles.intent = ({ DOM }) => ({ TOGGLE: DOM.click(TogglePop), OFF: DOM.click(ForceOff), ON: DOM.click(ForceOn) })
Toggles.model = {
  TOGGLE: { ELEMENT: { togglePopover: Pop } },
  OFF: { ELEMENT: { togglePopover: Pop, force: false } },
  ON: { ELEMENT: { togglePopover: Pop, force: true } },
}

// a new Collection row scrolls itself into view
function Row({ state }) { return <RowItem style={{ height: '40px' }}>{state.text}</RowItem> }
Row.model = { BOOTSTRAP: { ELEMENT: (s) => (s.fresh ? { scrollIntoView: RowItem, block: 'nearest' } : ABORT) } }
function Rows() {
  return (
    <div>
      <AddRow>Add</AddRow>
      <ul className="scroller" style={{ height: '120px', overflow: 'auto', margin: 0, padding: 0 }}>
        <Collection of={Row} from="rows" />
      </ul>
    </div>
  )
}
Rows.initialState = { rows: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, text: `row ${i + 1}` })) }
Rows.intent = ({ DOM }) => ({ ADD: DOM.click(AddRow) })
Rows.model = { ADD: (s) => ({ ...s, rows: [...s.rows, { id: s.rows.length + 1, text: `row ${s.rows.length + 1}`, fresh: true }] }) }

// a spec object with commands (D102); its focus overrides the native one
const opened = []
const dateSpec = {
  kind: 'test-date',
  vnode: (props, children, h) => h('div', { className: 'date', attrs: { tabindex: '-1' } }, h('input', { className: 'inner' })),
  commands: {
    open: (el, options) => { opened.push([el, options]) },
    focus: (el) => el.querySelector('input.inner').focus(),
  },
}
const { DueDate, PickDate, FocusDate, CloseDate } = controls({ DueDate: dateSpec, PickDate: 'button', FocusDate: 'button', CloseDate: 'button' })
function Planner() {
  return <div><DueDate /><PickDate>Pick</PickDate><FocusDate>Focus</FocusDate><CloseDate>Close</CloseDate></div>
}
Planner.initialState = {}
Planner.intent = ({ DOM }) => ({ PICK: DOM.click(PickDate), FOCUS_DATE: DOM.click(FocusDate), CLOSE_DATE: DOM.click(CloseDate) })
Planner.model = {
  PICK: { ELEMENT: { open: DueDate, at: 3 } },
  FOCUS_DATE: { ELEMENT: { focus: DueDate } },
  CLOSE_DATE: { ELEMENT: { close: DueDate } },
}

// arrays, and the failures
function Search({ state }) {
  return <div><Query value={state.q} /><Go>Go</Go><button className="typo">T</button><button className="gone">G</button></div>
}
Search.initialState = { q: 'sygnal' }
Search.intent = ({ DOM }) => ({ GO: DOM.click(Go), TYPO: DOM.click('.typo'), GONE: DOM.click('.gone') })
Search.model = {
  GO: { ELEMENT: [{ focus: Query }, { select: Query }] },
  TYPO: { ELEMENT: { fokus: Query } },
  GONE: { ELEMENT: { focus: '.nowhere' } },
}

async function start(App) {
  const { id, el } = mount()
  const app = run(App, {}, { mountPoint: id, diagnostics: 'collect' })
  await waitFor(() => el.children.length > 0 && el.textContent.length > 0)
  await wait(30)
  return { el, app }
}
const q = (el, c) => el.querySelector(String(c))

export async function elementCommandTests3A() {
  await runTest(CAT, 'focus the first invalid field after submit', async () => {
    const { el, app } = await start(Signup)
    try {
      q(el, Submit).click()
      await waitFor(() => document.activeElement === q(el, Email), 1000)
      assert(el.querySelector('.err').textContent === 'Enter an email address', 'the error rendered')
    } finally { app.dispose() }
  })

  await runTest(CAT, 'a native <dialog>: showModal, close(returnValue), close reaches intent', async () => {
    const { el, app } = await start(Help)
    try {
      const dlg = q(el, HelpDialog)
      q(el, OpenHelp).click()
      await waitFor(() => dlg.open, 1000)
      assert(dlg.matches(':modal'), 'opened as a modal')
      q(el, CloseHelp).click()
      await waitFor(() => el.querySelector('.log').textContent === 'closed:done', 1000)
      assert(!dlg.open, 'closed')
      assert(dlg.returnValue === 'done', `returnValue: ${dlg.returnValue}`)
    } finally { app.dispose() }
  })

  await runTest(CAT, 'a popover: showPopover / hidePopover fire toggle into intent', async () => {
    const { el, app } = await start(Tips)
    try {
      const tip = q(el, Tip)
      if (typeof tip.showPopover !== 'function') return
      q(el, ShowTip).click()
      await waitFor(() => el.querySelector('.tip').textContent === 'open', 1000)
      assert(tip.matches(':popover-open'), 'the popover is open')
      q(el, HideTip).click()
      await waitFor(() => el.querySelector('.tip').textContent === 'closed', 1000)
      assert(!tip.matches(':popover-open'), 'the popover is closed')
    } finally { app.dispose() }
  })

  await runTest(CAT, 'togglePopover: no force without the option, the boolean with it', async () => {
    const { el, app } = await start(Toggles)
    try {
      const pop = q(el, Pop)
      if (typeof pop.togglePopover !== 'function') return
      const calls = [], native = pop.togglePopover
      pop.togglePopover = function (...args) { calls.push(args); return native.apply(this, args) }
      const isOpen = () => pop.matches(':popover-open')
      q(el, TogglePop).click()
      await waitFor(() => calls.length === 1, 1000)
      // undefined = no argument for an optional WebIDL argument (plain toggle)
      assert(calls[0].length <= 1 && calls[0][0] === undefined, `no force: ${JSON.stringify(calls[0])}`)
      assert(isOpen(), 'toggled open')
      q(el, ForceOff).click()
      await waitFor(() => calls.length === 2, 1000)
      assert(calls[1].length === 1 && calls[1][0] === false, `force false: ${JSON.stringify(calls[1])}`)
      assert(!isOpen(), 'forced closed')
      q(el, ForceOff).click()
      await waitFor(() => calls.length === 3, 1000)
      assert(!isOpen(), 'stays closed')
      q(el, ForceOn).click()
      await waitFor(() => calls.length === 4, 1000)
      assert(calls[3][0] === true && isOpen(), 'forced open')
      q(el, TogglePop).click()
      await waitFor(() => calls.length === 5, 1000)
      assert(!isOpen(), 'toggled closed')
    } finally { app.dispose() }
  })

  await runTest(CAT, 'a new Collection row scrolls itself into view', async () => {
    const { el, app } = await start(Rows)
    try {
      const scroller = el.querySelector('.scroller')
      assert(scroller.scrollTop === 0, 'starts at the top')
      q(el, AddRow).click()
      await waitFor(() => el.querySelectorAll('li').length === 21, 1000)
      await waitFor(() => {
        const row = el.querySelectorAll('li')[20].getBoundingClientRect(), box = scroller.getBoundingClientRect()
        return row.bottom <= box.bottom + 1 && row.top >= box.top - 1
      }, 1500)
      assert(scroller.scrollTop > 0, `scrolled: ${scroller.scrollTop}`)
    } finally { app.dispose() }
  })

  await runTest(CAT, 'spec commands (D102): open gets the host element and the options; a spec focus overrides', async () => {
    opened.length = 0
    const { el, app } = await start(Planner)
    try {
      q(el, PickDate).click()
      await waitFor(() => opened.length === 1, 1000)
      assert(opened[0][0] === q(el, DueDate), 'the host element')
      assert(JSON.stringify(opened[0][1]) === '{"at":3}', `options: ${JSON.stringify(opened[0][1])}`)
      q(el, FocusDate).click()
      await waitFor(() => document.activeElement === el.querySelector('input.inner'), 1000)
    } finally { app.dispose() }
  })

  await runTest(CAT, 'an array runs in order: focus then select', async () => {
    const { el, app } = await start(Search)
    try {
      q(el, Go).click()
      const input = q(el, Query)
      await waitFor(() => document.activeElement === input && input.selectionEnd === 6 && input.selectionStart === 0, 1000)
    } finally { app.dispose() }
  })

  await runTest(CAT, 'SYG641 (unknown method, named) and SYG640 (no match after 1 s)', async () => {
    clearDiagnostics()
    const { el, app } = await start(Search)
    try {
      el.querySelector('.typo').click()
      await waitFor(() => getDiagnostics().some(d => d.code === 'SYG641'), 1000)
      assert(/'fokus' is not an element command \(did you mean 'focus'\?\)/.test(getDiagnostics().find(d => d.code === 'SYG641').message), 'names the method')
      el.querySelector('.gone').click()
      await waitFor(() => getDiagnostics().some(d => d.code === 'SYG640'), 2000)
    } finally { app.dispose() }
  })

  await runTest(CAT, 'SYG641: a spec control with neither the command nor the method names its commands', async () => {
    clearDiagnostics()
    const { el, app } = await start(Planner)
    try {
      q(el, CloseDate).click()
      await waitFor(() => getDiagnostics().some(d => d.code === 'SYG641'), 1000)
      assert(/it declares: open, focus/.test(getDiagnostics().find(d => d.code === 'SYG641').message), 'lists the commands')
    } finally { app.dispose() }
  })

  await runTest(CAT, 'renderComponent: mock DOM records, dom: "real" runs the native dialog', async () => {
    // (waitFor, not t.settle(): apps other tests leave running keep the page busy)
    const t = renderComponent(Help)
    try {
      await t.ready()
      t.simulateEvent(OpenHelp, 'click')
      await waitFor(() => t.commands('ELEMENT').length === 1, 1000)
      assert(JSON.stringify(t.commands('ELEMENT').map(c => Object.keys(c))) === '[["showModal"]]', 'recorded')
    } finally { t.dispose() }
    const r = renderComponent(Help, { dom: 'real' })
    try {
      await r.ready()
      r.simulateEvent(OpenHelp, 'click')
      await waitFor(() => r.query(HelpDialog).open, 1000)
      assert(r.query(HelpDialog).matches(':modal'), 'a real modal')
      r.simulateEvent(CloseHelp, 'click')
      await r.waitForState(s => s.log.length === 1)
      assert(r.state.log[0] === 'closed:done', r.state.log.join())
    } finally { r.dispose() }
  }, 5000)
}
