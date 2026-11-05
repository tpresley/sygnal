// @vitest-environment jsdom
// 7.3 (Sift's live-writes walk): focusWithin from a fragment-rooted sender reaches its children's
// root elements too. Cancel removed the sender's only own element, leaving a child component as
// the fragment's one root: the sender's scope had no root element, so the command was dropped
// (SYG640) and the focus stayed on <body>. Before cancel, too, only the sender's first own root was
// searched. renderComponent's mock DOM accepts the same target (no SYG640).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, renderComponent, focusWithin } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { Fragment } from '../src/cycle/dom/fragment.ts'

const sleep = (ms = 20) => new Promise(r => setTimeout(r, ms))
let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

function Trigger() { return h('button', { type: 'button', className: 'trigger' }, 'Resume') }
const section = () => h('div', { className: 'section' }, h('button', { type: 'button', className: 'cancel' }, 'Cancel'))
function Sender({ state }) { return h(Fragment, null, h(Trigger), state.opened ? section() : null) }
function Wrapped({ state }) { return h('div', { className: 'wrapped' }, h(Trigger), state.opened ? section() : null) }
for (const S of [Sender, Wrapped]) {
  S.initialState = { opened: true }
  S.isolatedState = true
  S.intent = ({ DOM }) => ({ CANCEL: DOM.click('.cancel'), FOCUS: DOM.keydown('.cancel') })
  S.model = {
    CANCEL: { STATE: (s) => ({ ...s, opened: false }), ELEMENT: () => ({ focus: focusWithin('.trigger') }) },
    FOCUS: { ELEMENT: () => ({ focus: focusWithin('.trigger') }) },
  }
}
const host = (S) => { const Host = () => h('ul', null, h('li', null, h(S))); Host.initialState = {}; return Host }

describe('focusWithin from a fragment-rooted sender', () => {
  for (const S of [Sender, Wrapped]) {
    it(`${S.name}: Cancel removes the section and focuses the child's trigger`, async () => {
      document.body.innerHTML = '<div id="root"></div>'
      app = run(host(S), {}, { mountPoint: '#root' })
      await sleep()
      document.querySelector('.cancel').click()
      await vi.waitFor(() => expect(document.activeElement?.className).toBe('trigger'), { timeout: 1000, interval: 5 })
      expect(document.querySelector('.section')).toBe(null)
    })

    it(`${S.name}: a child's root is found while the sender still has elements of its own`, async () => {
      document.body.innerHTML = '<div id="root"></div>'
      app = run(host(S), {}, { mountPoint: '#root' })
      await sleep()
      document.querySelector('.cancel').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }))
      await vi.waitFor(() => expect(document.activeElement?.className).toBe('trigger'), { timeout: 1000, interval: 5 })
    })

    it(`${S.name}: renderComponent's mock DOM reports no SYG640`, async () => {
      const t = renderComponent(host(S), { strict: false })
      await t.ready()
      await t.simulateEvent('.cancel', 'click')
      await sleep(1100)
      expect(t.diagnostics.filter(d => d.code === 'SYG640')).toEqual([])
      t.dispose()
    })
  }
})
