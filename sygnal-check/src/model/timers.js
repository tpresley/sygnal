/**
 * Timers (PLAN-4 GS-7): a component's `timers` static, read statically.
 *
 *   C.timers = (state) => ({ tick: state.running && { every: 100, action: 'TICK' }, frame: { frame: 'FRAME' } })
 *   C.timers = { tick: (state) => state.running && { every: 100, action: 'TICK' } }   // per-timer functions
 *
 * analyzeTimers(project, file, node) → {
 *   known     every timer map was an object literal the checker could read
 *   specs     [{ name, nameNode, node, file, problem, problemNode }]   one per literal spec (a name can have several:
 *             `on ? { every: 100, ... } : { after: 0, ... }`); problem: why makeTimerDriver() can't run it
 *             ('' when it can, null when undecidable), worded as the runtime's SYG422; problemNode: the
             property with the wrong value, or the spec when it isn't an object (null otherwise)
 *   targets   [{ name, key, node, file, timer: true }]    the action names (`action`, `frame`) — reply
 *             actions the timer driver dispatches (SYG102 triggers, SYG112 names)
 *   dynamic   [{ node, file }]                            action names (or maps) it can't read
 * }
 *
 * The validity rules mirror src/extra/timers.ts valid() and the dev entry's timerSpecProblem()
 * (src/extra/diagnostics/checks/timers.ts); only literal values are judged.
 */
import { unwrap, isFunction, propName } from '../ast.js'
import { resolveExpr } from './resolve.js'
import { returnedExpressions } from './intent.js'

const UNKNOWN = { known: false }

/** The value of a literal expression, or UNKNOWN. */
export function literal(node) {
  const n = unwrap(node)
  if (!n) return { known: true, value: undefined }
  switch (n.type) {
    case 'NumericLiteral': case 'StringLiteral': case 'BooleanLiteral': return { known: true, value: n.value }
    case 'NullLiteral': return { known: true, value: null }
    case 'TemplateLiteral': return n.expressions.length ? UNKNOWN : { known: true, value: n.quasis[0].value.cooked }
    case 'Identifier':
      if (n.name === 'undefined') return { known: true, value: undefined }
      if (n.name === 'NaN') return { known: true, value: NaN }
      if (n.name === 'Infinity') return { known: true, value: Infinity }
      return UNKNOWN
    case 'UnaryExpression': {
      if (n.operator !== '-' && n.operator !== '+') return UNKNOWN
      const v = literal(n.argument)
      return v.known && typeof v.value === 'number' ? { known: true, value: n.operator === '-' ? -v.value : v.value } : UNKNOWN
    }
    default: return UNKNOWN
  }
}

// candidate values of an expression: through ?:, && (its right side), || and sequences
function alternatives(e, out = [], depth = 0) {
  e = unwrap(e)
  if (!e || depth > 6) return out
  if (e.type === 'ConditionalExpression') { alternatives(e.consequent, out, depth + 1); alternatives(e.alternate, out, depth + 1) }
  else if (e.type === 'LogicalExpression') { alternatives(e.right, out, depth + 1); if (e.operator !== '&&') alternatives(e.left, out, depth + 1) }
  else if (e.type === 'SequenceExpression') alternatives(e.expressions[e.expressions.length - 1], out, depth + 1)
  else out.push(e)
  return out
}

/** Why a spec (an AST node) can't run: a problem string, '' when it can, null when undecidable. */
export function specProblem(file, node) {
  return specCheck(file, node).problem
}

/**
 * specProblem() with the node the problem is about (PLAN-7 C-2): `at` is the property with the
 * wrong value (`every: 0`, `action: 42`), the spec itself when it isn't an object, and null when
 * the problem is a missing key (the caller underlines the timer's name instead).
 */
