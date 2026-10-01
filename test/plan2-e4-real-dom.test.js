// @vitest-environment jsdom
// PLAN-2 E4: renderComponent(C, { dom: 'real' }) patches the tree into a real container, so
// real DOM state (checked, value, disabled, focus, refs, Portals) can be asserted with the same
// t.* API, without a second run() + jsdom suite.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { Portal } from '../src/portal.js'
import { createRef } from '../src/extra/ref.js'
import { ABORT } from '../src/component.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
  vi.unstubAllGlobals()
})

// ─── form state ─────────────────────────────────────────────────────────────

function Form({ state }) {
  return h('form', { className: 'f' },
    h('input', { name: 'email', value: state.email }),
    h('label', null, h('input', { type: 'checkbox', name: 'news', checked: state.news }), 'News'),
    h('input', { type: 'radio', name: 'plan', value: 'free', checked: state.plan === 'free' }),
    h('input', { type: 'radio', name: 'plan', value: 'team', checked: state.plan === 'team' }),
    h('button', { type: 'button', className: 'next', disabled: !state.email.includes('@') }, 'Next'),
    h('p', { className: 'step' }, `Step ${state.step}`),
  )
}
Form.initialState = { email: '', news: false, plan: 'free', step: 1 }
Form.intent = ({ DOM }) => ({
  EMAIL: DOM.input('input[name="email"]').value(),
  NEWS: DOM.change('input[name="news"]').checked(),
  PLAN: DOM.change('input[name="plan"]').value(),
  NEXT: DOM.click('.next'),
})
Form.model = {
  EMAIL: (state, email) => ({ ...state, email }),
  NEWS: (state, news) => ({ ...state, news }),
  PLAN: (state, plan) => ({ ...state, plan }),
  NEXT: (state) => ({ ...state, step: state.step + 1 }),
}

describe('E4: real DOM properties', () => {
  it('value, checked (checkbox and radio) and disabled are the real element properties', async () => {
    t = renderComponent(Form, { dom: 'real' })
    await t.ready()
    expect(t.container.isConnected).toBe(true)
    expect(t.query('input[name="plan"]:checked').value).toBe('free')
    expect(t.query('.next').disabled).toBe(true)

    t.simulateEvent('input[name="email"]', 'input', { value: 'ada@example.com' })
    await t.next(s => s.email === 'ada@example.com')
    expect(t.query('input[name="email"]').value).toBe('ada@example.com')
    expect(t.query('.next').disabled).toBe(false)

    // a click runs the default action: the checkbox toggles and fires change
    t.simulateEvent('input[name="news"]', 'click')
    await t.next(s => s.news === true)
    expect(t.query('input[name="news"]').checked).toBe(true)

    t.simulateEvent('input[name="plan"][value="team"]', 'click')
    await t.next(s => s.plan === 'team')
    expect(t.query('input[name="plan"][value="free"]').checked).toBe(false)
    expect(t.query('input[name="plan"]:checked').value).toBe('team')
    expect(t.queryAll('input[name="plan"]')).toHaveLength(2)
  })

  it('a click on a disabled button does nothing, like in a browser', async () => {
    t = renderComponent(Form, { dom: 'real' })
    t.simulateEvent('.next', 'click')
    await t.settle()
    expect(t.states.at(-1).step).toBe(1)
    t.simulateEvent('input[name="email"]', 'input', { value: 'a@b' })
    t.simulateEvent('.next', 'click')
    await t.next(s => s.step === 2)
    expect(t.html()).toContain('Step 2')
  })

  it('{ checked } on change sets the property first', async () => {
    t = renderComponent(Form, { dom: 'real' })
    t.simulateEvent('input[name="news"]', 'change', { checked: true })
    await t.next(s => s.news)
    expect(t.query('input[name="news"]').checked).toBe(true)
  })

  it('any CSS selector works (:checked, +, :has)', async () => {
    t = renderComponent(Form, { dom: 'real' })
    await t.ready()
    expect(t.query('label:has(input[name="news"])')).not.toBe(null)
    t.simulateEvent('input[value="free"] + input', 'click')
    await t.next(s => s.plan === 'team')
  })
})

// ─── focus ──────────────────────────────────────────────────────────────────

