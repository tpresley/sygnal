// How much of real Sygnal JSX a block compiler (tier B) could take: parses the example apps'
// views and classifies every JSX element.
//   block   an intrinsic element whose whole subtree is intrinsic, with no form field (input,
//           textarea, select, custom element: the controlled-input module re-syncs them), no
//           ref / autoFocus / hook / spread props, and children that are text, other block
//           elements or expression holes. An expression child that is (or may be) vnodes (JSX
//           inside, .map(), a call, a children/slot prop) is a "slot" hole: a block with a slot
//           is still a block in Million's sense, but is counted apart (needs a nested diff there).
//   other   a component, marker (Collection, Switchable, Portal, ...), form field or an element
//           with a ref / spread: stays a vnode
// Reports elements in blocks and block roots (the outermost block elements), per example.
//   node dev-plans/research/compile-wasm/survey/blockable.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '../../../..')
const { parse } = createRequire(path.join(repo, 'sygnal-check/package.json'))('@babel/parser')
const FIELD = /^(input|textarea|select|option)$|-/
const BAD_ATTR = /^(ref|autoFocus|autoSelect|hook|innerHTML)$/

const files = []
const walkDir = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name === 'node_modules' || f.name === 'dist') continue; const p = path.join(d, f.name); if (f.isDirectory()) walkDir(p); else if (/\.(jsx|tsx)$/.test(f.name) && !/\.test\./.test(f.name)) files.push(p) } }
walkDir(path.join(repo, 'examples'))

const tagName = (n) => n.type === 'JSXIdentifier' ? n.name : n.type === 'JSXMemberExpression' ? tagName(n.object) + '.' + n.property.name : 'ns'
const hasJSX = (node) => { let f = false; const v = (x) => { if (!x || typeof x !== 'object' || f) return; if (x.type === 'JSXElement' || x.type === 'JSXFragment') { f = true; return } for (const k in x) if (k !== 'loc' && k !== 'start' && k !== 'end') { const c = x[k]; Array.isArray(c) ? c.forEach(v) : c && typeof c === 'object' && c.type && v(c) } }; v(node); return f }
// an expression child: 'text' (a hole written as text), 'slot' (may be vnodes)
const holeKind = (e) => {
  if (hasJSX(e)) return 'slot'
  if (e.type === 'CallExpression' || e.type === 'OptionalCallExpression') return 'slot'
  if ((e.type === 'MemberExpression' || e.type === 'Identifier') && /children|slot/i.test(e.type === 'Identifier' ? e.name : e.property?.name || '')) return 'slot'
  return 'text'
}
const totals = { elements: 0, inBlock: 0, inBlockNoSlot: 0, roots: 0, rootsNoSlot: 0 }
const per = []
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  let ast
  try { ast = parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] }) } catch { continue }
  const t = { elements: 0, inBlock: 0, inBlockNoSlot: 0, roots: 0, rootsNoSlot: 0 }
  // returns {ok, slot, n}: whether the element's subtree is a block, has a slot hole, its element count
  const classify = (el) => {
    const name = tagName(el.openingElement.name)
    const intrinsic = /^[a-z]/.test(name) && !/^(collection|switchable|portal|slot|transition|suspense)$/.test(name) && !FIELD.test(name)
    let ok = intrinsic, slot = false, n = 1
    for (const a of el.openingElement.attributes) if (a.type === 'JSXSpreadAttribute' || BAD_ATTR.test(a.name?.name)) ok = false
    const kids = []
    for (const c of el.children) {
      if (c.type === 'JSXElement') { const r = classify(c); kids.push(r); n += r.n; if (!r.ok) ok = false; if (r.slot) slot = true }
      else if (c.type === 'JSXFragment') ok = false
      else if (c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression') {
        if (holeKind(c.expression) === 'slot') { slot = true; walkExpr(c.expression) }
      }
    }
    el._r = { ok, slot, n, kids }
    return el._r
  }
  // JSX inside an expression hole (a .map() body, a conditional) is its own tree
  const walkExpr = (x) => { if (!x || typeof x !== 'object') return; if (x.type === 'JSXElement') { top(x); return } if (x.type === 'JSXFragment') { x.children.forEach(c => c.type === 'JSXElement' ? top(c) : c.type === 'JSXExpressionContainer' && walkExpr(c.expression)); return } for (const k in x) if (k !== 'loc') { const c = x[k]; Array.isArray(c) ? c.forEach(walkExpr) : c && typeof c === 'object' && c.type && walkExpr(c) } }
  const count = (el, inBlock, blockHasSlot) => {
    const r = el._r
    t.elements++
    if (!inBlock && r.ok) { t.roots++; if (!r.slot) t.rootsNoSlot++; inBlock = true; blockHasSlot = r.slot }
    if (inBlock) { t.inBlock++; if (!blockHasSlot) t.inBlockNoSlot++ }
    for (const c of el.children) if (c.type === 'JSXElement') count(c, inBlock, blockHasSlot)
  }
  const top = (el) => { classify(el); count(el, false, false) }
  const visit = (x) => { if (!x || typeof x !== 'object') return; if (x.type === 'JSXElement') return top(x); if (x.type === 'JSXFragment') return x.children.forEach(c => c.type === 'JSXElement' ? top(c) : c.type === 'JSXExpressionContainer' && walkExpr(c.expression)); for (const k in x) if (k !== 'loc') { const c = x[k]; Array.isArray(c) ? c.forEach(visit) : c && typeof c === 'object' && c.type && visit(c) } }
  visit(ast.program)
  for (const k in totals) totals[k] += t[k]
  per.push([path.relative(repo, file), t])
}
const ex = new Map()
for (const [f, t] of per) { const k = f.split('/')[1]; const e = ex.get(k) || { elements: 0, inBlock: 0, inBlockNoSlot: 0, roots: 0, rootsNoSlot: 0 }; for (const j in t) e[j] += t[j]; ex.set(k, e) }
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '-'
console.log('example'.padEnd(26) + 'JSX elements'.padStart(13) + 'in blocks'.padStart(11) + ' (no slot)'.padStart(11) + 'block roots'.padStart(13))
for (const [k, e] of [...ex].sort()) console.log(k.padEnd(26) + String(e.elements).padStart(13) + pct(e.inBlock, e.elements).padStart(11) + pct(e.inBlockNoSlot, e.elements).padStart(11) + String(e.roots).padStart(13))
console.log('all'.padEnd(26) + String(totals.elements).padStart(13) + pct(totals.inBlock, totals.elements).padStart(11) + pct(totals.inBlockNoSlot, totals.elements).padStart(11) + String(totals.roots).padStart(13))
console.log(`\n${files.length} files; mean elements per block root ${(totals.inBlock / totals.roots).toFixed(1)}`)
