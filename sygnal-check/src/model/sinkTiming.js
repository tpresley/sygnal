/** Proven timing contexts for static reducer checks. Unknown means no evidence, never after.
 * Components inherit the app setting, not a parent component's declaration. One proven after
 * entry is enough to diagnose its use, even if another entry runs the same component before.
 */
import {walk, unwrap, propName, memberName, isFunction} from '../ast.js'
import {findBinding} from '../scope.js'
import {resolveExpr} from './resolve.js'
import {renderGraph, viewUsages} from './renderGraph.js'

const ABSENT = Symbol('absent')
const ACCESSOR = Symbol('accessor')
const cache = new WeakMap()
const mutationCache = new WeakMap()
const contractCache = new WeakMap()
const ENTRY = {run:[0,2], renderComponent:[0,1], defineElement:[1,2]}
const sygnal = source => /^sygnal(?:\/|$)/.test(source)

function importedEntry(file, callee) {
  callee=unwrap(callee)
  if (callee?.type==='Identifier') {
    const b=findBinding(file,callee.name,callee)
    return b?.kind==='import' && sygnal(b.source) && ENTRY[b.imported] ? b.imported : null
  }
  if (callee?.type==='MemberExpression' && unwrap(callee.object)?.type==='Identifier') {
    const b=findBinding(file,callee.object.name,callee)
    const name=memberName(callee)
    return b?.kind==='import' && b.imported==='*' && sygnal(b.source) && ENTRY[name] ? name : null
  }
  return null
}

// resolveExpr deliberately tolerates mutable bindings for other analyses. Timing evidence must
// not turn a let initializer or a directly modified const object into a proven configuration.
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

function resolved(project,file,node,{component=false}={}) {
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
    // A component's ordinary static declarations are resolved separately. Only reassignment
    // changes which component the entry starts; options objects also need property mutation checks.
    if (component && target.type==='MemberExpression') continue
    if (component && n.type==='CallExpression') continue
    while (target?.type==='MemberExpression') target=unwrap(target.object)
    const actual=target && resolveExpr(project,f,target)
    if (actual?.node===r.node) mutated=true
  }
  return mutated ? null : r
}

function modeValue(project,file,node) {
  node=unwrap(node)
  if (node?.type==='Identifier' && node.name==='undefined' && !findBinding(file,'undefined',node)) return ABSENT
  const r=resolved(project,file,node)
  return r?.node.type==='StringLiteral' && ['before','after'].includes(r.node.value) ? r.node.value : null
}

function objectMode(project,file,node,seen=new Set()) {
  const r=resolved(project,file,node)
  if (!r || r.node.type!=='ObjectExpression' || seen.has(r.node)) return null
  const next=new Set(seen).add(r.node)
  let mode=ABSENT
  for (const p of r.node.properties) {
    if (p.type==='SpreadElement') {
      const spread=objectMode(project,r.file,p.argument,next)
      if (spread===ACCESSOR) return ACCESSOR
      if (spread!==ABSENT) mode=spread
    } else {
      // run reads other options before copying sinkState. A getter can change the timing
      // contract during that read; later literal keys cannot prove an accessor is harmless.
      if (p.type==='ObjectMethod' && ['get','set'].includes(p.kind)) return ACCESSOR
      const key=propName(p)
      // A prototype can supply an inherited diagnostics getter that changes sinkState.
      if (!p.computed && key==='__proto__') return ACCESSOR
      if (key==='sinkState') mode=p.type==='ObjectProperty' ? modeValue(project,r.file,p.value) : null
      else if (key===null) mode=null // a computed key could be sinkState
    }
  }
  return mode
}

function entryMode(project,file,call,index) {
  // Spread arguments can shift either the component or options positions.
  if (call.arguments.slice(0,index+1).some(n=>n.type==='SpreadElement')) return null
  if (!call.arguments[index]) return 'after'
  const arg=unwrap(call.arguments[index])
  if (arg?.type==='Identifier' && arg.name==='undefined' && !findBinding(file,'undefined',arg)) return 'after'
  const mode=objectMode(project,file,arg)
  return mode===ABSENT ? 'after' : mode===ACCESSOR ? null : mode
}

function contexts(project) {
  if (cache.has(project)) return cache.get(project)
  const byUnit=new Map(), graph=renderGraph(project)
  for (const p of project.scanned) {
    const file=project.files.get(p)
    if (!file?.ast || !(project.sygnalFor(file).major>=7)) continue
    walk(file.ast.program,n=>{
      if (n.type!=='CallExpression') return true
      const via=importedEntry(file,n.callee)
      if (!via) return true
      const [componentIndex,optionsIndex]=ENTRY[via]
      const mode=entryMode(project,file,n,optionsIndex)
      if (!mode) return true
      const ref=resolved(project,file,n.arguments[componentIndex],{component:true})
      if (!ref || !isFunction(ref.node)) return true
      const root=graph.unitOf(ref)
      if (!root) return true
      const context={mode,via,file,node:n,root}
      const seen=new Set(), pending=[root]
      while (pending.length) {
        const unit=pending.pop()
        if (seen.has(unit)) continue
        seen.add(unit)
        if (!byUnit.has(unit)) byUnit.set(unit,[])
        byUnit.get(unit).push(context)
        for (const {usage,widget} of viewUsages(unit.viewInfo)) {
          if (widget || !usage.ref) continue
          const child=graph.unitOf(usage.ref)
          if (child) pending.push(child)
        }
      }
      return true
    })
  }
  cache.set(project,byUnit)
  return byUnit
}

// Index apparent component static writes once per project. Mutation lists themselves are indexed
// once per FileInfo; querying many components never rescans all project ASTs.
export function componentStaticKnown(project,component,prop='sinkState') {
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

/**
 * @returns {Array<{mode:'before'|'after', via:string, file:object, node:object, root:object}>}
 * Explicit component contracts are proven without an app entry. Otherwise only reachable,
 * readable imported run/renderComponent/defineElement calls supply evidence. An unknown or
 * invalid component declaration shadows inheritance and returns no contexts.
 */
export function sinkTimingContexts(project,component) {
  if (!(project.sygnalFor(component.file).major>=7) || !componentStaticKnown(project,component)) return []
  const declaration=component.staticProps?.sinkState
  if (declaration) {
    const mode=modeValue(project,component.file,declaration)
    if (mode!==ABSENT) return mode ? [{mode,via:'component',file:component.file,node:declaration,root:component}] : []
  }
  return contexts(project).get(component) || []
}