const cityRef = createRef()
function Lookup({ state }) {
  return h('div', null,
    h('input', { name: 'zip', value: state.zip }),
    h('input', { name: 'city', ref: cityRef, value: state.city }),
    h('p', { className: 'msg' }, state.touched ? 'touched' : ''),
  )
}
Lookup.initialState = { zip: '', city: '', touched: false }
Lookup.intent = ({ DOM }) => ({
  ZIP: DOM.input('input[name="zip"]').value(),
  TOUCH: DOM.blur('input[name="zip"]'),
})
Lookup.model = {
  ZIP: {
    STATE: (state, zip) => ({ ...state, zip }),
    EFFECT: (state, zip) => { if (zip === '00000') cityRef.current?.focus() },
  },
  TOUCH: (state) => ({ ...state, touched: true }),
}

describe('E4: focus', () => {
  it('focus moves document.activeElement, refs point at real elements, EFFECT can focus', async () => {
    t = renderComponent(Lookup, { dom: 'real' })
    t.simulateEvent('input[name="zip"]', 'focus')
    await t.settle()
    expect(document.activeElement).toBe(t.query('input[name="zip"]'))
    expect(cityRef.current).toBe(t.query('input[name="city"]'))

    t.simulateEvent('input[name="zip"]', 'input', { value: '00000' })
    await t.next(s => s.zip === '00000')
    expect(document.activeElement).toBe(t.query('input[name="city"]'))
    // the zip field lost focus: a real blur reached DOM.blur (a non-bubbling event)
    await t.waitForState(s => s.touched)
    expect(t.html()).toContain('touched')
  })

  it("blur on an element that doesn't have focus is still delivered", async () => {
    t = renderComponent(Lookup, { dom: 'real' })
    t.simulateEvent('input[name="zip"]', 'blur')
    await t.next(s => s.touched)
  })
})

// ─── isolation, Collections ─────────────────────────────────────────────────

function Child({ state }) { return h('button', { className: 'btn' }, `child ${state.n}`) }
Child.intent = ({ DOM }) => ({ INC: DOM.click('.btn') })
Child.model = { INC: { STATE: s => ({ ...s, n: s.n + 1 }), PARENT: s => s.n + 1 } }

function Parent({ state }) {
  return h('div', null,
    h('button', { className: 'btn own' }, `parent ${state.p}`),
    h(Child, { state: 'child' }),
  )
}
Parent.initialState = { p: 0, child: { n: 0 }, fromChild: [] }
Parent.intent = ({ DOM, CHILD }) => ({ P: DOM.click('.btn'), FROM_CHILD: CHILD.select(Child) })
Parent.model = {
  P: s => ({ ...s, p: s.p + 1 }),
  FROM_CHILD: (s, n) => ({ ...s, fromChild: [...s.fromChild, n] }),
}

function Row({ state }) {
  return h('li', { className: 'row', 'data-id': String(state.id) },
    h('span', null, state.title), h('button', { className: 'remove' }, 'x'))
}
Row.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
Row.model = { REMOVE: () => undefined }

function List({ state }) {
  return h('div', null, h('ul', null, h(Collection, { of: Row, from: 'items' })), h('p', { className: 'count' }, String(state.items.length)))
}
List.initialState = { items: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }, { id: 3, title: 'c' }] }

describe('E4: isolation and Collections on the real DOM driver', () => {
  it("a click in the child reaches the child's listener only; the parent's own selector its own", async () => {
    t = renderComponent(Parent, { dom: 'real' })
    t.simulateEvent('.btn:not(.own)', 'click')
    await t.next(s => s.child.n === 1)
    await t.settle()
    expect(t.states.at(-1).p).toBe(0)
    expect(t.sinkValues('PARENT')).toEqual([])
    expect(t.states.at(-1).fromChild).toEqual([1])
    t.simulateEvent('.own', 'click')
    await t.next(s => s.p === 1)
    expect(t.query('.own').textContent).toBe('parent 1')
  })

  it('Collection items: the event reaches the item it was dispatched in', async () => {
    t = renderComponent(List, { dom: 'real' })
    t.simulateEvent('.row[data-id="2"] .remove', 'click')
    await t.next(s => s.items.length === 2)
    expect(t.queryAll('.row').map(e => e.dataset.id)).toEqual(['1', '3'])
    expect(t.query('.count').textContent).toBe('2')
    t.simulateEvent('.row:last-child .remove', 'click')
    await t.next(s => s.items.length === 1)
    expect(t.queryAll('.row span').map(e => e.textContent)).toEqual(['a'])
  })
})

// ─── Portals ────────────────────────────────────────────────────────────────

