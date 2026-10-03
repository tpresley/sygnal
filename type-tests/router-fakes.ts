// PLAN-3 5-4c: renderComponent's router and HEAD fakes (router/url options, t.navigate / t.back /
// t.forward / t.location / t.sent('ROUTER') / t.head())
import { renderComponent, makeRouter } from 'sygnal'

const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', notFound: '*' } })
function App() { return null as any }
const t = renderComponent(App, { router, url: '/tasks/2', routerSink: 'ROUTER', routerScroll: false, routerFocus: 'h1', headSink: 'HEAD', titleTemplate: '%s · App' })
const p: Promise<void> = t.navigate('/tasks/3')
t.navigate({ to: 'task', params: { id: 4 }, query: { tab: 'x' }, replace: true })
t.back()
t.forward()
const path: string = t.location.path + t.location.search + t.location.hash + t.location.href
const commands: any[] = t.sent('ROUTER')
const title: string | undefined = t.head().title
const description: string = t.head().meta.description
const links: Array<Record<string, any>> = t.head().link
// @ts-expect-error router takes the makeRouter() object, not a route table
renderComponent(App, { router: { home: '/' } })
// @ts-expect-error a navigate target is a URL or { to }
t.navigate({ params: { id: 1 } })
// @ts-expect-error location is read-only
t.location = { path: '/', search: '', hash: '', href: '' }
export { p, path, commands, title, description, links }
