/**
 * SYG637 (static, warn): `{ refresh: name }` where another component declares the same read.
 *
 *   AlertsScreen.resources = { alerts: () => alertsResource() }
 *   App.resources = { alerts: () => alertsResource() }   // the header bell reads this copy
 *   AlertsScreen.model = { REFRESH: { HTTP: { refresh: 'alerts' } } }
 *
 * `refresh` looks its names up in the sending component's own resources (fetchDriver.ts), so the
 * other component keeps showing the old answer. It fails silently: the request is sent, the
 * sender updates and a test of the sender passes. `{ invalidate }` reaches every mounted copy.
 *
 * Two reads are the same when they ask for one literal URL by GET: with a `query`, only when they
 * are the same request object (one helper, called without arguments). Quiet for computed URLs and
 * requests with a spread the checker can't follow, and unless the two components can be mounted
 * together: both are known to sit under a common ancestor, and not on different targets of one
 * Switchable or Outlet on every way up to each.
 */
import { unwrap, propName } from '../ast.js'
import { resolveExpr } from '../model/resolve.js'
import { literalNames, requestProps, returnedObjects } from '../model/modelEntries.js'
import { renderGraph } from '../model/renderGraph.js'

/** The resource names a `refresh` value holds: a name, an array of names, spreads and consts of those. */
function refreshNames(project, file, node, bind, out = []) {
  const e = unwrap(node)
  if (e?.type === 'ArrayExpression') {
    for (const el of e.elements) {
      if (el) refreshNames(project, file, el.type === 'SpreadElement' ? el.argument : el, bind, out)
    }
    return out
  }
  if (e?.type === 'Identifier' && !bind?.has(e.name)) {
    const x = resolveExpr(project, file, e)
    if (unwrap(x?.node)?.type === 'ArrayExpression') return refreshNames(project, x.file, x.node, null, out)
  }
  out.push(...literalNames(project, file, e, bind).names.map(n => n.name))
  return out
}

/** A request object as a comparable read, or null when what it asks for isn't known statically. */
function readOf(project, o) {
  const { props, dynamic } = requestProps(project, o.node, o.file, o.bind)
  if (dynamic.length) return null
  const get = (key) => props.find(x => propName(x.p) === key)
  const url = get('url')
  if (!url) return null
  const v = literalNames(project, url.file, url.p.value, url.bind)
  if (v.dynamic.length || v.names.length !== 1) return null
  const method = get('method')
  if (method) {
    const m = literalNames(project, method.file, method.p.value, method.bind)
    if (m.dynamic.length || m.names.length !== 1 || m.names[0].name.toUpperCase() !== 'GET') return null
  }
  return { node: o.node, url: v.names[0].name, query: !!get('query'), bound: o.bind?.size > 0 }
}

/** A component's `resources` static: Map<name, reads>, or an empty map when it can't be read. */
function readsOf(project, comp, cache) {
  if (cache.has(comp)) return cache.get(comp)
  const reads = new Map()
  cache.set(comp, reads)
  const r = comp.staticProps.resources && resolveExpr(project, comp.file, comp.staticProps.resources)
  if (r?.node?.type !== 'ObjectExpression') return reads
  for (const p of r.node.properties) {
    if (p.type !== 'ObjectProperty' && p.type !== 'ObjectMethod') continue
    const name = propName(p)
    if (name == null) continue
    const objs = returnedObjects(project, r.file, p.type === 'ObjectMethod' ? p : p.value)
    reads.set(name, objs.map(o => readOf(project, o)).filter(Boolean))
  }
  return reads
}

const sameRead = (a, b) => a.url === b.url && (!a.query && !b.query || (a.node === b.node && !a.bound && !b.bound))

/**
 * Each unit's parents, with the targets of `of={PAGES}` maps added (a `lazy()` page the checker
 * can't follow is matched by name, when one component has that name).
 */
