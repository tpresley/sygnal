// @vitest-environment jsdom
// PLAN-5 0-A: the interfaces PLAN-4 promised to PLAN-5 (PLAN-4-status "Interfaces promised to
// PLAN-5"), checked against the BUILD (dist/) on the PLAN-4.6 core. A minimal widget-shaped spec
// object (kind 'widget', an opaque host whose insert hook "mounts" an instance and emits a
// bubbling CustomEvent) stands in for PLAN-5's defineWidget.
//
//   I1 control spec contract { kind, vnode(props, children, h), commands?, __props? }: the pragma
//      passes its own h, stamps data-control, keeps hooks, copies key (D101/D116)
//   I2 kind-blind acceptance: DOM.*, simulateEvent, query/queryAll, element commands resolve the
//      control to [data-control="<Key>"] whatever its kind; also inside a Collection item
//   I3 __props phantom typing: type-tests/p5-0a-interfaces.tsx
//   I4 element commands: spec.commands[name](hostElement, options) before native methods, SYG641
//      only after (D102)
//   I5 onError phase 'widget' in the type union (D105): type-tests/p5-0a-interfaces.tsx; nothing
//      in the core emits it (checked here: the runtime has no public way to report it)
import { describe, it, expect, afterEach } from 'vitest'
import * as sygnal from '../dist/index.esm.js'
import { jsx } from '../dist/jsx-runtime.esm.js'

const { renderComponent, createElement: h, controls, Collection, renderToString } = sygnal

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
})
const wait = (ms) => new Promise(r => setTimeout(r, ms))

// ─── a widget-shaped spec object ────────────────────────────────────────────

const mounted = []          // [hostElement, instance]
const opened = []           // [hostElement, options, instance]
let seenH = []
const pickerSpec = {
  kind: 'widget',
  vnode(props, children, hh) {
    seenH.push(hh)
    const { key, value, ...rest } = props
    return hh('div', {
      ...rest,
      // opaque host: no children; the "widget instance" lives on the host element
      hook: {
        insert: (v) => {
          const inst = { value, el: v.elm, opened: 0 }
          v.elm.__w = inst
          mounted.push([v.elm, inst])
          v.elm.textContent = 'picker:' + value
        },
        update: (_o, v) => { if (v.elm.__w) v.elm.__w.value = value },
      },
    })
  },
  commands: {
    open: (el, options) => { el.__w && el.__w.opened++; opened.push([el, options, el.__w]) },
    // overrides the native focus
    focus: (el, options) => { opened.push([el, { focus: true, ...options }, el.__w]) },
  },
}

// ─── I1: the contract ───────────────────────────────────────────────────────

describe('I1 control spec contract (D101/D116)', () => {
  const { Due } = controls({ Due: pickerSpec })

  it('kind and spec stay on the control; it stringifies to its selector', () => {
    expect(Due.kind).toBe('widget')
    expect(Due.spec).toBe(pickerSpec)
    expect(String(Due)).toBe('[data-control="Due"]')
  })

  it('the classic pragma passes its own createElement as h, stamps data-control, keeps hooks, copies key', () => {
    seenH = []
    const v = h(Due, { className: 'due', value: '2026-10-05', key: 'k1' })
    expect(seenH[0]).toBe(h)
    expect(v.sel).toBe('div')
    expect(v.key).toBe('k1')
    expect(v.data.attrs['data-control']).toBe('Due')
    expect(typeof v.data.hook.insert).toBe('function')
    expect(typeof v.data.hook.update).toBe('function')
    expect(v.data.props.className).toBe('due')
  })

  it('the automatic JSX runtime routes through the core pragma (same h), key from jsx()', () => {
    seenH = []
    const v = jsx(Due, { value: 'x' }, 'k2')
    expect(seenH[0]).toBe(h)
    expect(v.key).toBe('k2')
    expect(v.data.attrs['data-control']).toBe('Due')
  })

  it("a vnode()'s own key wins over the props' key", () => {
    const { Own } = controls({ Own: { kind: 'widget', vnode: (p, c, hh) => hh('div', { key: 'own' }) } })
    expect(h(Own, { key: 'props' }).key).toBe('own')
  })

  it('SSR renders the host with the stamp', () => {
    function Page() { return h('div', null, h(Due, { className: 'due', value: 'v' })) }
    Page.initialState = {}
    expect(renderToString(Page, { state: {} })).toContain('data-control="Due"')
  })
})

// ─── I2 + I4: one app, mock and real DOM, top level and in Collection items ─

const { Due, Open, FocusIt, Bogus } = controls({ Due: pickerSpec, Open: 'button', FocusIt: 'button', Bogus: 'button' })

function Row({ state }) {
  return h('li', { className: 'row', 'data-id': String(state.id) },
    h(Due, { value: state.due }), h(Open, null, 'open'))
}
Row.intent = ({ DOM }) => ({
  CHANGE: DOM.select(Due).events('change').map(e => e.detail),
  CLICKED: DOM.click(Due),
  OPEN: DOM.click(Open),
})
Row.model = {
  CHANGE: (s, due) => ({ ...s, due }),
  CLICKED: (s) => ({ ...s, clicks: (s.clicks || 0) + 1 }),
  OPEN: { ELEMENT: { open: Due, at: 'row' } },
}

