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
