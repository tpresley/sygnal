/** Reducer snapshot timing for static checks, and stable-value helpers for the proofs that use it.
 * Sygnal 7 has one contract: STATE runs first and every other sink gets the committed state, so
 * an installed 7+ means 'after' for every component. 6.x means 'before'. An unknown installed
 * version is no evidence: callers stay silent.
 */
import {walk, unwrap, memberName, isFunction} from '../ast.js'
import {findBinding} from '../scope.js'
import {resolveExpr} from './resolve.js'

const mutationCache = new WeakMap()
const contractCache = new WeakMap()

// resolveExpr deliberately tolerates mutable bindings for other analyses. A proof must not
// turn a let initializer or a directly modified const object into a known value.
function mutationTarget(node) {
  if (['AssignmentExpression','UpdateExpression'].includes(node.type)) return node.left || node.argument
  if (node.type==='UnaryExpression' && node.operator==='delete') return node.argument
  const callee=unwrap(node.callee)
  if (node.type==='CallExpression' && callee?.type==='MemberExpression' &&
      unwrap(callee.object)?.type==='Identifier' && callee.object.name==='Object' &&
      ['assign','defineProperty','defineProperties'].includes(memberName(callee))) return node.arguments[0]
  return null
}

function mutations(file) {
  if (!mutationCache.has(file)) {
    const found=[]
    walk(file.ast.program,n=>{
      if (mutationTarget(n)) found.push(n)
      return true
    })
    mutationCache.set(file,found)
  }
  return mutationCache.get(file)
}

function resolved(project,file,node) {
  node=unwrap(node)
  if (!node) return null
  const aliases=new Set()
  let alias=node
  while (alias?.type==='Identifier' && !aliases.has(alias)) {
    aliases.add(alias)
    const b=findBinding(file,alias.name,alias)
    if (b?.kind!=='var') break
    if (b.declKind!=='const') return null
    alias=unwrap(b.init)
  }
  const r=resolveExpr(project,file,node)
  if (!r) return null
  const decl=r.file.parents.get(r.node)
  if (decl?.type==='VariableDeclarator' && r.file.parents.get(decl)?.kind!=='const') return null
  let mutated=false
  for (const f of new Set([file,r.file])) for (const n of mutations(f)) {
    let target=unwrap(mutationTarget(n))
    while (target?.type==='MemberExpression') target=unwrap(target.object)
    const actual=target && resolveExpr(project,f,target)
    if (actual?.node===r.node) mutated=true
  }
  return mutated ? null : r
}

// Index apparent component static writes once per project. Mutation lists themselves are indexed
// once per FileInfo; querying many components never rescans all project ASTs.
export function componentStaticKnown(project,component,prop) {
  if (!contractCache.has(project)) {
    const writes=new Map(), results=new WeakMap()
    for (const p of project.scanned) {
      const file=project.files.get(p)
      if (!file?.ast) continue
      for (const n of mutations(file)) {
        let target=unwrap(mutationTarget(n))
        const members=[]
        while (target?.type==='MemberExpression') {
          members.unshift(memberName(target))
          target=unwrap(target.object)
        }
        const fn=target && resolveExpr(project,file,target)?.node
        if (!fn || !isFunction(fn)) continue
        if (!writes.has(fn)) writes.set(fn,[])
        writes.get(fn).push({file,node:n,members})
      }
    }
    contractCache.set(project,{writes,results})
  }
  const {writes,results}=contractCache.get(project)
  if (!results.has(component)) results.set(component,new Map())
  const known=results.get(component)
  if (!known.has(prop)) known.set(prop,(writes.get(component.view) || [])
    .filter(({members})=>!members[0] || members[0]===prop)
    .every(({file,node,members})=>members.length===1 && members[0]===prop &&
      node.type==='AssignmentExpression' && node.operator==='=' &&
      node.right===component.staticProps?.[prop] &&
      file.parents.get(node)?.type==='ExpressionStatement' &&
      file.parents.get(file.parents.get(node))?.type==='Program'))
  return known.get(prop)
}

/** Resolve a constant expression without apparent variable/object mutations. This is deliberately
 * internal checker analysis, not evaluation: a component's C.model member writes need the caller's
 * component-aware checks because general resolveExpr does not resolve arbitrary object members.
 */
export function resolveStableValue(project,file,node) {
  return resolved(project,file,node)
}

/** The snapshot every non-STATE sink of this file's components gets: 'after' on an installed
 * Sygnal 7 or later, 'before' on 6.x, null when the installed version is unknown.
 * @returns {'after'|'before'|null}
 */
export function sinkTiming(project,file) {
  return project.sygnalFor(file).timing
}
