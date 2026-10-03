/**
 * PLAN-4 3-E (GS-10): "Copy as test". Turns a recorded session (./devtoolsActions getSession())
 * into a Vitest + renderComponent test that replays it:
 *
 *   renderComponent(C, { initialState?, drivers? })   the session's initial state (left out when
 *                                                      it is the component's own initialState)
 *   await t.ready()
 *   t.simulateAction(type, data)     each action caused by 'intent' | 'simulateAction' | 'behavior'
 *   await t.respond(sink, body, OK)  a reply action from a makeFetchDriver source (renderComponent's
 *   await t.fail(sink, status, ...)  HTTP fake answers the request the replayed actions send again)
 *   await t.settle()
 *   expect(t.state).toEqual(final)
 *
 * 'next' and 'built-in' actions are consequences (the replay produces them again), never replayed;
 * nor is an intent action whose data is the component's own state (an intent over STATE.stream).
 * A t.respond / t.fail that follows simulateAction calls waits for the request they send (G-218).
 * Data is written as JS literals: JSON values, Date, Map, Set, NaN / Infinity / -0, bigint. A DOM
 * event or element becomes a stub ({ type, key, target: { dataset, value, checked, id } }), with a
 * comment. Anything else (functions, class instances, cycles) is left out with a comment.
 *
 * The final-state assertion is written only when the replay is complete: every state-changing
 * action could be replayed with its data, no descendant instance changed the state on its own
 * (a child's intent: copy the test from that instance instead), the session wasn't truncated,
 * and the final state is JSON-safe. Otherwise a comment says why. A test written with the
 * assertion passes unchanged (for drivers the session's app had, pass `drivers`).
 */
import type {SessionRecording, SessionAction} from './devtoolsActions'
import {isElement, isEvent, deepEqual} from './devtoolsActions'

export interface CopyAsTestOptions {
  /** the import line(s) for the component, e.g. "import App from './App.jsx'" (default: `import <Name> from './<Name>.js'`) */
  componentImport?: string
  /** the identifier the component has in the test (default: the recorded component name) */
  componentName?: string
  /** more import lines (drivers, helpers) */
  imports?: string[]
  /** drivers for renderComponent, as source code by sink name: { DND: 'mockDragDriver().driver' } */
  drivers?: Record<string, string>
  /** more renderComponent options, as source code: "strict: true" */
  renderOptions?: string
  /** the test's name (default: '<Component> session (copied from sygnal/devtools)') */
  testName?: string
  /** adds a `// @vitest-environment <env>` first line (e.g. 'jsdom') */
  environment?: string
}

export interface CopyAsTestResult {
  /** the test file */
  code: string
  /** true when the test asserts the final state */
  complete: boolean
  /** what was left out, and why (also comments in the code) */
  warnings: string[]
  /** actions written as simulateAction / respond / fail */
  replayed: number
}

const REPLAY = new Set(['intent', 'simulateAction', 'behavior'])
const IDENT = /^[A-Za-z_$][\w$]*$/

class Unserializable extends Error {}

/** a single-quoted JS string literal */
const str = (s: string) => `'${JSON.stringify(s).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`

interface Lit { code: string; stubbed: boolean }

/** `v` as a JS literal. mode 'data' turns DOM events / elements into stubs; 'state' refuses them. */
export function literal(v: any, mode: 'data' | 'state' = 'data', indent = ''): Lit {
  const flag = {stubbed: false}
  const code = lit(v, mode, indent, new Set(), flag)
  return {code, stubbed: flag.stubbed}
}

function elementStub(el: any): any {
  const out: any = {}
  const ds = el.dataset && typeof el.dataset == 'object' ? {...el.dataset} : {}
  if (Object.keys(ds).length) out.dataset = ds
  if (el.id) out.id = el.id
  const tag = String(el.tagName).toUpperCase()
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) && typeof el.value == 'string') out.value = el.value
  if (tag == 'INPUT' && /^(checkbox|radio)$/i.test(el.type || '')) out.checked = !!el.checked
  return out
}

function eventStub(e: any): any {
  const out: any = {type: e.type}
  if (typeof e.key == 'string') out.key = e.key
  if (isElement(e.target)) {
    const t = elementStub(e.target)
    if (Object.keys(t).length) out.target = t
  }
  return out
}

