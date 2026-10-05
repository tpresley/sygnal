/**
 * makeFetchDriver requests (PLAN-3 5-3: the query cache, D79/D80; G-175). Dev-entry codes
 * (DEV_CODE_SEVERITY):
 *
 * SYG630 — a cached request that is not idempotent: `cache: true` or `staleTime` on a
 *          POST/PUT/PATCH/DELETE (a request with a body defaults to POST) (warn)
 * SYG631 — `validate` is not a Standard Schema (no `~standard.validate`): the request
 *          fails (error)
 * SYG632 — `{ invalidate }` matched no cache entry and no mounted resource (info)
 * SYG633 — `{ abort: 'X' }` cancels the lane 'X', but this instance sends its `ok: 'X'`
 *          requests under another `key`, so nothing is cancelled (warn)
 * SYG635 — `cache: true` / `staleTime` / `{ prefetch }` sent to a driver without a
 *          `queryCache()` (D88): nothing is cached (warn). The source's `__inspect().cache`
 *          is undefined without one
 *
 * Mechanism: onModel wraps the component's own model stream for every sink whose source
 * takes the `resources` static (makeFetchDriver and renderComponent's HTTP fake) and checks
 * each value as it is sent: requests, and each entry of a `{ resources }` declaration.
 * SYG632 asks the source how many entries/resources the value matches (`__matches`).
 * Each is reported once per component name and request URL / name.
 */
import type {DiagnosticCheck} from '../index'
import {devReport, once, nameOf} from './shared'
import {isStandardSchema} from '../../standardSchema'

const IDEMPOTENT = /^(GET|HEAD)$/i

/** instance → reply key lanes it has sent, and ok name → the other key it was sent under */
const lanes = new WeakMap<object, {used: Set<string>; keyed: Map<string, string>}>()

const fetchSink = (component: any, name: string) => component?.sources?.[name]?.__sygnalStatic === 'resources'
/** 5-5: the sink's driver has no queryCache() */
const noCache = (component: any, sink: string) => {
  const i = component?.sources?.[sink]?.__inspect?.()
  return !!i && i.cache === undefined
}
const reportNoCache = (component: any, sink: string, what: string, url: string) => {
  if (!noCache(component, sink) || !once(`SYG635:${nameOf(component)}:${what}:${url}`)) return
  devReport('SYG635', {
    component,
    message: `${sink} ${url ? url + ' ' : ''}uses ${what}, but the ${sink} driver has no queryCache(), so nothing is cached`,
    fix: `Give the driver a cache: makeFetchDriver({ cache: queryCache({ staleTime: 30000 }) }) (import { queryCache } from 'sygnal'); in tests renderComponent(C, { http: { cache: queryCache() } }). Or remove ${what}`,
    data: {sink, url, what},
  })
}

function checkOne(component: any, sink: string, req: any, where: string) {
  if (!req || typeof req !== 'object') return
  const name = nameOf(component)
  const url = typeof req.url === 'string' ? req.url : ''
  const method = String(req.method || (req.json !== undefined || req.body !== undefined ? 'POST' : 'GET')).toUpperCase()
  if ((req.cache === true || req.staleTime != null) && !IDEMPOTENT.test(method) && once(`SYG630:${name}:${method}:${url}`)) {
    devReport('SYG630', {
      component,
      message: `${where} ${method} ${url} sets ${req.cache === true ? 'cache: true' : 'staleTime'}, so a cached reply answers it instead of sending it again`,
      fix: `Cache reads only: remove ${req.cache === true ? 'cache' : 'staleTime'} from the ${method}, and refresh the cached reads after it succeeds with invalidates: ['tag']`,
      data: {sink, method, url},
    })
  }
  if (req.cache === true || req.staleTime != null) reportNoCache(component, sink, req.cache === true ? 'cache: true' : 'staleTime', url)
  if ('validate' in req && !isStandardSchema(req.validate) && once(`SYG631:${name}:${url}`)) {
    devReport('SYG631', {
      component,
      message: `${where} ${url} has validate: ${typeof req.validate}, which is not a Standard Schema, so the request fails`,
      fix: "Pass a Standard Schema object (zod, valibot, arktype, ...: anything with a '~standard'.validate function), e.g. validate: QuoteSchema",
      data: {sink, url},
    })
  }
}

export function check(component: any, sink: string, req: any) {
  if (!req || typeof req !== 'object') return
  const name = nameOf(component)
  const res = req.resources
  if (res && typeof res === 'object') {
    for (const k of Object.keys(res)) checkOne(component, sink, typeof res[k] === 'string' ? {url: res[k]} : res[k], `${name}.resources.${k}:`)
    return
  }
  if (req.prefetch) {
    const p = req.prefetch
    reportNoCache(component, sink, '{ prefetch }', typeof p === 'string' ? p : String(p?.url ?? ''))
    return
  }
  if ('invalidate' in req) {
    const count = component.sources[sink]?.__matches?.(req.invalidate)
    const what = typeof req.invalidate === 'function' ? 'the predicate' : JSON.stringify(req.invalidate)
    if (count === 0 && once(`SYG632:${name}:${what}`)) {
      devReport('SYG632', {
        component,
        message: `${sink} { invalidate: ${what} } matched no cache entry and no mounted resource`,
        fix: "Give the resources (or cached requests) to refresh tags: ['quotes'] and invalidate that tag, or a URL prefix starting with '/' ('/api/quotes')",
        data: {sink, invalidate: what},
      })
    }
    return
  }
  let l = lanes.get(component)
  if (!l) lanes.set(component, (l = {used: new Set(), keyed: new Map()}))
  const {ok, error, key, abort} = req
  if (typeof abort === 'string' && key === undefined) {
    const other = l.keyed.get(abort)
    if (other !== undefined && !l.used.has(abort) && once(`SYG633:${name}:${abort}`)) {
      devReport('SYG633', {
        component,
        message: `${sink} { abort: '${abort}' } cancels the requests with key '${abort}', but ${name} sends its ok: '${abort}' requests with key: '${other}', so nothing is cancelled`,
        fix: `Cancel by that key: { abort: true, key: '${other}' } (or drop the key, so the lane is the ok action)`,
        data: {sink, abort, key: other},
      })
    }
    return
  }
  if (typeof ok === 'string' || typeof error === 'string') {
    const lane = key ?? ok ?? error
    l.used.add(lane)
    if (typeof ok === 'string' && key !== undefined && key !== ok) l.keyed.set(ok, String(key))
  }
  checkOne(component, sink, req, `A ${sink} request`)
}

export const fetchCheck: DiagnosticCheck = {
  id: 'fetch',

  onModel(component) {
    const model$ = component?.model$
    if (!model$ || typeof model$ !== 'object') return
    for (const sink of Object.keys(model$)) {
      const s$ = model$[sink]
      if (!fetchSink(component, sink) || !s$ || typeof s$.map !== 'function') continue
      model$[sink] = s$.map((req: any) => {
        try { check(component, sink, req) } catch (_) {}
        return req
      })
    }
  },
}
