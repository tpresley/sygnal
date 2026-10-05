// PLAN-5 1-F in a real browser (each engine): the pragma's popover / invoker attributes and aria
// booleans (D196), a region moved into a modal <dialog> keeps its events (G-356), focusWithin
// into a Collection item (D194), a form-associated custom element re-synced after the model
// refuses its value (D196), and the real-input helpers (__pw, __pwInput, D199).
import { run, Collection, focusWithin } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Foundations (PLAN-5 1-F)'
const hasPw = () => typeof window.__pw === 'function'

// on screen (real pointer input); the stage is emptied after each test
const runTest = (cat, name, fn, ms) => run_(cat, name, async () => { try { await fn() } finally { clearStage() } }, ms)

async function start(App, drivers = {}) {
  const { id, el } = mountOnScreen()
  const app = run(App, drivers, { mountPoint: id })
  await waitFor(() => el.children.length > 0)
  await wait(30)
  return { id, el, app }
}

// ── D196: declarative popover / invoker commands; aria booleans ────────────────────────────
function Declarative({ state }) {
  return (
    <div>
      <button className="open-tip" popovertarget="p5f-tip" aria-expanded={state.open}>Tip</button>
      <div id="p5f-tip" className="tip" attrs={{ popover: 'auto' }}>Hello</div>
      <button className="open-dlg" commandfor="p5f-dlg" command="show-modal">Open</button>
      <dialog id="p5f-dlg" className="dlg"><button className="close-dlg" commandfor="p5f-dlg" command="close">Close</button></dialog>
      <input className="field" aria-invalid={state.invalid} aria-required={true} />
      <p className="log">{state.log.join(',')}</p>
    </div>
  )
}
Declarative.initialState = { open: false, invalid: false, log: [] }
Declarative.intent = ({ DOM }) => ({ TOGGLED: DOM.toggle('.tip').map(e => e.newState) })
Declarative.model = { TOGGLED: (s, st) => ({ ...s, open: st === 'open', invalid: st === 'open', log: [...s.log, st] }) }

// ── G-356: a region moved into the open modal dialog ───────────────────────────────────────
function Toast({ state }) { return <li className="toast"><button className="dismiss">{state.text}</button></li> }
Toast.intent = ({ DOM }) => ({ DISMISS: DOM.click('.dismiss') })
Toast.model = { DISMISS: () => undefined }

const intoModal = {
  insert: (vnode) => {
    const el = vnode.elm, modal = document.querySelector('#p5f-modal')
    el.__sygnalHome = el.parentNode
    if (modal) modal.appendChild(el)
  },
}
function Notices({ state }) {
  return (
    <div className="home">
      <section className="notices" hook={intoModal}>
        <button className="clear">Clear</button>
        <ul><Collection of={Toast} from="toasts" /></ul>
      </section>
    </div>
  )
}
Notices.intent = ({ DOM }) => ({ CLEAR: DOM.click('.clear') })
Notices.model = { CLEAR: (s) => ({ ...s, toasts: [], cleared: true }) }

function Page({ state }) {
  return (
    <div>
      <dialog id="p5f-modal"><p>Modal</p></dialog>
      <Notices state="notices" />
      <p className="out">{state.notices.toasts.length + ':' + String(!!state.notices.cleared)}</p>
    </div>
  )
}
Page.initialState = { notices: { toasts: [{ id: 1, text: 'One' }, { id: 2, text: 'Two' }] } }

// ── D194: focusWithin a Collection item ─────────────────────────────────────────────────────
function Row({ state }) { return <li data-id={state.id}><input className="title" aria-label="Title" value={state.title} /></li> }
Row.intent = ({ DOM }) => ({ TITLE: DOM.input('.title').value() })
Row.model = { TITLE: (s, title) => ({ ...s, title }) }
function Checklist() {
  return <div><button className="add">Add item</button><ul><Collection of={Row} from="rows" /></ul></div>
}
Checklist.initialState = { rows: [{ id: 1, title: 'a' }], next: 2 }
Checklist.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
Checklist.model = {
  ADD: {
    STATE: (s) => ({ ...s, rows: [...s.rows, { id: s.next, title: '' }], next: s.next + 1 }),
    ELEMENT: (s) => ({ focus: focusWithin(`[data-id="${s.next}"] .title`) }),
  },
}

// ── D196: a form-associated custom element ──────────────────────────────────────────────────
if (!customElements.get('p5f-stars')) {
  customElements.define('p5f-stars', class extends HTMLElement {
    static formAssociated = true
    constructor() { super(); this._v = 0; this._i = this.attachInternals?.() }
    get value() { return this._v }
    set value(v) { this._v = Number(v); this.textContent = '*'.repeat(this._v); this._i?.setFormValue?.(String(this._v)) }
  })
}
function Capped({ state }) {
  return <div><p5f-stars className="stars" value={state.v} /><p className="refused">{String(state.refused)}</p></div>
}
Capped.initialState = { v: 2, refused: 0 }
Capped.intent = ({ DOM }) => ({ SET: DOM.select('.stars').events('change').map(e => e.target.value) })
Capped.model = { SET: (s, v) => (v > 3 ? { ...s, refused: s.refused + 1 } : { ...s, v }) }