function lit(v: any, mode: 'data' | 'state', ind: string, seen: Set<any>, flag: {stubbed: boolean}): string {
  if (v === null) return 'null'
  switch (typeof v) {
    case 'undefined': return 'undefined'
    case 'boolean': return String(v)
    case 'string': return str(v)
    case 'number': return Object.is(v, -0) ? '-0' : String(v)
    case 'bigint': return `${v}n`
    case 'function': throw new Unserializable(`a function (${v.name || 'anonymous'})`)
    case 'symbol': throw new Unserializable(`a symbol (${String(v)})`)
  }
  if (seen.has(v)) throw new Unserializable('a circular reference')
  if (isEvent(v) || isElement(v)) {
    if (mode == 'state') throw new Unserializable(isEvent(v) ? `a DOM ${v.type} event` : 'a DOM element')
    flag.stubbed = true
    return lit(isEvent(v) ? eventStub(v) : elementStub(v), mode, ind, seen, flag)
  }
  seen.add(v)
  try {
    const inner = ind + '  '
    const list = (items: string[], open: string, close: string) => {
      if (!items.length) return open + close
      const one = open + (open == '{' ? ' ' : '') + items.join(', ') + (open == '{' ? ' ' : '') + close
      if (one.length + ind.length <= 100 && !one.includes('\n')) return one
      return open + '\n' + items.map(s => inner + s).join(',\n') + ',\n' + ind + close
    }
    if (Array.isArray(v)) return list(Array.from(v, x => lit(x, mode, inner, seen, flag)), '[', ']')
    if (v instanceof Date) return `new Date(${str(isNaN(+v) ? 'Invalid Date' : v.toISOString())})`
    if (v instanceof Map) return `new Map(${list([...v].map(([k, x]) => list([lit(k, mode, inner + '  ', seen, flag), lit(x, mode, inner + '  ', seen, flag)], '[', ']')), '[', ']')})`
    if (v instanceof Set) return `new Set(${list([...v].map(x => lit(x, mode, inner, seen, flag)), '[', ']')})`
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) throw new Unserializable(`a ${(v.constructor && v.constructor.name) || 'class instance'}`)
    const items: string[] = []
    for (const k of Object.keys(v)) {
      if (v[k] === undefined) continue
      items.push(`${IDENT.test(k) ? k : str(k)}: ${lit(v[k], mode, inner, seen, flag)}`)
    }
    return list(items, '{', '}')
  } finally {
    seen.delete(v)
  }
}

const q = str
const tryLit = (v: any, mode: 'data' | 'state', ind: string): Lit | {error: string} => {
  try { return literal(v, mode, ind) } catch (e: any) {
    if (e instanceof Unserializable) return {error: e.message}
    throw e
  }
}

/** an error reply from makeFetchDriver: { error, request, status?, body? } for the request's `error` action */
const isErrorReply = (a: SessionAction) =>
  a.data && typeof a.data == 'object' && 'error' in a.data && a.data.request && typeof a.data.request == 'object' && a.data.request.error === a.type

