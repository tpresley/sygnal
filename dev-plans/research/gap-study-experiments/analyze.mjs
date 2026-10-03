import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import fs from 'fs'; import path from 'path'
const traverse = _traverse.default?.default ?? _traverse.default ?? _traverse
const FORM = new Set(['button','input','select','textarea','form','fieldset','output','a'])
function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__hidden__' || e.name === 'vendor') continue
  const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p) } return out }
function analyze(roots, label) {
  const st = { files: 0, sels: 0, simpleClass: 0, tag: 0, attr: 0, complex: 0, doc: 0, unresolved: 0, byTag: {}, styled: 0, classUsesBoth: 0, data: 0, compSels: {} }
  for (const root of roots) {
    const files = walk(root)
    const css = files.filter(f => f.endsWith('.css')).map(f => fs.readFileSync(f, 'utf8')).join('\n')
    for (const f of files.filter(f => /\.(jsx|tsx)$/.test(f) && !/\.test\./.test(f))) {
      let ast; try { ast = parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx', 'typescript'] }) } catch { continue }
      st.files++
      const classTags = {}; const sels = []
      traverse(ast, {
        JSXOpeningElement(p) {
          const tag = p.node.name.name; if (!tag) return
          for (const a of p.node.attributes) {
            if (a.type !== 'JSXAttribute' || !['className', 'class'].includes(a.name.name)) continue
            let s = a.value?.type === 'StringLiteral' ? a.value.value : a.value?.expression?.type === 'TemplateLiteral' ? a.value.expression.quasis.map(q => q.value.cooked).join(' ') : a.value?.expression?.type === 'StringLiteral' ? a.value.expression.value : ''
            for (const c of s.split(/\s+/).filter(Boolean)) (classTags[c] ||= new Set()).add(tag)
          }
        },
        CallExpression(p) {
          const c = p.node.callee
          if (c.type !== 'MemberExpression' || c.object.type !== 'Identifier' || c.object.name !== 'DOM') return
          const arg = p.node.arguments[0]; if (!arg || arg.type !== 'StringLiteral') return
          sels.push(arg.value)
          const parent = p.parentPath.node
          // look for .data( in chain
          let q = p.parentPath; let s = ''
          while (q && q.node.type === 'MemberExpression') { s += '.' + q.node.property.name; q = q.parentPath.parentPath }
          if (s.includes('.data')) st.data++
        },
      })
      for (const sel of sels) {
        st.sels++
        if (sel === 'document' || sel === 'body') { st.doc++; continue }
        const m = sel.match(/^\.([\w-]+)$/)
        if (m) {
          st.simpleClass++
          const tags = classTags[m[1]]
          if (!tags) { st.unresolved++; continue }
          for (const t of tags) st.byTag[t] = (st.byTag[t] || 0) + 1
          if (new RegExp('\\.' + m[1] + '(?![\\w-])').test(css)) st.styled++
        } else if (/^[a-z]+$/.test(sel)) st.tag++
        else if (/^[\w.-]*\[[^\]]+\]$/.test(sel)) st.attr++
        else st.complex++
      }
    }
  }
  const formish = Object.entries(st.byTag).filter(([t]) => FORM.has(t)).reduce((a, [, n]) => a + n, 0)
  const total = Object.values(st.byTag).reduce((a, n) => a + n, 0)
  console.log(`\n== ${label}: ${st.files} files, ${st.sels} DOM selectors`)
  console.log(`simple .class ${st.simpleClass} | tag ${st.tag} | [attr] ${st.attr} | complex ${st.complex} | document/body ${st.doc} | unresolved class ${st.unresolved} | chains using .data(): ${st.data}`)
  console.log(`resolved class targets by tag:`, JSON.stringify(Object.fromEntries(Object.entries(st.byTag).sort((a, b) => b[1] - a[1]))))
  console.log(`form-associated (button/input/select/textarea/form/fieldset/a): ${formish}/${total} = ${(100 * formish / total).toFixed(0)}%`)
  console.log(`intent classes also used in CSS: ${st.styled}/${st.simpleClass - st.unresolved}`)
}
const T = '/private/tmp/sygnal-evals/trials/p4-final2'
analyze(fs.readdirSync(T).filter(d => d.startsWith('sygnal-')).map(d => path.join(T, d, 'src')).filter(fs.existsSync), 'agent solutions p4-final2 (Opus)')
const H = '/private/tmp/sygnal-evals/trials/p4-haiku2'
if (fs.existsSync(H)) analyze(fs.readdirSync(H).filter(d => d.startsWith('sygnal-')).map(d => path.join(H, d, 'src')).filter(fs.existsSync), 'agent solutions p4-haiku2 (Haiku)')
const E = '/Users/troy/Documents/Displera/sygnal/.claude/worktrees/sygnal-feature-gaps-c61a02/examples'
analyze(fs.readdirSync(E).map(d => path.join(E, d)), 'repo examples')
