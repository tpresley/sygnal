// @vitest-environment jsdom
// PLAN-5 3-T G-524: after a showModal() that throws, dialog() goes back to closed without a DOM
// close event: the host's close listeners don't run for a dialog that never opened, and the
// previous close's returnValue isn't reported again.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { dialog } from '../src/ui.ts'
import run from '../src/extra/run.js'
import { settle } from './diagnostics/helpers.js'

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

describe('G-524: a failed showModal() sends no close event', () => {
  for (const cancelable of [true, false]) {
    it(`state { open: false, returnValue: '' }, no host close (cancelable: ${cancelable})`, async () => {
      const seen = [], domClose = []
      function Host({ state }) {
        return h('div', null,
          h('button', { className: 'open' }, 'Open'),
          h('p', { className: 'st' }, JSON.stringify({ open: state.d.open, returnValue: state.d.returnValue })),
          h('dialog', { className: 'dlg' }, h('button', { className: 'inner' }, 'x')))
      }
      Host.uses = { d: dialog({ dialog: '.dlg', trigger: '.open', cancelable }) }
      Host.intent = ({ DOM }) => ({ GONE: DOM.select('.dlg').events('close').map((e) => e.target.returnValue) })
      Host.model = { GONE: (s, rv) => { seen.push(rv); return s } }
      let fail = false
      P.showModal = function () { if (fail) throw new DOMException('no', 'InvalidStateError'); this.open = true }
      P.close = function (rv) { if (rv !== undefined) this.returnValue = rv; this.open = false; this.dispatchEvent(new Event('close')) }
      document.body.innerHTML = '<div id="root"></div>'
      const errors = [], qm = globalThis.queueMicrotask
      try {
        app = run(Host, {}, { mountPoint: '#root' })
        await settle(60)
        const d = document.querySelector('.dlg')
        d.addEventListener('close', () => domClose.push(d.returnValue))
        document.querySelector('.open').click(); await settle(60)
        d.close('confirm'); await settle(60)
        expect(JSON.parse(document.querySelector('.st').textContent)).toEqual({ open: false, returnValue: 'confirm' })
        fail = true
        globalThis.queueMicrotask = (f) => qm(() => { try { f() } catch (e) { errors.push(e) } })
        document.querySelector('.open').click(); await settle(60)
        globalThis.queueMicrotask = qm
        expect(errors.map((e) => e.name)).toEqual(['InvalidStateError'])
        expect(JSON.parse(document.querySelector('.st').textContent)).toEqual({ open: false, returnValue: '' })
        expect(d.hasAttribute('closedby')).toBe(false)
        // one close: the real one
        expect(domClose).toEqual(['confirm'])
        expect(seen).toEqual(['confirm'])
        // and the next OPEN opens it
        fail = false
        document.querySelector('.open').click(); await settle(60)
        expect(d.open).toBe(true)
        expect(JSON.parse(document.querySelector('.st').textContent)).toEqual({ open: true, returnValue: '' })
      } finally { globalThis.queueMicrotask = qm }
    })
  }
})