export async function foundationsTestsP5_1F() {
  await runTest(CAT, 'popovertarget opens a popover; its toggle reaches intent; aria-* booleans are "true"/"false"', async () => {
    const { id, el, app } = await start(Declarative)
    try {
      const tip = el.querySelector('.tip'), field = el.querySelector('.field')
      if (typeof tip.showPopover !== 'function') return
      assert(field.getAttribute('aria-invalid') === 'false' && field.getAttribute('aria-required') === 'true', `aria: ${field.outerHTML}`)
      assert(el.querySelector('.open-tip').getAttribute('popovertarget') === 'p5f-tip', 'popovertarget is an attribute')
      if (hasPw()) await window.__pw('click', `${id} .open-tip`)
      else el.querySelector('.open-tip').click()
      await waitFor(() => tip.matches(':popover-open'), 1000)
      await waitFor(() => el.querySelector('.log').textContent === 'open', 1000)
      assert(field.getAttribute('aria-invalid') === 'true', 'aria-invalid="true"')
      assert(el.querySelector('.open-tip').getAttribute('aria-expanded') === 'true', 'aria-expanded="true"')
    } finally { app.dispose() }
  }, 10000)

  await runTest(CAT, 'commandfor / command="show-modal" open and close a dialog (where the browser has invoker commands)', async () => {
    const { el, app } = await start(Declarative)
    try {
      if (!('command' in HTMLButtonElement.prototype)) return
      const dlg = el.querySelector('.dlg')
      el.querySelector('.open-dlg').click()
      await waitFor(() => dlg.open && dlg.matches(':modal'), 1000)
      el.querySelector('.close-dlg').click()
      await waitFor(() => !dlg.open, 1000)
    } finally { app.dispose() }
  }, 10000)

  await runTest(CAT, 'G-356: a region moved into an open modal dialog keeps its events (real clicks)', async () => {
    const { id, el, app } = await start(Page)
    try {
      const modal = el.querySelector('#p5f-modal')
      modal.showModal()
      await waitFor(() => modal.querySelector('.notices'), 1000)
      if (hasPw()) await window.__pw('click', `${id} #p5f-modal .dismiss >> nth=0`)
      else modal.querySelector('.dismiss').click()
      await waitFor(() => el.querySelector('.out').textContent === '1:false', 1000)
      if (hasPw()) await window.__pw('click', `${id} #p5f-modal .clear`)
      else modal.querySelector('.clear').click()
      await waitFor(() => el.querySelector('.out').textContent === '0:true', 1000)
      modal.close()
    } finally { app.dispose() }
  }, 10000)

  await runTest(CAT, 'D194: focusWithin focuses the input of the Collection item the same action adds', async () => {
    const { id, el, app } = await start(Checklist)
    try {
      if (hasPw()) await window.__pw('click', `${id} .add`)
      else el.querySelector('.add').click()
      await waitFor(() => document.activeElement === el.querySelector('[data-id="2"] .title'), 1000)
      if (hasPw()) {
        await window.__pw('type', `${id} [data-id="2"] .title`, 'xy')
        await waitFor(() => el.querySelector('[data-id="2"] .title').value === 'xy', 1000)
      }
    } finally { app.dispose() }
  }, 10000)

  await runTest(CAT, 'D196: a form-associated custom element gets the state value back after a refusal', async () => {
    const { el, app } = await start(Capped)
    try {
      const stars = el.querySelector('.stars')
      await waitFor(() => stars.value === 2, 1000)
      stars.value = 5
      stars.dispatchEvent(new Event('change', { bubbles: true }))
      await waitFor(() => el.querySelector('.refused').textContent === '1', 1000)
      await waitFor(() => stars.value === 2, 1000)
      assert(stars.textContent === '**', `rendered: ${stars.textContent}`)
    } finally { app.dispose() }
  }, 10000)

  await runTest(CAT, 'D199: __pwInput drives the real mouse (move, down, up) at page coordinates', async () => {
    if (typeof window.__pwInput !== 'function') return
    const { el, app } = await start(Checklist)
    try {
      const r = el.querySelector('.add').getBoundingClientRect()
      await window.__pwInput([['move', r.x + r.width / 2, r.y + r.height / 2, 2], ['down'], ['up']])
      await waitFor(() => el.querySelectorAll('li').length === 2, 1000)
      await waitFor(() => document.activeElement === el.querySelector('[data-id="2"] .title'), 1000)
    } finally { app.dispose() }
  }, 10000)
}
