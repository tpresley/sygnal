// ui-sweep (dev-plans/research/ui-sweep/native.md): the sygnal/ui native parts composed the way an
// app puts them together, in a real engine with Playwright's trusted input: tabs inside an
// accordion panel, a tooltip on a dialog's trigger, a form in a dialog, a dialog in every
// Collection item and in an isolated child, two instances of one component, and an accordion
// whose open panels the host's own state sets (numbers).
import { run, makeTimerDriver, Collection, Portal } from 'sygnal'
import { dialog, dialogAttrs, popover, popoverAttrs, tooltip, tabs, tabsAttrs, accordion, accordionAttrs } from 'sygnal/ui'
import { Menu } from 'sygnal/ui/menu'
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
    .ui-sweep .cp, .ui-sweep .ly-p, .ui-sweep .tg-p, .ui-sweep .zm-p { inset: auto 12px 12px auto; margin: 0; }
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


// ── round 2 (R2): a controlled open ───────────────────────────────────
function Editor({ state }) {
  return (
    <div>
      <button className="edit" data-name="edit">Edit</button>
      <button className="remote-open">Open from the model</button>
      <dialog className="ed" aria-label="Editor" id="ui-sweep-ed">
        <form method="dialog">
          <input className="field" data-name="field" aria-label="Text" />
          <button className="ok" value="ok">OK</button>
        </form>
        <button className="dirty">Make dirty</button>
        <button className="remote-close">Close from the model</button>
      </dialog>
      <button className="cmd-open" commandfor="ui-sweep-ed" command="show-modal">Open by command</button>
      <p className="out">{String(state.ed.open)}|{state.ed.returnValue}|{String(state.dirty)}</p>
    </div>
  )
}
Editor.initialState = { dirty: false }
Editor.uses = { ed: dialog({ dialog: '.ed', trigger: '.edit' }) }
Editor.intent = ({ DOM }) => ({ OPEN_IT: DOM.click('.remote-open'), CLOSE_IT: DOM.click('.remote-close'), DIRTY: DOM.click('.dirty') })
Editor.model = {
  OPEN_IT: (s) => ({ ...s, ed: { ...s.ed, open: true } }),
  CLOSE_IT: (s) => ({ ...s, dirty: false, ed: { ...s.ed, open: false, returnValue: 'model' } }),
  DIRTY: (s) => ({ ...s, dirty: true }),
  // a dirty editor refuses Escape and the form submit (Radix: onOpenChange(false) ignored)
  'ed.CANCEL': (s, _e, _n, { previousState }) => (s.dirty ? previousState : s),
  'ed.CLOSE': (s, _rv, _n, { previousState }) => (s.dirty ? previousState : s),
}

function Picker({ state, uid }) {
  return (
    <div>
      <button className="pk-btn" popovertarget={uid('pk')}>Pick</button>
      <button className="pk-set">Toggle from the model</button>
      <button className="pk-pin">Pin</button>
      <div className="pk" id={uid('pk')} popover="auto" aria-label="Picker">Choices</div>
      <p className="out">{String(state.pk.open)}|{String(state.pinned)}</p>
    </div>
  )
}
Picker.initialState = { pinned: false }
Picker.uses = { pk: popover({ popover: '.pk' }) }
Picker.intent = ({ DOM }) => ({ SET: DOM.click('.pk-set'), PIN: DOM.click('.pk-pin') })
Picker.model = {
  SET: (s) => ({ ...s, pk: { open: !s.pk.open } }),
  PIN: (s) => ({ ...s, pinned: true }),
  // pinned: a light dismiss is refused (it opens again)
  'pk.TOGGLED': (s, open) => (s.pinned && !open ? { ...s, pk: { open: true } } : s),
}

