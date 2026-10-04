// PLAN-3 5-4b: the router and HEAD driver without a window/document (SSR, node): href, match
// and current(url) are pure; the drivers are no-ops; Vike's onRenderHtml collects `head` statics.
import { it, expect, vi } from 'vitest'
import xs from 'xstream'
import { makeRouter, makeHeadDriver, renderToString } from '../dist/index.esm.js'

const routes = { home: '/', task: '/tasks/:id', notFound: '*' }

it('href / match / current(url) work without a window', () => {
  expect(typeof window).toBe('undefined')
  const r = makeRouter({ routes })
  expect(r.current()).toMatchObject({ name: 'home', path: '/' })
  expect(r.current('/tasks/12?tab=x#c')).toEqual({ name: 'task', params: { id: '12' }, query: { tab: 'x' }, hash: 'c', path: '/tasks/12' })
  expect(r.current('https://example.com/tasks/12/')).toMatchObject({ name: 'task', path: '/tasks/12' })
  expect(r.match('/tasks/%E2%9C%93')).toMatchObject({ params: { id: '✓' } })
  expect(r.match('/tasks/%E0%A4%A')).toMatchObject({ params: { id: '%E0%A4%A' } }) // malformed: kept raw
  expect(r.href('task', { id: 'a/b' })).toBe('/tasks/a%2Fb')
})

it('the router and HEAD drivers are no-ops without a window / document', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const sink$ = xs.create()
  const src = makeRouter({ routes }).driver(sink$)
  expect(src.current()).toBeNull()
  expect(src.__sygnalStatic).toBe('route')
  sink$.shamefullySendNext({ to: 'task', params: { id: 1 } })
  sink$.shamefullySendNext({ back: true })
  sink$.shamefullySendNext({ block: 'X' })
  src.dispose()
  const head$ = xs.create()
  const head = makeHeadDriver()(head$)
  head$.shamefullySendNext({ head: { title: 'x' } })
  head.dispose()
  expect(errors).not.toHaveBeenCalled()
  errors.mockRestore()
})

it('Vike onRenderHtml: head statics override config.title / description; without them the output is unchanged', async () => {
  const { onRenderHtml } = await import('../dist/vike/onRenderHtml.mjs')
  const router = makeRouter({ routes })
  function Page({ state }) { return { sel: 'h1', data: {}, children: undefined, text: state.route.name } }
  Page.initialState = { route: router.current('/tasks/3') }
  Page.head = s => ({ title: 'Task ' + s.route.params.id, meta: { 'og:title': 'T' } })
  const html = onRenderHtml({ Page, config: { title: 'Site', description: 'Desc' } }).documentHtml._escaped
  expect(html).toContain('<title>Task 3</title>')
  expect(html).not.toContain('<title>Site</title>')
  expect(html).toContain('<meta name="description" content="Desc" data-sygnal-head="m:description">')
  expect(html).toContain('<meta property="og:title" content="T" data-sygnal-head="m:og:title">')
  expect(html).toContain('<h1 data-sygnal-ssr="">task</h1>')
  function Plain() { return { sel: 'p', data: {}, children: undefined, text: 'x' } }
  const plain = onRenderHtml({ Page: Plain, config: { title: 'Site', description: 'Desc' } }).documentHtml._escaped
  expect(plain).toContain('<title>Site</title>')
  expect(plain).toContain('<meta name="description" content="Desc">')
})

it('renderToString({ head }) from the package entry', () => {
  function App() { return { sel: 'p', data: {}, children: undefined, text: 'x' } }
  App.head = () => ({ title: 'T' })
  const list = []
  renderToString(App, { head: list })
  expect(list).toEqual([{ title: 'T' }])
})
