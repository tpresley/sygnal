// PLAN-5 2-U: the sygnal/ui parts in a real engine (BROWSER=chromium|firefox|webkit), driven by
// Playwright's trusted pointer and keyboard (window.__pw / __pwInput): Dialog (focus trap,
// Escape, focus return also after a mouse click, returnValue, nesting), Popover (popovertarget,
// light dismiss, Escape + focus return), Tooltip (hover / focus delays through timers, hoverable,
// Escape, anchor positioning), Tabs / Accordion / Disclosure (roles, names, ARIA states, roving
// focus with the arrow keys, Home / End) and the Toaster (the 0-S4 matrix: above an open modal,
// clickable, Tab-reachable, announced (Chromium AX tree), survives the modal closing, reopening
// and being removed, a transformed modal, auto-dismiss). Ported from the 0-S3 / 0-S4 runners.
//
// WebKit's Tab skips buttons (macOS "keyboard navigation" off), so the Tab checks press Alt+Tab
// there, as Safari users do.
import { run, makeTimerDriver, event, getDiagnostics, clearDiagnostics } from 'sygnal'
import { resetChecks } from 'sygnal/diagnostics'
import {
  dialog, popover, tooltip, tabs, tabsAttrs, accordion, accordionAttrs, disclosure, disclosureAttrs, Toaster,
} from 'sygnal/ui'
import { mountOnScreen, clearStage, assert, runTest as run_, wait } from '../harness.js'

const CAT = 'UI parts (PLAN-5 2-U)'
const hasPw = () => typeof window.__pw === 'function'
const ua = navigator.userAgent
const ENGINE = /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chromium' : 'webkit'
const TAB = ENGINE === 'webkit' ? 'Alt+Tab' : 'Tab'
const SHIFT_TAB = ENGINE === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab'

let style
const css = () => {
  if (style) return
  style = document.createElement('style')
  style.textContent = `
    .ui-p5u dialog::backdrop { background: rgb(0 0 0 / 0.3); }
    /* index.html resets every margin and padding: give the top layer its UA centring back */
    .ui-p5u dialog, .ui-p5u [popover] { margin: auto; padding: 12px; }
    .ui-p5u .tip { inset: auto; margin: 0 0 6px 0; position-area: top; padding: 2px 6px; border: 1px solid; }
    .ui-p5u .toolbar { padding: 60px 0 0 200px; }
    .ui-p5u .toaster { inset: auto 16px 16px auto; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; }
    .ui-p5u .toast { background: #fde68a; padding: 6px; margin-top: 4px; }
    .ui-p5u dialog.transformed { margin: 0; top: 50%; left: 50%; transform: translate(-50%, -50%); }
  `
  document.head.appendChild(style)
}

const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  css()
  window.scrollTo(0, 0)
  try { await fn() } catch (e) {
    // a TypeError in the test itself: say where
    throw e instanceof TypeError ? new Error(`${e.message} @ ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`) : e
  } finally { await window.__pw('mouse-away'); clearStage() }
}, ms)

// waits for a condition, failing with what the page showed
const until = async (pred, what, ms = 2000) => {
  const t0 = Date.now()
  let err
  const ok = () => { try { return pred() } catch (e) { err = e; return false } }
  while (!ok()) {
    if (Date.now() - t0 > ms) {
      let w
      try { w = typeof what === 'function' ? what() : what } catch (e) { w = `${what} (${e.message})` }
      throw new Error(`timed out: ${w}${err ? ` [${err.message}]` : ''}`)
    }
    await wait(10)
  }
  return Date.now() - t0
}
// where the toaster regions are (failure messages)
const regions = () => [...document.querySelectorAll('.toaster')].map((r) => `${r.parentNode?.tagName}.${r.parentNode?.className} in ${r.closest('[id^=test-]')?.id}`).join('; ')
const key = (...keys) => window.__pwInput(keys.map((k) => ['key', k]))
const isOpen = (el) => (el.tagName === 'DIALOG' ? el.open : el.matches(':popover-open'))
const activeName = () => {
  const a = document.activeElement
  return !a || a === document.body ? 'body' : a.getAttribute('aria-label') || a.className || a.tagName.toLowerCase()
}
// the element on top at the centre of `el`
const onTop = (el) => {
  const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return !!hit && (hit === el || el.contains(hit))
}

async function mount(App) {
  const { id, el } = mountOnScreen()
  el.className = 'ui-p5u'
  const app = run(App, { TIMER: makeTimerDriver() }, { mountPoint: id })
  await until(() => el.firstElementChild, 'mounted')
  await wait(30)
  return { id, el, app, $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)] }
}

// ── fixtures (canonical forms; the same as test/p5-2u-fixtures.js, in JSX) ───────────────────
function Help({ state, uid }) {
  return (
    <div className="help-host">
      <button className="before">Before</button>
      <button className="open-help">Keyboard shortcuts</button>
      <dialog className="help" aria-labelledby={uid('title')}>
        <h2 id={uid('title')}>Keyboard shortcuts</h2>
        <label>Search <input className="search" /></label>
        <button className="more" popovertarget={uid('more')}>More</button>
        <div className="more-pop" id={uid('more')} popover="auto" aria-label="More shortcuts">
          <p>N: new card</p>
          <button className="more-ok">OK</button>
        </div>
        <button className="save">Save</button>
        <button className="close-help">Close</button>
      </dialog>
      <button className="after">After</button>
      <p className="status">{state.help.open ? 'open' : 'closed'}:{state.help.returnValue}</p>
      <p className="more-status">{state.more.open ? 'more-open' : 'more-closed'}</p>
    </div>
  )
}
Help.uses = {
  help: dialog({ dialog: '.help', trigger: '.open-help', close: '.close-help' }),
  more: popover({ popover: '.more-pop', close: '.more-ok' }),
}
Help.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
Help.model = { SAVE: { ELEMENT: { close: '.help', returnValue: 'saved' } } }

function Filters({ state, uid }) {
  return (
    <div className="filters-host">
      <button className="filters-btn" popovertarget={uid('filters')}>Filters</button>
      <button className="open-filters">Open filters from the model</button>
      <div className="filters" id={uid('filters')} popover="auto" aria-label="Filters">
        <label><input className="only-open" type="checkbox" /> Only open</label>
        <button className="filters-done">Done</button>
      </div>
      <p className="outside">Outside text</p>
      <p className="filters-status">{state.filters.open ? 'open' : 'closed'}</p>
    </div>
  )
}
Filters.uses = { filters: popover({ popover: '.filters', close: '.filters-done' }) }
Filters.intent = ({ DOM }) => ({ 'filters.OPEN': DOM.click('.open-filters') })

