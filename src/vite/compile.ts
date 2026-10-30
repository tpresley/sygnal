/**
 * CV-2: compiled views, tier A (dev-plans/research/compile-wasm/compiled-views-plan.md). Rewrites a
 * module's JSX before the JSX transform: an HTML element (not a form field, custom element or SVG
 * tag) with plain attributes becomes a call to the pragma's `__cv.e(sel, data, children, key)`,
 * its data made by the pragma's own sanitizeData (`__cv.sd`): once at module load (hoisted) when
 * every attribute is static, else per render. Everything else (components, markers, fragments,
 * fields, spreads, refs, ...) is left as JSX for the JSX transform; their children may still
 * compile. The output vnodes are the ones the pragma would make (test/cv-compile.test.js).
 *
 * `parse` is Vite 8's parseAst (ESTree + JSX, UTF-16 offsets). No source map yet (plan Q-2).
 */

// HTML elements the compiler takes. Not here: the form fields (input, textarea, select, option:
// the controlled-input module re-syncs them; the pragma never makes them plain), SVG and MathML
// (the pragma sets the namespace), hyphenated custom elements, and any other lowercase tag (a host
// renderer's own tags go through the pragma, which knows its run-time tag lists)
const HTML = new Set(('a abbr address article aside audio b bdi bdo blockquote br button canvas caption cite code col colgroup ' +
  'data datalist dd del details dfn dialog div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i ' +
  'iframe img ins kbd label legend li main map mark menu meter nav noscript object ol optgroup output p picture pre progress q rp rt ' +
  'ruby s samp search section small source span strong sub summary sup table tbody td template tfoot th thead time tr track u ul var ' +
  'video wbr').split(' '))
// attributes the pragma gives run-time behaviour (hooks) or that change what the element is
const BAIL_ATTR = /^(ref|autoFocus|autoSelect|hook|children|key)$/
// an HTML entity: JSX decodes them, the parser keeps them raw (the pragma path decodes through the JSX transform)
const ENTITY = /&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i

type Sub = [number, number, string]