// ── round 2 (R4): parts inside a <Portal> ─────────────────────────────
function Portaled({ state, uid }) {
  const anchor = '--' + uid('tt')
  return (
    <div>
      <button className="pt-open" data-name="pt-open">Open</button>
      <button className="pt-pop" popovertarget={uid('pt-pop')}>Menu</button>
      <button className="pt-tt" data-name="pt-tt" aria-describedby={uid('pt-tip')} style={{ anchorName: anchor }}>Info</button>
      <Portal target="#ui-sweep-portal">
        <dialog className="pt-d" aria-label="In a portal">
          <button className="pt-close" data-name="pt-close">Close</button>
        </dialog>
        <div className="pt-menu" id={uid('pt-pop')} popover="auto" aria-label="Portal menu"><button className="pt-done">Done</button></div>
        <div className="tip" id={uid('pt-tip')} role="tooltip" popover="manual" style={{ positionAnchor: anchor }}>More info</div>
      </Portal>
      <p className="out">{String(state.d.open)}|{String(state.m.open)}|{String(state.t.open)}</p>
    </div>
  )
}
Portaled.uses = {
  d: dialog({ dialog: '.pt-d', trigger: '.pt-open', close: '.pt-close' }),
  m: popover({ popover: '.pt-menu', close: '.pt-done' }),
  t: tooltip({ trigger: '.pt-tt', tip: '.tip', showDelay: 100 }),
}

// ── round 3: controlled parts dismiss through the state ──────────────
function Pinned({ state, uid }) {
  return (
    <div>
      <button className="cp-btn" popovertarget={uid('cp')}>Pick</button>
      <button className="cp-pin">Pin</button>
      <button className="cp-out" data-name="cp-out">Elsewhere</button>
      <div className="cp" id={uid('cp')} popover="auto" aria-label="Choices"><button className="cp-in" data-name="cp-in">Choice</button></div>
      <p className="out">{String(state.cp.open)}|{String(state.pinned)}</p>
    </div>
  )
}
Pinned.initialState = { pinned: false }
Pinned.uses = { cp: popover({ popover: '.cp', open: false }) }
Pinned.intent = ({ DOM }) => ({ PIN: DOM.click('.cp-pin') })
Pinned.model = {
  PIN: (s) => ({ ...s, pinned: !s.pinned }),
  // pinned: Escape, a press and a focus outside are refused (Radix: onOpenChange(false) ignored)
  'cp.DISMISS': (s, _e, _n, { previousState }) => (s.pinned ? previousState : s),
}

function Layered({ state, uid }) {
  return (
    <div>
      <button className="ly-open">Edit</button>
      <dialog className="ly-d" aria-label="Edit">
        <button className="ly-menu" popovertarget={uid('ly-p')}>More</button>
        <button className="ly-other" data-name="ly-other">Other</button>
        <div className="ly-p" id={uid('ly-p')} popover="auto" aria-label="More"><button className="ly-item" data-name="ly-item">Item</button></div>
      </dialog>
      <p className="out">{String(state.d.open)}|{String(state.p.open)}</p>
    </div>
  )
}
Layered.uses = { d: dialog({ dialog: '.ly-d', trigger: '.ly-open', open: false }), p: popover({ popover: '.ly-p', open: false }) }

// ── round 4: the popover trigger, one dismissal per press, a Zag Menu in a controlled popover ──
function Trig({ state, uid }) {
  const a = popoverAttrs(state.p, uid), b = popoverAttrs(state.q, uid)
  return (
    <div>
      <button className="tg-btn" data-name="tg-btn" {...a.trigger}>Auto</button>
      <button className="tq-btn" {...b.trigger}>Controlled</button>
      <button className="tg-out" data-name="tg-out">Elsewhere</button>
      <div className="tg-p" {...a.popover} popover="auto" aria-label="Auto">auto</div>
      <div className="tg-p tq" {...b.popover} popover="auto" aria-label="Controlled"><button className="tq-in">In</button></div>
      <p className="out">{String(state.p.open)}|{String(state.q.open)}|{state.dismissed}</p>
    </div>
  )
}
Trig.initialState = { dismissed: 0 }
Trig.uses = { p: popover({ popover: '.tg-p:not(.tq)', trigger: '.tg-btn' }), q: popover({ popover: '.tq', trigger: '.tq-btn', open: false }) }
Trig.model = { 'q.DISMISS': (s) => ({ ...s, dismissed: s.dismissed + 1 }) }

