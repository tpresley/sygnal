import { parse } from '@babel/parser'
import _t from '@babel/traverse'; import fs from 'fs'; import path from 'path'
const traverse = _t.default?.default ?? _t.default ?? _t
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules','dist','__hidden__','vendor'].includes(e.name)) continue; const p = path.join(d, e.name); e.isDirectory() ? walk(p, o) : o.push(p) } return o }
const T = '/private/tmp/sygnal-evals/trials/p4-final2'
let pairs = 0, same = 0, contains = 0, perAction = {}, samples = []
for (const d of fs.readdirSync(T).filter(d => d.startsWith('sygnal-'))) {
  const src = path.join(T, d, 'src'); if (!fs.existsSync(src)) continue
  for (const f of walk(src).filter(f => /\.(jsx|tsx)$/.test(f) && !/\.test\./.test(f))) {
    let ast; try { ast = parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx', 'typescript'] }) } catch { continue }
    traverse(ast, { ObjectProperty(p) {
      const k = p.node.key.name || p.node.key.value; if (!k || !/^[A-Z_]+$/.test(k)) return
      let n = p.node.value; while (n && n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !(n.callee.object.type === 'Identifier' && n.callee.object.name === 'DOM')) n = n.callee.object
      if (!n || n.type !== 'CallExpression' || n.callee.object?.name !== 'DOM') return
      const a = n.arguments[0]; if (!a || a.type !== 'StringLiteral') return
      const m = a.value.match(/^\.([\w-]+)/); if (!m) return
      const norm = s => s.toLowerCase().replace(/[-_]/g, '')
      const A = norm(k), C = norm(m[1]); pairs++
      if (A === C) same++; else if (A.includes(C) || C.includes(A)) contains++
      else if (samples.length < 25) samples.push(`${k} ← .${m[1]}`)
    } })
  }
}
console.log({ pairs, same, contains, related: ((same + contains) / pairs * 100).toFixed(0) + '%' })
console.log('unrelated samples:', samples.join(' | '))
