/**
 * SYG508 (PLAN-3 §1.1, strict): the select()/errors() round trip where a
 * routed request would do.
 *
 *   Quote.intent = ({ DOM, HTTP }) => ({ LOAD: DOM.click('.get'), LOADED: HTTP.select('quote') })
 *   Quote.model  = { LOAD: { HTTP: () => ({ category: 'quote', url }) }, LOADED: … }
 *
 * The canonical form names the reply actions in the request and drops the
 * intent half:
 *
 *   Quote.model = { LOAD: { HTTP: () => ({ url, ok: 'LOADED', error: 'FAILED' }) }, LOADED: … }
 *
 * Flags `X.select('c')` / `X.errors('c')` in an intent when the same
 * component's model sends sink X an object with `category: 'c'` (or the
 * driverFromAsync `selector` property) and no ok/error, and X is a routing
 * driver: registered somewhere in the scanned files as makeFetchDriver(),
 * driverFromAsync() or makeSocketDriver(), or named HTTP and not registered as
 * another `…Driver()`. A custom driver can't route replies, so its select()
 * is left alone.
 */
import { walk, unwrap, propName, memberName, stringValue } from '../../ast.js'
import { sourceAliases } from '../../model/intent.js'
import { returnedObjects } from '../../model/modelEntries.js'
import { modelEntries, sinkProps } from './shared.js'

const ROUTING_FACTORIES = new Set(['makeFetchDriver', 'driverFromAsync', 'makeSocketDriver'])
const NOT_DRIVER_SOURCES = new Set(['DOM', 'EVENTS', 'CHILD', 'STATE', 'props$', 'dispose$'])

const calleeName = (call) => {
  const c = unwrap(call.callee)
  if (c.type === 'Identifier') return c.name
  if (c.type === 'MemberExpression') return memberName(c)
  return null
}

/** sink name → { selectorKey } for routing drivers; plus the names registered as other drivers. */
function routingDrivers(project) {
  if (project._routingDrivers) return project._routingDrivers
  const routing = new Map()
  const other = new Set()
  for (const file of project.files.values()) {
    // G-164: a file that failed to parse is kept as null (its parse error is reported once)
    if (!file?.ast) continue
    walk(file.ast.program, (n) => {
      if (n.type !== 'ObjectProperty') return true
      const key = propName(n)
      const v = unwrap(n.value)
      if (!key || v?.type !== 'CallExpression') return true
      const name = calleeName(v)
      if (ROUTING_FACTORIES.has(name)) {
        let selectorKey = 'category'
        const opts = name === 'driverFromAsync' ? unwrap(v.arguments[1]) : null
        if (opts?.type === 'ObjectExpression') {
          const sel = opts.properties.find(p => p.type === 'ObjectProperty' && propName(p) === 'selector')
          const s = sel && stringValue(sel.value)
          if (s) selectorKey = s
        }
        routing.set(key, { selectorKey })
      } else if (name && /Driver$/.test(name)) {
        other.add(key)
      }
      return true
    })
  }
  return (project._routingDrivers = { routing, other })
}

function routingInfo(project, sink) {
  const { routing, other } = routingDrivers(project)
  if (routing.has(sink)) return routing.get(sink)
  if (sink === 'HTTP' && !other.has('HTTP')) return { selectorKey: 'category' }
  return null
}

/** The source name a node refers to (`HTTP`, a renamed `{ HTTP: http }`, `sources.HTTP`). */
function sourceName(node, sa) {
  node = unwrap(node)
  if (node?.type === 'Identifier') {
    for (const [src, locals] of sa.aliases) if (locals.has(node.name)) return src
    return null
  }
  if (node?.type === 'MemberExpression' && sa.sourcesParam) {
    const o = unwrap(node.object)
    if (o.type === 'Identifier' && o.name === sa.sourcesParam) return memberName(node)
  }
  return null
}

/** Name of the intent action whose stream contains `node` (the outermost property around it). */
function intentActionAt(fn, node) {
  let found = null
  walk(fn.body, (n) => {
    if (found) return false
    if (n.start > node.start || n.end < node.end) return false
    if (n.type === 'ObjectProperty' && n.value.start <= node.start) { found = propName(n); return false }
    return true
  })
  return found
}

/** Model entries that send sink `sink` an object with `key: category` (and no ok/error/abort). */
function requestsFor(project, comp, sink, key, category) {
  const out = []
  for (const e of modelEntries(project, comp)) {
    const values = e.shorthand ? (e.sink === sink ? [e.value] : [])
      : sinkProps(e.value).filter(s => s.sink === sink).map(s => s.value)
    for (const v of values) {
      for (const { node: obj } of returnedObjects(project, e.file, v)) {
        const props = obj.properties.filter(p => p.type === 'ObjectProperty')
        const names = props.map(propName)
        if (names.includes('ok') || names.includes('error') || names.includes('abort')) continue
        if (props.some(p => propName(p) === key && stringValue(p.value) === category)) out.push(e.action)
      }
    }
  }
  return [...new Set(out)]
}

export default {
  id: 'strict-select-roundtrip',
  codes: ['SYG508'],
  description: 'select()/errors() round trip where a routed request would do',
  strict: true,
  run(project, report) {
    for (const comp of project.components) {
      const fn = comp.intent?.fn
      if (!fn || !comp.staticProps.model) continue
      const file = comp.intent.file
      const sa = sourceAliases(fn)
      const calls = []
      walk(fn.body, (n) => {
        if (n.type !== 'CallExpression') return true
        const callee = unwrap(n.callee)
        if (callee.type !== 'MemberExpression') return true
        const method = memberName(callee)
        if (method !== 'select' && method !== 'errors') return true
        const sink = sourceName(callee.object, sa)
        const category = stringValue(n.arguments[0])
        if (!sink || NOT_DRIVER_SOURCES.has(sink) || category == null) return true
        const info = routingInfo(project, sink)
        if (!info) return true
        const senders = requestsFor(project, comp, sink, info.selectorKey, category)
        if (senders.length) calls.push({ node: n, method, sink, category, senders, key: info.selectorKey, action: intentActionAt(fn, n) })
        return true
      })
      for (const c of calls) {
        const pair = (m) => calls.find(o => o.sink === c.sink && o.category === c.category && o.method === m)
        const ok = pair('select')?.action || 'LOADED'
        const error = pair('errors')?.action || 'FAILED'
        const sender = c.senders[0]
        const reading = `${c.sink}.${c.method}('${c.category}')`
        report({
          code: 'SYG508',
          component: comp.name,
          file,
          node: c.node,
          message: `${comp.name}.intent reads ${reading} for the replies to its own ${c.sink} request ` +
            `('${sender}' sends ${c.key}: '${c.category}'); a routed request delivers them as actions directly`,
          fix: `name the reply actions in the request and drop the intent line: ` +
            `before \`${sender}: { ${c.sink}: (state) => ({ ${c.key}: '${c.category}', … }) }\` + \`${c.action || 'ACTION'}: ${reading}\`; ` +
            `after \`${sender}: { ${c.sink}: (state) => ({ …, ok: '${ok}', error: '${error}' }) }\` ` +
            `(the '${ok}' reducer gets the parsed body, '${error}' gets { error, status, body, request })`,
          data: { source: c.sink, method: c.method, category: c.category, action: c.action, sender, ok, error },
        })
      }
    }
  },
}
