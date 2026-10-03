// PLAN-3 5-4b: makeRouter's typed href() (route names and params inferred from the route
// table literal), the `route` and `head` statics, router commands, makeHeadDriver/renderHead.
import { makeRouter, makeRouterDriver, makeHeadDriver, renderHead, renderToString, ABORT } from 'sygnal'
import type { RootComponent, Route, RouterCommand, RouterBlocked, HeadValue } from 'sygnal'

export const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', note: '/tasks/:id/notes/:noteId', notFound: '*' } })
const { href } = router

// names and params
const a: string = href('home')
href('home', {}, { q: 'x' })
href('task', { id: 2 })
href('task', { id: '2' }, { tab: 'notes', page: 1, off: null }, 'c3')
href('note', { id: 1, noteId: 'n' })
// @ts-expect-error unknown route name
href('tasks', { id: 1 })
// @ts-expect-error '*' is not a link target
href('notFound')
// @ts-expect-error missing id
href('task')
// @ts-expect-error missing id (empty params)
href('task', {})
// @ts-expect-error missing noteId
href('note', { id: 1 })
// @ts-expect-error extra param
href('task', { id: 1, x: 2 })
// @ts-expect-error params on a route without any
href('home', { id: 1 })

// match / current
const r: Route<'home' | 'task' | 'note' | 'notFound'> = router.current()
router.current('/tasks/1?x=1')
const n: 'home' | 'task' | 'note' | 'notFound' | null = router.match('/x').name
const p: string = r.params.id
void [a, n, p]

// untyped (wide) tables stay permissive
const table: Record<string, string> = { home: '/', task: '/tasks/:id' }
const loose = makeRouter({ routes: table, base: '/app', mode: 'hash', focus: false, scroll: false, settleMs: 0 })
loose.href('anything', { id: 1 })
loose.href('anything')
makeRouterDriver({ routes: table, window: {}, prefetch: (route, url) => { void [route.name, url] } })
makeRouter({ routes: { a: '/a' }, navigate: (url, { overwriteLastHistoryEntry }) => { void [url, overwriteLastHistoryEntry] } })

// the route static and commands from the model
type S = { route: Route | null; dirty: boolean; pending: RouterCommand | null }
type A = { ROUTE: Route; LEAVE: RouterBlocked; SAVE: null }
export const App: RootComponent<S, {}, A> = ({ state }) => <a href={href('task', { id: 1 })}>{state.route?.name}</a>
App.route = 'ROUTE'
App.route = ((s: S) => s.dirty ? "ROUTE" : null)
App.initialState = { route: router.current(), dirty: false, pending: null }
App.head = (s) => ({ title: s.route?.name ?? 'Home', meta: { description: 'x', 'og:title': null }, link: [{ rel: 'canonical', href: '/' }] })
App.model = {
  ROUTE: {
    STATE: (s, route) => route.name == 'task' && !route.params.id ? ABORT : { ...s, route },
  },
  LEAVE: (s, blocked) => ({ ...s, pending: blocked.proceed }),
  SAVE: (s) => ({ ...s, dirty: false }),
}

const cmds: RouterCommand<typeof router.routes>[] = [
  { to: 'task', params: { id: 1 }, query: { tab: 'notes' }, hash: 'c3', replace: true },
  { url: href('home') },
  { back: true }, { forward: true }, { go: -2 },
  { block: 'LEAVE' }, { block: false },
  { prefetch: 'task', params: { id: 1 } },
]
// @ts-expect-error unknown route name in a typed command
const bad: RouterCommand<typeof router.routes> = { to: 'tasks' }
void [cmds, bad]

// HEAD
const h: HeadValue = { title: 't', meta: { description: 'd' }, link: [{ rel: 'icon', href: '/i.svg', type: 'image/svg+xml' }] }
makeHeadDriver({ titleTemplate: '%s · App' })
const list: any[] = []
renderToString(App, { head: list })
const tags: string = renderHead([h, null, ...list], { titleTemplate: '%s' })
void tags
