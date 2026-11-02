// @vitest-environment jsdom
// Three compose fixes found by the examples/ai-adaptive stress test (composed forms and a board that
// re-arranges itself): `render` parts keyed by their node key; a fresh composition's preview over a
// layout (the behavior's `preview`: 'merge' by default, 'replace', 'keep'; layout.ts overlay());
// `maxUses` on containers (defineCatalog, finish(), compose.llm()'s repair and prompt).
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { compose, composeWith, defineCatalog } from '../src/extra/ai/index.ts'
import { finish, overlay } from '../src/extra/ai/compose/layout.ts'
import { llm, systemPrompt } from '../src/extra/ai/compose/llm.ts'
import { configureDiagnostics, getDiagnostics, _resetDiagnostics } from '../src/extra/diagnostics/index.ts'
import { makeApp, catalog as appCatalog } from './p9-compose-app.js'
import { fakeLlm, shape } from './p9-compose-fakes.js'
import { names } from './p9-llm-helpers.js'

let t
beforeEach(() => { _resetDiagnostics(); configureDiagnostics({ mode: 'collect' }) })
afterEach(() => { t?.dispose(); t = null; _resetDiagnostics() })
const codes = () => getDiagnostics().map((d) => d.code)
const L = (nodes, keys) => ({ root: 'page', nodes: { page: { part: 'page', slots: { default: keys } }, ...nodes } })

describe('render parts are keyed by their node key', () => {
  const Field = ({ node, label }) => h('label', { className: 'field' }, label, h('textarea', { className: `ta ta-${node}` }))
  const Own = ({ node }) => h('p', { key: 'mine', className: 'own' }, node)
  const cat = defineCatalog({
    parts: {
      field: { render: Field, description: 'A field', maxUses: 5, params: { label: { type: 'text', default: 'Field' } } },
      own: { render: Own, description: 'Keys itself' },
      none: { render: () => null, description: 'Renders nothing' },
    },
  })

  it('the vnode gets the node key (scoped like a component part) unless the view gave one', () => {
    const layout = L({ field: { part: 'field' }, 'field~2': { part: 'field' }, own: { part: 'own' }, none: { part: 'none' } }, ['field', 'field~2', 'own', 'none'])
    const page = cat.render({ layout }, {})
    expect(page.children.map((v) => v.key)).toEqual(['field', 'field~2', 'mine'])
    expect(cat.render({ layout }, {}, { scope: 'call_1' }).children.map((v) => v.key)).toEqual(['call_1/field', 'call_1/field~2', 'mine'])
  })

  it('a part inserted above one keeps its element and the focus (real DOM)', async () => {
    function Host({ state }) { return h('main', null, cat.render(state.page, state)) }
    Host.initialState = { page: { layout: L({ field: { part: 'field', params: { label: 'Details' } } }, ['field']), ui: {}, local: {} } }
    Host.model = { SET: (s, layout) => ({ ...s, page: { ...s.page, layout } }) }
    t = renderComponent(Host, { dom: 'real' })
    await t.ready()
    await t.settle()
    const ta = t.container.querySelector('.ta-field')
    ta.focus()
    ta.value = 'on the seat'
    const next = L({ 'field~2': { part: 'field', params: { label: 'Device' } }, field: { part: 'field', params: { label: 'Details' } } }, ['field~2', 'field'])
    t.simulateAction('SET', next)
    await t.next((s) => s.page.layout === next)
    await t.settle()
    expect([...t.container.querySelectorAll('.ta')].map((e) => e.className)).toEqual(['ta ta-field~2', 'ta ta-field'])
    expect(t.container.querySelector('.ta-field')).toBe(ta)
    expect(document.activeElement).toBe(ta)
    expect(ta.value).toBe('on the seat')
  })
})