function mountParents(project, graph) {
  const parents = new Map([...graph.parentsOf].map(([u, list]) => [u, [...list]]))
  for (const unit of [...graph.units]) {
    for (const usage of unit.viewInfo?.collections || []) {
      for (const t of usage.constTargets || []) {
        const named = project.components.filter(c => c.name === t.name)
        const child = t.ref ? graph.unitOf(t.ref) : named.length === 1 ? named[0] : null
        if (child) parents.set(child, [...(parents.get(child) || []), { unit, via: 'switchable' }])
      }
    }
  }
  return parents
}

/** Map<switching parent, the target it reaches `unit` through>: the ones every way up to `unit` passes. */
function switchPoints(parents, unit, memo, stack = new Set()) {
  if (memo.has(unit)) return memo.get(unit)
  if (stack.has(unit)) return new Map()
  stack.add(unit)
  let common = null
  for (const { unit: parent, via } of parents.get(unit) || []) {
    const points = new Map(switchPoints(parents, parent, memo, stack))
    if (via === 'switchable') points.set(parent, unit)
    common = common ? new Map([...common].filter(([p, t]) => points.get(p) === t)) : points
  }
  stack.delete(unit)
  const result = common || new Map()
  memo.set(unit, result)
  return result
}

/** `unit` and everything known to render it. */
function ancestors(parents, unit, out = new Set()) {
  if (out.has(unit)) return out
  out.add(unit)
  for (const p of parents.get(unit) || []) ancestors(parents, p.unit, out)
  return out
}

/** Under a common ancestor and not on different targets of one switch. Unknown placement is false. */
function mountedTogether(parents, memo, a, b) {
  const above = ancestors(parents, a)
  if (![...ancestors(parents, b)].some(u => above.has(u))) return false
  const pointsOfB = switchPoints(parents, b, memo)
  for (const [parent, target] of switchPoints(parents, a, memo)) {
    if (pointsOfB.has(parent) && pointsOfB.get(parent) !== target) return false
  }
  return true
}

export default {
  id: 'refresh-shared-read',
  codes: ['SYG637'],
  description: '{ refresh } on a read another component also declares',
  run(project, report) {
    const cache = new Map()
    const memo = new Map()
    let mounted = null
    const parents = () => (mounted ||= mountParents(project, renderGraph(project)))
    for (const comp of project.components) {
      const own = readsOf(project, comp, cache)
      if (!own.size) continue
      for (const r of comp.model?.requests || []) {
        const refresh = requestProps(project, r.node, r.file, r.bind).props.find(x => propName(x.p) === 'refresh')
        if (!refresh) continue
        const names = [...new Set(refreshNames(project, refresh.file, refresh.p.value, refresh.bind))]
        const shared = new Map()
        for (const name of names) {
          for (const mine of own.get(name) || []) {
            for (const other of project.components) {
              if (other === comp || shared.get(name)?.others.has(other.name)) continue
              const theirs = [...readsOf(project, other, cache).values()].flat()
              if (!theirs.some(t => sameRead(mine, t)) || !mountedTogether(parents(), memo, comp, other)) continue
              if (!shared.has(name)) shared.set(name, { url: mine.url, others: new Set() })
              shared.get(name).others.add(other.name)
            }
          }
        }
        if (!shared.size) continue
        const others = [...new Set([...shared.values()].flatMap(s => [...s.others]))]
        const quoted = [...shared.keys()].map(n => `'${n}'`).join(', ')
        const urls = [...shared.values()].map(s => s.url)
        const example = urls.length === 1 ? `'${urls[0]}'` : `[${urls.map(u => `'${u}'`).join(', ')}]`
        report({
          code: 'SYG637',
          component: comp.name,
          file: refresh.file,
          node: refresh.p.value,
          message: `'${r.action}' refreshes ${quoted} only in ${comp.name}, but ${others.join(', ')} also declare${others.length === 1 ? 's' : ''} the same read (${urls.join(', ')}) and would keep showing the old answer`,
          fix: `send { invalidate: ${example} }, or a tag both reads carry, to refetch every mounted copy; // sygnal-ignore SYG637 if only this component's copy should update`,
          data: { action: r.action, names: [...shared.keys()], others },
        })
      }
    }
  },
}
