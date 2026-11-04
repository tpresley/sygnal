/**
 * PLAN-13 F-1 type tests: the declaration statics get the component's context. Compiled by
 * `npm run test:types`; never executed.
 */
import type { Component } from 'sygnal'

type State = { item?: any }
type Ctx = { route: { name: string; params: Record<string, string> } }
type Page = Component<State, {}, {}, { POLL: null; MSG: any }, {}, Ctx>

export const Page: Page = () => null as any
Page.resources = { item: (s, { route }) => `/api/items/${route.params.id}` }
Page.timers = (s, ctx) => ({ poll: { every: ctx.route.name === 'item' ? 1000 : 5000, action: 'POLL' } })
Page.connections = (s, { route }) => ({ feed: { sse: `/events/${route.params.id}`, message: 'MSG' } })
Page.head = (s, { route }) => ({ title: route.name })
// a static that ignores the context still type-checks
Page.browser = (s) => ({})
// @ts-expect-error the context has no `user`
Page.head = (s, { user }) => ({ title: user })

// 7.2 (the one bag): the 2nd argument is the bag ({ ...props, state, context, uid }); the context's
// own fields stay on it until 8.0 (the form above), the canonical form reads bag.context
type Props = { id?: string }
type Item = Component<State, Props, {}, { POLL: null }, {}, Ctx>
export const Item: Item = () => null as any
Item.resources = { item: (s, { id, context: { route } }) => `/api/items/${id ?? route.params.id}` }
Item.route = (s, { context, uid }) => context.route.name === 'item' && uid('r')
Item.timers = (s, bag) => ({ poll: { every: bag.state === s ? 1000 : 5000, action: 'POLL' } })
// @ts-expect-error a bag has no `nope` prop
Item.head = (s, { nope }) => ({ title: nope })
// a prop wins over a context field of the same name
type Shadow = Component<State, { route: number }, {}, {}, {}, Ctx>
export const Shadow: Shadow = () => null as any
Shadow.head = (s, { route }) => ({ title: String(route.toFixed()) })
// .context entries: (state, bag), the bag with the parent's context
type Provider = Component<State, Props, {}, {}, {}, Ctx, {}, { itemId: string }>
export const Provider: Provider = () => null as any
Provider.context = { itemId: (s, { id, context }) => id ?? context.route.params.id }
