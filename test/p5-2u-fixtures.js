// PLAN-5 2-U: host components for the sygnal/ui parts, in canonical forms (class selectors,
// object-form model, event()). Shared by the mock-DOM / jsdom suites (p5-2u-ui.test.js,
// p5-2u-toaster.test.js). The browser suite (browser-tests/src/tests/ui-p5u.jsx) has JSX copies.
import { event, Collection } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import {
  dialog, popover, tooltip, tabs, tabsAttrs, accordion, accordionAttrs, disclosure, disclosureAttrs, Toaster,
} from '../src/ui.ts'

// ── Dialog (with a popover nested inside it) ─────────────────────────
export function Help({ state, uid }) {
  return h('div', { className: 'help-host' },
    h('button', { className: 'open-help' }, 'Keyboard shortcuts'),
    h('dialog', { className: 'help', 'aria-labelledby': uid('title') },
      h('h2', { id: uid('title') }, 'Keyboard shortcuts'),
      h('button', { className: 'save' }, 'Save'),
      h('button', { className: 'close-help' }, 'Close')),
    h('p', { className: 'status' }, `${state.help.open ? 'open' : 'closed'}:${state.help.returnValue}`))
}
Help.uses = { help: dialog({ dialog: '.help', trigger: '.open-help', close: '.close-help' }) }
Help.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
Help.model = { SAVE: { ELEMENT: { close: '.help', returnValue: 'saved' } } }

export const dialogHost = (options) => {
  function D({ state, uid }) {
    return h('div', null,
      h('button', { className: 'open' }, 'Open'),
      h('button', { className: 'elsewhere' }, 'Elsewhere'),
      h('dialog', { className: 'd', 'aria-labelledby': uid('t') }, h('h2', { id: uid('t') }, 'Title')),
      h('p', { className: 'out' }, String(state.d.open)))
  }
  D.uses = { d: dialog({ dialog: '.d', trigger: '.open', ...options }) }
  return D
}

// ── Popover ───────────────────────────────────────────────────────────
export function Filters({ state, uid }) {
  return h('div', null,
    h('button', { className: 'filters-btn', popovertarget: uid('filters') }, 'Filters'),
    h('button', { className: 'open-filters' }, 'Open filters'),
    h('div', { className: 'filters', id: uid('filters'), attrs: { popover: 'auto' }, 'aria-label': 'Filters' },
      h('button', { className: 'filters-done' }, 'Done')),
    h('p', { className: 'filters-status' }, state.filters.open ? 'open' : 'closed'))
}
Filters.uses = { filters: popover({ popover: '.filters', close: '.filters-done' }) }
Filters.intent = ({ DOM }) => ({ 'filters.OPEN': DOM.click('.open-filters') })

// ── Tooltip ───────────────────────────────────────────────────────────
export function Toolbar({ state, uid }) {
  const anchor = '--' + uid('save')
  return h('div', null,
    h('button', { className: 'save-btn', 'aria-describedby': uid('tip'), style: { anchorName: anchor } }, 'Save'),
    h('div', { className: 'save-tip', id: uid('tip'), role: 'tooltip', attrs: { popover: 'manual' }, style: { positionAnchor: anchor } }, 'Save the draft'),
    h('p', { className: 'tip-status' }, state.tip.open ? 'shown' : 'hidden'))
}
Toolbar.uses = { tip: tooltip({ trigger: '.save-btn', tip: '.save-tip' }) }

// ── Tabs ──────────────────────────────────────────────────────────────
export const TABS = [{ id: 'general', label: 'General' }, { id: 'privacy', label: 'Privacy' }, { id: 'advanced', label: 'Advanced' }]
export const tabsHost = (options = {}, disabled = []) => {
  function Settings({ state, uid }) {
    const a = tabsAttrs(state.tabs, uid)
    return h('div', { className: 'settings' },
      h('div', { className: 'tablist', ...a.list, 'aria-label': 'Settings' },
        ...TABS.map((t) => h('button', { className: 'tab', ...a.tab(t.id), disabled: disabled.includes(t.id) }, t.label))),
      ...TABS.map((t) => h('section', { className: 'panel', ...a.panel(t.id) }, h('p', null, `${t.label} settings`))),
      h('p', { className: 'selected' }, String(state.tabs.selected)))
  }
  Settings.uses = { tabs: tabs({ tab: '.tab', ...options }) }
  return Settings
}

