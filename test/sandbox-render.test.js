// @vitest-environment jsdom
// sygnal/sandbox, in-thread tier (isolation: 'thread'): a component in QuickJS rendered into the
// page's DOM through the mirror, events forwarded back synchronously, the emits gate, the class
// prefix and the scoped focus capability (research: dev-plans/research/sandbox, maintainer decisions).
import { describe, it, expect, afterEach } from 'vitest'
import { mount, settle, schema, any, kernel, compile } from './fixtures/sandbox-helpers.js'
import { createSandbox, emitGate, loadQuickJS, PROTOCOL } from '../src/sandbox.ts'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.js'

afterEach(() => { document.body.innerHTML = '' })

const COUNTER = `
export default function Counter({ state }) {
  return <div className="counter">
    <button className="inc">+</button>
    <span className="n">{state.count}</span>
    {state.count > 2 && <em className="many">many</em>}
  </div>
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
Counter.model = { INC: { STATE: (s) => ({ count: s.count + 1 }), EVENTS: (s) => ({ type: 'COUNT', data: s.count }) } }
`

describe('sygnal/sandbox: in-thread rendering', () => {
  it('renders, and a click round-trips through the guest; real nodes are kept', async () => {
    const t = mount(COUNTER)
    await t.ready()
    expect(t.errors).toEqual([])
    expect(t.$('.n').textContent).toBe('0')
    const btn = t.$('.inc')
    for (let i = 0; i < 3; i++) t.fire('.inc', 'click')
    expect(t.$('.n').textContent).toBe('3')
    expect(t.$('.many')).toBeTruthy()
    expect(t.$('.inc')).toBe(btn)
    expect(t.emits.map((e) => e.data)).toEqual([1, 2, 3])
    expect(t.container.querySelector('[data-sandbox-root]').getAttribute('style')).toMatch(/contain: content/)
  })

  it('a controlled input: the typed value goes in, the guest\'s value comes back; a form never submits', async () => {
    const t = mount(`
      export default function Form({ state }) {
        return <form className="f">
          <input className="name" value={state.name} />
          <p className="out">{state.name.toUpperCase()}</p>
          <button type="submit">go</button>
          <p className="sent">{state.sent}</p>
        </form>
      }
      Form.initialState = { name: '', sent: '' }
      Form.intent = ({ DOM }) => ({ NAME: DOM.select('.name').events('input').map(e => e.target.value), SEND: DOM.select('.f').events('submit') })
      Form.model = { NAME: (s, v) => ({ ...s, name: v.slice(0, 5) }), SEND: (s) => ({ ...s, sent: s.name, name: '' }) }
    `)
    await t.ready()
    const input = t.$('.name')
    input.value = 'abcdefgh'
    t.fire('.name', 'input')
    expect(t.$('.out').textContent).toBe('ABCDE')
    expect(input.value).toBe('abcde')
    expect(t.fire('.f', 'submit').defaultPrevented).toBe(true)
    expect(t.$('.sent').textContent).toBe('abcde')
    expect(input.value).toBe('')
  })

  it('keydown with preventDefault is answered synchronously', async () => {
    const t = mount(`
      export default function K() { return <input className="k" /> }
      K.initialState = { n: 0 }
      K.intent = ({ DOM }) => ({ KEY: DOM.select('.k').events('keydown').filter(e => e.key === 'Enter').map(e => { e.preventDefault(); return 1 }) })
      K.model = { KEY: (s) => ({ n: s.n + 1 }) }
    `)
    await t.ready()
    expect(t.fire('.k', 'keydown', { key: 'Enter' }).defaultPrevented).toBe(true)
    expect(t.fire('.k', 'keydown', { key: 'a' }).defaultPrevented).toBe(false)
  })

  it('Collection, context and timers work inside', async () => {
    const t = mount(`
      import { Collection } from 'sygnal'
      function Item({ state, context }) { return <li className="item">{context.prefix}{state.text}<button className="x">x</button></li> }
      Item.intent = ({ DOM }) => ({ DEL: DOM.select('.x').events('click') })
      Item.model = { DEL: () => undefined }
      export default function List({ state }) { return <div><ul><Collection of={Item} from="items" /></ul><p className="tick">{state.ticks}</p></div> }
      List.initialState = { items: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }], ticks: 0 }
      List.context = { prefix: () => '> ' }
      List.model = { BOOTSTRAP: { EFFECT: (s, d, next) => { setTimeout(() => next('TICK'), 10) } }, TICK: (s) => ({ ...s, ticks: s.ticks + 1 }) }
    `)
    await t.ready()
    expect(t.errors).toEqual([])
    expect([...t.container.querySelectorAll('.item')].map((li) => li.textContent)).toEqual(['> ax', '> bx', '> cx'])
    t.fire(t.container.querySelectorAll('.x')[1], 'click')
    expect([...t.container.querySelectorAll('.item')].map((li) => li.textContent)).toEqual(['> ax', '> cx'])
    await settle(40)
    expect(t.$('.tick').textContent).toBe('1')
  })

  it('PROPS: data from the page, before and after boot', async () => {
    const t = mount(`
      export default function P({ state }) { return <p className="p">{state.title}</p> }
      P.initialState = { title: '' }
      P.intent = ({ PROPS }) => ({ PROPS: PROPS.get('title') })
      P.model = { PROPS: (s, title) => ({ title }) }
    `, { props: { title: 'hello' } })
    t.sb.setProps({ title: 'before boot' })
    await t.ready()
    expect(t.$('.p').textContent).toBe('before boot')
    t.sb.setProps({ title: 'again' })
    expect(t.$('.p').textContent).toBe('again')
  })

  it('a root without initialState still renders (generated code often has none)', async () => {
    const t = mount(`export default function Hi() { return <p className="hi">hi</p> }`)
    await t.ready()
    expect(t.$('.hi').textContent).toBe('hi')
  })

  it('dispose removes everything', async () => {
    const t = mount(COUNTER)
    await t.ready()
    t.sb.dispose()
    expect(t.container.innerHTML).toBe('')
    expect(t.sb.memory()).toBe(null)
    expect(t.sb.dead).toBe(true)
  })

  it('a shared module can be passed (synchronous boot)', async () => {
    const quickjs = await loadQuickJS({ maxWasmBytes: 48 << 20 })
    const t = mount(COUNTER, { quickjs })
    expect(t.$('.n').textContent).toBe('0')
  })
})

