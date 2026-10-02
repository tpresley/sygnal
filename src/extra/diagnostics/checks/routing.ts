/**
 * Routed requests (PLAN-3 §1.1, workstream 1-D).
 *
 * SYG112 — a routed request names an action the sending component has no
 *          model entry for (error: the reply is dropped). Dev-entry code
 *          (DEV_CODE_SEVERITY).
 * SYG508 — strict: the component reads the replies to its own request with
 *          X.select('cat') / X.errors('cat') where a routed request would do.
 *
 * Mechanism:
 *   onModel  for every sink whose source is routing-capable
 *            (`__sygnalRoutes === true`: makeFetchDriver, driverFromAsync, the
 *            socket driver), wraps the component's own model stream for that
 *            sink (component.model$[sink], before initSinks stamps and merges
 *            it) in an identity map that checks each request as it is sent.
 *            The names it sees feed inspect()'s 'routed' trigger.
 *   sources  (strict only) wraps those sources for the intent, recording the
 *            select()/errors() categories the instance reads.
 * A request's `category` is compared for SYG508 (driverFromAsync's custom
 * `selector` property is not known at run time; sygnal-check covers it).
 * Reported once per component name and action / category.
 *
 * TODO(2-B): `connections` declarations ({ message, open, close, error }) are
 * not checked at run time yet; the static checker covers them.
 */
import type {DiagnosticCheck} from '../index'
import {STRICT_CODE_SEVERITY} from '../codes'
import {devReport, reportSafely, once, nameOf, suggest, routedSeen} from './shared'
import {isStrictEnabled} from './strict'

const ROUTED_KEYS = ['ok', 'error']

/** instance → 'SINK\0category' → the select/errors call that read it */
const selected = new WeakMap<object, Map<string, string>>()

const routing = (component: any, name: string) => component?.sources?.[name]?.__sygnalRoutes === true

function readingSource(component: any, sink: string, source: any) {
  const wrapped = Object.create(source)
  for (const method of ['select', 'errors']) {
    if (typeof source[method] !== 'function') continue
    wrapped[method] = (category?: any, ...rest: any[]) => {
      if (typeof category === 'string') {
        let reads = selected.get(component)
        if (!reads) selected.set(component, reads = new Map())
        reads.set(`${sink}\0${category}`, `${sink}.${method}('${category}')`)
      }
      return source[method](category, ...rest)
    }
  }
  return wrapped
}

function checkRequest(component: any, sink: string, req: any, modelActions: string[]) {
  if (!req || typeof req !== 'object') return
  const name = nameOf(component)
  let routed = false
  for (const key of ROUTED_KEYS) {
    const action = req[key]
    if (typeof action !== 'string') continue
    routed = true
    let seen = routedSeen.get(component)
    if (!seen) routedSeen.set(component, seen = new Set())
    seen.add(action)
    if (modelActions.includes(action) || !once(`SYG112:${name}:${action}`)) continue
    const near = suggest(action, modelActions.filter(a => !a.startsWith('__')))
    devReport('SYG112', {
      component,
      message: `A ${sink} request routes its ${key} reply to '${action}', but ${name} has no model entry '${action}', so the reply is dropped` +
        (near ? ` (did you mean '${near}'?)` : ''),
      fix: near
        ? `Use the existing entry: ${key}: '${near}'`
        : `Add '${action}' to ${name}.model, e.g. ${action}: (state, data) => ({ ...state, ... }), or fix the name`,
      data: {action, key, sink, ...(near ? {suggestion: near} : {}), modelActions},
    })
  }

  // SYG508 (strict): an unrouted request whose replies this instance reads back with select()/errors()
  if (routed || 'abort' in req || typeof req.category !== 'string' || !isStrictEnabled()) return
  const read = selected.get(component)?.get(`${sink}\0${req.category}`)
  if (!read || !once(`SYG508:${name}:${sink}:${req.category}`)) return
  // (inside a sink stream: reportSafely, so 'error' mode can't break the stream)
  reportSafely('SYG508', {
    severity: STRICT_CODE_SEVERITY.SYG508,
    component,
    message: `${name} sends a ${sink} request with category: '${req.category}' and reads the reply back with ${read}`,
    fix: `Route the reply instead: name the actions in the request, ${sink}: (state) => ({ url, ok: 'LOADED', error: 'FAILED' }), ` +
      `handle LOADED (the parsed body) and FAILED ({ error, status, body, request }) in the model, and remove ${read} from the intent`,
    data: {sink, category: req.category, read},
  })
}

export const routingCheck: DiagnosticCheck = {
  id: 'routing',

  sources(component, sources) {
    if (!isStrictEnabled() || typeof Proxy != 'function') return
    const cache = new Map<string, any>()
    return new Proxy(sources, {
      get(t: any, k: any) {
        const v = t[k]
        if (typeof k != 'string' || !v || v.__sygnalRoutes !== true) return v
        if (!cache.has(k)) cache.set(k, readingSource(component, k, v))
        return cache.get(k)
      },
    })
  },

  onModel(component, modelMap) {
    const model$ = component?.model$
    if (!model$ || typeof model$ !== 'object') return
    const modelActions = Object.keys(modelMap || {})
    for (const sink of Object.keys(model$)) {
      const s$ = model$[sink]
      if (!routing(component, sink) || !s$ || typeof s$.map !== 'function') continue
      model$[sink] = s$.map((req: any) => {
        checkRequest(component, sink, req, modelActions)
        return req
      })
    }
  },
}
