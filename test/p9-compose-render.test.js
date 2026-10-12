// PLAN-9 K-2 (worker A): catalog.render: identity keys (key + id until 0-S2 merges), lenses (key,
// lens, (node) => lens with byId, local), params as props / props(), node / scope / frozen /
// answer props, containers (slots, children, ui, control), unknown parts, error containment.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { defineCatalog, compose } from '../src/extra/ai/index.ts'
import { byId } from '../src/extra/lens.ts'
import { configureDiagnostics, getDiagnostics, _resetDiagnostics } from '../src/extra/diagnostics/index.ts'

let t
beforeEach(() => { _resetDiagnostics(); configureDiagnostics({ mode: 'collect' }) })
afterEach(() => { t?.dispose(); t = null; _resetDiagnostics() })

const Card = ({ state, title, node, scope, frozen, answer }) => h('div', { className: 'card', 'data-node': node }, `${title}|${state?.name ?? ''}|${scope ?? ''}|${frozen ?? ''}|${answer ?? ''}`)
const Chart = ({ range, metric }) => h('i', { className: 'chart', 'data-range': range, 'data-metric': metric })
const cat = defineCatalog({
  parts: {
    card: { component: Card, description: 'Card', in: ['page', 'tabs'], params: { id: { from: (s) => s.items.map((x) => ({ value: x.id })) }, title: { type: 'text', default: 'T' } }, state: (node) => byId('items', node.params.id) },
    keyed: { component: Card, description: 'Keyed', state: 'one', params: { title: { type: 'text', default: 'K' } } },
    lensed: { component: Card, description: 'Lensed', state: { get: (s) => s.one, set: (s, v) => ({ ...s, one: v }) } },
    chart: { component: Chart, description: 'Chart', props: (params, state) => ({ ...params, metric: state.metric }), params: { range: { options: { m: 'm', y: 'y' }, default: 'y' } } },
    view: { render: ({ range, state, node }) => h('b', { className: 'view', 'data-node': node }, `${range}:${state.metric}`), description: 'View', in: ['page', 'tabs'], params: { range: { options: { m: 'm', y: 'y' } } } },
    boom: { component: Chart, description: 'Boom', props: () => { throw new Error('no data') } },
  },
  containers: {
    tabs: { slots: { a: null, b: null }, render: ({ key, slots, children, ui, control, params }) => h('section', { className: 'tabs', 'data-key': key, 'data-tone': params.tone },
      h('button', { className: 'pick', ...control('tab', { i: 1 }) }, String(ui.tab?.i ?? 0)), h('div', { className: 'a' }, slots.a), h('div', { className: 'b' }, slots.b),
      h('p', { className: 'kids' }, children.map((c) => `${c.slot}:${c.key}:${c.part.id}`).join(','))),
      params: { tone: { options: { calm: 'c', loud: 'l' } } } },
  },
})
const STATE = { items: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }], one: { name: 'solo' }, metric: 'revenue' }
const L = (keys, nodes) => ({ root: 'page', nodes: { page: { part: 'page', slots: { default: keys } }, ...nodes } })
const comps = (v, out = []) => { if (v && typeof v === 'object') { if (v.data?.c) out.push(v); (v.children || []).forEach((c) => comps(c, out)) } return out }