function Planner({ state }) {
  return h('div', null,
    h(Due, { className: 'top', value: state.due }),
    h(Open, null, 'Open'), h(FocusIt, null, 'Focus'), h(Bogus, null, 'Bogus'),
    h('ul', null, h(Collection, { of: Row, from: 'rows' })))
}
Planner.initialState = { due: 'd0', rows: [{ id: 1, due: 'a' }, { id: 2, due: 'b' }] }
Planner.intent = ({ DOM }) => ({
  CHANGE: DOM.select(Due).events('change').map(e => e.detail),
  OPEN: DOM.click(Open),
  FOCUS_IT: DOM.click(FocusIt),
  BOGUS: DOM.click(Bogus),
})
Planner.model = {
  CHANGE: (s, due) => ({ ...s, due }),
  OPEN: { ELEMENT: { open: Due, at: 3 } },
  FOCUS_IT: { ELEMENT: { focus: Due } },
  BOGUS: { ELEMENT: { explode: Due } },
}

const codes = () => t.diagnostics.map(d => d.code)

for (const dom of ['mock', 'real']) {
  const opts = dom === 'real' ? { dom: 'real' } : {}
  describe(`I2 kind-blind acceptance (${dom} DOM)`, () => {
    it('DOM.select(control).events, DOM.<event>(control), simulateEvent, query/queryAll', async () => {
      t = renderComponent(Planner, opts)
      await t.ready()
      expect(t.queryAll(Due)).toHaveLength(3)
      expect(t.query(Due)).toBeTruthy()
      expect(t.html()).toContain('data-control="Due"')
      // the parent hears only its own widget (isolation: the items' hosts are not its)
      t.simulateEvent(Due, 'change', { detail: 'd1' })
      await t.next(s => s.due === 'd1')
      expect(t.state.rows.map(r => r.due)).toEqual(['a', 'b'])
    })

    it('inside a Collection item: a control event reaches only that item', async () => {
      t = renderComponent(Planner, opts)
      await t.ready()
      t.simulateEvent(Due, 'click', { within: '[data-id="2"]' })
      await t.next(s => s.rows[1].clicks === 1)
      await wait(20)
      expect(t.state.rows[0].clicks).toBeUndefined()
      t.simulateEvent(Due, 'change', { within: '[data-id="1"]', detail: 'a2' })
      await t.next(s => s.rows[0].due === 'a2')
      await wait(20)
      expect(t.state.rows[1].due).toBe('b')
      expect(t.state.due).toBe('d0')
    })
  })
}

describe('I2 real DOM: a host-dispatched bubbling CustomEvent reaches intent', () => {
  it('the widget instance emits on its host; each item mounts once', async () => {
    mounted.length = 0
    t = renderComponent(Planner, { dom: 'real' })
    await t.ready()
    expect(mounted).toHaveLength(3)
    const itemHost = t.query('[data-id="2"] [data-control="Due"]')
    itemHost.dispatchEvent(new CustomEvent('change', { detail: 'b2', bubbles: true }))
    await t.next(s => s.rows[1].due === 'b2')
    expect(t.state.rows[0].due).toBe('a')
    expect(t.state.due).toBe('d0')
    // the host was patched, not re-mounted; update saw the newest value
    expect(mounted).toHaveLength(3)
    expect(itemHost.__w.value).toBe('b2')
  })
})

describe('I4 element commands consult spec.commands before native methods (D102)', () => {
  it('mock DOM: a spec command is recorded and raises no SYG641', async () => {
    t = renderComponent(Planner, { diagnostics: 'collect' })
    await t.ready()
    t.simulateEvent(Open, 'click')
    await t.settle()
    expect(t.commands('ELEMENT')).toEqual([{ open: Due, at: 3 }])
    expect(codes()).not.toContain('SYG641')
  })

  it('real DOM: commands[name](hostElement, options) runs; a spec focus overrides the native one', async () => {
    opened.length = 0
    t = renderComponent(Planner, { dom: 'real', diagnostics: 'collect' })
    await t.ready()
    t.simulateEvent(Open, 'click')
    await t.settle(); await wait(20)
    const host = t.query(`.top${Due}`)
    expect(opened).toHaveLength(1)
    expect(opened[0][0]).toBe(host)
    expect(opened[0][1]).toEqual({ at: 3 })
    expect(opened[0][2]).toBe(host.__w)         // the widget instance, found through the host
    t.simulateEvent(FocusIt, 'click')
    await t.settle(); await wait(20)
    expect(opened[1][1]).toEqual({ focus: true })
    expect(codes()).not.toContain('SYG641')
  })

  it('real DOM: inside a Collection item the command reaches only that item\'s host', async () => {
    opened.length = 0
    t = renderComponent(Planner, { dom: 'real' })
    await t.ready()
    t.simulateEvent(Open, 'click', { within: '[data-id="2"]' })
    await t.settle(); await wait(20)
    expect(opened).toHaveLength(1)
    expect(opened[0][0]).toBe(t.query(`[data-id="2"] ${Due}`))
    expect(opened[0][1]).toEqual({ at: 'row' })
  })

  it('real DOM: neither a spec command nor a native method → SYG641 (only then)', async () => {
    t = renderComponent(Planner, { dom: 'real', diagnostics: 'collect' })
    await t.ready()
    t.simulateEvent(Bogus, 'click')
    await t.settle(); await wait(40)
    expect(codes()).toContain('SYG641')
    const d = t.diagnostics.find(x => x.code === 'SYG641')
    expect(d.data.commands).toEqual(['open', 'focus'])
  })
})

describe("I5 onError phase 'widget'", () => {
  it('is reported only through defineWidget (W-1): no public way to report it otherwise', () => {
    // 0-A finding: reporting needs the owning instance (Runtime.appError, internal). PLAN-5 W-1's
    // defineWidget reports it through its owner (test/p5-w1-widget.test.js, errors).
    expect(Object.keys(sygnal).filter(k => /widget|reportError|appError/i.test(k))).toEqual(['defineWidget'])
  })
})
