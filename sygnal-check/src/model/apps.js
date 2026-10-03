/**
 * Apps: the `run(App, drivers)` calls in the scanned files, the components each one renders, and
 * the declaration statics its drivers take (PLAN-4 GS-7, SYG643).
 *
 *   findApps(project) → App[]
 *   App = {
 *     call, file,
 *     statics: Set<'timers' | 'connections' | 'resources'> | null   what its drivers take; null when
 *              the drivers can't be listed (not an object literal, a spread, a driver from a package
 *              or a local one that may wrap a static driver)
 *     components: Set<ComponentInfo>   the root and every component its view renders (tags,
 *              Collection / Switchable targets, slots), as far as the checker can follow
 *   }
 *
 * A driver value is a call of a 'sygnal' export (makeTimerDriver() and the like; any other is a
 * driver that takes no static), possibly through a const, or a local function or value whose
 * source doesn't mention a static driver. The core finds a static's driver by its
 * `__sygnalStatic` marker, not by its key, so the key is free.
 */
import { unwrap, walk, isFunction, propName } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from './resolve.js'

/** sygnal driver factories → the static their driver takes (src/extra/diagnostics/checks/timers.ts NEEDS) */
export const STATIC_DRIVERS = { makeTimerDriver: 'timers', makeSocketDriver: 'connections', makeFetchDriver: 'resources' }
const MENTIONS = /__sygnalStatic|\b(makeTimerDriver|makeSocketDriver|makeFetchDriver|timerDriver)\b/

const SYGNAL = /^sygnal(\/|$)/

function sygnalExport(file, ident) {
  ident = unwrap(ident)
  if (ident?.type !== 'Identifier') return null
  const b = findBinding(file, ident.name, ident)
  return b?.kind === 'import' && SYGNAL.test(b.source) ? b.imported : null
}

/** What one driver value takes: a static name, '' for none, null when unknown. */
function driverStatic(project, file, node) {
  const r = resolveExpr(project, file, node)
  const n = unwrap(r?.node)
  if (!n || !r.file) return null
  if (n.type === 'CallExpression') {
    const name = sygnalExport(r.file, n.callee)
    if (name) return STATIC_DRIVERS[name] || ''
  }
  // an import from a package (resolveExpr stops at it) or a value we can't see
  if (n.type === 'Identifier' || n.type === 'MemberExpression') return null
  const text = (f, x) => f.source.slice(x.start, x.end)
  if (n.type === 'CallExpression') {
    // a local factory: its own source must not mention a static driver either
    const c = resolveExpr(project, r.file, n.callee)
    if (!c?.node || !isFunction(c.node)) return null
    if (MENTIONS.test(text(c.file, c.node))) return null
  }
  return MENTIONS.test(text(r.file, n)) ? null : ''
}

function driverStatics(project, file, arg) {
  const out = new Set()
  if (!arg) return out
  const r = resolveExpr(project, file, arg)
  const obj = unwrap(r?.node)
  if (obj?.type !== 'ObjectExpression') return null
  for (const p of obj.properties) {
    if (p.type !== 'ObjectProperty' || propName(p) == null) return null
    const s = driverStatic(project, r.file, p.value)
    if (s === null) return null
    if (s) out.add(s)
  }
  return out
}

/** The components a root renders (its own and its children's views, depth-first). */
function reachable(project, ref) {
  const out = new Set()
  const seen = new Set()
  const visit = (r, depth) => {
    if (!r || seen.has(r.node) || depth > 30) return
    seen.add(r.node)
    const comp = project.componentForFunction(r.node)
    if (comp) out.add(comp)
    const sink = project.viewOf(r)
    const usages = (s, d) => {
      for (const u of s.children) {
        if (u.ref) visit(u.ref, depth + 1)
        if (d < 8) usages(u.injected, d + 1)
      }
    }
    if (sink) usages(sink, 0)
  }
  visit(ref, 0)
  return out
}

export function findApps(project) {
  const apps = []
  for (const p of project.scanned) {
    const file = project.files.get(p)
    if (!file) continue
    walk(file.ast.program, (n) => {
      if (n.type !== 'CallExpression' || sygnalExport(file, n.callee) !== 'run') return true
      const [root, drivers] = n.arguments
      const r = root && resolveExpr(project, file, root)
      const ref = r?.node && isFunction(r.node) ? { file: r.file, node: r.node } : null
      apps.push({
        call: n,
        file,
        statics: drivers?.type === 'SpreadElement' ? null : driverStatics(project, file, drivers),
        components: ref ? reachable(project, ref) : new Set(),
      })
      return true
    })
  }
  return apps
}