function ZagIn({ state, uid }) {
  const a = popoverAttrs(state.p, uid)
  return (
    <div>
      <button className="zm-btn" {...a.trigger}>Tools</button>
      <button className="zm-out">Elsewhere</button>
      <div className="zm-p" {...a.popover} popover="auto" aria-label="Tools">
        <Menu className="zm" label="Actions" items={['edit', 'copy']} />
      </div>
      <p className="out">{String(state.p.open)}|{state.picked}</p>
    </div>
  )
}
ZagIn.initialState = { picked: '' }
ZagIn.uses = { p: popover({ popover: '.zm-p', trigger: '.zm-btn', open: false }) }
ZagIn.intent = ({ DOM }) => ({ PICK: DOM.select('.zm').events('select').detail() })
ZagIn.model = { PICK: (s, picked) => ({ ...s, picked }) }

// ── round 5: dialogAttrs, an alert dialog ──
function Confirm({ state, uid }) {
  const a = dialogAttrs(state.c, uid)
  return (
    <div>
      <button className="cf-open" {...a.trigger}>Delete</button>
      <dialog className="cf-d" {...a.dialog} role="alertdialog">
        <h2 {...a.title}>Delete the file?</h2>
        <p {...a.description}>It cannot be undone.</p>
        <button className="cf-no" {...a.close} data-name="cf-no" autofocus>Cancel</button>
      </dialog>
    </div>
  )
}
Confirm.uses = { c: dialog({ dialog: '.cf-d', trigger: '.cf-open', close: '.cf-no' }) }

// ── round 6: in a shadow root (the parts read the element's own root and document) ──
function Shadowed({ state, uid }) {
  const a = dialogAttrs(state.d, uid), b = popoverAttrs(state.p, uid)
  return (
    <div>
      <button className="sh-open" data-name="sh-open" {...a.trigger}>Settings</button>
      <dialog className="sh-d" {...a.dialog}><h2 {...a.title}>Settings</h2><button className="sh-x" {...a.close}>Close</button></dialog>
      <button className="sh-t" {...b.trigger}>Share</button>
      <div className="sh-p" {...b.popover} popover="auto" aria-label="Share"><button className="sh-in">Copy</button></div>
      <button className="sh-out">Elsewhere</button>
      <p className="out">{String(state.d.open)}|{String(state.p.open)}|{state.n}</p>
    </div>
  )
}
Shadowed.initialState = { n: 0 }
Shadowed.uses = { d: dialog({ dialog: '.sh-d', trigger: '.sh-open', close: '.sh-x' }), p: popover({ popover: '.sh-p', trigger: '.sh-t', open: false }) }
Shadowed.model = { 'p.DISMISS': (s) => ({ ...s, n: s.n + 1 }) }

// every animation frame and every toggle of `el` while `fn` runs: the frames it was hidden in, its
// beforetoggle / toggle events (a hide sends beforetoggle:closed synchronously)
async function watchFrames(el, fn) {
  const r = { frames: 0, hidden: 0, events: [] }
  let on = true
  const f = () => { if (!on) return; r.frames++; el.matches(':popover-open') || r.hidden++; requestAnimationFrame(f) }
  const ev = (e) => r.events.push(`${e.type}:${e.newState}`)
  requestAnimationFrame(f)
  el.addEventListener('beforetoggle', ev)
  el.addEventListener('toggle', ev)
  try { await fn() } finally { await wait(100); on = false; el.removeEventListener('beforetoggle', ev); el.removeEventListener('toggle', ev) }
  return r
}