describe('sygnal/sandbox: emits (declared types, Standard Schema)', () => {
  const EMITTER = `
    export default function E() { return <div><button className="a">a</button><button className="b">b</button><button className="c">c</button></div> }
    E.intent = ({ DOM }) => ({ A: DOM.select('.a').events('click'), B: DOM.select('.b').events('click'), C: DOM.select('.c').events('click') })
    E.model = {
      A: { EVENTS: () => ({ type: 'ANSWER', data: { pct: 20 } }) },
      B: { EVENTS: () => ({ type: 'ANSWER', data: { pct: 'lots' } }) },
      C: { EVENTS: () => ({ type: 'DELETE_ALL', data: null }) },
    }
  `
  const Answer = schema((v) => (typeof v?.pct == 'number' ? undefined : 'pct must be a number'), (v) => ({ pct: v.pct, checked: true }))

  it('delivers declared, valid events (the schema\'s output); drops the rest with SYG692 in dev', async () => {
    configureDiagnostics({ mode: 'collect' })
    clearDiagnostics()
    try {
      const t = mount(EMITTER, { emits: { ANSWER: Answer } })
      await t.ready()
      t.fire('.a', 'click')
      t.fire('.b', 'click')
      t.fire('.c', 'click')
      expect(t.emits).toEqual([{ type: 'ANSWER', data: { pct: 20, checked: true } }])
      const d = getDiagnostics().filter((x) => x.code === 'SYG692')
      expect(d.map((x) => x.message)).toEqual([
        "sygnal/sandbox: dropped the guest's 'ANSWER' event: invalid data: pct must be a number",
        "sygnal/sandbox: dropped the guest's 'DELETE_ALL' event: not declared in emits",
      ])
      expect(d[0].severity).toBe('warn')
    } finally { configureDiagnostics({}) }
  })

  it('without emits nothing reaches the page; an inherited name is not a declaration', async () => {
    const t = mount(EMITTER, { emits: undefined })
    await t.ready()
    t.fire('.a', 'click')
    expect(t.emits).toEqual([])
    const got = []
    const gate = emitGate({}, (e) => got.push(e))
    gate({ type: 'constructor', data: 1 })
    gate({ type: 'toString', data: 1 })
    gate({ type: '__proto__', data: 1 })
    expect(got).toEqual([])
  })

  it('async schemas keep the guest\'s order', async () => {
    const got = []
    const slow = { '~standard': { version: 1, vendor: 't', validate: (v) => new Promise((r) => setTimeout(() => r({ value: v }), 20)) } }
    const gate = emitGate({ S: slow, F: any }, (e) => got.push(e.type + e.data))
    gate({ type: 'S', data: 1 })
    gate({ type: 'F', data: 2 })
    gate({ type: 'S', data: 3 })
    await settle(80)
    expect(got).toEqual(['S1', 'F2', 'S3'])
    gate({ type: 'F', data: 4 })
    expect(got).toEqual(['S1', 'F2', 'S3', 'F4'])
  })

  it('works with real schema libraries (zod, valibot)', async () => {
    const { z } = await import('zod')
    const v = await import('valibot')
    const got = []
    const gate = emitGate({ Z: z.object({ n: z.number() }), V: v.object({ s: v.string() }) }, (e) => got.push(e))
    gate({ type: 'Z', data: { n: 1, extra: 'dropped by zod' } })
    gate({ type: 'Z', data: { n: 'x' } })
    gate({ type: 'V', data: { s: 'ok' } })
    gate({ type: 'V', data: { s: 1 } })
    await settle(5)
    expect(got).toEqual([{ type: 'Z', data: { n: 1 } }, { type: 'V', data: { s: 'ok' } }])
  })
})

