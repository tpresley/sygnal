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
