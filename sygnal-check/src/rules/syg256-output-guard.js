/** A deliberately bounded proof, not a general control-flow or mutation analysis. */
import {isFunction, propName, unwrap, walk} from '../ast.js'
import {findBinding} from '../scope.js'
import {splitModelKey} from '../model/modelEntries.js'
import {sinkTimingContexts, componentStaticKnown, resolveStableValue} from '../model/sinkTiming.js'

const UNKNOWN = Symbol('unknown')
function literal(node) {
  node = unwrap(node)
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node?.type)) return node.value
  if (node?.type === 'NullLiteral') return null
  if (node?.type === 'UnaryExpression' && ['+', '-'].includes(node.operator) && node.argument.type === 'NumericLiteral')
    return node.operator === '-' ? -node.argument.value : node.argument.value
  return UNKNOWN
}
function member(node, fn, file) {
  node = unwrap(node)
  if (node?.type !== 'MemberExpression' || node.optional || node.computed || node.property.type !== 'Identifier') return null
  const obj = unwrap(node.object)
  if (obj?.type !== 'Identifier' || obj.name !== fn.params[0].name || findBinding(file, obj.name, obj)?.node !== fn) return null
  return node.property.name
}
function predicate(node, fn, file, values = new Map()) {
  node = unwrap(node)
  const key = member(node, fn, file)
  if (key) return {valid:true, value:values.has(key) ? values.get(key) : UNKNOWN}
  const v = literal(node)
  if (v !== UNKNOWN) return {valid:true, value:v}
  if (node?.type === 'UnaryExpression' && node.operator === '!') {
    const p = predicate(node.argument, fn, file, values)
    return {valid:p.valid, value:p.value === UNKNOWN ? UNKNOWN : !p.value}
  }
  if (node?.type === 'BinaryExpression' && ['===', '!=='].includes(node.operator)) {
    if (!(member(node.left, fn, file) && literal(node.right) !== UNKNOWN || member(node.right, fn, file) && literal(node.left) !== UNKNOWN))
      return {valid:false, value:UNKNOWN}
    const a = predicate(node.left, fn, file, values), b = predicate(node.right, fn, file, values)
    return {valid:a.valid && b.valid, value:a.value === UNKNOWN || b.value === UNKNOWN ? UNKNOWN : (a.value === b.value) === (node.operator === '===')}
  }
  return {valid:false, value:UNKNOWN}
}
function aborted(node, file) {
  node = unwrap(node)
  if (node?.type !== 'Identifier') return false
  const b = findBinding(file, node.name, node)
  return b?.kind === 'import' && b.source === 'sygnal' && b.imported === 'ABORT'
}