/** The test for a recorded session (see the module comment), with what it left out. */
export function sessionToTest(rec: SessionRecording, options: CopyAsTestOptions = {}): CopyAsTestResult {
  const name = options.componentName || (IDENT.test(rec.component) ? rec.component : 'Component')
  const warnings: string[] = []
  const incomplete: string[] = []
  const body: string[] = []
  const I = '    '
  const drivers = options.drivers || {}
  let replayed = 0

  if (rec.truncated) incomplete.push('the session lost its oldest actions (clear the log, then record a shorter session)')

  // render options
  const opts: string[] = []
  if (rec.initialState !== undefined && !deepEqual(rec.initialState, rec.definitionInitialState)) {
    const l = tryLit(rec.initialState, 'state', I)
    if ('error' in l) {
      warnings.push(`the initial state holds ${l.error}: rendering with the component's own initialState`)
      incomplete.push('the initial state could not be written')
    } else opts.push(`initialState: ${l.code}`)
  }
  const fakeable = new Set(rec.fakeable)
  const driverNames = [...new Set([...rec.drivers.filter(n => !fakeable.has(n)), ...Object.keys(drivers)])]
  const given = driverNames.filter(n => drivers[n] !== undefined)
  const missing = driverNames.filter(n => drivers[n] === undefined)
  if (given.length) opts.push(`drivers: { ${given.map(n => `${IDENT.test(n) ? n : q(n)}: ${drivers[n]}`).join(', ')} }`)
  if (missing.length) warnings.push(`the app had ${missing.length == 1 ? 'a driver' : 'drivers'} for ${missing.join(', ')}: pass ${missing.length == 1 ? 'it' : 'them'} with copyAsTest(..., { drivers: { ${missing[0]}: '...' } }) if the component reads ${missing.length == 1 ? 'it' : 'them'}`)
  if (options.renderOptions) opts.push(options.renderOptions)

  const names = rec.actionNames && new Set(rec.actionNames)
  // (G-218: t.respond / t.fail right after queued simulateAction calls wait for the request
  // those calls send, so no settle() is needed before them)
  const answer = (line: string) => body.push(line)
  for (const a of rec.actions) {
    const changes = a.sinks.includes('STATE') || a.sinks.includes('state')
    if (REPLAY.has(a.cause)) {
      // an intent over the component's own STATE stream: the replay produces it again
      if (a.echo) continue
      // an intent action with no model entry does nothing (renderComponent can't send it)
      if (names && !names.has(a.type) && a.cause != 'behavior') continue
      replayed++
      if (a.data === undefined) { body.push(`${I}t.simulateAction(${q(a.type)})`); continue }
      const l = tryLit(a.data, 'data', I)
      if ('error' in l) {
        body.push(`${I}t.simulateAction(${q(a.type)}) // data left out: it held ${l.error}`)
        if (changes) incomplete.push(`${a.type}'s data could not be written (${l.error})`)
        continue
      }
      if (l.stubbed) body.push(`${I}// ${a.type}: DOM event/element data as a stub (type, key, target dataset/value/checked/id)`)
      body.push(`${I}t.simulateAction(${q(a.type)}, ${l.code})`)
    } else if (a.cause == 'reply') {
      const sink = a.replySink
      if (!sink || a.replyKind != 'fetch' || drivers[sink] !== undefined) {
        body.push(`${I}// reply ${a.type}${sink ? ` from ${sink}` : ''}: not replayed (renderComponent fakes makeFetchDriver sources only)`)
        if (changes) incomplete.push(`the ${a.type} reply could not be replayed`)
        continue
      }
      if (isErrorReply(a)) {
        const err = a.data.error, status = a.data.status ?? (err && err.status), errBody = a.data.body ?? (err && err.body)
        if (typeof status == 'number') {
          if (errBody === undefined) answer(`${I}await t.fail(${q(sink)}, ${status}, ${q(a.type)})`)
          else {
            const l = tryLit(errBody, 'state', I)
            if ('error' in l) { answer(`${I}await t.fail(${q(sink)}, ${status}, ${q(a.type)}) // body left out: it held ${l.error}`); if (changes) incomplete.push(`the ${a.type} error body could not be written`) }
            else answer(`${I}await t.fail(${q(sink)}, ${status}, { request: (r) => r.error === ${q(a.type)}, body: ${l.code} })`)
          }
        } else if (a.data.issues) {
          body.push(`${I}// reply ${a.type}: a validation failure, not replayed`)
          if (changes) incomplete.push(`the ${a.type} validation failure could not be replayed`)
          continue
        } else {
          answer(`${I}await t.fail(${q(sink)}, new Error(${str(String(err && err.message || err))}), ${q(a.type)})`)
        }
        replayed++
        continue
      }
      const l = tryLit(a.data, 'state', I)
      if ('error' in l) {
        body.push(`${I}// reply ${a.type} from ${sink}: its data held ${l.error}, not replayed`)
        if (changes) incomplete.push(`the ${a.type} reply's data could not be written`)
        continue
      }
      answer(`${I}await t.respond(${q(sink)}, ${l.code}, ${q(a.type)})`)
      replayed++
    } else if (a.type == 'RESOURCE' && a.data && (a.data.status == 'success' || a.data.status == 'error')) {
      body.push(`${I}// RESOURCE ${a.data.name}: ${a.data.status}, not replayed (answer it with t.respond / t.fail)`)
      if (changes) incomplete.push(`resource '${a.data.name}' was answered`)
    }
    // 'next' and 'built-in': consequences, produced again by the replay
  }

  if (rec.foreign.length) {
    const list = rec.foreign.slice(0, 5).map(f => `${f.component}#${f.instance} ${f.type}`).join(', ') + (rec.foreign.length > 5 ? ', ...' : '')
    incomplete.push(`child components changed the state through their own actions (${list}): copy the test from that component instance instead`)
  }

  let assertion: string[]
  if (!incomplete.length) {
    const l = tryLit(rec.finalState, 'state', I)
    if ('error' in l) incomplete.push(`the final state holds ${l.error}`)
    else assertion = [`${I}expect(t.state).toEqual(${l.code})`]
  }
  if (incomplete.length) {
    warnings.push(...incomplete.map(s => 'no final-state assertion: ' + s))
    assertion = [`${I}// No final-state assertion: ${incomplete.join('; ')}`]
  }

  const head: string[] = []
  if (options.environment) head.push(`// @vitest-environment ${options.environment}`)
  head.push(`// Copied from a sygnal/devtools session of ${rec.component} (${rec.actions.length} recorded actions, ${replayed} replayed)`)
  for (const w of warnings) head.push(`// NOTE: ${w}`)
  head.push(`import { it, expect } from 'vitest'`, `import { renderComponent } from 'sygnal'`)
  head.push(...(options.imports || []))
  head.push(options.componentImport || `import ${name} from './${name}.js'`)

  const testName = options.testName || `${rec.component} session (copied from sygnal/devtools)`
  const render = opts.length ? `renderComponent(${name}, {\n${opts.map(o => `${I}${o},`).join('\n')}\n  })` : `renderComponent(${name})`
  const code = [
    ...head,
    '',
    `it(${q(testName)}, async () => {`,
    `  const t = ${render}`,
    '  try {',
    `${I}await t.ready()`,
    ...body,
    `${I}await t.settle()`,
    ...assertion!,
    '  } finally {',
    `${I}t.dispose()`,
    '  }',
    '})',
    '',
  ].join('\n')
  return {code, complete: !incomplete.length, warnings, replayed}
}
