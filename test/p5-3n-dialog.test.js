// @vitest-environment jsdom
// PLAN-5 3-N G-488: dialog() when showModal() throws (a disconnected dialog, a popover open on
// it): the state goes back to closed (a close event: CLOSED), so the next OPEN opens it; the
// error surfaces once, as the command's.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { dialog } from '../src/ui.ts'
import run from '../src/extra/run.js'
import { setupChecks, settle } from './diagnostics/helpers.js'

const P = HTMLDialogElement.prototype
const own = { showModal: Object.getOwnPropertyDescriptor(P, 'showModal'), close: Object.getOwnPropertyDescriptor(P, 'close') }
const restore = () => { for (const k in own) own[k] ? Object.defineProperty(P, k, own[k]) : delete P[k] }

let app
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  document.body.innerHTML = ''
  restore()
})

function Host({ state }) {
  return h('div', null,
    h('button', { className: 'open' }, 'Open'),
    h('p', { className: 'st' }, String(state.d.open)),
    h('dialog', { className: 'dlg' }, h('button', { className: 'inner' }, 'x')))
}

describe('G-488: OPEN when showModal() throws', () => {
  for (const cancelable of [true, false]) {
    it(`the state goes back to closed, and the next OPEN opens it (cancelable: ${cancelable})`, async () => {
      Host.uses = { d: dialog({ dialog: '.dlg', trigger: '.open', cancelable }) }
      const errors = [], qm = globalThis.queueMicrotask
      let fail = true, calls = 0
      P.showModal = function () { calls++; if (fail) throw new DOMException('not allowed', 'InvalidStateError'); this.open = true }
      setupChecks()
      document.body.innerHTML = '<div id="root"></div>'
      try {
        app = run(Host, {}, { mountPoint: '#root', diagnostics: 'collect' })
        await settle(60)
        const d = document.querySelector('.dlg')
        globalThis.queueMicrotask = (f) => qm(() => { try { f() } catch (e) { errors.push(e) } })
        document.querySelector('.open').click()
        await settle(60)
        globalThis.queueMicrotask = qm
        // the command's error, once
        expect(errors.map((e) => e.name)).toEqual(['InvalidStateError'])
        expect(d.open).toBe(false)
        expect(d.hasAttribute('closedby')).toBe(false)
        expect(document.querySelector('.st').textContent).toBe('false')
        fail = false
        document.querySelector('.open').click()
        await settle(60)
        expect(calls).toBe(2)
        expect(d.open).toBe(true)
        expect(document.querySelector('.st').textContent).toBe('true')
      } finally { globalThis.queueMicrotask = qm }
    })
  }
})