export async function uiSweepNativeTests() {

  // ── round 4 ─────────────────────────────────────────────────────────
  await runTest('Round 4 popover trigger: toggles an auto popover (no reopen after the light dismiss) and a controlled one; ARIA from popoverAttrs; one DISMISS per press', async () => {
    const { id, app, $ } = await mount(Trig)
    const shown = (s) => $(s).matches(':popover-open')
    try {
      await window.__pw('click', `${id} .tg-btn`)
      await until(() => shown('.tg-p:not(.tq)') && $('.out').textContent === 'true|false|0', () => $('.out').textContent)
      assert($('.tg-btn').getAttribute('aria-expanded') === 'true' && $('.tg-btn').getAttribute('aria-haspopup') === 'dialog' && $('.tg-btn').getAttribute('aria-controls') === $('.tg-p').id, 'trigger ARIA')
      await window.__pw('click', `${id} .tg-btn`)
      await wait(150)
      assert(!shown('.tg-p:not(.tq)') && $('.out').textContent === 'false|false|0', `the auto popover opened again: ${$('.out').textContent}`)
      await window.__pw('click', `${id} .tq-btn`)
      await until(() => shown('.tq') && $('.out').textContent === 'false|true|0', () => $('.out').textContent)
      await window.__pw('click', `${id} .tq-btn`)
      await until(() => !shown('.tq') && $('.out').textContent === 'false|false|0', () => $('.out').textContent)
      // a press outside on a focusable button: one DISMISS (the press's), not a second for the focus
      await window.__pw('click', `${id} .tq-btn`)
      await until(() => shown('.tq'), 'open')
      await window.__pw('focus', `${id} .tq-in`)
      await window.__pw('click', `${id} .tg-out`)
      await until(() => !shown('.tq') && $('.out').textContent === 'false|false|1', () => $('.out').textContent)
      await wait(100)
      assert($('.out').textContent === 'false|false|1', `dismissed twice: ${$('.out').textContent}`)
    } finally { app.dispose() }
  })

  await runTest('Round 4 a Zag Menu in a controlled popover: Escape and a pick close the menu only; the next Escape the popover; a press outside both closes both', async () => {
    const { id, app, $ } = await mount(ZagIn)
    const shown = () => $('.zm-p').matches(':popover-open')
    const menuOpen = () => $('.zm [data-part=content]')?.getAttribute('data-state') === 'open'
    try {
      await window.__pw('click', `${id} .zm-btn`)
      await until(() => shown(), 'popover open')
      await window.__pw('click', `${id} .zm [data-part=trigger]`)
      await until(menuOpen, 'menu open')
      await key('Escape')
      await until(() => !menuOpen(), 'menu closed by Escape')
      await wait(80)
      assert(shown() && $('.out').textContent === 'true|', `the popover closed with the menu: ${$('.out').textContent}`)
      await window.__pw('click', `${id} .zm [data-part=trigger]`)
      await until(menuOpen, 'menu open again')
      await window.__pw('click', `${id} .zm [data-value=copy]`)
      await until(() => !menuOpen() && $('.out').textContent === 'true|copy', () => $('.out').textContent)
      assert(shown(), 'a pick in the menu closed the popover')
      await window.__pw('focus', `${id} .zm [data-part=trigger]`)
      await key('Escape')
      await until(() => !shown() && $('.out').textContent === 'false|copy', () => $('.out').textContent)
      await window.__pw('click', `${id} .zm-btn`)
      await until(() => shown(), 'popover open')
      await window.__pw('click', `${id} .zm [data-part=trigger]`)
      await until(menuOpen, 'menu open')
      await window.__pw('click', `${id} .zm-out`)
      await until(() => !menuOpen() && !shown() && $('.out').textContent === 'false|copy', () => `${menuOpen()} ${shown()} ${$('.out').textContent}`)
    } finally { app.dispose() }
  })

  // ── round 3 ─────────────────────────────────────────────────────────
  await runTest('Round 3 controlled popover: a refused Escape, press outside and focus outside never hide it (no frame, no toggle)', async () => {
    const { id, app, $ } = await mount(Pinned)
    const shown = () => $('.cp').matches(':popover-open')
    try {
      await window.__pw('click', `${id} .cp-pin`)
      await window.__pw('click', `${id} .cp-btn`)
      await until(() => shown() && $('.out').textContent === 'true|true', () => `${shown()} ${$('.out').textContent}`)
      assert($('.cp').getAttribute('popover') === 'manual', `popover=${$('.cp').getAttribute('popover')}`)
      // (the open's own toggle event is asynchronous)
      await wait(60)
      const r = await watchFrames($('.cp'), async () => {
        await window.__pw('focus', `${id} .cp-in`)
        await key('Escape')
        await wait(60)
        await window.__pw('click', `${id} .cp-out`)
        await wait(60)
        await window.__pw('focus', `${id} .cp-out`)
        await wait(60)
      })
      assert(r.frames > 3 && r.hidden === 0 && !r.events.some((e) => e.endsWith(':closed')), `hidden in ${r.hidden} of ${r.frames} frames, events ${r.events.join(' ')}`)
      assert($('.out').textContent === 'true|true', $('.out').textContent)
      // unpinned: a press outside closes it (the press on Pin is outside too: refused, then unpinned)
      await window.__pw('click', `${id} .cp-pin`)
      await until(() => shown() && $('.out').textContent === 'true|false', () => $('.out').textContent)
      await window.__pw('click', `${id} .cp-out`)
      await until(() => !shown() && $('.out').textContent === 'false|false', () => `${shown()} ${$('.out').textContent}`)
      // its button toggles it through the model (the press on it isn't outside)
      await window.__pw('click', `${id} .cp-btn`)
      await until(() => shown(), 'open')
      await window.__pw('click', `${id} .cp-btn`)
      await until(() => !shown() && $('.out').textContent === 'false|false', () => `${shown()} ${$('.out').textContent}`)
    } finally { app.dispose() }
  })

  await runTest('Round 3 layers: a controlled popover in a controlled dialog: Escape, a press and a focus on the dialog close the popover only', async () => {
    const { id, app, $ } = await mount(Layered)
    const shown = () => $('.ly-p').matches(':popover-open')
    try {
      await window.__pw('click', `${id} .ly-open`)
      await until(() => $('.ly-d').open, 'dialog open')
      await window.__pw('click', `${id} .ly-menu`)
      await until(() => shown() && $('.out').textContent === 'true|true', () => $('.out').textContent)
      await window.__pw('focus', `${id} .ly-item`)
      await key('Escape')
      await until(() => !shown() && $('.out').textContent === 'true|false', () => `${shown()} ${$('.out').textContent}`)
      assert($('.ly-d').open, 'the first Escape closed the dialog')
      await window.__pw('click', `${id} .ly-menu`)
      await until(() => shown(), 'popover again')
      await window.__pw('click', `${id} .ly-other`)
      await until(() => !shown() && $('.out').textContent === 'true|false', () => `${shown()} ${$('.out').textContent}`)
      await window.__pw('click', `${id} .ly-menu`)
      await until(() => shown(), 'popover again')
      await window.__pw('focus', `${id} .ly-other`)
      await until(() => !shown() && $('.out').textContent === 'true|false', () => `${shown()} ${$('.out').textContent}`)
      await key('Escape')
      await until(() => !$('.ly-d').open && $('.out').textContent === 'false|false', () => `${$('.ly-d').open} ${$('.out').textContent}`)
    } finally { app.dispose() }
  })

  // ── round 2 ─────────────────────────────────────────────────────────
  await runTest('R2 dialog: a reducer writing open opens and closes it; Escape closes through the state, focus back on the opener', async () => {
    const { id, app, $ } = await mount(Editor)
    try {
      await window.__pw('click', `${id} .remote-open`)
      await until(() => $('.ed').open && $('.ed').matches(':modal') && $('.out').textContent === 'true||false', () => $('.out').textContent)
      await window.__pw('click', `${id} .remote-close`)
      await until(() => !$('.ed').open && $('.out').textContent === 'false|model|false', () => $('.out').textContent)
      await window.__pw('press', `${id} .edit`, 'Enter')
      await until(() => $('.ed').open, 'open by the trigger')
      await key('Escape')
      await until(() => !$('.ed').open && $('.out').textContent === 'false||false', () => $('.out').textContent)
      await until(() => activeName() === 'edit', activeName)
    } finally { app.dispose() }
  })

  await runTest('R2 dialog: a host entry refusing Escape and the form submit keeps it open (twice: no CloseWatcher close)', async () => {
    const { id, app, $ } = await mount(Editor)
    try {
      await window.__pw('click', `${id} .edit`)
      await until(() => $('.ed').open, 'open')
      await window.__pw('click', `${id} .dirty`)
      await until(() => $('.out').textContent === 'true||true', () => $('.out').textContent)
      await window.__pw('focus', `${id} .field`)
      await key('Escape')
      await wait(80)
      await key('Escape')
      await wait(80)
      assert($('.ed').open && $('.out').textContent === 'true||true', `Escape closed it: ${$('.ed').open} ${$('.out').textContent}`)
      assert(activeName() === 'field', `focus moved: ${activeName()}`)
      await window.__pw('press', `${id} .field`, 'Enter')
      await wait(80)
      assert($('.ed').open, 'the form submit closed it')
      await window.__pw('click', `${id} .remote-close`)
      await until(() => !$('.ed').open && $('.out').textContent === 'false|model|false', () => $('.out').textContent)
    } finally { app.dispose() }
  })

  await runTest('R2 dialog: the form submit closes with the submitter\'s value; commandfor show-modal opens it through the model', async () => {
    const { id, app, $ } = await mount(Editor)
    try {
      await window.__pw('click', `${id} .cmd-open`)
      await until(() => $('.ed').open && $('.out').textContent === 'true||false', () => $('.out').textContent)
      await window.__pw('click', `${id} .ok`)
      await until(() => !$('.ed').open && $('.out').textContent === 'false|ok|false', () => $('.out').textContent)
      assert($('.ed').returnValue === 'ok', `returnValue ${$('.ed').returnValue}`)
    } finally { app.dispose() }
  })

  await runTest('R2 popover: a reducer shows and hides it; a refused light dismiss opens it again', async () => {
    const { id, app, $ } = await mount(Picker)
    const shown = () => $('.pk').matches(':popover-open')
    try {
      await window.__pw('click', `${id} .pk-set`)
      await until(() => shown() && $('.out').textContent === 'true|false', () => $('.out').textContent)
      await window.__pw('click', `${id} .pk-set`)
      await until(() => !shown() && $('.out').textContent === 'false|false', () => $('.out').textContent)
      await window.__pw('click', `${id} .pk-pin`)
      await window.__pw('click', `${id} .pk-btn`)
      await until(() => shown(), 'opened by popovertarget')
      await key('Escape')
      await until(() => shown() && $('.out').textContent === 'true|true', () => `${shown()} ${$('.out').textContent}`)
    } finally { app.dispose() }
  })

  await runTest('R3 tooltip: a press on the trigger hides the tip at once; it comes back only after the pointer leaves and returns', async () => {
    const { id, app, $ } = await mount(Tb)
    try {
      await window.__pw('hover', `${id} .act`)
      await until(() => $('.out').textContent === 'tip', () => $('.out').textContent)
      await window.__pwInput([['down']])
      await until(() => $('.out').textContent === 'notip', () => $('.out').textContent, 500)
      await window.__pwInput([['up']])
      await wait(300)
      assert($('.out').textContent === 'notip', 'shown again while still hovered')
      await window.__pw('mouse-away')
      await window.__pw('hover', `${id} .act`)
      await until(() => $('.out').textContent === 'tip', () => $('.out').textContent)
    } finally { app.dispose() }
  })

  await runTest('R3 a tooltip on a dialog trigger: closed by the click that opens the modal (WebKit too)', async () => {
    const { id, app, $ } = await mount(Bar)
    try {
      await window.__pw('hover', `${id} .open`)
      await until(() => $('.out').textContent === 'closed|tip', () => $('.out').textContent)
      await window.__pw('click', `${id} .open`)
      await until(() => $('.d').open && $('.out').textContent === 'open|notip', () => $('.out').textContent)
    } finally { app.dispose() }
  })

  await runTest('R4 a dialog, a popover and a tooltip inside a <Portal>: open, state, Escape, close button, focus return', async () => {
    const root = document.createElement('div')
    root.id = 'ui-sweep-portal'
    document.body.appendChild(root)
    const { id, app, $ } = await mount(Portaled)
    const q = (s) => root.querySelector(s)
    try {
      await window.__pw('click', `${id} .pt-open`)
      await until(() => q('.pt-d')?.open && $('.out').textContent === 'true|false|false', () => `${q('.pt-d')?.open} ${$('.out').textContent}`)
      await key('Escape')
      await until(() => !q('.pt-d').open && $('.out').textContent === 'false|false|false', () => `${$('.out').textContent} open=${q('.pt-d').open} closedBy=${q('.pt-d').closedBy} active=${document.activeElement?.className} inBox=${!!document.activeElement?.closest('#ui-sweep-portal')}`)
      await until(() => activeName() === 'pt-open', activeName)
      await window.__pw('click', `${id} .pt-open`)
      await until(() => q('.pt-d').open, 'reopen')
      await window.__pw('click', '#ui-sweep-portal .pt-close')
      await until(() => !q('.pt-d').open && $('.out').textContent === 'false|false|false', () => $('.out').textContent)
      await window.__pw('click', `${id} .pt-pop`)
      await until(() => q('.pt-menu').matches(':popover-open') && $('.out').textContent === 'false|true|false', () => $('.out').textContent)
      await window.__pw('click', '#ui-sweep-portal .pt-done')
      await until(() => !q('.pt-menu').matches(':popover-open') && $('.out').textContent === 'false|false|false', () => $('.out').textContent)
      await window.__pw('hover', `${id} .pt-tt`)
      await until(() => q('.tip').matches(':popover-open') && $('.out').textContent === 'false|false|true', () => $('.out').textContent)
    } finally { app.dispose(); root.remove() }
  })
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
      await until(() => $('.name').value === 'New', () => `draft after Escape: ${$('.name').value} out=${$('.out').textContent}`, 1000)
    } finally { app.dispose() }
  })

  await runTest('Round 5: dialogAttrs names and describes an alert dialog; the trigger\'s aria-expanded follows it', async () => {
    const { id, app, $ } = await mount(Confirm)
    const role = (o) => window.__pw('role', id, o)
    try {
      assert(await role({ role: 'button', name: 'Delete', expanded: false }) === 1, 'trigger collapsed')
      await window.__pw('click', `${id} .cf-open`)
      await until(() => $('.cf-d').open && $('.cf-open').getAttribute('aria-expanded') === 'true', 'opened')
      assert(await role({ role: 'alertdialog', name: 'Delete the file?' }) === 1, 'the alert dialog is named by its title')
      assert(await role({ role: 'button', name: 'Delete', expanded: true, includeHidden: true }) === 1, 'trigger expanded')
      assert(activeName() === 'cf-no', `focus on the safe answer: ${activeName()}`)
      if (ENGINE === 'chromium') {
        const d = await window.__pw('ax', null, { role: 'alertdialog', name: 'Delete the file?', prop: 'description' })
        assert(d === 'It cannot be undone.', `described: ${d}`)
      }
      await key('Escape')
      await until(() => !$('.cf-d').open && $('.cf-open').getAttribute('aria-expanded') === 'false' && $('.cf-d').dataset.state === 'closed', 'closed')
    } finally { app.dispose() }
  })

  await runTest('Round 6: in a shadow root, a dialog returns the focus to its trigger after a mouse click; a controlled popover is dismissed by a press outside', async () => {
    const { id, el } = mountOnScreen()
    el.className = 'ui-sweep'
    const host = document.createElement('div')
    el.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    const sheet = document.createElement('style')
    sheet.textContent = 'dialog { margin: auto; padding: 12px; } [popover] { inset: auto 12px 12px auto; margin: 0; }'
    const point = document.createElement('div')
    root.append(sheet, point)
    const app = run(Shadowed, { TIMER: makeTimerDriver() }, { mountPoint: point })
    const $ = (s) => root.querySelector(s)
    const name = () => { const a = root.activeElement; return a ? a.getAttribute('data-name') || a.className : 'none' }
    try {
      await until(() => $('.sh-open'), 'mounted')
      await window.__pw('click', `${id} .sh-open`)
      await until(() => $('.sh-d').open && $('.out').textContent === 'true|false|0', () => $('.out').textContent)
      assert($('.sh-open').getAttribute('aria-controls') === $('.sh-d').id, 'trigger ARIA in the shadow root')
      await window.__pw('click', `${id} .sh-x`)
      await until(() => !$('.sh-d').open && $('.out').textContent === 'false|false|0', () => $('.out').textContent)
      // (WebKit doesn't focus a clicked button: the focus was lost, and the root's activeElement says so)
      await until(() => name() === 'sh-open', name)
      await window.__pw('click', `${id} .sh-t`)
      await until(() => $('.sh-p').matches(':popover-open') && $('.out').textContent === 'false|true|0', () => $('.out').textContent)
      await window.__pw('click', `${id} .sh-in`)
      await wait(50)
      assert($('.out').textContent === 'false|true|0', `a press inside dismissed it: ${$('.out').textContent}`)
      await window.__pw('click', `${id} .sh-out`)
      await until(() => !$('.sh-p').matches(':popover-open') && $('.out').textContent === 'false|false|1', () => $('.out').textContent)
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
