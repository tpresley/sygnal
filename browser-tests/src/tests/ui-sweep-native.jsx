// ui-sweep (dev-plans/research/ui-sweep/native.md): the sygnal/ui native parts composed the way an
// app puts them together, in a real engine with Playwright's trusted input: tabs inside an
// accordion panel, a tooltip on a dialog's trigger, a form in a dialog, a dialog in every
// Collection item and in an isolated child, two instances of one component, and an accordion
// whose open panels the host's own state sets (numbers).
import { run, makeTimerDriver, Collection } from 'sygnal'
import { dialog, tooltip, tabs, tabsAttrs, accordion, accordionAttrs } from 'sygnal/ui'
import { mountOnScreen, clearStage, assert, runTest as run_, wait } from '../harness.js'

const CAT = 'UI parts, composed (ui-sweep)'
const hasPw = () => typeof window.__pw === 'function'
const ENGINE = /Firefox\//.test(navigator.userAgent) ? 'firefox' : /Chrome\//.test(navigator.userAgent) ? 'chromium' : 'webkit'

let style
const css = () => {
  if (style) return
  style = document.createElement('style')
  style.textContent = `
    .ui-sweep dialog, .ui-sweep [popover] { margin: auto; padding: 12px; }
    .ui-sweep .tip { inset: auto; margin: 0 0 6px 0; position-area: top; padding: 2px 6px; border: 1px solid; }
    .ui-sweep .bar { padding: 60px 0 0 200px; }
  `
  document.head.appendChild(style)
}

const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  css()
  window.scrollTo(0, 0)
  try { await fn() } finally { await window.__pw('mouse-away'); clearStage() }
}, ms)