describe("a fresh composition's preview over a layout", () => {
  const app = (preview) => {
    const backend = fakeLlm()
    return makeApp(backend, { uses: { page: compose(appCatalog, { backend, form: '.ask', prompt: '.prompt', ...(preview && { preview }) }) } })
  }
  // the board: tickets, orders, weather; then a fresh composition that streams weather first
  async function rearrange(preview) {
    t = renderComponent(app(preview), { strict: true })
    t.simulateAction('page.COMPOSE', 'tickets, orders, weather')
    await t.next((s) => s.page.status === 'composing')
    await composeWith(t, appCatalog, [{ part: 'tickets' }, { part: 'orders' }, { part: 'weather' }])
    await t.waitForState((s) => s.page.status === 'done')
    t.simulateAction('page.COMPOSE', { prompt: 'weather first, then the tickets', fresh: true })
    await t.next((s) => s.page.status === 'composing')
    const text = JSON.stringify({ page: [{ part: 'weather' }, { part: 'tickets' }] })
    const cut = text.indexOf('{"part":"tickets"') + 12
    await t.stream('LLM', [text.slice(0, cut)], 'page.REPLY', { end: false })
    return async () => {
      await t.stream('LLM', [text.slice(cut)], 'page.REPLY')
      await t.waitForState((s) => s.page.status === 'done')
      expect(shape(t.state.page.layout)).toEqual(['weather', 'tickets'])
      expect(t.state.page.preview).toBe(null)
    }
  }

  it("'merge' (the default): the streamed parts where the reply puts them, the others where they were", async () => {
    const end = await rearrange()
    expect(t.state.page.status).toBe('preview')
    expect(shape(t.state.page.preview)).toEqual(['weather', 'tickets', 'orders'])
    expect(t.query('.orders')).toBeTruthy()
    await end()
    expect(t.query('.orders')).toBe(null)
  })

  it("'replace': only the parts streamed so far (the earlier behaviour)", async () => {
    const end = await rearrange('replace')
    expect(shape(t.state.page.preview)).toEqual(['weather'])
    expect(t.query('.orders')).toBe(null)
    await end()
  })

  it("'keep': no preview while a layout is up, status 'composing' until the reply", async () => {
    const end = await rearrange('keep')
    expect(t.state.page.status).toBe('composing')
    expect(t.state.page.preview).toBe(null)
    expect(shape(t.state.page.layout)).toEqual(['tickets', 'orders', 'weather'])
    await end()
  })

  it("'keep' and 'merge' still preview a first composition; an invalid value is SYG681", async () => {
    for (const preview of ['keep', 'merge']) {
      t = renderComponent(app(preview), { strict: true })
      t.simulateAction('page.COMPOSE', 'tickets, orders')
      await t.next((s) => s.page.status === 'composing')
      const text = JSON.stringify({ page: [{ part: 'tickets' }, { part: 'orders' }] })
      await t.stream('LLM', [text.slice(0, text.indexOf('{"part":"orders"') + 5)], 'page.REPLY', { end: false })
      expect(shape(t.state.page.preview)).toEqual(['tickets'])
      t.dispose()
      t = null
    }
    expect(() => compose(appCatalog, { backend: fakeLlm(), preview: 'later' })).toThrow(/SYG681/)
  })

  it('overlay(): previous nodes stay in their container, an emptied one goes, a held node appears once', () => {
    const previous = L({
      a: { part: 'a' }, b: { part: 'b' }, c: { part: 'c' }, d: { part: 'd' },
      box: { part: 'box', slots: { default: ['b', 'c'] } }, other: { part: 'box', slots: { default: ['d'] } },
    }, ['a', 'box', 'other'])
    // the reply so far: d at the top, the box holding c
    const preview = L({ d: { part: 'd' }, c: { part: 'c' }, box: { part: 'box', slots: { default: ['c'] } } }, ['d', 'box'])
    const out = overlay(preview, previous)
    expect(shape(out)).toEqual(['d', 'box(c,b)', 'a'])
    expect(out.nodes.other).toBe(undefined)
    // the preview is left as it was
    expect(shape(preview)).toEqual(['d', 'box(c)'])
    expect(overlay(preview, null)).toBe(preview)
  })
})

