/**
 * PLAN-9 X-2: `defineCatalog({...})` declarations (sygnal/ai), read statically.
 *
 * findCatalogs(project) → [CatalogDecl] for every `defineCatalog(arg)` call in a scanned file whose
 * callee is imported from 'sygnal' / 'sygnal/ai' and whose argument is an object literal, or an
 * identifier bound to one in the same module. Nested objects (`parts`, a part, `params`, ...) may
 * also be identifiers bound to object literals in that module.
 *
 *   CatalogDecl { file, call, node (the declaration object), obj: Obj, parts: Map<id, Entry> | null,
 *                 containers: Map<id, Entry | false> | null, partsOpen, containersOpen }
 *   Obj   { node, open (a spread or a computed key: keys may be missing), props: Map<key, ObjectProperty> }
 *   Entry { id, keyNode, obj: Obj | null (not a literal), params: Map<name, { keyNode, obj }> | null }
 *
 * `partsOpen` / `containersOpen`: the map may miss entries (a spread, a computed key, not a
 * literal), so "unknown id" checks are skipped.
 */
import { walk, unwrap, propName } from '../ast.js'
import { findBinding } from '../scope.js'

/** the object literal an expression is, following a same-module `const` binding; null otherwise */
export function literalObject(file, node, depth = 0) {
  const n = unwrap(node)
  if (!n || depth > 4) return null
  if (n.type === 'ObjectExpression') return n
  if (n.type === 'Identifier') {
    const b = findBinding(file, n.name, n)
    if (b?.kind === 'var' && b.declKind === 'const' && b.init) return literalObject(file, b.init, depth + 1)
  }
  return null
}

/** Obj for an object literal */
export function objOf(node) {
  const props = new Map()
  let open = false
  for (const p of node.properties) {
    if (p.type === 'SpreadElement') { open = true; continue }
    const k = propName(p)
    if (k == null) { open = true; continue }
    props.set(k, p)
  }
  return { node, open, props }
}

/** a string literal's value (or a template without expressions); undefined otherwise */
export function literalString(node) {
  const n = unwrap(node)
  if (!n) return undefined
  if (n.type === 'StringLiteral') return n.value
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked
  return undefined
}

/** a literal value: string, number, boolean, null; undefined for anything else */
export function literalValue(node) {
  const n = unwrap(node)
  if (!n) return undefined
  if (n.type === 'NumericLiteral') return n.value
  if (n.type === 'BooleanLiteral') return n.value
  if (n.type === 'NullLiteral') return null
  if (n.type === 'UnaryExpression' && n.operator === '-' && unwrap(n.argument)?.type === 'NumericLiteral') return -unwrap(n.argument).value
  return literalString(n)
}

const isSygnal = (src) => /^sygnal(\/ai)?$/.test(src)

function isDefineCatalog(file, callee) {
  const c = unwrap(callee)
  if (c?.type !== 'Identifier') return false
  const b = findBinding(file, c.name, c)
  return b?.kind === 'import' && b.imported === 'defineCatalog' && isSygnal(b.source)
}

function entries(file, node, withParams) {
  const o = literalObject(file, node)
  if (!o) return { map: null, open: true, obj: null }
  const obj = objOf(o)
  const map = new Map()
  for (const [id, prop] of obj.props) {
    if (prop.type !== 'ObjectProperty') { map.set(id, { id, keyNode: prop.key, obj: null, params: null }); continue }
    const v = unwrap(prop.value)
    if (v?.type === 'BooleanLiteral' && v.value === false) { map.set(id, false); continue }
    const eo = literalObject(file, v)
    const e = { id, keyNode: prop.key, prop, obj: eo ? objOf(eo) : null, params: null }
    if (withParams && e.obj?.props.has('params')) {
      const po = literalObject(file, e.obj.props.get('params').value)
      if (po) {
        const pobj = objOf(po)
        e.params = new Map()
        e.paramsOpen = pobj.open
        for (const [name, pp] of pobj.props) {
          const vo = pp.type === 'ObjectProperty' ? literalObject(file, pp.value) : null
          e.params.set(name, { name, keyNode: pp.key, obj: vo ? objOf(vo) : null })
        }
      }
    }
    map.set(id, e)
  }
  return { map, open: obj.open, obj }
}

export function findCatalogs(project) {
  const out = []
  for (const p of project.scanned) {
    const file = project.files.get(p)
    if (!file || !file.source.includes('defineCatalog')) continue
    walk(file.ast.program, (n) => {
      if (n.type !== 'CallExpression' || !isDefineCatalog(file, n.callee)) return true
      const declNode = literalObject(file, n.arguments[0])
      if (!declNode) return true
      const obj = objOf(declNode)
      const parts = obj.props.has('parts') ? entries(file, obj.props.get('parts').value, true) : { map: new Map(), open: obj.open }
      const containers = obj.props.has('containers') ? entries(file, obj.props.get('containers').value, true) : { map: new Map(), open: obj.open }
      out.push({
        file, call: n, node: declNode, obj,
        parts: parts.map, partsOpen: parts.open || !parts.map,
        containers: containers.map, containersOpen: containers.open || !containers.map,
      })
      return true
    })
  }
  return out
}