// Only expression returns, or straight if/return blocks. Side-effectful statements are opaque.
function expression(node, fn, file) {
  node = unwrap(node)
  if (node?.type !== 'ConditionalExpression') return {leaf:node}
  if (!predicate(node.test, fn, file).valid) return null
  const yes = expression(node.consequent, fn, file), no = expression(node.alternate, fn, file)
  return yes && no ? {test:node.test, yes, no} : null
}
function statements(list, fn, file, fallback = {leaf:null}) {
  if (!list.length) return fallback
  const [s, ...rest] = list
  if (s.type === 'ReturnStatement') return expression(s.argument, fn, file)
  if (s.type === 'BlockStatement') return statements(s.body, fn, file, statements(rest, fn, file, fallback))
  if (s.type !== 'IfStatement' || !predicate(s.test, fn, file).valid) return null
  const tail = statements(rest, fn, file, fallback)
  const yes = statements([s.consequent], fn, file, tail)
  const no = s.alternate ? statements([s.alternate], fn, file, tail) : tail
  return yes && no ? {test:s.test, yes, no} : null
}
function reducer(node, file) {
  const fn = unwrap(node)
  if (!isFunction(fn) || fn.async || fn.generator || fn.params[0]?.type !== 'Identifier') return null
  // Default parameters can run arbitrary work before a predicate is evaluated.
  if (fn.params.some(p => {
    let defaults = false
    walk(p, n => {if (n.type === 'AssignmentPattern' || n.type === 'ObjectProperty' && n.computed) defaults = true})
    return defaults
  })) return null
  const tree = fn.body.type === 'BlockStatement' ? statements(fn.body.body, fn, file) : expression(fn.body, fn, file)
  return tree ? {fn, file, tree} : null
}
// STATE paths constrain the old snapshot. Retain only facts supported by predicate(), rather
// than treating a write in an already-rejected branch as a timing-induced contradiction.
function constrain(facts, node, truthy, r) {
  node=unwrap(node)
  if (node.type==='UnaryExpression' && node.operator==='!') return constrain(facts,node.argument,!truthy,r)
  let key=member(node,r.fn,r.file), value=UNKNOWN, equal=null
  if (!key && node.type==='BinaryExpression') {
    key=member(node.left,r.fn,r.file) || member(node.right,r.fn,r.file)
    value=literal(member(node.left,r.fn,r.file) ? node.right : node.left)
    equal=(node.operator==='===')===truthy
  }
  if (!key) return facts
  const next=new Map(facts), old=facts.get(key)
  const f=old ? {...old,excluded:new Set(old.excluded)} : {hasEqual:false,excluded:new Set()}
  if (equal===null) {
    if (f.truthy!==undefined && f.truthy!==truthy) return null
    f.truthy=truthy
  } else if (equal) {
    if (f.hasEqual && f.value!==value) return null
    f.hasEqual=true; f.value=value
  } else f.excluded.add(value)
  if (f.hasEqual && (f.excluded.has(f.value) || f.truthy!==undefined && Boolean(f.value)!==f.truthy)) return null
  next.set(key,f)
  return next
}
function constrainedPredicate(node, r, facts) {
  node=unwrap(node)
  const key=member(node,r.fn,r.file), f=key && facts.get(key)
  if (key) return f?.hasEqual ? f.value : f?.truthy ?? UNKNOWN
  const v=literal(node)
  if (v!==UNKNOWN) return v
  if (node.type==='UnaryExpression' && node.operator==='!') {
    const value=constrainedPredicate(node.argument,r,facts)
    return value===UNKNOWN ? UNKNOWN : !value
  }
  if (node.type==='BinaryExpression') {
    const field=member(node.left,r.fn,r.file) || member(node.right,r.fn,r.file)
    const fact=facts.get(field), value=literal(member(node.left,r.fn,r.file) ? node.right : node.left)
    if (!fact || value===UNKNOWN) return UNKNOWN
    let eq=UNKNOWN
    if (fact.hasEqual) eq=fact.value===value
    else if (fact.excluded.has(value) || fact.truthy!==undefined && Boolean(value)!==fact.truthy) eq=false
    return eq===UNKNOWN ? UNKNOWN : node.operator==='===' ? eq : !eq
  }
  return UNKNOWN
}
function rejectedBefore(tree,r,facts) {
  if (!tree) return false
  if (!tree.test) return aborted(tree.leaf,r.file)
  const value=constrainedPredicate(tree.test,r,facts)
  if (value!==UNKNOWN) return rejectedBefore(value ? tree.yes : tree.no,r,facts)
  return rejectedBefore(tree.yes,r,facts) && rejectedBefore(tree.no,r,facts)
}

function writes(r) {
  let safe = true
  walk(r.fn.body, n => {
    if (['CallExpression', 'OptionalCallExpression', 'NewExpression', 'AssignmentExpression', 'UpdateExpression', 'AwaitExpression', 'YieldExpression', 'TaggedTemplateExpression'].includes(n.type) ||
      n.type === 'UnaryExpression' && n.operator === 'delete' || isFunction(n)) safe = false
  })
  if (!safe) return []
  const result = []
  function visit(tree, facts=new Map()) {
    if (!tree) {safe = false; return}
    if (tree.test) {
      const p = predicate(tree.test, r.fn, r.file)
      if (p.value !== UNKNOWN) visit(p.value ? tree.yes : tree.no,facts)
      else {
        const yes=constrain(facts,tree.test,true,r), no=constrain(facts,tree.test,false,r)
        if (yes) visit(tree.yes,yes)
        if (no) visit(tree.no,no)
      }
      return
    }
    if (aborted(tree.leaf, r.file)) return
    if (tree.leaf?.type !== 'ObjectExpression') {safe = false; return}
    const values = new Map(), nodes = new Map()
    for (const p of tree.leaf.properties) {
      if (p.type === 'SpreadElement') {
        const arg = unwrap(p.argument)
        if (arg?.type !== 'Identifier' || arg.name !== r.fn.params[0].name || findBinding(r.file, arg.name, arg)?.node !== r.fn) {safe = false; return}
        values.clear(); nodes.clear(); continue
      }
      if (p.type !== 'ObjectProperty' || p.computed || propName(p) == null) {safe = false; return}
      const key = propName(p), v = literal(p.value)
      // Noncomputed __proto__ changes an object literal's prototype, not an own field.
      if (key === '__proto__') continue
      if (v === UNKNOWN) {values.delete(key); nodes.delete(key)}
      else {values.set(key, v); nodes.set(key, p.value)}
    }
    if (values.size) result.push({values, nodes, facts})
  }
  visit(r.tree)
  return safe ? result : []
}
function rejection(tree, r, values) {
  if (!tree?.test) return null
  const p = predicate(tree.test, r.fn, r.file, values)
  if (!p.valid || p.value === UNKNOWN) return null
  const chosen = p.value ? tree.yes : tree.no
  const other = p.value ? tree.no : tree.yes
  // A reducer that always suppresses output has no admission-guard contradiction.
  if (chosen && !chosen.test && aborted(chosen.leaf, r.file) && canOutput(other, r) && guardFields(tree.test, r, values).length) return tree.test
  return rejection(chosen, r, values)
}
function guardFields(node, r, values) {
  const fields = new Set()
  walk(node, n => {const key = member(n, r.fn, r.file); if (key && values.has(key)) fields.add(key)})
  return [...fields]
}
function canOutput(tree, r) {
  if (!tree) return false
  if (tree.test) {
    const p = predicate(tree.test, r.fn, r.file)
    return p.value !== UNKNOWN ? canOutput(p.value ? tree.yes : tree.no, r) : canOutput(tree.yes, r) || canOutput(tree.no, r)
  }
  return ['ObjectExpression', 'ArrayExpression'].includes(tree.leaf?.type) || literal(tree.leaf) !== UNKNOWN && tree.leaf?.type !== 'NullLiteral'
}