const until = async (pred, what, ms = 2000) => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${typeof what === 'function' ? what() : what}`)
    await wait(10)
  }
}
const key = (...keys) => window.__pwInput(keys.map((k) => ['key', k]))
const activeName = () => {
  const a = document.activeElement
  return !a || a === document.body ? 'body' : a.getAttribute('data-name') || a.className || a.tagName.toLowerCase()
}

async function mount(App) {
  const { id, el } = mountOnScreen()
  el.className = 'ui-sweep'
  const app = run(App, { TIMER: makeTimerDriver() }, { mountPoint: id })
  await until(() => el.firstElementChild, 'mounted')
  await wait(30)
  return { id, el, app, $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)] }
}

// ── tabs inside an accordion panel ────────────────────────────────────
function Settings({ state, uid }) {
  const a = accordionAttrs(state.sections, uid), tb = tabsAttrs(state.tabs, uid)
  return (
    <div>
      <h3><button className="sec" data-name="sec-a" {...a.trigger('a')}>Account</button></h3>
      <div className="sec-panel" {...a.panel('a')}>
        <div {...tb.list} aria-label="Account">
          <button className="tab" data-name="tab-x" {...tb.tab('x')}>Profile</button>
          <button className="tab" data-name="tab-y" {...tb.tab('y')}>Security</button>
        </div>
        <div {...tb.panel('x')}>Profile panel</div>
        <div {...tb.panel('y')}>Security panel</div>
      </div>
      <h3><button className="sec" data-name="sec-b" {...a.trigger('b')}>Billing</button></h3>
      <div className="sec-panel" {...a.panel('b')}>Billing panel</div>
      <p className="out">{state.sections.expanded.join(',')}|{state.tabs.selected}</p>
    </div>
  )
}
Settings.uses = { sections: accordion({ trigger: '.sec', expanded: 'a' }), tabs: tabs({ tab: '.tab', selected: 'x' }) }

// ── a tooltip on the trigger of a dialog ──────────────────────────────
function Bar({ state, uid }) {
  const anchor = '--' + uid('open')
  return (
    <div className="bar">
      <button className="open" data-name="open" aria-describedby={uid('tip')} style={{ anchorName: anchor }}>Settings</button>
      <div className="tip" id={uid('tip')} role="tooltip" popover="manual" style={{ positionAnchor: anchor }}>Open the settings</div>
      <dialog className="d" aria-label="Settings"><button className="close" data-name="close">Close</button></dialog>
      <p className="out">{state.d.open ? 'open' : 'closed'}|{state.tip.open ? 'tip' : 'notip'}</p>
    </div>
  )
}
Bar.uses = { d: dialog({ dialog: '.d', trigger: '.open', close: '.close' }), tip: tooltip({ trigger: '.open', tip: '.tip', showDelay: 100 }) }

function Tb({ state, uid }) {
  const anchor = '--' + uid('act')
  return (
    <div className="bar">
      <button className="pre" data-name="pre">Italic</button>
      <button className="act" data-name="act" aria-describedby={uid('tip')} style={{ anchorName: anchor }}>Bold</button>
      <div className="tip" id={uid('tip')} role="tooltip" popover="manual" style={{ positionAnchor: anchor }}>Bold (Ctrl+B)</div>
      <p className="out">{state.tip.open ? 'tip' : 'notip'}</p>
    </div>
  )
}
Tb.uses = { tip: tooltip({ trigger: '.act', tip: '.tip', showDelay: 100 }) }

// ── a form in a dialog ────────────────────────────────────────────────
function Rename({ state }) {
  return (
    <div>
      <button className="rename">Rename</button>
      <dialog className="rn" aria-label="Rename">
        {/* Enter in the field submits with the form's first submit button: OK comes first */}
        <form method="dialog">
          <input className="name" data-name="name" aria-label="Name" required value={state.draft} />
          <button className="ok" value="ok">OK</button>
          <button type="button" className="cancel">Cancel</button>
        </form>
      </dialog>
      <p className="out">{state.name}|{state.rn.open ? 'open' : 'closed'}|{state.rn.returnValue}</p>
    </div>
  )
}
Rename.initialState = { name: 'Old', draft: 'Old' }
Rename.uses = { rn: dialog({ dialog: '.rn', trigger: '.rename', close: '.cancel' }) }
Rename.intent = ({ DOM }) => ({ DRAFT: DOM.input('.name').value() })
Rename.model = {
  DRAFT: (s, draft) => ({ ...s, draft }),
  'rn.CLOSED': (s, rv) => (rv === 'ok' ? { ...s, name: s.draft } : { ...s, draft: s.name }),
}

// ── a dialog in every Collection item, and in an isolated child ───────
function Row({ state }) {
  return (
    <li>
      <button className="edit" data-name={'edit-' + state.id}>Edit {state.id}</button>
      <dialog className="row-d" aria-label={'Row ' + state.id}><button className="row-close">Close</button></dialog>
      <span className="row-out">{state.d.open ? 'open' : 'closed'}</span>
    </li>
  )
}
Row.uses = { d: dialog({ dialog: '.row-d', trigger: '.edit', close: '.row-close' }) }
function Rows() { return <ul><Collection of={Row} from="rows" /></ul> }
Rows.initialState = { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }

function Panel({ state }) {
  return (
    <div>
      <button className="p-open" data-name="p-open">Open</button>
      <dialog className="p-d" aria-label="Panel"><button className="p-close">Close</button></dialog>
      <span className="p-out">{state.d.open ? 'open' : 'closed'}</span>
    </div>
  )
}
Panel.uses = { d: dialog({ dialog: '.p-d', trigger: '.p-open', close: '.p-close' }) }
function Page({ state }) { return <div><Panel state="panel" /><Panel state="other" /><p className="page-out">{JSON.stringify(state.panel?.d?.open ?? null)}</p></div> }
Page.initialState = { panel: {}, other: {} }

// ── an accordion whose open panels the host sets (numeric ids) ────────
function Orders({ state, uid }) {
  const a = accordionAttrs(state.acc, uid)
  return (
    <div>
      <button className="latest">Show latest</button>
      {state.orders.map((o) => (
        <div>
          <button className="ord" {...a.trigger(o.id)}>Order {o.id}</button>
          <div className="ord-panel" {...a.panel(o.id)}>Details {o.id}</div>
        </div>
      ))}
    </div>
  )
}
Orders.initialState = { orders: [{ id: 7 }, { id: 8 }] }
Orders.uses = { acc: accordion({ trigger: '.ord' }) }
Orders.intent = ({ DOM }) => ({ LATEST: DOM.click('.latest') })
Orders.model = { LATEST: (s) => ({ ...s, acc: { ...s.acc, expanded: [s.orders.at(-1).id] } }) }

export async function uiSweepNativeTests() {
  await runTest('Tooltip: a mouse click on the trigger (Chromium, Firefox focus it) leaves no tip once the pointer leaves; Tab still shows it', async () => {
    const { id, app, $ } = await mount(Tb)
    try {
      await window.__pw('hover', `${id} .act`)
      await until(() => $('.out').textContent === 'tip', () => $('.out').textContent)
      await window.__pw('click', `${id} .act`)
      await wait(50)
      await window.__pw('mouse-away')
      await until(() => $('.out').textContent === 'notip', () => `${$('.out').textContent}, focus on ${activeName()}`, 1000)
      // the keyboard focus still shows it
      await window.__pw('press', `${id} .pre`, ENGINE === 'webkit' ? 'Alt+Tab' : 'Tab')
      await until(() => activeName() === 'act' && $('.out').textContent === 'tip', () => `${$('.out').textContent}, focus on ${activeName()}`, 1000)
    } finally { app.dispose() }
  })

  await runTest('Tabs inside an accordion panel: Left / Right stay in the tabs, Up / Down in the headers; a closed section hides its tabs', async () => {
    const { id, app, $ } = await mount(Settings)
    try {
      await window.__pw('focus', `${id} [data-name="tab-x"]`)
      await key('ArrowRight')
      await until(() => activeName() === 'tab-y' && $('.out').textContent === 'a|y', () => `${activeName()} ${$('.out').textContent}`)
      // Down on a tab is not the accordion's (it listens on its headers only)
      await key('ArrowDown')
      await wait(50)
      assert(activeName() === 'tab-y', `ArrowDown on a tab moved the focus to ${activeName()}`)
      await window.__pw('focus', `${id} [data-name="sec-a"]`)
      await key('ArrowDown')
      await until(() => activeName() === 'sec-b', activeName)
      await key('Enter')
      await until(() => $('.out').textContent === 'b|y', () => $('.out').textContent)
      assert($('.sec-panel').hidden, 'section a still shown')
    } finally { app.dispose() }
  })

  await runTest('A tooltip on a dialog trigger: shown on hover; a mouse Close returns the focus without the tip; Enter / Escape return it too', async () => {
    const { id, app, $ } = await mount(Bar)
    try {
      await window.__pw('hover', `${id} .open`)
      await until(() => $('.out').textContent === 'closed|tip', () => $('.out').textContent)
      await window.__pw('click', `${id} .open`)
      await until(() => $('.d').open, 'dialog open')
      // (WebKit sends no pointerleave for a trigger the modal covers: its tip stays open under the backdrop)
      await window.__pw('click', `${id} .close`)
      await until(() => !$('.d').open && activeName() === 'open', activeName)
      await window.__pw('mouse-away')
      await until(() => $('.out').textContent === 'closed|notip', () => $('.out').textContent, 1000)
      await window.__pw('press', `${id} .open`, 'Enter')
      await until(() => $('.d').open, 'dialog open by Enter')
      await key('Escape')
      // the focus is back; whether it shows the tip is the engine's :focus-visible call (Chromium and
      // WebKit: yes after a keyboard close; Firefox: no)
      await until(() => !$('.d').open && activeName() === 'open', activeName)
    } finally { app.dispose() }
  })

  await runTest('A form in a dialog: required blocks OK, Enter submits, the returnValue reaches CLOSED; Cancel restores the draft', async () => {
    const { id, app, $ } = await mount(Rename)
    try {
      await window.__pw('click', `${id} .rename`)
      await until(() => $('.rn').open, 'open')
      await window.__pw('fill', `${id} .name`, '')
      await window.__pw('click', `${id} .ok`)
      await wait(100)
      assert($('.rn').open, 'an empty required field closed the dialog')
      await window.__pw('fill', `${id} .name`, 'New')
      await window.__pw('press', `${id} .name`, 'Enter')
      await until(() => $('.out').textContent === 'New|closed|ok', () => $('.out').textContent)
      await window.__pw('click', `${id} .rename`)
      await until(() => $('.rn').open, 'reopen')
      assert($('.name').value === 'New', `draft on reopen: ${$('.name').value}`)
      await window.__pw('fill', `${id} .name`, 'Typo')
      await key('Escape')
      await until(() => $('.out').textContent === 'New|closed|', () => $('.out').textContent)
      assert($('.name').value === 'New', `draft after Escape: ${$('.name').value}`)
    } finally { app.dispose() }
  })

  await runTest('A dialog in every Collection item: each opens its own; Escape returns the focus to that row\'s trigger', async () => {
    const { id, app, $$ } = await mount(Rows)
    try {
      await window.__pw('click', `${id} [data-name="edit-2"]`)
      await until(() => $$('.row-d')[1].open, 'row 2 open')
      assert(!$$('.row-d')[0].open && !$$('.row-d')[2].open, 'another row opened')
      assert($$('.row-out').map((e) => e.textContent).join() === 'closed,open,closed', $$('.row-out').map((e) => e.textContent).join())
      await key('Escape')
      await until(() => !$$('.row-d')[1].open && $$('.row-out')[1].textContent === 'closed', 'closed')
      await until(() => activeName() === 'edit-2', activeName)
    } finally { app.dispose() }
  })

  await runTest('A dialog in an isolated child (state="panel"), two instances: the slice lives in the parent', async () => {
    const { id, app, $, $$ } = await mount(Page)
    try {
      await window.__pw('click', `${id} .p-open >> nth=0`)
      await until(() => $$('.p-d')[0].open && $('.page-out').textContent === 'true', () => $('.page-out').textContent)
      assert(!$$('.p-d')[1].open, 'the other instance opened')
      await window.__pw('click', `${id} .p-close >> nth=0`)
      await until(() => $('.page-out').textContent === 'false', () => $('.page-out').textContent)
    } finally { app.dispose() }
  })

  await runTest('An accordion opened from the host state with numeric ids; a click on that header closes it', async () => {
    const { id, app, $$ } = await mount(Orders)
    try {
      await window.__pw('click', `${id} .latest`)
      await until(() => !$$('.ord-panel')[1].hidden, 'order 8 not shown')
      await window.__pw('click', `${id} .ord >> nth=1`)
      await until(() => $$('.ord-panel')[1].hidden, 'order 8 still shown')
    } finally { app.dispose() }
  })
}