function Toolbar({ state, uid }) {
  const anchor = '--' + uid('save')
  return (
    <div className="toolbar">
      <button className="save-btn" aria-describedby={uid('tip')} style={{ anchorName: anchor }}>Save</button>
      <div className="tip" id={uid('tip')} role="tooltip" popover="manual" style={{ positionAnchor: anchor }}>Save the draft</div>
      <button className="other-btn">Other</button>
      <p className="tip-status">{state.tip.open ? 'shown' : 'hidden'}</p>
    </div>
  )
}
Toolbar.uses = { tip: tooltip({ trigger: '.save-btn', tip: '.tip' }) }

const TABS = [['general', 'General'], ['privacy', 'Privacy'], ['advanced', 'Advanced']]
const tabsApp = (options = {}) => {
  function Settings({ state, uid }) {
    const a = tabsAttrs(state.tabs, uid)
    return (
      <div className="settings">
        <button className="before-tabs">Before</button>
        <div className="tablist" {...a.list} aria-label="Settings">
          {TABS.map(([v, label]) => <button className="tab" {...a.tab(v)}>{label}</button>)}
        </div>
        {TABS.map(([v, label]) => <section className="panel" {...a.panel(v)}><p>{label} settings</p></section>)}
      </div>
    )
  }
  Settings.uses = { tabs: tabs({ tab: '.tab', ...options }) }
  return Settings
}

const FAQ = [['ship', 'Shipping'], ['returns', 'Returns'], ['warranty', 'Warranty']]
function Faq({ state, uid }) {
  const a = accordionAttrs(state.faq, uid)
  return (
    <div className="faq">
      {FAQ.map(([v, q]) => (
        <div className="item">
          <h3><button className="faq-trigger" {...a.trigger(v)}>{q}</button></h3>
          <div className="faq-panel" {...a.panel(v)}><p>{q} answer</p></div>
        </div>
      ))}
    </div>
  )
}
Faq.uses = { faq: accordion({ trigger: '.faq-trigger' }) }

function More({ state, uid }) {
  const a = disclosureAttrs(state.more, uid)
  return (
    <div>
      <button className="more-toggle" {...a.trigger}>Details</button>
      <div className="more-panel" {...a.panel}><p>More text</p></div>
    </div>
  )
}
More.uses = { more: disclosure({ trigger: '.more-toggle' }) }

const toast = (text, kind = 'success', timeoutMs = 0) => event('TOAST', { text, kind, timeoutMs })
const toasterApp = (init = {}) => {
  function App({ state, uid }) {
    return (
      <div className="app">
        <button className="notify">Notify</button>
        <button className="notify-quick">Notify quick</button>
        <button className="open-modal">Edit</button>
        {state.modalMounted && (
          <dialog className={state.transformed ? 'modal transformed' : 'modal'} aria-labelledby={uid('title')}>
            <h2 id={uid('title')}>Edit card</h2>
            <button className="save">Save</button>
            <button className="fail">Fail</button>
            <button className="copy">Copy link</button>
            <button className="remove-modal">Remove dialog</button>
            <button className="close-modal">Close</button>
          </dialog>
        )}
        <button className="after">After</button>
        <Toaster />
      </div>
    )
  }
  App.initialState = { modalMounted: true, transformed: false, ...init }
  App.intent = ({ DOM }) => ({
    NOTIFY: DOM.click('.notify'), QUICK: DOM.click('.notify-quick'), OPEN: DOM.click('.open-modal'),
    SAVE: DOM.click('.save'), FAIL: DOM.click('.fail'), COPY: DOM.click('.copy'),
    CLOSE: DOM.click('.close-modal'), REMOVE_MODAL: DOM.click('.remove-modal'),
  })
  App.model = {
    NOTIFY: { EVENTS: toast('Saved') },
    QUICK: { EVENTS: toast('Copied', 'info', 400) },
    OPEN: { ELEMENT: { showModal: '.modal' } },
    SAVE: { EVENTS: toast('Card saved') },
    FAIL: { EVENTS: toast('Card not saved', 'error') },
    COPY: { EVENTS: toast('Link copied', 'info', 400) },
    CLOSE: { ELEMENT: { close: '.modal' } },
    REMOVE_MODAL: (state) => ({ ...state, modalMounted: false }),
  }
  return App
}