describe('sygnal/sandbox: styling and focus (maintainer decisions Q4, Q5)', () => {
  it('guest classes are kept by default; classPrefix prefixes them', async () => {
    const code = `export default function C() { return <div className="card primary"><span className="x">x</span></div> }`
    const a = mount(code)
    await a.ready()
    expect(a.$('.card.primary')).toBeTruthy()
    const b = mount(code, { policy: { classPrefix: 'g-' } })
    await b.ready()
    expect(b.$('.card')).toBe(null)
    expect(b.$('.g-card.g-primary .g-x')).toBeTruthy()
  })

  const DIALOG = `
    export default function D({ state }) {
      return <div>
        <button className="open">open</button>
        {state.open && <input className="field" autoFocus={true} />}
      </div>
    }
    D.initialState = { open: false }
    D.intent = ({ DOM }) => ({ OPEN: DOM.select('.open').events('click') })
    D.model = { OPEN: (s) => ({ open: true }) }
  `
  it('focus is off by default: a guest never moves the page\'s focus', async () => {
    const t = mount(DIALOG)
    await t.ready()
    t.$('.open').focus()
    t.fire('.open', 'click')
    await settle(40) // autoFocus waits a frame
    expect(t.$('.field')).toBeTruthy()
    expect(document.activeElement).toBe(t.$('.open'))
    expect(t.sb.violations).toContain('focus (no focus capability)')
  })

  it('with the capability, the guest moves focus only while focus is inside the box', async () => {
    const t = mount(DIALOG, { capabilities: { focus: true } })
    await t.ready()
    t.$('.open').focus()
    t.fire('.open', 'click')
    await settle(40)
    expect(document.activeElement).toBe(t.$('.field'))

    // focus outside the box: the guest's autofocus is ignored
    const page = document.createElement('input')
    document.body.appendChild(page)
    const u = mount(DIALOG, { capabilities: { focus: true } })
    await u.ready()
    page.focus()
    u.fire('.open', 'click')
    await settle(40)
    expect(u.$('.field')).toBeTruthy()
    expect(document.activeElement).toBe(page)
  })
})

describe('sygnal/sandbox: the kernel and the protocol', () => {
  it('a kernel of another protocol version, or no kernel at all, is refused at boot', async () => {
    const errors = []
    const container = document.body.appendChild(document.createElement('div'))
    const quickjs = await loadQuickJS()
    createSandbox({ kernel: kernel + `;globalThis.__sandbox.v = ${PROTOCOL + 998}`, source: compile('export default () => null'), container, isolation: 'thread', quickjs, onError: (e) => errors.push(e) })
    createSandbox({ kernel: 'var x = 1', source: '', container, isolation: 'thread', quickjs, onError: (e) => errors.push(e) })
    expect(errors.map((e) => [e.reason, e.message.slice(0, 40)])).toEqual([
      ['protocol', 'the kernel speaks protocol 999, this syg'],
      ['protocol', 'not a sandbox kernel: import it from syg'],
    ])
    expect(() => createSandbox({ source: '' })).toThrow(/kernel` is required/)
    expect(() => createSandbox({ kernel, source: '', isolation: 'iframe' })).toThrow(/'worker' or 'thread'/)
    expect(() => createSandbox({ kernel, source: '', limits: { stackBytes: 1 << 20 } })).toThrow(/crash the WASM module/)
  })
})