describe('catalog.render (vnodes)', () => {
  it('a part: identity key and id, its lens, params with defaults as props, node', () => {
    const slice = { layout: L(['card:1', 'keyed'], { 'card:1': { part: 'card', params: { id: 1 } }, keyed: { part: 'keyed' } }) }
    const [card, keyed] = comps(cat.render(slice, { ...STATE, page: slice }))
    expect(card.key).toBe('card:1')
    expect(card.key).toBe('card:1')
    expect(card.data.props).toMatchObject({ id: 1, node: 'card:1', title: 'T' })   // the record param `id` reaches the part
    expect(card.data.props.state.get(STATE)).toBe(STATE.items[0])
    expect(keyed.data.props.state).toBe('one')
    expect(keyed.data.props.title).toBe('K')
  })

  it('lenses are memoized per node (same object across renders, G-752); a new record: a new lens', () => {
    const slice = { layout: L(['card:1'], { 'card:1': { part: 'card', params: { id: 1 } } }) }
    const a = comps(cat.render(slice, STATE))[0].data.props.state
    const b = comps(cat.render({ ...slice }, { ...STATE }))[0].data.props.state
    expect(a).toBe(b)
    const c = comps(cat.render({ layout: L(['card:2'], { 'card:2': { part: 'card', params: { id: 2 } } }) }, STATE))[0].data.props.state
    expect(c).not.toBe(a)
  })

  it('scope, frozen and answer: scoped keys, the props, a disabled fieldset', () => {
    const slice = { layout: L(['keyed'], { keyed: { part: 'keyed' } }) }
    const out = cat.render(slice, STATE, { scope: 'call_1', frozen: true, answer: { node: 'keyed', value: 'yes' }, at: ['cards', 'call_1'] })
    expect(out.sel).toBe('fieldset')
    expect(out.data.props.disabled).toBe(true)
    const [k] = comps(out)
    expect(k.key).toBe('call_1/keyed')
    expect(k.key).toBe('call_1/keyed')
    expect(k.data.props).toMatchObject({ scope: 'call_1', frozen: true, answer: 'yes' })
  })

  it('renders the preview while there is one; nothing without a layout', () => {
    expect(cat.render({ layout: null }, STATE)).toBe(null)
    expect(cat.render(null, STATE)).toBe(null)
    const out = cat.render({ layout: L(['keyed'], { keyed: { part: 'keyed' } }), preview: L(['lensed'], { lensed: { part: 'lensed' } }) }, STATE)
    expect(comps(out).map((v) => v.key)).toEqual(['lensed'])
  })

  it('an unknown part or slot is skipped (SYG250, once); a throwing props() replaces the composition (SYG406)', () => {
    const slice = { layout: L(['x', 'tabs'], { x: { part: 'gone' }, tabs: { part: 'tabs', slots: { a: ['keyed'], zz: ['lensed'] } }, keyed: { part: 'keyed' }, lensed: { part: 'lensed' } }) }
    cat.render(slice, STATE)
    cat.render(slice, STATE)
    expect(getDiagnostics().map((d) => d.code)).toEqual(['SYG250', 'SYG250'])
    const out = cat.render({ layout: L(['boom'], { boom: { part: 'boom' } }) }, STATE)
    expect(out.data.props.className).toBe('compose-error')
    expect(getDiagnostics().map((d) => d.code)).toContain('SYG406')
  })
})

describe('catalog.render in an app', () => {
  function makeHost() {
    function Host({ state }) { return h('main', null, cat.render(state.page, state)) }
    Host.initialState = { ...STATE }
    Host.uses = { page: compose(cat, { backend: compose.llm({ model: 'm' }) }) }
    Host.model = { SET_METRIC: (s, metric) => ({ ...s, metric }) }
    return Host
  }

  it('props(params, state), a view-function part, containers with slots / children / params / ui / control', async () => {
    t = renderComponent(makeHost())
    t.simulateAction('page.SET_LAYOUT', L(['chart', 'tabs'], {
      chart: { part: 'chart', params: { range: 'm' } },
      tabs: { part: 'tabs', params: { tone: 'loud' }, slots: { a: ['view'], b: ['card:2'] } },
      view: { part: 'view' }, 'card:2': { part: 'card', params: { id: 2 } },
    }))
    await t.next((s) => s.page.status === 'done')
    expect(t.query('.chart').getAttribute('data-range')).toBe('m')
    expect(t.query('.chart').getAttribute('data-metric')).toBe('revenue')
    expect(t.query('.tabs .a .view').textContent).toBe('m:revenue')
    expect(t.query('.tabs .b .card').textContent).toBe('T|two|||')
    expect(t.query('.tabs').getAttribute('data-tone')).toBe('loud')
    expect(t.query('.kids').textContent).toBe('a:view:view,b:card:2:card')
    expect(t.query('.pick').getAttribute('data-compose-key')).toBe('tabs')
    t.simulateEvent('.pick', 'click')
    await t.next((s) => s.page.ui.tabs?.tab?.i === 1)
    expect(t.query('.pick').textContent).toBe('1')
    t.simulateAction('SET_METRIC', 'churn')
    await t.next((s) => s.metric === 'churn')
    expect(t.query('.chart').getAttribute('data-metric')).toBe('churn')
  })
})