describe('maxUses on containers', () => {
  const Q = () => h('p', null, 'q')
  const decl = (section = { maxUses: 2 }) => ({
    parts: {
      q: { render: Q, description: 'Question', maxUses: 6, in: ['section'], params: { label: { type: 'text', required: true } } },
      note: { render: Q, description: 'Note' },
    },
    containers: { section: { description: 'Section', params: { title: { type: 'text', default: 'Section' } }, ...section } },
  })
  const sections = (n) => {
    const nodes = {}, keys = []
    for (let i = 1; i <= n; i++) {
      const s = i === 1 ? 'section' : `section~${i}`, q = i === 1 ? 'q' : `q~${i}`
      nodes[q] = { part: 'q', params: { label: `Q${i}` } }
      nodes[s] = { part: 'section', params: { title: `S${i}` }, slots: { default: [q] } }
      keys.push(s)
    }
    return L(nodes, keys)
  }

  it('defineCatalog keeps it (a positive integer; default: no limit); an invalid one is SYG450', () => {
    expect(defineCatalog(decl()).containers.section.maxUses).toBe(2)
    expect(defineCatalog(decl({})).containers.section.maxUses).toBe(undefined)
    expect(codes()).toEqual([])
    for (const maxUses of [0, 1.5, 'two']) expect(defineCatalog(decl({ maxUses })).containers.section.maxUses).toBe(undefined)
    expect(codes()).toEqual(['SYG450', 'SYG450', 'SYG450'])
  })

  it('finish(): the ones past it are unwrapped, their children moved into the first one (their `in`)', () => {
    const cat = defineCatalog(decl())
    expect(shape(finish(cat, sections(3)))).toEqual(['section(q,q~3)', 'section~2(q~2)'])
    // without maxUses a container repeats freely
    expect(shape(finish(defineCatalog(decl({})), sections(3)))).toEqual(['section(q)', 'section~2(q~2)', 'section~3(q~3)'])
    expect(shape(finish(defineCatalog(decl({ maxUses: 1 })), sections(2)))).toEqual(['section(q,q~2)'])
  })

  it('compose.llm(): a reply with more is repaired to maxUses (a repair, not an error); three sections stay without it', () => {
    const value = {
      asked_for: [],
      children: [1, 2, 3].map((i) => ({ part: 'section', params: { title: `S${i}` }, children: [{ part: 'q', params: { label: `Q${i}` } }] })),
    }
    const run = (cat) => {
      const b = llm()
      const { pending } = b.start({ catalog: cat, state: {}, prompt: 'x', previous: null, names })
      return b.reply({ catalog: cat, state: {}, pending, reply: { value, text: JSON.stringify(value) } })
    }
    const r = run(defineCatalog(decl()))
    expect(shape(r.layout)).toEqual(['section(q,q~3)', 'section~2(q~2)'])
    expect(r.decisions.repairs).toContainEqual({ kind: 'duplicate', detail: 'section' })
    expect(shape(run(defineCatalog(decl({}))).layout)).toEqual(['section(q)', 'section~2(q~2)', 'section~3(q~3)'])
  })

  it("the LLM prompt says how often a part or a container may be used (unchanged when nothing repeats)", () => {
    const p = systemPrompt(defineCatalog(decl()), {})
    expect(p).toContain('- q: Question (up to 6 times) (only inside section)')
    expect(p).toContain('- section: Section (up to 2 times)')
    expect(p).toContain('- Use each part at most once; a part marked "up to N times" at most N times.')
    expect(systemPrompt(defineCatalog(decl({ maxUses: 1 })), {})).toContain('- section: Section (at most once)')
    const plain = systemPrompt(defineCatalog({ parts: { note: { render: Q, description: 'Note' } }, containers: { section: { description: 'Section' } } }), {})
    expect(plain).toContain('- section: Section\n')
    expect(plain).toContain('- Use each part at most once.\n')
  })
})
