// PLAN-9 (worker A): defineCatalog inference (part ids, param types, slots), layouts and trees,
// the compose behavior's slice and actions, composeWith, compose.answer, byId.
import { expectTypeOf } from 'vitest'
import { defineCatalog, compose, composeWith, fromTree, toTree, removeNode } from 'sygnal/ai'
import type { Catalog, Layout, ComposeState, ComposeTree, CatalogTree, ComposeBackend } from 'sygnal/ai'
import { byId, renderComponent, defineCatalog as fromCore } from 'sygnal'
import type { UsesActions, UsesState } from 'sygnal'

function Kpi({ metric }: { metric: string }) { return <div>{metric}</div> }
function Card({ state }: { state: { id: number; name: string } }) { return <div>{state.name}</div> }

const catalog = defineCatalog({
  guidance: 'Summaries first.',
  limits: { maxParts: 8 },
  parts: {
    revenue: { component: Kpi, props: { metric: 'revenue' }, description: 'Revenue (KPI)' },
    chart: { component: Kpi, description: 'Chart', params: { range: { options: { month: 'm', year: 'y' }, default: 'year' }, n: { type: 'number', default: 5 } } },
    note: { component: Kpi, local: { text: '' }, description: 'Note', params: { title: { type: 'text', required: true }, tags: { type: 'list' } } },
    customer: {
      component: Card, description: 'Customer',
      params: { id: { from: (s: { customers: Array<{ id: number; name: string }> }) => s.customers.map((c) => ({ value: c.id, name: c.name })) } },
      state: (node) => byId('customers', node.params.id),
    },
  },
  containers: {
    tabs: { slots: { overview: 'Overview', billing: 'Billing' }, minSlots: 2, render: ({ children, ui, control }) => <div {...control('tab', 1)}>{children.map((c) => c.vnode)}{ui.tab}</div> },
  },
})
expectTypeOf(fromCore).toEqualTypeOf(defineCatalog)

// ---- trees: part ids, params and slots are checked
const tree: CatalogTree<typeof catalog extends Catalog<infer D> ? D : never> = [
  { part: 'revenue' },
  { part: 'chart', params: { range: 'month', n: 3 } },
  { part: 'customer', params: { id: 7 } },
  { part: 'row', children: [{ part: 'revenue' }, { part: 'note', params: { title: 'x', tags: ['a'] } }] },
  { part: 'tabs', children: { overview: [{ part: 'revenue' }], billing: [{ part: 'chart' }] } },
]
const layout: Layout = fromTree(catalog, tree)
fromTree(catalog, [{ part: 'revenue' }], layout)
// @ts-expect-error not a part
fromTree(catalog, [{ part: 'revenu' }])
// @ts-expect-error not an option
fromTree(catalog, [{ part: 'chart', params: { range: 'decade' } }])
// @ts-expect-error a number param
fromTree(catalog, [{ part: 'chart', params: { n: 'three' } }])
// @ts-expect-error a record value is a number here
fromTree(catalog, [{ part: 'customer', params: { id: 'seven' } }])
// @ts-expect-error not a slot of tabs
fromTree(catalog, [{ part: 'tabs', children: { settings: [{ part: 'revenue' }] } }])
expectTypeOf(toTree(layout)).toEqualTypeOf<ComposeTree>()
expectTypeOf(removeNode(layout, 'revenue')).toEqualTypeOf<Layout>()
expectTypeOf(catalog.finish(layout, {})).toEqualTypeOf<Layout>()
expectTypeOf(catalog.options({})[0].option).toEqualTypeOf<string>()
expectTypeOf(catalog.limits.maxParts).toEqualTypeOf<number>()

// ---- the behavior
const backend: ComposeBackend = compose.decisions({ model: 'jev-latest' })
const uses = { page: compose(catalog, { backend, form: '.ask', prompt: '.prompt' }) }
type S = UsesState<typeof uses>
expectTypeOf<S['page']>().toEqualTypeOf<ComposeState>()
type A = UsesActions<typeof uses>
expectTypeOf<A['page.SET_LAYOUT']>().toEqualTypeOf<Layout | null>()
expectTypeOf<A['page.DONE']>().toEqualTypeOf<Layout>()
expectTypeOf<A['page.REMOVE']>().toEqualTypeOf<string>()
compose(catalog, { backend: compose.llm({ model: 'qwen3:8b' }), key: 'lane' })
// @ts-expect-error a backend is required
compose(catalog, {})

function Workspace({ state }: { state: { page: ComposeState; customers: Array<{ id: number; name: string }> } }) {
  return <main>{catalog.render(state.page, state, { scope: 'c1', frozen: false, answer: null, at: ['page'] })}</main>
}
Workspace.initialState = { customers: [] as Array<{ id: number; name: string }> }
Workspace.uses = uses

// ---- answer, composeWith, byId
expectTypeOf(compose.answer({ scope: 'c1', node: 'choice' }, 'yes').value).toEqualTypeOf<string>()
const t = renderComponent(Workspace)
expectTypeOf(composeWith(t, catalog, [{ part: 'revenue' }], { stream: 3 })).toEqualTypeOf<Promise<void>>()
// @ts-expect-error not a part
composeWith(t, catalog, [{ part: 'nope' }])
const lens = byId<{ id: number; name: string }>('customers', 7)
expectTypeOf(lens.get({})).toEqualTypeOf<{ id: number; name: string } | undefined>()

// an untyped catalog takes any tree
declare const loose: Catalog<any>
fromTree(loose, [{ part: 'anything', children: { x: [] } }])

// ---- C-2: the composition as an agent action
expectTypeOf(compose.action('page')).toHaveProperty('page.COMPOSE')
expectTypeOf(compose.action('board', { timeout: 5 })).toHaveProperty('board.COMPOSE')
const agentDecl = { name: 'app', read: (s: { page: ComposeState }) => ({ page: compose.summary(s.page) }), actions: { ...compose.action() } }
expectTypeOf(agentDecl.actions['page.COMPOSE'].description).toEqualTypeOf<string>()
expectTypeOf(compose.summary(null)).toEqualTypeOf<{ status: ComposeState['status']; page: ComposeTree; error?: string } | undefined>()
// @ts-expect-error a key, not a number
compose.action(3)
