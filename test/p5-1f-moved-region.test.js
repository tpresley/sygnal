// @vitest-environment jsdom
// PLAN-5 1-F item 2 (D196, G-356): an element moved out of its component's DOM by a hook (a
// toaster region re-parented into the topmost open modal <dialog>, 0-S4). Before: every event
// inside it threw 'No root element found' from IsolateModule.getRootElement and no listener
// saw it.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/index.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => { if (t) t.dispose(); t = null; _resetDiagnostics(); document.body.innerHTML = '' })

const log = (s, entry) => ({ ...s, log: [...s.log, entry] })

// moves its element into `sel` (inside the app, or outside it) when inserted; `home`: it names
// the element it came from as __sygnalHome
const moveTo = (sel, home) => ({ insert: (vnode) => {
  const el = vnode.elm, target = document.querySelector(sel)
  if (home) el.__sygnalHome = el.parentNode
  if (target) target.appendChild(el)
} })

function Toast({ state }) { return h('li', { className: 'toast' }, h('button', { className: 'dismiss' }, state.text)) }
Toast.intent = ({ DOM }) => ({ DISMISS: DOM.click('.dismiss') })
Toast.model = { DISMISS: () => undefined }

function Toaster({ state, where, home }) {
  return h('div', { className: 'home' },
    h('section', { className: 'region', hook: moveTo(where, home) },
      h('button', { className: 'clear' }, 'Clear'),
      h('ul', { className: 'list' }, h(Collection, { of: Toast, from: 'toasts' }))))
}
Toaster.intent = ({ DOM }) => ({ CLEAR: DOM.click('.clear'), REGION: DOM.click('.region') })
Toaster.model = {
  CLEAR: (s) => ({ ...s, toasts: [] }),
  REGION: (s, e) => log(s, 'region:' + e.target.className),
}

function App({ state }) {
  return h('div', { className: 'app' },
    h('dialog', { className: 'modal', id: 'in-app' }, h('p', null, 'modal')),
    h('button', { className: 'add' }, 'Add'),
    h(Toaster, { state: 'toaster', where: state.where, home: state.home }))
}
App.intent = ({ DOM }) => ({ ADD: DOM.click('.add'), MODAL: DOM.click('.modal'), APP: DOM.click('.app') })
App.model = {
  ADD: (s) => ({ ...s, toaster: { ...s.toaster, toasts: [...s.toaster.toasts, { id: s.toaster.toasts.length + 1, text: 'T' + (s.toaster.toasts.length + 1) }] } }),
  MODAL: (s, e) => log(s, 'modal:' + e.target.className),
  APP: (s, e) => log(s, 'app:' + e.target.className),
}
const start = (where, home = true) => ({ where, home, log: [], toaster: { toasts: [{ id: 1, text: 'T1' }, { id: 2, text: 'T2' }], log: [] } })

describe('G-356: a component region moved elsewhere in the app keeps its events', () => {
  it('the moved region really is inside the dialog', async () => {
    t = renderComponent(App, { dom: 'real', initialState: start('#in-app') }); await t.ready()
    expect(document.querySelector('#in-app .region')).not.toBe(null)
    expect(document.querySelector('.home').children.length).toBe(0)
  })

  it('a Collection item inside the moved region hears its own clicks', async () => {
    t = renderComponent(App, { dom: 'real', initialState: start('#in-app') }); await t.ready()
    expect(() => t.simulateEvent('.dismiss', 'click')).not.toThrow()
    await t.settle()
    expect(t.state.toaster.toasts.map(x => x.id)).toEqual([2])
  })

  it("the moving component's own listeners hear clicks inside the region (with __sygnalHome)", async () => {
    t = renderComponent(App, { dom: 'real', initialState: start('#in-app') }); await t.ready()
    t.simulateEvent('.clear', 'click'); await t.settle()
    expect(t.state.toaster.toasts).toEqual([])
    expect(t.state.toaster.log).toEqual(['region:clear'])
  })

  it('events bubble along the component tree: through the home to the parent, not the dialog', async () => {
    t = renderComponent(App, { dom: 'real', initialState: start('#in-app') }); await t.ready()
    t.simulateEvent('.dismiss', 'click'); await t.settle()
    t.simulateEvent('.clear', 'click'); await t.settle()
    expect(t.state.toaster.log).toEqual(['region:dismiss', 'region:clear'])
    expect(t.state.log).toEqual(['app:dismiss', 'app:clear'])
  })

  it('without __sygnalHome: items still work, the component misses its own moved elements (the limit)', async () => {
    t = renderComponent(App, { dom: 'real', initialState: start('#in-app', false) }); await t.ready()
    t.simulateEvent('.dismiss', 'click'); await t.settle()
    expect(t.state.toaster.toasts.map(x => x.id)).toEqual([2])
    t.simulateEvent('.clear', 'click'); await t.settle()
    expect(t.state.toaster.toasts.map(x => x.id)).toEqual([2])
    expect(t.state.toaster.log).toEqual([])
  })

  it('new items rendered into the moved region work', async () => {
    t = renderComponent(App, { dom: 'real', initialState: start('#in-app') }); await t.ready()
    t.simulateEvent('.add', 'click'); await t.settle()
    expect(document.querySelectorAll('#in-app .toast').length).toBe(3)
    const buttons = document.querySelectorAll('.dismiss')
    buttons[2].click(); await t.settle()
    expect(t.state.toaster.toasts.map(x => x.id)).toEqual([1, 2])
  })
})

describe('G-356: a region moved out of the app', () => {
  it('no throw; the event leaves the app (nothing hears it)', async () => {
    const outside = document.createElement('div')
    outside.id = 'outside'
    document.body.appendChild(outside)
    t = renderComponent(App, { dom: 'real', initialState: start('#outside') }); await t.ready()
    expect(document.querySelector('#outside .region')).not.toBe(null)
    const errors = []
    const onErr = (e) => errors.push(e)
    window.addEventListener('error', onErr)
    document.querySelector('.dismiss').click()
    await t.settle()
    window.removeEventListener('error', onErr)
    expect(errors).toEqual([])
  })
})
