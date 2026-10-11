/**
 * PLAN-6 K-1: the `agent` static (sygnal/ai, A-1; src/extra/ai/agent/index.ts):
 *
 *   Comp.agent = { name, description?, read?, label?, untrusted?,
 *                  actions: { ACTION: { description, input?, consequential?, when?, idempotent? } },
 *                  queries: { find: { description, input?, when?, run: (state, input) => result } } }
 *
 * analyzeAgent(project, file, node) → AgentInfo
 *   AgentInfo = {
 *     node, file,                 the declaration (object literal) or the assigned expression
 *     known: boolean,             an object literal the checker can read
 *     name: string | null,        the literal `name` (null: none given, or dynamic: see nameDynamic)
 *     nameNode, nameDynamic,
 *     description: string | null,
 *     read: boolean, label: boolean,
 *     actionsKnown: boolean,      `actions` is an object literal without spreads or computed keys
 *     actions: Array<{ name, node (the key), file, value (object literal | null), consequential: boolean,
 *                      idempotent: boolean, when: boolean, input: { node, file } | null }>,
 *     queriesKnown: boolean,      `queries` is an object literal without spreads or computed keys
 *     queries: Array<{ name, node, file, value, when: boolean, input: { node, file } | null,
 *                      run: 'missing' | 'async' | 'sync' | 'unknown', runNode }>,
 *   }
 */
import { unwrap, propName, stringValue, isFunction } from '../ast.js'
import { resolveExpr } from './resolve.js'

const prop = (obj, name) => obj.properties.find(p => (p.type === 'ObjectProperty' || p.type === 'ObjectMethod') && propName(p) === name) || null
const isTrue = (p) => p?.type === 'ObjectProperty' && unwrap(p.value)?.type === 'BooleanLiteral' && unwrap(p.value).value === true

export function analyzeAgent(project, file, node) {
  const info = {
    node, file, known: false, name: null, nameNode: null, nameDynamic: false, description: null,
    read: false, label: false, actionsKnown: false, actions: [], queriesKnown: false, queries: [],
  }
  const r = resolveExpr(project, file, node)
  const obj = r?.node
  if (!obj || obj.type !== 'ObjectExpression') return info
  info.node = obj
  info.file = r.file
  info.known = !obj.properties.some(p => p.type === 'SpreadElement')
  const name = prop(obj, 'name')
  if (name) {
    info.nameNode = name.type === 'ObjectProperty' ? name.value : name
    info.name = name.type === 'ObjectProperty' ? stringValue(name.value) : null
    info.nameDynamic = info.name == null
  }
  const desc = prop(obj, 'description')
  if (desc?.type === 'ObjectProperty') info.description = stringValue(desc.value)
  info.read = !!prop(obj, 'read')
  info.label = !!prop(obj, 'label')
  analyzeQueries(project, r.file, prop(obj, 'queries'), info)
  const actions = prop(obj, 'actions')
  if (!actions || actions.type !== 'ObjectProperty') return info
  const ar = resolveExpr(project, r.file, actions.value)
  const aobj = ar?.node
  if (!aobj || aobj.type !== 'ObjectExpression') return info
  info.actionsKnown = true
  for (const p of aobj.properties) {
    const key = p.type === 'SpreadElement' ? null : propName(p)
    if (key == null) { info.actionsKnown = false; continue }
    const vr = p.type === 'ObjectProperty' ? resolveExpr(project, ar.file, p.value) : null
    const value = vr?.node?.type === 'ObjectExpression' ? vr.node : null
    const input = value && prop(value, 'input')
    info.actions.push({
      name: key, node: p.key, file: ar.file, value,
      consequential: !!value && isTrue(prop(value, 'consequential')),
      idempotent: !!value && isTrue(prop(value, 'idempotent')),
      when: !!value && !!prop(value, 'when'),
      input: input?.type === 'ObjectProperty' ? { node: input.value, file: vr.file } : null,
    })
  }
  return info
}

/** `agent.queries`: each entry's input and what its `run` is ('async' for an async function) */
function analyzeQueries(project, file, queries, info) {
  if (!queries || queries.type !== 'ObjectProperty') return
  const qr = resolveExpr(project, file, queries.value)
  const qobj = qr?.node
  if (!qobj || qobj.type !== 'ObjectExpression') return
  info.queriesKnown = true
  for (const p of qobj.properties) {
    const key = p.type === 'SpreadElement' ? null : propName(p)
    if (key == null) { info.queriesKnown = false; continue }
    const vr = p.type === 'ObjectProperty' ? resolveExpr(project, qr.file, p.value) : null
    const value = vr?.node?.type === 'ObjectExpression' ? vr.node : null
    const input = value && prop(value, 'input')
    const runP = value && prop(value, 'run')
    let run = 'unknown', runNode = null
    if (value && !value.properties.some(q => q.type === 'SpreadElement')) {
      if (!runP) run = 'missing'
      else {
        const fn = runP.type === 'ObjectMethod' ? runP : unwrap(resolveExpr(project, vr.file, runP.value)?.node ?? runP.value)
        runNode = runP.type === 'ObjectMethod' ? runP.key : runP.value
        run = fn && (fn.type === 'ObjectMethod' || isFunction(fn)) ? (fn.async ? 'async' : 'sync') : 'unknown'
      }
    }
    info.queries.push({
      name: key, node: p.key, file: qr.file, value,
      when: !!value && !!prop(value, 'when'),
      input: input?.type === 'ObjectProperty' ? { node: input.value, file: vr.file } : null,
      run, runNode,
    })
  }
}

// the runtime's tool-name prefix (src/extra/ai/agent/index.ts snake())
export const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\W+/g, '_').toLowerCase()

/** The declaration's tool-name prefix the runtime uses: `agent.name`, else the component's name (snake_case). */
export function agentName(comp) {
  const a = comp.agent
  if (!a?.known || a.nameDynamic) return null
  return snake(a.name ?? comp.name)
}