// ── Accordion ─────────────────────────────────────────────────────────
export const FAQ = [{ id: 'ship', q: 'Shipping' }, { id: 'returns', q: 'Returns' }, { id: 'warranty', q: 'Warranty' }]
export const accordionHost = (options = {}) => {
  function Faq({ state, uid }) {
    const a = accordionAttrs(state.faq, uid)
    return h('div', { className: 'faq' },
      ...FAQ.map((f) => h('div', { className: 'item' },
        h('h3', null, h('button', { className: 'faq-trigger', ...a.trigger(f.id) }, f.q)),
        h('div', { className: 'faq-panel', ...a.panel(f.id) }, h('p', null, `${f.q} answer`)))),
      h('p', { className: 'expanded' }, state.faq.expanded.join(',')))
  }
  Faq.uses = { faq: accordion({ trigger: '.faq-trigger', ...options }) }
  return Faq
}

// ── Disclosure ────────────────────────────────────────────────────────
export const disclosureHost = (options = {}) => {
  function More({ state, uid }) {
    const a = disclosureAttrs(state.more, uid)
    return h('div', null,
      h('button', { className: 'more-toggle', ...a.trigger }, 'Details'),
      h('div', { className: 'more-panel', ...a.panel }, h('p', null, 'More text')))
  }
  More.uses = { more: disclosure({ trigger: '.more-toggle', ...options }) }
  return More
}

// tabs in every Collection item: ids stay unique per instance (uid)
function Card({ state, uid }) {
  const a = tabsAttrs(state.tabs, uid)
  return h('article', { className: 'card' },
    h('div', a.list, h('button', { className: 'tab', ...a.tab('a') }, `A${state.id}`), h('button', { className: 'tab', ...a.tab('b') }, `B${state.id}`)),
    h('div', a.panel('a'), 'a'), h('div', a.panel('b'), 'b'))
}
Card.uses = { tabs: tabs({ tab: '.tab' }) }
export function Cards() { return h('div', null, h(Collection, { of: Card, from: 'cards' })) }
Cards.initialState = { cards: [{ id: 1 }, { id: 2 }] }

// ── Toaster ───────────────────────────────────────────────────────────
const toast = (text, kind, timeoutMs, id) => event('TOAST', { text, kind, timeoutMs, ...(id && { id }) })
export const toasterApp = (props = {}) => {
  function App() {
    return h('div', { className: 'app' },
      h('button', { className: 'notify' }, 'Notify'),
      h('button', { className: 'notify-quick' }, 'Notify quick'),
      h('button', { className: 'notify-error' }, 'Notify error'),
      h('button', { className: 'saving' }, 'Saving'),
      h('button', { className: 'saved' }, 'Saved'),
      h('button', { className: 'plain' }, 'Plain'),
      h('button', { className: 'clear' }, 'Clear'),
      h(Toaster, props))
  }
  App.initialState = {}
  App.intent = ({ DOM }) => ({
    NOTIFY: DOM.click('.notify'), QUICK: DOM.click('.notify-quick'), ERROR: DOM.click('.notify-error'),
    SAVING: DOM.click('.saving'), SAVED: DOM.click('.saved'), PLAIN: DOM.click('.plain'), CLEAR: DOM.click('.clear'),
  })
  App.model = {
    NOTIFY: { EVENTS: toast('Saved', 'success', 0) },
    QUICK: { EVENTS: toast('Copied', 'info', 400) },
    ERROR: { EVENTS: toast('Upload failed', 'error', 0) },
    SAVING: { EVENTS: toast('Saving…', 'info', 0, 'save') },
    SAVED: { EVENTS: toast('Saved', 'success', 300, 'save') },
    PLAIN: { EVENTS: event('TOAST', 'Hello') },
    CLEAR: { EVENTS: event('TOAST_DISMISS') },
  }
  return App
}