export function specCheck(file, node) {
  const text = (n) => file.source.slice(n.start, n.end)
  const ok = (problem) => ({ problem, at: null })
  if (node.type !== 'ObjectExpression') {
    const v = literal(node)
    if (!v.known || !v.value) return ok(null)   // falsy: the timer is stopped
    return typeof v.value === 'object' ? ok(null) : { problem: 'is not an object ({ every, action }, { after, action } or { frame: action })', at: node }
  }
  if (node.properties.some(p => p.type !== 'ObjectProperty')) return ok(null)   // spreads, methods
  const props = new Map()
  for (const p of node.properties) {
    const k = propName(p)
    if (k == null) return ok(null)
    props.set(k, p)
  }
  const get = (k) => props.has(k) ? literal(props.get(k).value) : { known: true, value: undefined }
  const bad = (problem, k) => ({ problem, at: props.get(k) || null })
  const frame = get('frame')
  if (!frame.known) return ok(null)
  if (frame.value) {
    if (typeof frame.value !== 'string') return bad('frame must be the action name (a string)', 'frame')
    // canvas-game R2: a fixed step (ms) and the keys a frame samples
    const step = get('step'), keys = get('keys')
    if (step.known && step.value != null && !(typeof step.value === 'number' && step.value > 0)) return bad(`step must be a positive number of ms (got ${text(props.get('step').value)})`, 'step')
    if (props.has('keys') && props.get('keys').value.type !== 'ObjectExpression' && keys.known && keys.value != null && typeof keys.value !== 'object') return bad(`keys must be an object of button: key codes (got ${text(props.get('keys').value)})`, 'keys')
    return ok('')
  }
  const action = get('action')
  if (!action.known) return ok(null)
  if (!action.value || typeof action.value !== 'string') return bad('has no action (a string)', 'action')
  const every = get('every'), after = get('after')
  if (!every.known || !after.known) return ok(null)
  if (every.value == null && after.value == null) return ok('has neither every nor after')
  if (every.value != null && after.value != null) return ok('has both every and after')
  if (every.value != null) return every.value > 0 && every.value < Infinity ? ok('') : bad(`every must be a positive number of ms (got ${text(props.get('every').value)})`, 'every')
  return after.value >= 0 && after.value < Infinity ? ok('') : bad(`after must be a number of ms, 0 or more (got ${text(props.get('after').value)})`, 'after')
}

/** A literal spec's fields for the graph: { every?, after?, frame?, action?, background? } */
export function specFields(node) {
  const out = {}
  if (node.type !== 'ObjectExpression') return out
  for (const p of node.properties) {
    if (p.type !== 'ObjectProperty') continue
    const k = propName(p)
    const v = literal(p.value)
    if (k === 'every' || k === 'after') out[k] = v.known && typeof v.value === 'number' && Number.isFinite(v.value) ? v.value : null
    else if (k === 'frame' || k === 'action') out[k] = v.known && typeof v.value === 'string' ? v.value : null
    else if (k === 'background' && v.known && v.value === true) out.background = true
  }
  return out
}

/** (`keys`: the spec keys that name actions; PLAN-5 B-3's `browser` static passes ['action', 'error'], and its specs aren't judged) */
export function analyzeTimers(project, file, node, keys = null) {
  const res = { known: true, specs: [], targets: [], dynamic: [] }
  const r = resolveExpr(project, file, node)
  if (!r?.node) { res.known = false; res.dynamic.push({ node, file }); return res }
  const f = r.file

  const spec = (name, nameNode, s, vfile) => {
    const { problem, at } = keys ? { problem: '', at: null } : specCheck(vfile, s)
    return { name, nameNode, node: s, file: vfile, problem, problemNode: at }
  }
  const addSpec = (name, nameNode, value, vfile) => {
    for (const s of alternatives(value)) {
      if (s.type !== 'ObjectExpression') {
        const v = literal(s)
        if (v.known && !v.value) continue   // a stopped timer
        if (!v.known) { res.known = false; res.dynamic.push({ node: s, file: vfile }) }
        res.specs.push(spec(name, nameNode, s, vfile))
        continue
      }
      res.specs.push(spec(name, nameNode, s, vfile))
      for (const p of s.properties) {
        if (p.type === 'SpreadElement') { res.dynamic.push({ node: p, file: vfile }); continue }
        const k = propName(p)
        if (!(keys || ['action', 'frame']).includes(k)) continue
        const v = p.type === 'ObjectProperty' ? literal(p.value) : UNKNOWN
        if (v.known && typeof v.value === 'string' && v.value) res.targets.push({ name: v.value, key: k, node: p.value, file: vfile, timer: true })
        else if (!v.known) res.dynamic.push({ node: p.value || p, file: vfile })
      }
    }
  }
  const addMap = (obj, ofile, perTimerFunctions) => {
    for (const p of obj.properties) {
      if (p.type === 'SpreadElement') { res.known = false; res.dynamic.push({ node: p, file: ofile }); continue }
      const name = propName(p) ?? '?'
      const value = p.type === 'ObjectMethod' ? p : p.value
      if (!perTimerFunctions) { addSpec(name, p.key, value, ofile); continue }
      const fr = resolveExpr(project, ofile, value)
      // (nameNode only in the spec's own file: SYG422 locates findings with it)
      if (fr?.node && isFunction(fr.node)) returnedExpressions(fr.node).forEach(e => addSpec(name, fr.file === ofile ? p.key : null, e, fr.file))
      else { res.known = false; res.dynamic.push({ node: value, file: ofile }) }
    }
  }

  if (isFunction(r.node)) {
    for (const ret of returnedExpressions(r.node)) {
      for (const m of alternatives(ret)) {
        if (m.type === 'ObjectExpression') addMap(m, f, false)
        else if (!(literal(m).known && !literal(m).value)) { res.known = false; res.dynamic.push({ node: m, file: f }) }
      }
    }
  } else if (r.node.type === 'ObjectExpression') {
    addMap(r.node, f, true)
  } else {
    res.known = false
    res.dynamic.push({ node: r.node, file: f })
  }
  return res
}
