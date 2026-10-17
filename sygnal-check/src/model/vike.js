/**
 * Vike's filesystem routing and inheritance for the static graph (PLAN-10 A-9, D538): the route of
 * each `+Page`, the URL prefix a `+Layout` / `+Wrapper` applies to, and the shell each page is
 * rendered in (Wrapper(s) > Layout(s) > Page, as sygnal/vike's onRenderClient nests them).
 *
 * Follows Vike's own rules (vike/dist/node/vite/shared/resolveVikeConfigInternal/filesystemRouting.js,
 * checked against vike 0.4.267):
 *   - a plus file's location is its directory, relative to the app's root (the nearest directory
 *     above it with a vite.config.* or package.json; else the working directory)
 *   - the route: the location without the directories named `renderer`, `pages`, `src`, `index`
 *     (at any depth) and without `(group)` directories; '/' when nothing is left
 *     (pages/orders/@id/+Page.jsx → '/orders/@id', pages/(shop)/cart/+Page.jsx → '/cart')
 *   - a `+route.js` / `+route.ts` beside the `+Page`, or `route` in the `+config.js` beside it,
 *     overrides it: a literal string is the route; a function (Route Function) or a value the
 *     checker can't read gives route null and routeDynamic true
 *   - `_error/+Page` is the error page: no route (null, not dynamic)
 *   - inheritance: a `+Layout` / `+Wrapper` applies to the pages whose location, without the
 *     `renderer` and `pages` directories, starts with its own (`(group)` and `index` directories
 *     count here, so a group's layout applies only inside the group). Several apply outermost first:
 *     the shorter location first; at the same one, the `renderer/` file first (Vike puts the
 *     closest first; renderer/ counts as farther)
 *
 *   vikeGraph(project, refs, unitOf) → { routes: Map unit → { route, routeDynamic?, routes? }, shellChildren: Map unit → unit[] }
 *     refs: findEntries(project).refs with via 'vike' (each with `plus`: the plus file's path and
 *     `vike`: 'Page' | 'Layout' | 'Wrapper'). shellChildren: each shell component → the components
 *     it renders directly (the next Layout in, or the Page), over every page it applies to.
 *     A component several +Page files export: route (and routeDynamic) from the first in path
 *     order, routes: every one's route in that order (null for a dynamic one)
 */
import fs from 'node:fs'
import path from 'node:path'
import { stringValue, unwrap, propName } from '../ast.js'
import { resolveExport, resolveExpr } from './resolve.js'

const ROUTE_IGNORED = new Set(['renderer', 'pages', 'src', 'index'])
const INHERIT_IGNORED = new Set(['renderer', 'pages'])
const EXTS = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.mts', '.cjs', '.cts']
const ROOT_MARKERS = ['package.json', 'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.mts', 'vite.config.cjs', 'vite.config.cts']

const exists = (project, p) => project.sources?.has(p) || (() => { try { return fs.statSync(p).isFile() } catch { return false } })()

/** The app root above a plus file: the nearest directory with a vite.config.* or package.json, else cwd. */
function rootOf(project, dir, cache) {
  const seen = []
  let d = dir
  for (;;) {
    if (cache.has(d)) { const r = cache.get(d); for (const s of seen) cache.set(s, r); return r }
    seen.push(d)
    if (ROOT_MARKERS.some(m => exists(project, path.join(d, m)))) { for (const s of seen) cache.set(s, d); return d }
    const up = path.dirname(d)
    if (up === d) { for (const s of seen) cache.set(s, project.cwd); return project.cwd }
    d = up
  }
}

const segmentsOf = (root, dir) => path.relative(root, dir).split(path.sep).filter(Boolean)
const isGroup = (s) => s.startsWith('(') && s.endsWith(')')

/** Vike's filesystem route of a location: '/orders/@id'. */
export function filesystemRoute(segments) {
  const kept = segments.filter(s => !ROUTE_IGNORED.has(s) && !isGroup(s))
  return '/' + kept.join('/')
}

/** Vike's inheritance root of a location (only renderer/ and pages/ dropped). */
export function inheritanceRoot(segments) {
  return segments.filter(s => !INHERIT_IGNORED.has(s))
}

const startsWithSegments = (a, b) => b.length <= a.length && b.every((s, i) => a[i] === s)

/** The route a `+route.*` beside the page, or `route` in its `+config.*`, sets; null when neither does. */
function routeOverride(project, dir) {
  for (const ext of EXTS) {
    const p = path.join(dir, '+route' + ext)
    if (!exists(project, p)) continue
    const file = project.loadFile(p)
    const r = file && resolveExport(project, file, 'default')
    return valueOf(project, r)
  }
  for (const ext of EXTS) {
    const p = path.join(dir, '+config' + ext)
    if (!exists(project, p)) continue
    const file = project.loadFile(p)
    const r = file && resolveExport(project, file, 'default')
    const obj = r && unwrap(r.node)
    if (obj?.type !== 'ObjectExpression') return obj ? { route: null, routeDynamic: true } : null
    for (const prop of obj.properties) {
      if (prop.type === 'SpreadElement') continue
      if (propName(prop) !== 'route') continue
      return prop.type === 'ObjectMethod' ? { route: null, routeDynamic: true } : valueOf(project, resolveExpr(project, r.file, prop.value))
    }
    return null
  }
  return null
}

function valueOf(project, r) {
  const node = r && unwrap(r.node)
  const s = stringValue(node)
  if (s != null) return { route: s }
  return { route: null, routeDynamic: true }
}

export function vikeGraph(project, refs, unitOf) {
  const routes = new Map()
  const shellChildren = new Map()
  const roots = new Map()
  const plus = []
  for (const ref of refs) {
    if (ref.via !== 'vike' || !ref.plus) continue
    const unit = unitOf(ref)
    if (!unit) continue
    const dir = path.dirname(ref.plus)
    const segments = segmentsOf(rootOf(project, dir, roots), dir)
    plus.push({ unit, vike: ref.vike, dir, segments, inherit: inheritanceRoot(segments), renderer: segments.includes('renderer') })
  }
  // the first plus file of a unit gives its route; a component that is the +Page of several
  // directories (a re-exported editor at new/ and @id/) also lists them all in `routes`
  for (const p of plus) {
    const r = p.vike !== 'Page' ? { route: filesystemRoute(p.segments) }
      : p.segments.includes('_error') ? { route: null }
      : routeOverride(project, p.dir) || { route: filesystemRoute(p.segments) }
    const had = routes.get(p.unit)
    if (!had) { routes.set(p.unit, r); continue }
    if (p.vike !== 'Page') continue
    had.routes = had.routes || [had.route]
    had.routes.push(r.route)
  }
  const order = (a, b) => a.inherit.length - b.inherit.length || Number(b.renderer) - Number(a.renderer) || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)
  const add = (from, to) => {
    if (from === to) return
    if (!shellChildren.has(from)) shellChildren.set(from, [])
    if (!shellChildren.get(from).includes(to)) shellChildren.get(from).push(to)
  }
  for (const page of plus.filter(p => p.vike === 'Page')) {
    const applies = (s) => startsWithSegments(page.inherit, s.inherit)
    const wrappers = plus.filter(s => s.vike === 'Wrapper' && applies(s)).sort(order)
    const layouts = plus.filter(s => s.vike === 'Layout' && applies(s)).sort(order)
    const chain = [...wrappers, ...layouts].map(s => s.unit).filter((u, i, a) => a.indexOf(u) === i)
    chain.push(page.unit)
    for (let i = 0; i + 1 < chain.length; i++) add(chain[i], chain[i + 1])
  }
  return { routes, shellChildren }
}

