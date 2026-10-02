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

// ─── 4-A1: waits resolve with the DOM patched to the state they resolved with ───

// task 17's shape: an input starts a lookup ('Looking up…'), the response replaces it a few ms
// later (a stubbed fetch through makeFetchDriver), before the old wait's quiet window ended.
// The stub answers on the macrotask after 'Looking up…' is in the DOM (deterministic under
// load: a response that beats the render would replace the state before it ever renders)
function Zip({ state }) {
  return h('form', null,
    h('input', { name: 'zip', value: state.zip }),
    h('p', { className: 'zip-status' }, state.status),
    h('input', { name: 'city', value: state.city }),
    h('input', { type: 'checkbox', name: 'express', checked: state.express, disabled: state.noExpress }),
  )
}
Zip.initialState = { zip: '', status: '', city: '', express: true, noExpress: false }
Zip.intent = ({ DOM, HTTP }) => ({
  ZIP: DOM.input('input[name="zip"]').value(),
  FOUND: HTTP.select('zip'),
})
Zip.model = {
  ZIP: {
    STATE: (s, zip) => ({ ...s, zip, status: 'Looking up…' }),
    HTTP: (s, zip) => ({ category: 'zip', url: `/api/zip/${zip}` }),
  },
  FOUND: (s, { value }) => ({ ...s, status: '', city: value.city, express: value.express, noExpress: !value.express }),
}
const quickFetch = () => vi.fn(() => new Promise(r => {
  const answer = () => r(new Response(JSON.stringify({ city: 'Springfield', express: false }), { headers: { 'Content-Type': 'application/json' } }))
  const poll = () => document.querySelector('.sygnal-test .zip-status')?.textContent === 'Looking up…' ? setTimeout(answer) : setTimeout(poll)
  poll()
}))

describe('4-A1: real-mode waits resolve after the DOM patch', () => {
  it('right after await t.next(pred) the DOM shows that state, even when the next one follows within ms', async () => {
    const { makeFetchDriver } = await import('../src/extra/fetchDriver.js')
    vi.stubGlobal('fetch', quickFetch())
    t = renderComponent(Zip, { dom: 'real', drivers: { HTTP: makeFetchDriver() } })
    await t.ready()
    t.simulateEvent('input[name="zip"]', 'input', { value: '62704' })
    await t.next(s => s.status === 'Looking up…')
    expect(t.query('.zip-status').textContent).toBe('Looking up…')
    expect(t.query('input[name="zip"]').value).toBe('62704')
    expect(t.query('input[name="express"]').disabled).toBe(false)
    await t.next(s => s.city === 'Springfield')
    expect(t.query('.zip-status').textContent).toBe('')
    expect(t.query('input[name="city"]').value).toBe('Springfield')
    expect(t.query('input[name="express"]').checked).toBe(false)
    expect(t.query('input[name="express"]').disabled).toBe(true)
  })

  it('a held render goes in on the next macrotask; waitForState and settle() see the latest DOM', async () => {
    const { makeFetchDriver } = await import('../src/extra/fetchDriver.js')
    vi.stubGlobal('fetch', quickFetch())
    t = renderComponent(Zip, { dom: 'real', drivers: { HTTP: makeFetchDriver() } })
    t.simulateEvent('input[name="zip"]', 'input', { value: '62704' })
    await t.next(s => s.status === 'Looking up…')
    await t.settle()
    expect(t.query('.zip-status').textContent).toBe('')
    expect(t.query('input[name="city"]').value).toBe('Springfield')
    expect(t.state.city).toBe('Springfield')
    // a match from the history: the DOM shows the newest state at the match
    await t.waitForState(s => s.status === 'Looking up…')
    expect(t.query('input[name="city"]').value).toBe('Springfield')
  })

  it('next() right after a wait also matches the states whose render was held back', async () => {
    const { makeFetchDriver } = await import('../src/extra/fetchDriver.js')
    vi.stubGlobal('fetch', quickFetch())
    t = renderComponent(Zip, { dom: 'real', drivers: { HTTP: makeFetchDriver() } })
    t.simulateEvent('input[name="zip"]', 'input', { value: '62704' })
    await t.next(s => s.status === 'Looking up…')
    expect(t.query('.zip-status').textContent).toBe('Looking up…')
    // the response state may already be recorded (held back from the DOM): next() still sees it
    await t.next(s => s.city === 'Springfield')
    expect(t.query('input[name="city"]').value).toBe('Springfield')
    // an input starts a fresh next(): earlier states don't match
    t.simulateEvent('input[name="zip"]', 'input', { value: '6270' })
    await expect(t.next(s => s.city === 'Springfield' && s.zip === '62704', 100)).rejects.toThrow(/already matches/)
  })

  it('t.respond: each await shows its own state in the DOM', async () => {
    t = renderComponent(Zip, { dom: 'real' })
    await t.ready()
    t.simulateEvent('input[name="zip"]', 'input', { value: '10001' })
    await t.next(s => s.status === 'Looking up…')
    expect(t.query('.zip-status').textContent).toBe('Looking up…')
    t.respond('HTTP', { city: 'New York', express: true }, 'zip')
    await t.next(s => s.city === 'New York')
    expect(t.query('input[name="city"]').value).toBe('New York')
    expect(t.query('.zip-status').textContent).toBe('')
    expect(t.query('input[name="express"]').checked).toBe(true)
  })

  it('with vi.useFakeTimers() too', async () => {
    vi.useFakeTimers()
    try {
      const { makeFetchDriver } = await import('../src/extra/fetchDriver.js')
      vi.stubGlobal('fetch', quickFetch())
      t = renderComponent(Zip, { dom: 'real', drivers: { HTTP: makeFetchDriver() } })
      await t.ready()
      expect(t.query('.zip-status')).not.toBe(null)
      t.simulateEvent('input[name="zip"]', 'input', { value: '62704' })
      await t.next(s => s.status === 'Looking up…')
      expect(t.query('.zip-status').textContent).toBe('Looking up…')
      await t.next(s => s.city === 'Springfield')
      expect(t.query('input[name="city"]').value).toBe('Springfield')
      expect(t.query('input[name="express"]').disabled).toBe(true)
      await t.settle()
      expect(t.query('.zip-status').textContent).toBe('')
    } finally {
      t?.dispose(); t = null
      vi.useRealTimers()
    }
  })
})

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

  it('4-A1: query()/queryAll()/html() before the first render throw, naming await t.ready()', async () => {
    t = renderComponent(Counter, { dom: 'real' })
    expect(() => t.query('.inc')).toThrow(/before the component's first render was in the DOM.*await t\.ready\(\)/)
    expect(() => t.queryAll('.inc')).toThrow(/await t\.ready\(\)/)
    expect(() => t.html()).toThrow(/await t\.ready\(\)/)
    await t.ready()
    expect(t.query('.inc')).not.toBe(null)
    expect(t.query('span').textContent).toBe('0')
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