export async function uiTestsP5U() {
  // ── Dialog ───────────────────────────────────────────────────────────
  await runTest('Dialog: the trigger opens it as a modal; role dialog named by its heading', async () => {
    const { id, app, $ } = await mount(Help)
    try {
      await window.__pw('click', `${id} .open-help`)
      await until(() => isOpen($('.help')) && $('.status').textContent === 'open:', () => $('.status').textContent)
      assert($('.help').matches(':modal'), 'not :modal')
      assert(await window.__pw('role', 'body', { role: 'dialog', name: 'Keyboard shortcuts' }) === 1, 'no dialog named "Keyboard shortcuts"')
      const outside = await window.__pw('ax', null, { role: 'button', name: 'After' })
      assert(outside === null || outside === 'ignored' || outside === 'absent', `outside button while modal: ${outside}`)
    } finally { app.dispose() }
  })

  await runTest('Dialog: focus trap (Tab and Shift+Tab never leave it)', async () => {
    const { id, app, $ } = await mount(Help)
    try {
      await window.__pw('click', `${id} .open-help`)
      await until(() => isOpen($('.help')), 'open')
      const seen = []
      for (let i = 0; i < 10; i++) { await key(TAB); seen.push(activeName()) }
      for (let i = 0; i < 4; i++) { await key(SHIFT_TAB); seen.push(activeName()) }
      const out = seen.filter((c) => ['before', 'after', 'open-help'].includes(c))
      assert(out.length === 0, `focused outside the dialog: ${seen.join(' > ')}`)
    } finally { app.dispose() }
  })

  await runTest('Dialog: Escape closes it; state closed; focus back on the opener (keyboard)', async () => {
    const { id, app, $ } = await mount(Help)
    try {
      await window.__pw('press', `${id} .open-help`, 'Enter')
      await until(() => isOpen($('.help')), 'open')
      await key('Escape')
      await until(() => !isOpen($('.help')) && $('.status').textContent === 'closed:', () => $('.status').textContent)
      await until(() => activeName() === 'open-help', activeName)
    } finally { app.dispose() }
  })

  await runTest('Dialog: a host ELEMENT close sets returnValue; Close button; mouse open + close returns the focus (returnFocus)', async () => {
    const { id, app, $ } = await mount(Help)
    try {
      await window.__pw('click', `${id} .open-help`)
      await until(() => isOpen($('.help')), 'open')
      await window.__pw('click', `${id} .save`)
      await until(() => $('.status').textContent === 'closed:saved', () => $('.status').textContent)
      // WebKit leaves the focus on body after a mouse click; the behavior's returnFocus fixes it
      await until(() => activeName() === 'open-help', activeName)
      await window.__pw('click', `${id} .open-help`)
      await until(() => isOpen($('.help')), 'reopen')
      await window.__pw('click', `${id} .close-help`)
      await until(() => $('.status').textContent === 'closed:', () => $('.status').textContent)
      await until(() => activeName() === 'open-help', activeName)
    } finally { app.dispose() }
  })

  await runTest('Dialog: a popover inside it is on top; Escape closes the popover first, then the dialog', async () => {
    const { id, app, $ } = await mount(Help)
    try {
      await window.__pw('click', `${id} .open-help`)
      await until(() => isOpen($('.help')), 'open')
      await window.__pw('click', `${id} .more`)
      await until(() => isOpen($('.more-pop')) && $('.more-status').textContent === 'more-open', () => $('.more-status').textContent)
      assert(onTop($('.more-pop')), 'popover not on top')
      const more = await window.__pw('ax', null, { role: 'button', name: 'More', prop: 'expanded' })
      assert(more === null || more === true, `More expanded: ${more}`)
      await key('Escape')
      await until(() => !isOpen($('.more-pop')), 'Escape did not close the popover')
      await wait(50)
      assert(isOpen($('.help')), 'the first Escape closed the dialog too')
      await key('Escape')
      await until(() => !isOpen($('.help')) && $('.status').textContent === 'closed:', 'second Escape')
    } finally { app.dispose() }
  })

  await runTest('Dialog: a click inside the dialog, outside the nested popover, light-dismisses only the popover', async () => {
    const { id, app, $ } = await mount(Help)
    try {
      await window.__pw('click', `${id} .open-help`)
      await until(() => isOpen($('.help')), 'open')
      await window.__pw('click', `${id} .more`)
      await until(() => isOpen($('.more-pop')), 'popover')
      // a point inside the dialog (its padding), outside the popover (centred in the viewport)
      const d = $('.help').getBoundingClientRect()
      await window.__pwInput([['move', d.left + 4, d.top + 4], ['down'], ['up']])
      await until(() => !isOpen($('.more-pop')) && $('.more-status').textContent === 'more-closed', () => `not light-dismissed: hit ${document.elementFromPoint(d.left + 4, d.top + 4)?.className}`)
      assert(isOpen($('.help')), 'dialog closed by the light dismiss')
    } finally { app.dispose() }
  })

  // ── Popover ──────────────────────────────────────────────────────────
  await runTest('Popover: popovertarget opens it; state follows; aria-expanded; light dismiss closes it', async () => {
    const { id, app, $ } = await mount(Filters)
    try {
      assert($('.filters-btn').getAttribute('popovertarget') === $('.filters').id, 'popovertarget attribute')
      await window.__pw('click', `${id} .filters-btn`)
      await until(() => isOpen($('.filters')) && $('.filters-status').textContent === 'open', () => $('.filters-status').textContent)
      // popovertarget's aria-expanded is the browser's: Chromium's AX tree (Playwright's role query doesn't follow it)
      const ex = await window.__pw('ax', null, { role: 'button', name: 'Filters', prop: 'expanded' })
      assert(ex === null || ex === true, `Filters expanded: ${ex}`)
      await window.__pw('click', `${id} .outside`)
      await until(() => !isOpen($('.filters')) && $('.filters-status').textContent === 'closed', 'not dismissed')
    } finally { app.dispose() }
  })

  await runTest('Popover: Escape closes it and the focus returns to the invoker; model OPEN and the close button', async () => {
    const { id, app, $ } = await mount(Filters)
    try {
      await window.__pw('press', `${id} .filters-btn`, 'Enter')
      await until(() => isOpen($('.filters')), 'open')
      await window.__pw('focus', `${id} .only-open`)
      await key('Escape')
      await until(() => !isOpen($('.filters')), 'Escape')
      await until(() => activeName() === 'filters-btn', activeName)
      await window.__pw('click', `${id} .open-filters`)
      await until(() => isOpen($('.filters')), 'model OPEN')
      await window.__pw('click', `${id} .filters-done`)
      await until(() => !isOpen($('.filters')) && $('.filters-status').textContent === 'closed', 'close button')
    } finally { app.dispose() }
  })

  // ── Tooltip ──────────────────────────────────────────────────────────
  await runTest('Tooltip: hover shows it after ~500 ms (not before) and hides it ~100 ms after leaving', async () => {
    const { id, app, $ } = await mount(Toolbar)
    try {
      await window.__pw('hover', `${id} .save-btn`)
      const t0 = Date.now()
      await wait(300)
      assert(!isOpen($('.tip')), 'shown before the delay')
      await until(() => isOpen($('.tip')), 'never shown', 2000)
      const dt = Date.now() - t0
      assert(dt >= 400 && dt < 1500, `show delay ${dt}`)
      await until(() => $('.tip-status').textContent === 'shown', 'state')
      await window.__pw('hover', `${id} .other-btn`)
      const t1 = Date.now()
      await until(() => !isOpen($('.tip')), 'never hidden', 2000)
      const dh = Date.now() - t1
      assert(dh >= 40 && dh < 1000, `hide delay ${dh}`)
    } finally { app.dispose() }
  })

  await runTest('Tooltip: leaving before the delay never shows it; the pointer on the tip keeps it open', async () => {
    const { id, app, $ } = await mount(Toolbar)
    try {
      await window.__pw('hover', `${id} .save-btn`)
      await wait(200)
      await window.__pw('hover', `${id} .other-btn`)
      await wait(700)
      assert(!isOpen($('.tip')), 'shown after an early leave')
      await window.__pw('hover', `${id} .save-btn`)
      await until(() => isOpen($('.tip')), 'not shown', 2000)
      const b = $('.save-btn').getBoundingClientRect(), tp = $('.tip').getBoundingClientRect()
      await window.__pwInput([['move', b.left + b.width / 2, tp.top + tp.height / 2, 3]])
      await wait(400)
      assert(isOpen($('.tip')), 'hidden while the pointer is on it')
    } finally { app.dispose() }
  })

  await runTest('Tooltip: anchor positioning (above its trigger, centred, follows it); focus shows it, Escape hides it at once', async () => {
    const { id, app, $ } = await mount(Toolbar)
    try {
      await window.__pw('focus', `${id} .save-btn`)
      await until(() => isOpen($('.tip')), 'not shown on focus', 2000)
      let b = $('.save-btn').getBoundingClientRect(), t = $('.tip').getBoundingClientRect()
      assert(Math.abs(t.bottom + 6 - b.top) <= 2, `tip bottom ${t.bottom} + 6 vs anchor top ${b.top}`)
      assert(Math.abs((t.left + t.right) / 2 - (b.left + b.right) / 2) <= 2, 'not centred')
      $('.save-btn').style.marginLeft = '150px'
      await wait(50)
      b = $('.save-btn').getBoundingClientRect(); t = $('.tip').getBoundingClientRect()
      assert(Math.abs((t.left + t.right) / 2 - (b.left + b.right) / 2) <= 2, 'did not follow the anchor')
      assert(await window.__pw('role', 'body', { role: 'tooltip', name: 'Save the draft' }) === 1, 'no tooltip named "Save the draft"')
      const desc = await window.__pw('ax', null, { role: 'button', name: 'Save', prop: 'description' })
      assert(desc === null || desc === 'Save the draft', `button description: ${desc}`)
      const t0 = Date.now()
      await key('Escape')
      await until(() => !isOpen($('.tip')), 'Escape', 1000)
      assert(Date.now() - t0 < 300, 'Escape waited for the hide delay')
      assert(activeName() === 'save-btn', `focus moved: ${activeName()}`)
    } finally { app.dispose() }
  })

  await runTest('Tooltip: Tab away hides it', async () => {
    const { id, app, $ } = await mount(Toolbar)
    try {
      await window.__pw('focus', `${id} .save-btn`)
      await until(() => isOpen($('.tip')), 'not shown on focus', 2000)
      await key(TAB)
      await until(() => !isOpen($('.tip')), 'not hidden on blur', 2000)
    } finally { app.dispose() }
  })

  await runTest('Tooltip: anchor positioning on a scrolled page (an in-flow trigger; a trigger in a position: fixed bar, except WebKit)', async () => {
    const tall = document.body.style.minHeight
    document.body.style.minHeight = '10000px'
    const host = document.createElement('div')
    host.id = 'probe-flow'
    host.className = 'ui-p5u'
    host.style.cssText = 'position: absolute; top: 3000px; left: 0; width: 600px;'
    document.body.appendChild(host)
    window.scrollTo(0, 2900)
    const app = run(Toolbar, { TIMER: makeTimerDriver() }, { mountPoint: '#probe-flow' })
    try {
      await until(() => host.querySelector('.save-btn'), 'mounted')
      await window.__pw('focus', '#probe-flow .save-btn')
      await until(() => isOpen(host.querySelector('.tip')), 'shown', 2000)
      const b = host.querySelector('.save-btn').getBoundingClientRect(), t = host.querySelector('.tip').getBoundingClientRect()
      assert(Math.abs(t.bottom + 6 - b.top) <= 2, `in-flow: tip bottom ${t.bottom} + 6 vs anchor top ${b.top} (scrollY ${window.scrollY})`)
    } finally { app.dispose(); host.remove() }
    // the stage is position: fixed. WebKit 26.6 offsets a tip anchored inside a fixed element by
    // the page's scroll (documented on the Tooltip page); Chromium and Firefox place it right
    if (ENGINE !== 'webkit') {
      const { id, app: app2, $ } = await mount(Toolbar)
      try {
        window.scrollTo(0, 2900)
        await window.__pw('focus', `${id} .save-btn`)
        await until(() => isOpen($('.tip')), 'shown in the fixed bar', 2000)
        const b = $('.save-btn').getBoundingClientRect(), t = $('.tip').getBoundingClientRect()
        assert(Math.abs(t.bottom + 6 - b.top) <= 2, `fixed bar: tip bottom ${t.bottom} + 6 vs anchor top ${b.top} (scrollY ${window.scrollY})`)
      } finally { app2.dispose() }
    }
    document.body.style.minHeight = tall
    window.scrollTo(0, 0)
  })
  // ── Tabs ─────────────────────────────────────────────────────────────
  await runTest('Tabs: roles and names; the arrow keys move focus and selection (wrap), Home / End; a click selects', async () => {
    const { id, app, $ } = await mount(tabsApp({ selected: 'general' }))
    const tab = (v) => $(`.tab[data-value="${v}"]`)
    const shown = () => $$visible()
    const $$visible = () => [...document.querySelectorAll(`${id} .panel`)].filter((p) => !p.hidden).map((p) => p.textContent).join()
    try {
      assert(await window.__pw('role', id, { role: 'tablist', name: 'Settings' }) === 1, 'tablist')
      assert(await window.__pw('role', id, { role: 'tab', name: 'General', selected: true }) === 1, 'General selected')
      assert(await window.__pw('role', id, { role: 'tabpanel', name: 'General' }) === 1, 'panel named by its tab')
      assert(await window.__pw('role', id, { role: 'tabpanel' }) === 1, 'only one panel shown')
      await window.__pw('focus', `${id} .tab[data-value="general"]`)
      await key('ArrowRight')
      await until(() => document.activeElement === tab('privacy') && shown() === 'Privacy settings', () => `${activeName()} ${shown()}`)
      assert(tab('privacy').tabIndex === 0 && tab('general').tabIndex === -1, 'roving tabindex')
      await key('ArrowRight', 'ArrowRight')
      await until(() => document.activeElement === tab('general'), 'wrap', 1500)
      await key('ArrowLeft')
      await until(() => document.activeElement === tab('advanced') && shown() === 'Advanced settings', 'ArrowLeft wraps')
      await key('Home')
      await until(() => document.activeElement === tab('general'), 'Home')
      await key('End')
      await until(() => document.activeElement === tab('advanced'), 'End')
      await key('ArrowDown') // not a key of a horizontal tablist
      await wait(50)
      assert(document.activeElement === tab('advanced'), 'ArrowDown moved the focus in a horizontal tablist')
      await window.__pw('click', `${id} .tab[data-value="privacy"]`)
      await until(() => shown() === 'Privacy settings', shown)
      assert(await window.__pw('role', id, { role: 'tab', name: 'Privacy', selected: true }) === 1, 'Privacy selected')
    } finally { app.dispose() }
  })

  await runTest('Tabs: manual activation (arrows move the focus, Enter selects); Tab from the tab list goes to the panel', async () => {
    const { id, app, $ } = await mount(tabsApp({ activation: 'manual' }))
    const tab = (v) => $(`.tab[data-value="${v}"]`)
    try {
      await window.__pw('focus', `${id} .tab[data-value="general"]`)
      await key('ArrowRight')
      await until(() => document.activeElement === tab('privacy'), activeName)
      assert(tab('general').getAttribute('aria-selected') === 'true', 'selection moved with the focus')
      await key('Enter')
      await until(() => tab('privacy').getAttribute('aria-selected') === 'true', 'Enter did not select')
      await key(TAB)
      await until(() => document.activeElement?.getAttribute('role') === 'tabpanel' && !document.activeElement.hidden, () => `Tab went to ${activeName()}`)
    } finally { app.dispose() }
  })

  // ── Accordion ────────────────────────────────────────────────────────
  await runTest('Accordion: a click toggles (one open); regions named by their buttons; Up / Down / Home / End move the focus; Space toggles', async () => {
    const { id, app, $ } = await mount(Faq)
    const trig = (v) => $(`.faq-trigger[data-value="${v}"]`)
    try {
      assert(await window.__pw('role', id, { role: 'button', name: 'Shipping', expanded: false }) === 1, 'collapsed button')
      await window.__pw('click', `${id} .faq-trigger[data-value="ship"]`)
      await until(() => trig('ship').getAttribute('aria-expanded') === 'true', 'expand')
      assert(await window.__pw('role', id, { role: 'region', name: 'Shipping' }) === 1, 'region named Shipping')
      await window.__pw('click', `${id} .faq-trigger[data-value="returns"]`)
      await until(() => trig('returns').getAttribute('aria-expanded') === 'true' && trig('ship').getAttribute('aria-expanded') === 'false', 'one open')
      // (a click doesn't focus a button in WebKit)
      await window.__pw('focus', `${id} .faq-trigger[data-value="returns"]`)
      await key('ArrowDown')
      await until(() => document.activeElement === trig('warranty'), activeName)
      await key('ArrowDown')
      await until(() => document.activeElement === trig('ship'), 'wrap')
      await key('End')
      await until(() => document.activeElement === trig('warranty'), 'End')
      await key('ArrowUp', 'Home')
      await until(() => document.activeElement === trig('ship'), 'Home')
      await key(' ')
      await until(() => trig('ship').getAttribute('aria-expanded') === 'true', 'Space')
      assert(!$(`#${trig('ship').getAttribute('aria-controls')}`).hidden, 'panel shown')
    } finally { app.dispose() }
  })

  // ── Disclosure ───────────────────────────────────────────────────────
  await runTest('Disclosure: Enter and a click toggle it; aria-expanded; the panel shows and hides', async () => {
    const { id, app, $ } = await mount(More)
    try {
      assert(await window.__pw('role', id, { role: 'button', name: 'Details', expanded: false }) === 1, 'collapsed')
      assert($('.more-panel').hidden && !$('.more-panel').checkVisibility(), 'panel visible at the start')
      await window.__pw('press', `${id} .more-toggle`, 'Enter')
      await until(() => $('.more-toggle').getAttribute('aria-expanded') === 'true' && $('.more-panel').checkVisibility(), 'Enter')
      await window.__pw('click', `${id} .more-toggle`)
      await until(() => $('.more-panel').hidden, 'click')
    } finally { app.dispose() }
  })

  // ── PLAN-5 2-S ───────────────────────────────────────────────────────
  // G-405: cancelable: false holds against a second Escape (Chromium's CloseWatcher closes without
  // a cancel event otherwise); G-407: returnFocus goes to the trigger that opened it
  function Locked({ state }) {
    return (
      <div>
        <button className="row-edit" aria-label="Edit 1">Edit 1</button>
        <button className="row-edit" aria-label="Edit 2">Edit 2</button>
        <dialog className="locked" aria-label="Locked">
          <p>Locked</p>
          <button className="locked-done">Done</button>
        </dialog>
        <p className="locked-status">{state.locked.open ? 'open' : 'closed'}</p>
      </div>
    )
  }
  Locked.uses = { locked: dialog({ dialog: '.locked', trigger: '.row-edit', close: '.locked-done', cancelable: false }) }

  await runTest('Dialog (G-405): cancelable: false stays open after Escape, Escape; (G-407) returnFocus goes to the trigger that opened it', async () => {
    const { id, app, $ } = await mount(Locked)
    try {
      await window.__pw('press', `${id} [aria-label="Edit 2"]`, 'Enter')
      await until(() => isOpen($('.locked')), 'open')
      await key('Escape')
      await wait(50)
      await key('Escape')
      await wait(100)
      assert(isOpen($('.locked')), 'closed by the second Escape')
      assert($('.locked-status').textContent === 'open', $('.locked-status').textContent)
      await window.__pw('click', `${id} .locked-done`)
      await until(() => !isOpen($('.locked')) && $('.locked-status').textContent === 'closed', 'closed by Done')
      await until(() => activeName() === 'Edit 2', activeName)
      // a mouse open of the second row: the focus comes back to it, not to the first trigger
      await window.__pw('click', `${id} [aria-label="Edit 2"]`)
      await until(() => isOpen($('.locked')), 'reopen')
      await window.__pw('click', `${id} .locked-done`)
      await until(() => !isOpen($('.locked')), 'closed again')
      await until(() => activeName() === 'Edit 2', activeName)
    } finally { app.dispose() }
  })

  // G-400: a dialog removed while open (non-modal, so the page is usable) opens again when back;
  // G-406: a popover's OPEN and CLOSE in one tick leave it closed
  function Removable({ state }) {
    return (
      <div>
        <button className="toggle-dialog">Toggle the dialog</button>
        <button className="open-panel">Open</button>
        {state.shown && <dialog className="panel" aria-label="Panel"><p>Panel</p></dialog>}
        <button className="blink">Blink</button>
        <div className="blink-pop" popover="auto" aria-label="Blink">blink</div>
        <p className="panel-status">{state.panel.open ? 'open' : 'closed'}</p>
        <p className="blink-status">{state.blink.open ? 'open' : 'closed'}</p>
      </div>
    )
  }
  Removable.initialState = { shown: true }
  Removable.uses = {
    panel: dialog({ dialog: '.panel', trigger: '.open-panel', modal: false }),
    blink: popover({ popover: '.blink-pop' }),
  }
  Removable.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle-dialog'), 'blink.OPEN': DOM.click('.blink'), 'blink.CLOSE': DOM.click('.blink') })
  Removable.model = { TOGGLE: (state) => ({ ...state, shown: !state.shown }) }

  await runTest('Dialog (G-400): removed while open, back, and opened again; Popover (G-406): OPEN and CLOSE in one tick leave it closed', async () => {
    const { id, app, $ } = await mount(Removable)
    try {
      await window.__pw('click', `${id} .open-panel`)
      await until(() => $('.panel')?.open && $('.panel-status').textContent === 'open', 'open')
      await window.__pw('click', `${id} .toggle-dialog`)
      await until(() => !$('.panel') && $('.panel-status').textContent === 'closed', () => `removed: ${$('.panel-status').textContent}`)
      await window.__pw('click', `${id} .toggle-dialog`)
      await until(() => $('.panel'), 'back')
      await window.__pw('click', `${id} .open-panel`)
      await until(() => $('.panel').open && $('.panel-status').textContent === 'open', () => `reopened: ${$('.panel').open} ${$('.panel-status').textContent}`)
      await window.__pw('click', `${id} .blink`)
      await wait(150)
      assert(!isOpen($('.blink-pop')), 'the popover stayed open')
      assert($('.blink-status').textContent === 'closed', $('.blink-status').textContent)
    } finally { app.dispose() }
  })

  // ── Toaster (0-S4 matrix) ────────────────────────────────────────────
  // the Dismiss button of a live toast (a dismissed one stays in the DOM during its leave transition)
  const dismissOf = (text) => `.toast:not(.toast-leave-active) [aria-label="Dismiss: ${text}"]`
  const live = (el, text) => [...el.querySelectorAll('.toast:not(.toast-leave-active)')].filter((t) => t.querySelector('.toast-text').textContent === text)
  // Tab (Alt+Tab in WebKit) up to n times: does the focus reach the Dismiss button?
  const tabReaches = async (text, n = 14) => {
    for (let i = 0; i < n; i++) {
      await key(TAB)
      if (activeName() === `Dismiss: ${text}`) return true
    }
    return false
  }
  // the matrix checks for one toast: on top, clickable (a real click on its Dismiss removes it)
  const checkToast = async (el, text, where) => {
    const btn = el.querySelector(dismissOf(text))
    assert(btn, `${where}: no toast "${text}"`)
    await until(() => !el.querySelector('.toast-enter-active'), 'enter transition', 1000).catch(() => {})
    const r = btn.getBoundingClientRect(), region = btn.closest('.toaster')
    assert(region, `${where}: the Dismiss button is outside the region: ${(() => { const a = []; for (let p = btn; p; p = p.parentElement) a.push(p.tagName + '.' + p.className); return a.join(' < ') })()}`)
    assert(onTop(btn), `${where}: "${text}" is not on top (hit ${document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.className}; region in ${region.parentNode?.className}, open ${region.matches(':popover-open')})`)
  }
  const pointerDismiss = async (el, text) => {
    await window.__pw('click', dismissOf(text))
    await until(() => live(el, text).length === 0, `pointer Dismiss of "${text}"`)
  }

  await runTest('Toaster: a toast without a modal: top layer, on top, in the status region, Tab-reachable, dismissed by a click', async () => {
    const { id, app, el } = await mount(toasterApp())
    try {
      await window.__pw('click', `${id} .notify`)
      await until(() => live(el, 'Saved').length === 1, 'shown')
      assert(el.querySelector('.toaster').matches(':popover-open'), 'region not in the top layer')
      await checkToast(el, 'Saved', 'page')
      assert(await window.__pw('role', 'body', { role: 'status' }) >= 1, 'no status region')
      const ax = await window.__pw('ax', null, { role: 'button', name: 'Dismiss: Saved', in: 'status' })
      assert(ax === null || ax === 'exposed', `a11y: ${ax}`)
      await window.__pw('focus', `${id} .after`)
      assert(await tabReaches('Saved', 4), 'Tab does not reach Dismiss')
      await pointerDismiss(el, 'Saved')
    } finally { app.dispose() }
  })

  await runTest('Toaster: toasts sent from inside an open modal: moved into it, on top, clickable, Tab-reachable, exposed; the modal stays open', async () => {
    const { id, app, el, $ } = await mount(toasterApp())
    try {
      await window.__pw('click', `${id} .open-modal`)
      await until(() => $('.modal').matches(':modal'), 'modal')
      await window.__pw('click', `${id} .save`)
      await window.__pw('click', `${id} .fail`)
      await until(() => live(el, 'Card saved').length === 1 && live(el, 'Card not saved').length === 1, 'shown')
      assert($('.toaster').parentNode === $('.modal'), 'region not moved into the modal')
      assert($('.toaster').matches(':popover-open'), 'region not shown after the move')
      await checkToast(el, 'Card saved', 'modal')
      const s = await window.__pw('ax', null, { role: 'button', name: 'Dismiss: Card saved', in: 'status' })
      const a = await window.__pw('ax', null, { role: 'button', name: 'Dismiss: Card not saved', in: 'alert' })
      assert((s === null || s === 'exposed') && (a === null || a === 'exposed'), `a11y: status ${s}, alert ${a}`)
      assert(await window.__pw('role', '.modal', { role: 'alert' }) === 1, 'no alert region in the modal')
      await window.__pw('focus', `${id} .save`)
      assert(await tabReaches('Card saved'), 'Tab does not reach Dismiss')
      await pointerDismiss(el, 'Card saved')
      assert($('.modal').matches(':modal'), 'modal closed by the Dismiss')
    } finally { app.dispose() }
  })

  await runTest('Toaster: shown before the modal opens, it moves into it; when the modal closes it goes home, still on top, and the next round trip works', async () => {
    const { id, app, el, $ } = await mount(toasterApp())
    try {
      await window.__pw('click', `${id} .notify`)
      await until(() => live(el, 'Saved').length === 1, 'shown')
      await window.__pw('click', `${id} .open-modal`)
      await until(() => $('.modal').matches(':modal') && $('.toaster')?.parentNode === $('.modal'), () => `moved in: ${[...document.querySelectorAll('.toaster')].map((r) => `${r.parentNode?.tagName}.${r.parentNode?.className} in ${r.closest('[id^=test-]')?.id}`).join('; ')} / el ${el.id}`)
      await wait(50)
      await checkToast(el, 'Saved', 'after showModal')
      await window.__pw('click', `${id} .save`)
      await until(() => live(el, 'Card saved').length === 1, 'shown in modal')
      await window.__pw('click', `${id} .close-modal`)
      await until(() => !$('.modal').open && $('.toaster').parentNode === $('.toaster-home'), () => `moved home: ${regions()}`)
      await wait(50)
      await checkToast(el, 'Card saved', 'after close')
      await pointerDismiss(el, 'Card saved')
      await pointerDismiss(el, 'Saved')
      await window.__pw('click', `${id} .open-modal`)
      await until(() => $('.modal').matches(':modal'), () => `reopen: ${regions()}`)
      await window.__pw('click', `${id} .save`)
      await until(() => live(el, 'Card saved').length === 1, 'shown in the reopened modal')
      await checkToast(el, 'Card saved', 'reopened modal')
      await pointerDismiss(el, 'Card saved')
    } finally { app.dispose() }
  })

  await runTest('Toaster: the dialog removed while open: the region survives at home; a transformed modal', async () => {
    const { id, app, el, $ } = await mount(toasterApp({ transformed: true }))
    try {
      await window.__pw('click', `${id} .open-modal`)
      await until(() => $('.modal').matches(':modal'), 'modal')
      await window.__pw('click', `${id} .save`)
      await until(() => live(el, 'Card saved').length === 1, 'shown')
      await wait(50)
      await checkToast(el, 'Card saved', 'transformed modal')
      const r = el.querySelector(dismissOf('Card saved')).getBoundingClientRect()
      assert(window.innerWidth - r.right < 60 && window.innerHeight - r.bottom < 60, `not at the viewport corner: ${window.innerWidth - r.right}/${window.innerHeight - r.bottom}`)
      await window.__pw('click', `${id} .remove-modal`)
      await until(() => !$('.modal') && $('.toaster')?.parentNode === $('.toaster-home'), 'region lost with the dialog')
      await wait(50)
      await checkToast(el, 'Card saved', 'after removal')
      await pointerDismiss(el, 'Card saved')
      await window.__pw('click', `${id} .notify`)
      await until(() => live(el, 'Saved').length === 1, 'next toast')
      await checkToast(el, 'Saved', 'next toast')
    } finally { app.dispose() }
  })

  await runTest('Toaster: auto-dismiss (400 ms) in the page and in a modal; hovering pauses it', async () => {
    const { id, app, el, $ } = await mount(toasterApp())
    try {
      await window.__pw('click', `${id} .notify-quick`)
      const t0 = Date.now()
      await until(() => live(el, 'Copied').length === 1, 'shown')
      await until(() => el.querySelectorAll('.toast').length === 0, 'not removed', 2500)
      assert(Date.now() - t0 >= 350, `removed too early: ${Date.now() - t0}`)
      await window.__pw('click', `${id} .open-modal`)
      await until(() => $('.modal').matches(':modal'), 'modal')
      await window.__pw('click', `${id} .copy`)
      await until(() => live(el, 'Link copied').length === 1, 'shown in modal')
      await window.__pw('hover', dismissOf('Link copied'))
      await wait(700)
      assert(live(el, 'Link copied').length === 1, 'dismissed while hovered')
      await window.__pw('mouse-away')
      await until(() => el.querySelectorAll('.toast').length === 0, 'not removed after leaving', 2500)
    } finally { app.dispose() }
  })

  // PLAN-5 2-S G-399: the focus and the pointer pause apart; Dismiss by keyboard moves the focus on
  await runTest('Toaster (G-399): keyboard Dismiss moves the focus to the next toast; the pointer leaving keeps a focused region paused; nothing stays paused', async () => {
    const { id, app, el, $ } = await mount(toasterApp())
    try {
      await window.__pw('click', `${id} .notify`)
      await window.__pw('click', `${id} .notify-quick`)
      await until(() => live(el, 'Saved').length === 1 && live(el, 'Copied').length === 1, 'shown')
      await window.__pw('focus', dismissOf('Saved'))
      await until(() => $('.toaster').hasAttribute('data-paused'), 'paused by the focus')
      // the pointer comes and goes: the focus still holds it
      await window.__pw('hover', dismissOf('Copied'))
      await window.__pw('mouse-away')
      await wait(700)
      assert(live(el, 'Copied').length === 1, 'Copied expired while the focus was in the region')
      await key('Enter')
      await until(() => live(el, 'Saved').length === 0, 'Enter dismissed Saved')
      assert(activeName() === 'Dismiss: Copied', `focus after Dismiss: ${activeName()}`)
      await wait(600)
      assert(live(el, 'Copied').length === 1, 'Copied expired while focused')
      await key('Enter')
      await until(() => live(el, 'Copied').length === 0, 'Enter dismissed Copied')
      assert(!el.querySelector('.toaster').contains(document.activeElement), `focus left in the region: ${activeName()}`)
      await until(() => !el.querySelectorAll('.toast').length, 'removed', 1000)
      await until(() => !$('.toaster').hasAttribute('data-paused'), 'still paused after the last toast went')
      // the next toast's timer runs
      await window.__pw('click', `${id} .notify-quick`)
      await until(() => live(el, 'Copied').length === 1, 'shown again')
      await until(() => live(el, 'Copied').length === 0, 'the next toast never expired', 2500)
    } finally { app.dispose() }
  })

  // PLAN-5 2-S G-404: a Toaster in a shadow root (sygnal/element) moves into a modal dialog there
  await runTest('Toaster (G-404): in a shadow root, it moves into that root\'s open modal dialog and back', async () => {
    const { el } = mountOnScreen()
    el.className = 'ui-p5u'
    const host = document.createElement('div')
    el.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    const sheet = document.createElement('style')
    sheet.textContent = '.toaster { inset: auto 16px 16px auto; margin: 0; } dialog { margin: auto; }'
    const point = document.createElement('div')
    root.append(sheet, point)
    function App() { return <div><dialog className="modal" aria-label="Modal"><p>modal</p></dialog><Toaster state="toaster" /></div> }
    App.initialState = { toaster: { toasts: [{ id: 'a', text: 'Hi', kind: 'info', timeoutMs: 0, paused: false, rev: 0 }], next: 1, paused: false, hover: false, focus: false } }
    const app = run(App, { TIMER: makeTimerDriver() }, { mountPoint: point })
    try {
      await until(() => root.querySelector('.toast'), 'mounted')
      const $ = (s) => root.querySelector(s)
      $('.modal').showModal()
      await until(() => $('.toaster').parentNode === $('.modal'), () => `in ${$('.toaster').parentNode?.className}`)
      assert($('.toaster').matches(':popover-open'), 'region shown in the dialog')
      $('.modal').close()
      await until(() => $('.toaster').parentNode === $('.toaster-home'), 'back home')
    } finally { app.dispose() }
  })

  await runTest('Toaster: a toast whose Dismiss button had the focus when the modal closed is back home and still dismissed by Enter', async () => {
    const { id, app, el, $ } = await mount(toasterApp())
    try {
      await window.__pw('click', `${id} .open-modal`)
      await until(() => $('.modal').matches(':modal'), 'modal')
      await window.__pw('click', `${id} .save`)
      await until(() => live(el, 'Card saved').length === 1, 'shown')
      await window.__pw('focus', dismissOf('Card saved'))
      $('.modal').close()
      await until(() => $('.toaster').parentNode === $('.toaster-home'), () => `moved home: ${regions()}`)
      // the browser moves the focus out of a closing modal (to its opener; WebKit: body after a mouse click)
      await wait(30)
      assert(activeName() !== 'Dismiss: Card saved', 'focus stayed on the moved button')
      await window.__pw('focus', dismissOf('Card saved'))
      await key('Enter')
      await until(() => live(el, 'Card saved').length === 0, 'Enter')
    } finally { app.dispose() }
  })

  // ── PLAN-5 3-F ───────────────────────────────────────────────────────
  // G-429: cancelable: false (closedby="none") still runs a host CANCEL entry on Escape, and the
  // attribute it set goes when the dialog closes
  function Strict({ state }) {
    return (
      <div>
        <button className="strict-open">Open strict</button>
        <dialog className="strict" aria-label="Strict"><button className="strict-done">Done</button></dialog>
        <p className="strict-cancels">{String(state.cancels)}</p>
      </div>
    )
  }
  Strict.initialState = { cancels: 0 }
  Strict.uses = { strict: dialog({ dialog: '.strict', trigger: '.strict-open', close: '.strict-done', cancelable: false }) }
  Strict.model = { 'strict.CANCEL': (state) => ({ ...state, cancels: state.cancels + 1 }) }

  await runTest('Dialog (G-429): cancelable: false: Escape keeps it open and runs CANCEL (each press); closedby goes on close', async () => {
    const { id, app, $ } = await mount(Strict)
    try {
      await window.__pw('press', `${id} .strict-open`, 'Enter')
      await until(() => isOpen($('.strict')), 'open')
      assert($('.strict').getAttribute('closedby') === 'none', `closedby ${$('.strict').getAttribute('closedby')}`)
      await key('Escape')
      await until(() => $('.strict-cancels').textContent === '1', () => `CANCEL ran ${$('.strict-cancels').textContent} times`)
      await key('Escape')
      await until(() => $('.strict-cancels').textContent === '2', () => `CANCEL ran ${$('.strict-cancels').textContent} times`)
      assert(isOpen($('.strict')), 'closed by Escape')
      await window.__pw('click', `${id} .strict-done`)
      await until(() => !isOpen($('.strict')), 'closed by Done')
      // (the close event is a task after the dialog closed)
      await until(() => !$('.strict').hasAttribute('closedby'), 'closedby left on the closed dialog')
    } finally { app.dispose() }
  })

  // G-430: returnFocus with a dialog rendered only while it is open: the opener gets the focus
  // back, with no SYG640 for the dialog that is gone
  function Transient({ state }) {
    return (
      <div>
        <button className="t-open">Open transient</button>
        {state.t.open && <dialog className="transient" aria-label="Transient"><button className="t-done">Done</button></dialog>}
      </div>
    )
  }
  Transient.uses = { t: dialog({ dialog: '.transient', trigger: '.t-open', close: '.t-done' }) }

  await runTest('Dialog (G-430): rendered only while open: the focus returns to the opener, no SYG640', async () => {
    resetChecks()
    clearDiagnostics()
    const { id, el } = mountOnScreen()
    el.className = 'ui-p5u'
    const app = run(Transient, {}, { mountPoint: id, diagnostics: 'collect' })
    const $ = (s) => el.querySelector(s)
    await until(() => el.firstElementChild, 'mounted')
    try {
      // OPEN renders the dialog and opens it in the same patch's commands
      await window.__pw('click', `${id} .t-open`)
      await until(() => $('.transient')?.open, () => `open: ${!!$('.transient')}`)
      await window.__pw('click', `${id} .t-done`)
      await until(() => !$('.transient'), 'removed')
      await until(() => activeName() === 't-open', activeName)
      await wait(1200)
      const codes = getDiagnostics().map((d) => d.code)
      assert(!codes.includes('SYG640') && !codes.includes('SYG641'), `diagnostics: ${codes.join(', ')}`)
    } finally { app.dispose() }
  }, 9000)

  // G-426: a Toaster in a shadow root reads the focus from that root (the document's is the host)
  await runTest('Toaster (G-426): in a shadow root, a focused Dismiss keeps the region paused through mutations, and Enter moves the focus on', async () => {
    const { el } = mountOnScreen()
    el.className = 'ui-p5u'
    const host = document.createElement('div')
    el.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    const sheet = document.createElement('style')
    sheet.textContent = '.toaster { inset: auto 16px 16px auto; margin: 0; }'
    const point = document.createElement('div')
    root.append(sheet, point)
    const t = (id, text) => ({ id, text, kind: 'info', timeoutMs: 0, paused: false, rev: 0 })
    function App() { return <div><Toaster state="toaster" /></div> }
    App.initialState = { toaster: { toasts: [t('a', 'One'), t('b', 'Two')], next: 1, paused: false, hover: false, focus: false } }
    const app = run(App, { TIMER: makeTimerDriver() }, { mountPoint: point })
    const $ = (s) => root.querySelector(s)
    try {
      await until(() => root.querySelectorAll('.toast').length === 2, 'mounted')
      await window.__pw('focus', '[aria-label="Dismiss: One"]')
      await until(() => $('.toaster').hasAttribute('data-paused'), 'paused')
      assert(document.activeElement === host && root.activeElement === $('[aria-label="Dismiss: One"]'), 'focus in the shadow root')
      // a mutation in the root: the region's observer runs
      point.appendChild(document.createElement('span'))
      await wait(60)
      assert($('.toaster').hasAttribute('data-paused'), 'unpaused by a mutation (a false focusout)')
      await key('Enter')
      await until(() => root.activeElement?.getAttribute('aria-label') === 'Dismiss: Two', () => `focus on ${root.activeElement?.getAttribute('aria-label') || root.activeElement?.tagName}`)
    } finally { app.dispose() }
  })

  // G-428: a focusout with no relatedTarget while the focus stays (the window lost it) keeps the
  // region paused; a real move of the focus out of it resumes
  await runTest('Toaster (G-428): focusout without relatedTarget keeps it paused; a click outside resumes', async () => {
    const { id, app, el, $ } = await mount(toasterApp())
    try {
      await window.__pw('click', `${id} .notify`)
      await until(() => live(el, 'Saved').length === 1, 'shown')
      await window.__pw('focus', dismissOf('Saved'))
      await until(() => $('.toaster').hasAttribute('data-paused'), 'paused')
      const b = document.activeElement
      b.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      await wait(60)
      assert($('.toaster').hasAttribute('data-paused') && document.activeElement === b, 'resumed by a window blur')
      // a real click on the page outside anything focusable: the focus goes to body
      await window.__pwInput([['move', 1000, 600], ['down'], ['up']])
      await until(() => !$('.toaster').hasAttribute('data-paused'), () => `still paused; focus ${activeName()}`)
    } finally { app.dispose() }
  })

  // G-432: the focus coming back into the region from nowhere (after a modal round trip) keeps
  // where it came from: dismissing the last toast gives the focus back there
  await runTest('Toaster (G-432): after a modal round trip, Dismiss of the last toast returns the focus where it came from', async () => {
    const { id, app, el, $ } = await mount(toasterApp())
    try {
      await window.__pw('click', `${id} .notify`)
      await until(() => live(el, 'Saved').length === 1, 'shown')
      await window.__pw('focus', `${id} .after`)
      await window.__pw('focus', dismissOf('Saved'))
      $('.modal').showModal()
      await until(() => $('.toaster').parentNode === $('.modal'), 'in the modal')
      $('.modal').close()
      await until(() => $('.toaster').parentNode === $('.toaster-home'), 'back home')
      await wait(30)
      // back to the toast with no element before it (the closed modal's focus is gone)
      document.activeElement?.blur()
      await window.__pw('focus', dismissOf('Saved'))
      await key('Enter')
      await until(() => live(el, 'Saved').length === 0, 'dismissed')
      await until(() => activeName() === 'after', activeName)
    } finally { app.dispose() }
  })
}