function Modal({ state }) {
  return h('div', { className: 'page' },
    h('button', { className: 'open' }, 'open'),
    state.open ? h(Portal, { target: '#modal-root' }, h('div', { className: 'dialog' }, h('button', { className: 'close' }, 'close'))) : null,
  )
}
Modal.initialState = { open: false }
Modal.intent = ({ DOM }) => ({
  OPEN: DOM.click('.open'),
  CLOSE: DOM.select('document').select('.close').events('click'),
})
Modal.model = { OPEN: s => ({ ...s, open: true }), CLOSE: s => ({ ...s, open: false }) }

describe('E4: Portals', () => {
  it('Portal content is mounted in its target; query() finds it and events reach document listeners', async () => {
    const target = document.createElement('div')
    target.id = 'modal-root'
    document.body.appendChild(target)
    try {
      t = renderComponent(Modal, { dom: 'real' })
      t.simulateEvent('.open', 'click')
      await t.next(s => s.open)
      await t.settle()
      expect(target.querySelector('.dialog')).not.toBe(null)
      expect(t.query('.dialog .close')).toBe(target.querySelector('.close'))
      t.simulateEvent('.close', 'click')
      await t.next(s => !s.open)
      await t.settle()
      expect(target.querySelector('.dialog')).toBe(null)
    } finally {
      target.remove()
    }
  })
})

// ─── dispose, the rest of the t.* API ───────────────────────────────────────

function Counter({ state }) { return h('div', { className: 'counter' }, h('button', { className: 'inc' }, '+'), h('span', null, String(state.count))) }
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = {
  INC: { STATE: s => ({ count: s.count + 1 }), EVENTS: (s) => ({ type: 'INC', data: s.count + 1 }), API: s => s.count + 1 },
  DISPOSE: { EFFECT: () => disposed() },
}
const disposed = vi.fn()

describe('E4: dispose and the shared t.* API', () => {
  it('next/settle/html/emitted/sinkValues work the same; dispose fires DISPOSE and unmounts', async () => {
    t = renderComponent(Counter, { dom: 'real' })
    const container = t.container
    t.simulateEvent('.inc', 'click')
    t.simulateEvent('.inc', 'click')
    await t.next(s => s.count === 2)
    expect(t.html()).toBe('<div class="counter"><button class="inc">+</button><span>2</span></div>')
    expect(container.innerHTML).toBe(t.html())
    expect(t.emitted).toEqual([{ type: 'INC', data: 1 }, { type: 'INC', data: 2 }])
    expect(t.sinkValues('API')).toEqual([1, 2])
    const btn = t.query('.inc')
    t.dispose()
    expect(container.isConnected).toBe(false)
    await new Promise(r => setTimeout(r, 10))
    expect(disposed).toHaveBeenCalledTimes(1)
    btn.click()
    await new Promise(r => setTimeout(r, 30))
    expect(t.states.at(-1).count).toBe(2)
    t = null
  })

  it("a selector that never matches fails the test, like the mock's", async () => {
    t = renderComponent(Counter, { dom: 'real' })
    await t.settle()
    expect(() => t.simulateEvent('.nope', 'click')).toThrow(/matched nothing/)
    expect(() => t.simulateEvent('.inc[', 'click')).toThrow(/not a valid CSS selector/)
  })

  it('keydown carries key; document listeners get page events', async () => {
    function Keys({ state }) { return h('input', { className: 'k', value: state.last }) }
    Keys.initialState = { last: '', esc: 0 }
    Keys.intent = ({ DOM }) => ({ KEY: DOM.keydown('.k').key(), ESC: DOM.select('document').events('keydown').filter(e => e.key === 'Escape') })
    Keys.model = { KEY: (s, last) => ({ ...s, last }), ESC: s => ({ ...s, esc: s.esc + 1 }) }
    t = renderComponent(Keys, { dom: 'real' })
    t.simulateEvent('.k', 'keydown', { key: 'Enter' })
    await t.next(s => s.last === 'Enter')
    t.simulateEvent('document', 'keydown', { key: 'Escape' })
    await t.next(s => s.esc === 1)
  })

  it('mock mode: query() explains that it needs { dom: "real" }', () => {
    t = renderComponent(Counter)
    expect(t.container).toBe(null)
    expect(() => t.query('.inc')).toThrow(/dom: 'real'/)
  })

  it('without a document it throws a clear error', () => {
    vi.stubGlobal('document', undefined)
    expect(() => renderComponent(Counter, { dom: 'real' })).toThrow(/@vitest-environment jsdom/)
  })

  it('rejects mockConfig and unknown dom values', () => {
    expect(() => renderComponent(Counter, { dom: 'real', mockConfig: {} })).toThrow(/mockConfig/)
    expect(() => renderComponent(Counter, { dom: 'jsdom' })).toThrow(/'mock' \(default\) or 'real'/)
  })
})