export function compileViews(code: string, id: string, parse: (code: string, opts: any) => any): string | null {
  if (!/<[a-z]/.test(code)) return null
  let ast: any
  try { ast = parse(code, {lang: /\.tsx$/.test(id) ? 'tsx' : /\.ts$/.test(id) ? 'ts' : 'jsx'}) } catch { return null }
  const hoisted: string[] = []
  let compiled = 0

  const src = (s: number, e: number, subs: Sub[]): string => {
    let out = '', at = s
    for (const [a, b, t] of subs.sort((x, y) => x[0] - y[0])) { out += code.slice(at, a) + t; at = b }
    return out + code.slice(at, e)
  }
  // every maximal JSX node under `node`, rewritten (a JSX node in expression position)
  const subsIn = (node: any, subs: Sub[] = []): Sub[] => {
    if (!node || typeof node != 'object') return subs
    if (node.type == 'JSXElement' || node.type == 'JSXFragment') { subs.push([node.start, node.end, jsx(node)]); return subs }
    for (const k in node) {
      if (k == 'start' || k == 'end' || k == 'loc' || k == 'range') continue
      const v = node[k]
      if (Array.isArray(v)) for (const c of v) subsIn(c, subs)
      else if (v && typeof v == 'object' && typeof v.type == 'string') subsIn(v, subs)
    }
    return subs
  }
  const expr = (e: any): string => src(e.start, e.end, subsIn(e))

  const tag = (el: any): string | null => el.openingElement.name.type == 'JSXIdentifier' ? el.openingElement.name.name : null
  const compilable = (el: any): boolean => {
    const t = tag(el)
    if (!t || !HTML.has(t)) return false
    for (const a of el.openingElement.attributes) {
      if (a.type != 'JSXAttribute' || a.name.type != 'JSXIdentifier') return false
      if (BAIL_ATTR.test(a.name.name) && a.name.name != 'key') return false
      const v = a.value
      if (v && v.type == 'Literal' && ENTITY.test(String(v.value))) return false
      if (v && v.type != 'Literal' && !(v.type == 'JSXExpressionContainer' && v.expression.type != 'JSXEmptyExpression')) return false
    }
    for (const c of el.children) if (c.type == 'JSXText' && ENTITY.test(c.value)) return false
    return true
  }

  // a JSX node in expression position: compiled, or JSX whose children may compile
  const jsx = (node: any): string => node.type == 'JSXElement' && compilable(node) ? element(node) : jsxSource(node)
  const jsxSource = (node: any): string => {
    const subs: Sub[] = []
    const open = node.openingElement
    if (open) for (const a of open.attributes) {
      const v = a.type == 'JSXSpreadAttribute' ? a.argument : a.value?.type == 'JSXExpressionContainer' ? a.value.expression : null
      if (v) subsIn(v, subs)
    }
    for (const c of node.children) {
      if (c.type == 'JSXElement') subs.push([c.start, c.end, compilable(c) ? '{' + element(c) + '}' : jsxSource(c)])
      else if (c.type == 'JSXFragment') subs.push([c.start, c.end, jsxSource(c)])
      else if (c.type == 'JSXExpressionContainer') subsIn(c.expression, subs)
    }
    return src(node.start, node.end, subs)
  }

  const element = (el: any): string => {
    compiled++
    let key = 'undefined', dynamic = false
    const names: string[] = [], vals: string[] = []
    for (const a of el.openingElement.attributes) {
      const name = a.name.name, v = a.value
      const val = !v ? 'true' : v.type == 'Literal' ? JSON.stringify(v.value) : (dynamic = name != 'key' || dynamic, '(' + expr(v.expression) + ')')
      if (name == 'key') key = val
      // a duplicate keeps its first place and takes the last value, as in an object literal
      else { const i = names.indexOf(name); if (i >= 0) vals[i] = val; else names.push(name), vals.push(val) }
    }
    // static: made once at load by the pragma's sanitizeData; dynamic: the keys routed once at
    // load by the pragma's route(), the data made per render from the values (__cv.d)
    let data: string
    if (!dynamic) data = hoist('__cv.sd({' + names.map((n, i) => JSON.stringify(n) + ': ' + vals[i]).join(', ') + '})')
    else data = `__cv.d(${hoist('__cv.r(' + JSON.stringify(names) + ')')}, [${vals.join(', ')}])`
    const kids = children(el.children)
    const c = kids.length == 0 ? 'undefined' : kids.length == 1 ? kids[0] : '[' + kids.join(', ') + ']'
    return `__cv.e(${JSON.stringify(tag(el))}, ${data}, ${c}${key == 'undefined' ? '' : ', ' + key})`
  }
  const hoist = (obj: string): string => {
    const i = hoisted.indexOf(obj)
    if (i >= 0) return '$cv' + i
    hoisted.push(obj)
    return '$cv' + (hoisted.length - 1)
  }
  // the children as the JSX transform passes them: JSX text cleaned as the JSX spec does (lines
  // trimmed, empty lines dropped, joined by a space), empty expressions dropped
  const children = (list: any[]): string[] => {
    const out: string[] = []
    for (const c of list) {
      if (c.type == 'JSXText') { const t = cleanText(c.value); if (t) out.push(JSON.stringify(t)) }
      else if (c.type == 'JSXExpressionContainer') { if (c.expression.type != 'JSXEmptyExpression') out.push('(' + expr(c.expression) + ')') }
      else if (c.type == 'JSXSpreadChild') out.push('...(' + expr(c.expression) + ')')
      else out.push(jsx(c))
    }
    return out
  }

  const subs = subsIn(ast)
  if (!compiled) return null
  const head = `import { __cv } from 'sygnal';\n` + hoisted.map((h, i) => `const $cv${i} = ${h};\n`).join('')
  return head + src(0, code.length, subs)
}

// JSX text as oxc's JSX transform cleans it (the transform the plugin configures): split on line
// breaks, trim spaces and tabs at each line's edges (not the first line's start nor the last's
// end), drop empty lines, join with ' '; tabs inside a line stay (Babel would make them spaces)
function cleanText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/)
  let last = 0
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) last = i
  let str = ''
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (i !== 0) line = line.replace(/^[ \t]+/, '')
    if (i !== lines.length - 1) line = line.replace(/[ \t]+$/, '')
    if (line) { if (i !== last) line += ' '; str += line }
  }
  return str
}
