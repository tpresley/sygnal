/**
 * Router and declaration statics (PLAN-3 5-4b). Dev-entry-only codes (DEV_CODE_SEVERITY):
 *
 * SYG130 — href() names no route, or leaves out a param its pattern needs (the link is broken).
 *          (A `{ to }` command with the same problem is SYG620, reported by the router itself
 *          in production too, and not navigated.)
 * SYG131 — href() or a `{ to, params }` command passes params the route's pattern doesn't use.
 * SYG132 — G-167: a component declares a static the core sends to a driver (`route`,
 *          `resources`, `connections`, `head`) but never sends it: it has no model (the core
 *          wires statics in its model setup), or it is a root without initialState (a static is
 *          computed from the state stream, which a root without state never emits).
 * SYG133 — the SPA router (makeRouter().driver without `navigate`) runs inside a Vike app,
 *          where Vike owns links and history.
 *
 * Mechanism: the router's href() calls `__SYGNAL_DIAGNOSTICS__.routerHref(routes, name, params)`
 * when it exists (installRouterHooks() sets it); onModel looks at the component's sources for
 * `__sygnalStatic` / `__sygnalRouter` markers.
 */
import type {DiagnosticCheck} from '../index'
import {bridge, devReport, once, nameOf, suggest} from './shared'

const PARAM = /:(\w+)/g
const paramsOf = (pat: string) => (pat.match(PARAM) || []).map(p => p.slice(1))

function checkHref(routes: Record<string, string>, name: string, params: any) {
  const names = Object.keys(routes).filter(k => routes[k] != '*')
  const pat = routes[name]
  if (pat == null || pat == '*') {
    if (!once(`SYG130:${name}`)) return
    const near = suggest(String(name), names)
    devReport('SYG130', {
      message: `href('${name}') names no route, so the link points to '/'` + (near ? ` (did you mean '${near}'?)` : ''),
      fix: `Use one of the route names: ${names.join(', ')}`,
      data: {name, routes: names, ...(near ? {suggestion: near} : {})},
    })
    return
  }
  const wanted = paramsOf(pat)
  const given = params && typeof params == 'object' ? params : {}
  const missing = wanted.filter(k => given[k] == null)
  const extra = Object.keys(given).filter(k => !wanted.includes(k))
  if (missing.length && once(`SYG130:${name}:${missing}`)) {
    devReport('SYG130', {
      message: `href('${name}') leaves out ${missing.map(k => `'${k}'`).join(', ')} (${pat}), so that segment is empty`,
      fix: `href('${name}', { ${wanted.join(', ')} })`,
      data: {name, pattern: pat, missing},
    })
  }
  if (extra.length && once(`SYG131:${name}:${extra}`)) {
    devReport('SYG131', {
      message: `Route '${name}' (${pat}) has no param ${extra.map(k => `'${k}'`).join(', ')}; it is ignored`,
      fix: wanted.length ? `Pass only ${wanted.join(', ')}; put other values in the query: href('${name}', params, { ${extra[0]} })` : `Put it in the query: href('${name}', {}, { ${extra[0]} })`,
      data: {name, pattern: pat, extra},
    })
  }
}

/** install the hook the router's href() calls (removed by the returned function) */
export function installRouterHooks(): () => void {
  const core = bridge()
  if (!core) return () => {}
  core.routerHref = checkHref
  return () => { if (core.routerHref === checkHref) core.routerHref = undefined }
}

export const routerCheck: DiagnosticCheck = {
  id: 'router',

  onModel(component) {
    const sources = component?.sources
    if (!sources || typeof sources != 'object') return
    const name = nameOf(component)
    for (const n of component.sourceNames || Object.keys(sources)) {
      const src = sources[n]
      const k = src?.__sygnalStatic
      if (typeof k == 'string' && component.view?.[k] != null) {
        // the core wires statics in its model setup: a component without a model never sends one,
        // nor does a root whose state never emits (no initialState)
        const noModel = component.model === undefined
        if ((noModel || (!component.isSubComponent && component.initialState === undefined)) && once(`SYG132:${name}:${k}`)) {
          devReport('SYG132', {
            component,
            message: noModel
              ? `${name} declares ${name}.${k}, but has no model, so ${k} is never sent to ${n}`
              : `${name} declares ${name}.${k}, but a root without initialState has no state, so ${k} is never sent to ${n}`,
            fix: noModel
              ? `Give ${name} a model (an empty one is enough: ${name}.model = {})`
              : `Add ${name}.initialState (e.g. { }${k == 'route' ? ', or { route: router.current() }' : ''})`,
            data: {static: k, source: n, reason: noModel ? 'model' : 'state'},
          })
        }
      }
      const opts = src?.__sygnalRouter
      const g: any = globalThis
      if (opts && !opts.navigate && g.document?.getElementById?.('vike_pageContext') && once('SYG133')) {
        devReport('SYG133', {
          component,
          message: `The SPA router (${n}) runs inside a Vike app: Vike owns links and history, so both would handle a click`,
          fix: "Pass Vike's navigate: makeRouter({ routes, navigate }) with import { navigate } from 'vike/client/router', or use Vike's routing",
          data: {source: n},
        })
      }
    }
  },
}