// Inspect the literal model ourselves: modelEntries intentionally tolerates spreads/duplicate
// entries, which cannot establish a unique transition for this proof.
function actions(project, comp) {
  if (!componentStaticKnown(project, comp, 'model')) return []
  const m = resolveStableValue(project, comp.file, comp.staticProps.model)
  if (m?.node.type !== 'ObjectExpression') return []
  const groups = new Map()
  for (const p of m.node.properties) {
    if (!['ObjectProperty', 'ObjectMethod'].includes(p.type) || p.computed || propName(p) == null) return []
    const {action, sink} = splitModelKey(propName(p))
    if (!groups.has(action)) groups.set(action, {sinks:new Map(), safe:true})
    const g = groups.get(action)
    const add = (key, value) => {
      if (g.sinks.has(key) || key === 'HOST') g.safe = false
      g.sinks.set(key, value)
    }
    const value = p.type === 'ObjectMethod' ? p : unwrap(p.value)
    if (sink) add(sink, value)
    else if (value?.type === 'ObjectExpression') {
      for (const sp of value.properties) {
        if (!['ObjectProperty', 'ObjectMethod'].includes(sp.type) || sp.computed || propName(sp) == null) {g.safe = false; continue}
        add(propName(sp), sp.type === 'ObjectMethod' ? sp : sp.value)
      }
    } else add('STATE', value)
  }
  return [...groups].filter(([, g]) => g.safe).map(([action, g]) => ({action, sinks:g.sinks, file:m.file}))
}
export default {
  id:'output-guard-rejects-state',
  codes:['SYG256'],
  description:'A same-action STATE write makes an after output guard return ABORT',
  run(project, report) {
    for (const comp of project.components) {
      if (!comp.staticProps.model || comp.staticProps.uses || comp.staticProps.calculated) continue
      const contexts = sinkTimingContexts(project, comp).filter(c => c.mode === 'after')
      if (!contexts.length) continue
      for (const a of actions(project, comp)) {
        const state = reducer(a.sinks.get('STATE'), a.file)
        if (!state) continue
        const transitions = writes(state)
        if (!transitions.length) continue
        for (const [sink, node] of a.sinks) {
          if (['STATE', 'HOST'].includes(sink)) continue
          const output = reducer(node, a.file)
          if (!output) continue
          const found = transitions.filter(t=>!rejectedBefore(output.tree,output,t.facts))
            .map(t => ({...t, guard:rejection(output.tree, output, t.values)})).find(t => t.guard)
          if (!found) continue
          const fields = guardFields(found.guard, output, found.values)
          const ctx = contexts[0]
          report({code:'SYG256', component:comp.name, file:a.file, node:found.guard, anchor:node,
            message:`${a.action}'s ${sink} guard returns ABORT for the state written by STATE under after timing (${ctx.via}${ctx.root?.name ? `: ${ctx.root.name}` : ''})`,
            fix:'Use the fourth argument\'s previousState for admission/loading guards and updated state for payload fields; keep the output guard because STATE returning ABORT does not cancel other sinks',
            related:fields.map(field => ({file:a.file, node:found.nodes.get(field), message:`STATE writes ${field} here`})).concat([
              {file:ctx.file, node:ctx.node, message:`This ${ctx.via} context uses after snapshots`},
            ]),
            data:{action:a.action, sink, fields, timing:'after', context:ctx.via},
          })
        }
      }
    }
  },
}
