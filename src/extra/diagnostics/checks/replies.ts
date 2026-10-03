/**
 * Reply actions (PLAN-3 §1.1, workstream 1-D).
 *
 * SYG112 — a request names a reply action the sending component has no
 *          model entry for (error: the reply is dropped). Dev-entry code
 *          (DEV_CODE_SEVERITY).
 * SYG508 — strict: the component reads the replies to its own request with
 *          X.select('cat') / X.errors('cat') where reply actions would do.
 *
 * Mechanism:
 *   onModel  for every sink whose source is reply-capable
 *            (`__sygnalReplies === true`: makeFetchDriver, driverFromAsync, the
 *            socket driver), wraps the component's own model stream for that
 *            sink (component.model$[sink], before initSinks stamps and merges
 *            it) in an identity map that checks each request as it is sent.
 *            The names it sees feed inspect()'s 'reply' trigger.
 *   sources  (strict only) wraps those sources for the intent, recording the
 *            select()/errors() categories the instance reads.
 * A request's `category` is compared for SYG508 (driverFromAsync's custom
 * `selector` property is not known at run time; sygnal-check covers it).
 * Reported once per component name and action / category.
 *
 * `{ connections }` values (the `connections` static, which the core sends on
 * the same model stream, or one a model entry sends) are checked the same way:
 * each connection's message / open / close / error and its SSE `events` names.
 */
import type {DiagnosticCheck} from '../index'
import {STRICT_CODE_SEVERITY} from '../codes'
import {devReport, reportSafely, once, nameOf, suggest, replySeen} from './shared'
import {isStrictEnabled} from './strict'

const REPLY_KEYS = ['ok', 'error']
// PLAN-3 5-4b: on the router's sink, `{ route }` (the route static) and `{ block }` name reply actions
const ROUTER_KEYS = ['route', 'block']
const CONNECTION_KEYS = ['message', 'open', 'close', 'error']

/** [action, key, connection name?] for every reply action name a sink value names */
function replyNames(req: any, router?: boolean): Array<[string, string, string?]> {
  const out: Array<[string, string, string?]> = []
  for (const key of router ? REPLY_KEYS.concat(ROUTER_KEYS) : REPLY_KEYS) if (typeof req[key] === 'string') out.push([req[key], key])
  const conns = req.connections
  if (conns && typeof conns === 'object') {
    for (const name of Object.keys(conns)) {
      const spec = conns[name]
      if (!spec || typeof spec !== 'object') continue
      for (const key of CONNECTION_KEYS) if (typeof spec[key] === 'string') out.push([spec[key], key, name])
      const events = spec.events
      if (events && typeof events === 'object') {
        for (const ev of Object.keys(events)) if (typeof events[ev] === 'string') out.push([events[ev], `events.${ev}`, name])
      }
    }
  }
  return out
}

/** instance → 'SINK\0category' → the select/errors call that read it */
const selected = new WeakMap<object, Map<string, string>>()

const replying = (component: any, name: string) => component?.sources?.[name]?.__sygnalReplies === true

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
  let replies = false
  for (const [action, key, connection] of replyNames(req, !!component?.sources?.[sink]?.__sygnalRouter)) {
    replies = true
    let seen = replySeen.get(component)
    if (!seen) replySeen.set(component, seen = new Set())
    seen.add(action)
    if (modelActions.includes(action) || !once(`SYG112:${name}:${action}`)) continue
    const near = suggest(action, modelActions.filter(a => !a.startsWith('__')))
    devReport('SYG112', {
      component,
      message: (connection
        ? `${sink} connection '${connection}' names '${action}' as its ${key} reply action, but ${name} has no model entry '${action}', so those events are dropped`
        : `A ${sink} request names '${action}' as its ${key} reply action, but ${name} has no model entry '${action}', so the reply is dropped`) +
        (near ? ` (did you mean '${near}'?)` : ''),
      fix: near
        ? `Use the existing entry: ${key.startsWith('events.') ? `events: { '${key.slice(7)}': '${near}' }` : `${key}: '${near}'`}`
        : `Add '${action}' to ${name}.model, e.g. ${action}: (state, data) => ({ ...state, ... }), or fix the name`,
      data: {action, key, sink, ...(connection ? {connection} : {}), ...(near ? {suggestion: near} : {}), modelActions},
    })
  }

  // SYG508 (strict): a request without reply actions whose replies this instance reads back with select()/errors()
  if (replies || 'abort' in req || typeof req.category !== 'string' || !isStrictEnabled()) return
  const read = selected.get(component)?.get(`${sink}\0${req.category}`)
  if (!read || !once(`SYG508:${name}:${sink}:${req.category}`)) return
  // (inside a sink stream: reportSafely, so 'error' mode can't break the stream)
  reportSafely('SYG508', {
    severity: STRICT_CODE_SEVERITY.SYG508,
    component,
    message: `${name} sends a ${sink} request with category: '${req.category}' and reads the reply back with ${read}`,
    fix: `Use reply actions instead: name them in the request, ${sink}: (state) => ({ url, ok: 'LOADED', error: 'FAILED' }), ` +
      `handle LOADED (the parsed body) and FAILED ({ error, status, body, request }) in the model, and remove ${read} from the intent`,
    data: {sink, category: req.category, read},
  })
}

export const repliesCheck: DiagnosticCheck = {
  id: 'replies',

  sources(component, sources) {
    if (!isStrictEnabled() || typeof Proxy != 'function') return
    const cache = new Map<string, any>()
    return new Proxy(sources, {
      get(t: any, k: any) {
        const v = t[k]
        if (typeof k != 'string' || !v || v.__sygnalReplies !== true) return v
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
      if (!replying(component, sink) || !s$ || typeof s$.map !== 'function') continue
      model$[sink] = s$.map((req: any) => {
        checkRequest(component, sink, req, modelActions)
        return req
      })
    }
  },
}
