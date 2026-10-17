/**
 * PLAN-10 A-9 (D538): Vike routes on +Page / +Layout / +Wrapper components and the shell edges
 * (via 'layout': Wrapper(s) > Layout(s) > Page) in the static graph, on test/fixtures/vike-routes
 * (nested layouts, @param, (group), index/, renderer/, a +route string, a Route Function, `route` in
 * +config.js, _error, a re-exported Page, one component the +Page of two directories) and
 * examples/vike (nothing lost).
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { graph, graphFiles, validateSchema } from '../src/index.js'
import { formatGraph } from '../src/graphText.js'
import { filesystemRoute } from '../src/model/vike.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const repoRoot = path.resolve(pkgRoot, '..')
const schema = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'schema/inspect.schema.json'), 'utf8'))
const FIX = 'test/fixtures/vike-routes'
const fixture = () => graph([FIX], { cwd: pkgRoot })
const byName = (g) => Object.fromEntries(g.components.map(c => [c.name, c]))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })
function project(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-a9-'))
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true })
    fs.writeFileSync(path.join(tmp, rel), src)
  }
  return graphFiles(Object.keys(files).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(tmp, f)), { cwd: tmp })
}

describe('Vike routes (A-9)', () => {
  it('validates against the schema', () => {
    expect(validateSchema(schema, fixture())).toEqual([])
  })

  it('gives each +Page its route: filesystem, @param, (group) and index/ dropped, +route string, Route Function, config route, _error', () => {
    const c = byName(fixture())
    const route = (n) => [c[n].route, c[n].routeDynamic]
    expect(route('Home')).toEqual(['/', undefined])
    expect(route('Orders')).toEqual(['/orders', undefined])
    expect(route('Order')).toEqual(['/orders/@id', undefined])
    expect(route('Pricing')).toEqual(['/pricing', undefined])
    expect(route('Legacy')).toEqual(['/old-home', undefined])
    expect(route('Search')).toEqual([null, true])
    expect(route('Docs')).toEqual(['/docs/*', undefined])
    expect(route('ErrorPage')).toEqual([null, undefined])
    // a Page re-exported from components/: the route comes from the +Page file's directory
    expect(route('About')).toEqual(['/about', undefined])
    expect(c.About.file).toBe(`${FIX}/components/About.jsx`)
  })

  it('lists every route of a component several +Page files export (route: the first in path order)', () => {
    const g = fixture()
    const c = byName(g)
    expect([c.OrderEditor.route, c.OrderEditor.routes]).toEqual(['/orders/@id/edit', ['/orders/@id/edit', '/orders/new']])
    expect(c.Order.routes).toBeUndefined()
    // one node, one shell edge from OrdersLayout
    expect(c.OrdersLayout.children.filter(x => x.name === 'OrderEditor')).toHaveLength(1)
    expect(formatGraph(g)).toContain('routes /orders/@id/edit, /orders/new')
  })

  it('gives each +Layout / +Wrapper the URL prefix it applies to; other components get no route', () => {
    const c = byName(fixture())
    expect([c.Theme.route, c.Shell.route, c.OrdersLayout.route, c.Marketing.route]).toEqual(['/', '/', '/orders', '/'])
    const g = graph(['test/fixtures/graph-shop/src'], { cwd: pkgRoot })
    expect(g.components.filter(x => 'route' in x || 'routeDynamic' in x)).toEqual([])
  })

  it("adds the shell edges with via 'layout': Wrapper > Layout > nested Layout / (group) Layout > Page", () => {
    const g = fixture()
    const c = byName(g)
    const kids = (n) => c[n].children.filter(x => x.via === 'layout').map(x => [x.name, x.id])
    const id = (n) => c[n].id
    expect(kids('Theme')).toEqual([['Shell', id('Shell')]])
    expect(kids('Shell').sort()).toEqual([
      ['About', id('About')], ['Docs', id('Docs')], ['ErrorPage', id('ErrorPage')], ['Home', id('Home')],
      ['Legacy', id('Legacy')], ['Marketing', id('Marketing')], ['OrdersLayout', id('OrdersLayout')], ['Search', id('Search')],
    ])
    expect(kids('OrdersLayout').sort()).toEqual([['Order', id('Order')], ['OrderEditor', id('OrderEditor')], ['Orders', id('Orders')]])
    expect(kids('Marketing')).toEqual([['Pricing', id('Pricing')]])
    // a shell edge has no location (no JSX site), and pages have no shell children
    expect(c.Shell.children.every(x => !('line' in x) && !('column' in x))).toBe(true)
    for (const n of ['Home', 'Order', 'Pricing', 'Search']) expect(c[n].children).toEqual([])
  })

  it("keeps kind from JSX only: pages and layouts stay 'root' with entry: true (Vike starts them)", () => {
    for (const c of fixture().components) expect([c.name, c.kind, c.entry]).toEqual([c.name, 'root', true])
  })

  it('shows the route on the component line and in the layout children (graphText)', () => {
    const t = formatGraph(fixture())
    expect(t).toContain(`Order  ${FIX}/pages/orders/@id/+Page.jsx:2  root  entry  view only  route /orders/@id`)
    expect(t).toContain('route (dynamic)')
    expect(t).toContain('route (error page)')
    expect(t).toContain('children  Order (layout /orders/@id), OrderEditor (layout /orders/@id/edit), Orders (layout /orders)')
    expect(t).toContain('Search (layout)')
  })

  it('finds the app root by vite.config / package.json, so a src/pages app in a subdirectory gets its own routes', () => {
    const g = project({
      'apps/web/vite.config.js': 'export default {}',
      'apps/web/src/pages/+Layout.jsx': 'export default function L({ children }) { return <div>{children}</div> }',
      'apps/web/src/pages/blog/@slug/+Page.jsx': 'export default function Post() { return <p /> }',
      'apps/web/src/pages/blog/@slug/+route.js': 'const r = makeRoute()\nexport default r',
      'apps/web/src/pages/(app)/settings/index/+Page.jsx': 'export default function Settings() { return <p /> }',
    })
    expect(validateSchema(schema, g)).toEqual([])
    const c = byName(g)
    expect([c.L.route, c.Settings.route]).toEqual(['/', '/settings'])
    // a +route value the checker can't read is dynamic, like a Route Function
    expect([c.Post.route, c.Post.routeDynamic]).toEqual([null, true])
    expect(c.L.children.map(x => x.name).sort()).toEqual(['Post', 'Settings'])
  })

  it('filesystemRoute follows Vike: renderer, pages, src, index and (group) directories are dropped at any depth', () => {
    expect(filesystemRoute([])).toBe('/')
    expect(filesystemRoute(['pages', 'index'])).toBe('/')
    expect(filesystemRoute(['src', 'pages', '(admin)', 'users', '@id', 'index'])).toBe('/users/@id')
    expect(filesystemRoute(['auth', 'pages', 'login'])).toBe('/auth/login')
  })
})

describe('examples/vike (A-9: nothing lost)', () => {
  it('keeps every field it had, adds the routes, the shell edges and entry on the +Wrapper', () => {
    const g = graph(['examples/vike/pages'], { cwd: repoRoot })
    expect(validateSchema(schema, g)).toEqual([])
    const strip = (c) => {
      const { route, routeDynamic, entry, ...rest } = c
      return { ...rest, children: c.children.filter(x => x.via !== 'layout') }
    }
    // before A-9: no route fields, no layout children, and the Wrapper had no entry
    const before = g.components.map(strip)
    expect(before.map(c => [c.name, c.file, c.kind, c.children.length])).toEqual([
      ['Layout', 'examples/vike/pages/+Layout.jsx', 'root', 0],
      ['Wrapper', 'examples/vike/pages/+Wrapper.jsx', 'root', 0],
      ['Page', 'examples/vike/pages/about/+Page.jsx', 'root', 0],
      ['AdminLayout', 'examples/vike/pages/admin/+Layout.jsx', 'root', 0],
      ['Page', 'examples/vike/pages/index/+Page.jsx', 'root', 0],
      ['Page', 'examples/vike/pages/spa/+Page.jsx', 'root', 0],
      ['Page', 'examples/vike/pages/admin/+Page.jsx', 'root', 0],
    ])
    expect(g.components.map(c => [c.name, c.route, c.entry])).toEqual([
      ['Layout', '/', true], ['Wrapper', '/', true], ['Page', '/about', true], ['AdminLayout', '/admin', true],
      ['Page', '/', true], ['Page', '/spa', true], ['Page', '/admin', true],
    ])
    const [layout, wrapper, about, adminLayout, index, spa, admin] = g.components
    expect(wrapper.children).toEqual([{ name: 'Layout', via: 'layout', id: layout.id }])
    // G-803: the nested Layout inside the root one, as sygnal/vike renders it
    expect(layout.children).toEqual([
      { name: 'Page', via: 'layout', id: about.id },
      { name: 'AdminLayout', via: 'layout', id: adminLayout.id },
      { name: 'Page', via: 'layout', id: index.id },
      { name: 'Page', via: 'layout', id: spa.id },
    ])
    expect(adminLayout.children).toEqual([{ name: 'Page', via: 'layout', id: admin.id }])
    expect(g.diagnostics).toEqual([])
  })
})
