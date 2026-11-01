/**
 * CV-2: compiled views, tier A (dev-plans/research/compile-wasm/compiled-views-plan.md). Rewrites a
 * module's JSX before the JSX transform: an HTML element (not a form field, custom element or SVG
 * tag) with plain attributes becomes a call to the pragma's `__cv.e(sel, data, children, key)`,
 * its data made by the pragma's own sanitizeData (`__cv.sd`): once at module load (hoisted) when
 * every attribute is static, else per render. Everything else (components, markers, fragments,
 * fields, spreads, refs, ...) is left as JSX for the JSX transform; their children may still
 * compile. The output vnodes are the ones the pragma would make (test/cv-compile.test.js).
 *
 * CV-1 (`ssr`, server builds): the outermost compiled element stays a vnode (`__cvs.r`: the
 * root's `data-sygnal-ssr` stamp and the SSR walk need one) whose inside is HTML parts made by
 * ssr.ts (`__cvs.f`, `__cvs.s`): open tags and static subtrees serialized by its own vnodeToHtml
 * (cached per escaping mode), text escaped by its escapeHtml, anything not compiled (components,
 * markers, fields, ...) kept as a vnode at the child path the JSX runtime's tree would give it.
 * The HTML is renderToString's (test/cv-ssr.test.js).
 *
 * `parse` is Vite 8's parseAst (ESTree + JSX, UTF-16 offsets). The source map maps each rewritten
 * JSX expression to its start (magic-string).
 */
// the named export: magic-string's CJS build has no plain default for the plugin's CJS output
import { MagicString } from 'magic-string'

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
// in server builds also: the SSR serializer gives these their own content
const SSR_BAIL_ATTR = /^(innerHTML|textContent)$/
// an HTML entity: JSX decodes them, the parser keeps them raw (the pragma path decodes through the JSX transform)
const ENTITY = /&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i

type Sub = [number, number, string]

export function compileViews(code: string, id: string, parse: (code: string, opts: any) => any, opts: {ssr?: boolean; blocks?: boolean} = {}): {code: string; map: any} | null {
  const ssr = !!opts.ssr, blocks = !ssr && !!opts.blocks
  let nblocks = 0
  if (!/<[a-z]/.test(code)) return null
  let ast: any
  try { ast = parse(code, {lang: /\.tsx$/.test(id) ? 'tsx' : /\.ts$/.test(id) ? 'ts' : 'jsx'}) } catch { return null }
  const hoisted: string[] = []
  let compiled = 0
  // CV-3: the JSX a component (a capitalized function) returns directly: its view's root
  const roots = new Set<any>()
  if (blocks) {
    const un = (n: any): any => n?.type == 'ParenthesizedExpression' ? un(n.expression) : n
    const fnRoots = (f: any): void => {
      if (!f) return
      if (f.expression) { roots.add(un(f.body)); return }
      for (const st of f.body?.body || []) if (st.type == 'ReturnStatement') roots.add(un(st.argument))
    }
    const scan = (n: any): void => {
      if (!n || typeof n != 'object') return
      if (n.type == 'FunctionDeclaration' && /^[A-Z]/.test(n.id?.name || '')) fnRoots(n)
      if (n.type == 'VariableDeclarator' && /^[A-Z]/.test(n.id?.name || '') && /Function/.test(n.init?.type || '')) fnRoots(n.init)
      for (const k in n) { if (k == 'start' || k == 'end' || k == 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v == 'object' && typeof v.type == 'string') scan(v) }
    }
    scan(ast)
  }

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
      if (BAIL_ATTR.test(a.name.name) && a.name.name != 'key' || ssr && SSR_BAIL_ATTR.test(a.name.name)) return false
      const v = a.value
      if (v && v.type == 'Literal' && ENTITY.test(String(v.value))) return false
      if (v && v.type != 'Literal' && !(v.type == 'JSXExpressionContainer' && v.expression.type != 'JSXEmptyExpression')) return false
    }
    for (const c of el.children) if (c.type == 'JSXText' && ENTITY.test(c.value) || c.type == 'JSXSpreadChild') return false
    return true
  }
  // no expression anywhere below (attributes, children): its HTML never changes (CV-1)
  const isStatic = (el: any): boolean => compilable(el)
    && el.openingElement.attributes.every((a: any) => !a.value || a.value.type == 'Literal')
    && el.children.every((c: any) => c.type == 'JSXText' || c.type == 'JSXElement' && isStatic(c))

  // a JSX node in expression position: compiled, or JSX whose children may compile
  // (`vnodes`: inside a static SSR subtree's vnode factory, every element is a client one)
  let vnodes = 0
  const jsx = (node: any): string => node.type == 'JSXElement' && compilable(node)
    ? (ssr && !vnodes ? ssrRoot(node) : blocks && !vnodes && roots.has(node) && blockable(node) ? block(node) : element(node)) : jsxSource(node)
  const jsxSource = (node: any): string => {
    const subs: Sub[] = []
    const open = node.openingElement
    if (open) for (const a of open.attributes) {
      const v = a.type == 'JSXSpreadAttribute' ? a.argument : a.value?.type == 'JSXExpressionContainer' ? a.value.expression : null
      if (v) subsIn(v, subs)
    }
    for (const c of node.children) {
      if (c.type == 'JSXElement') subs.push([c.start, c.end, compilable(c) ? '{' + jsx(c) + '}' : jsxSource(c)])
      else if (c.type == 'JSXFragment') subs.push([c.start, c.end, jsxSource(c)])
      else if (c.type == 'JSXExpressionContainer') subsIn(c.expression, subs)
    }
    return src(node.start, node.end, subs)
  }

  // the element's data expression and key (a static one hoisted; see __cv in src/pragma/index.ts)
  const dataOf = (el: any): [string, string, boolean] => {
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
    const data = !dynamic ? hoist('__cv.sd({' + names.map((n, i) => JSON.stringify(n) + ': ' + vals[i]).join(', ') + '})')
      : `__cv.d(${hoist('__cv.r(' + JSON.stringify(names) + ')')}, [${vals.join(', ')}])`
    return [data, key, dynamic]
  }
  const childArg = (kids: string[]): string => kids.length == 0 ? 'undefined' : kids.length == 1 ? kids[0] : '[' + kids.join(', ') + ']'
  const element = (el: any): string => {
    compiled++
    const [data, key] = dataOf(el)
    const c = childArg(children(el.children, false))
    return `__cv.e(${JSON.stringify(tag(el))}, ${data}, ${c}${key == 'undefined' ? '' : ', ' + key})`
  }
  // CV-1: the outermost compiled element in server code: a vnode with HTML parts inside
  const ssrRoot = (el: any): string => {
    compiled++
    const [data, key] = dataOf(el)
    return `__cvs.r(${JSON.stringify(tag(el))}, ${data}, ${childArg(children(el.children, true))}${key == 'undefined' ? '' : ', ' + key})`
  }
  // CV-1: a compiled element inside one: a static one's HTML made once (per escaping mode), else
  // its open tag (static: once) and its children's parts
  const ssrInner = (el: any): string => {
    compiled++
    if (isStatic(el)) { vnodes++; const v = element(el); vnodes--; return `__cvs.s(${hoist('__cvs.S(() => ' + v + ')')})` }
    const [data, , dynamic] = dataOf(el), t = JSON.stringify(tag(el))
    const open = dynamic ? `__cvs.od(${t}, ${data})` : hoist(`__cvs.O(${t}, ${data})`)
    return `__cvs.f(${open}, ${childArg(children(el.children, true))})`
  }
  // CV-1: JSX in a direct value position of a compiled element's child expression (the expression,
  // a ?: branch, either side of && || ??, an array element, a .map() arrow's expression body) can
  // only become that element's child, so a compilable one is an HTML chunk; anything else (JSX in a
  // variable, a call's argument, a component prop) stays a vnode
  // (client builds with blocks: a .map() row there is a block, `row`: inside a .map() body)
  const direct = (n: any, subs: Sub[], row = false): void => {
    if (!n) return
    const t = n.type
    if (t == 'JSXElement' && compilable(n)) subs.push([n.start, n.end, ssr ? ssrInner(n) : row && blockable(n) ? block(n) : jsx(n)])
    else if (t == 'ParenthesizedExpression') direct(n.expression, subs, row)
    else if (t == 'ConditionalExpression') { subsIn(n.test, subs); direct(n.consequent, subs, row); direct(n.alternate, subs, row) }
    else if (t == 'LogicalExpression') { direct(n.left, subs, row); direct(n.right, subs, row) }
    else if (t == 'ArrayExpression') { for (const e of n.elements) e && (e.type == 'SpreadElement' ? subsIn(e, subs) : direct(e, subs, row)) }
    else if (t == 'CallExpression' && n.callee.type == 'MemberExpression' && !n.callee.computed && n.callee.property.name == 'map'
      && n.arguments.length == 1 && n.arguments[0].type == 'ArrowFunctionExpression' && n.arguments[0].expression) {
      subsIn(n.callee, subs)
      for (const p of n.arguments[0].params) subsIn(p, subs)
      direct(n.arguments[0].body, subs, true)
    } else subsIn(n, subs)
  }
  // CV-3: a block: compilable all the way down, at least two elements, children only text, text
  // holes (an expression with no JSX in it; not `children` / `slots`, which are vnodes) and such
  // elements
  const SLOTISH = /^(children|slots)$|\.(children|slots)$/
  const hasJsx = (n: any): boolean => {
    if (!n || typeof n != 'object') return false
    if (n.type == 'JSXElement' || n.type == 'JSXFragment') return true
    for (const k in n) { if (k == 'start' || k == 'end' || k == 'loc') continue; const v = n[k]; if (Array.isArray(v) ? v.some(hasJsx) : v && typeof v == 'object' && typeof v.type == 'string' && hasJsx(v)) return true }
    return false
  }
  const blockable = (el: any, top = true): boolean => {
    if (!compilable(el)) return false
    let n = 0
    const ok = (e: any): boolean => {
      if (!compilable(e)) return false
      n++
      for (const c of e.children) {
        if (c.type == 'JSXElement') { if (!ok(c)) return false }
        else if (c.type == 'JSXExpressionContainer') {
          if (c.expression.type == 'JSXEmptyExpression') continue
          if (hasJsx(c.expression) || SLOTISH.test(code.slice(c.expression.start, c.expression.end).trim())) return false
        } else if (c.type != 'JSXText') return false
      }
      return true
    }
    return ok(el) && (!top || n >= 2)
  }
  const block = (el: any): string => {
    compiled++; nblocks++
    const vals: string[] = [], kinds: string[] = []
    const hole = (k: string, v: string): string => (kinds.push(k), vals.push(v), `h(${vals.length - 1})`)
    const [rootData, key] = dataOf(el)
    hole('r', rootData)
    const bel = (e: any, root: boolean): string => {
      let d: string
      if (root) d = 'h(0)'
      else { const [data, , dynamic] = dataOf(e); d = dynamic ? hole('d', data) : data }
      const kids: string[] = []
      for (const c of e.children) {
        if (c.type == 'JSXText') { const t = cleanText(c.value); if (t) kids.push(JSON.stringify(t)) }
        else if (c.type == 'JSXExpressionContainer') { if (c.expression.type != 'JSXEmptyExpression') kids.push(hole('t', '(' + expr(c.expression) + ')')) }
        else kids.push(bel(c, false))
      }
      return `__cv.e(${JSON.stringify(tag(e))}, ${d}, ${childArg(kids)})`
    }
    const body = bel(el, true)
    const def = hoist(`__cvb.b((h) => ${body}, ${JSON.stringify(kinds.join(''))})`)
    return `__cvb.B(${def}, [${vals.join(', ')}]${key == 'undefined' ? '' : ', ' + key})`
  }
  const hoist = (obj: string): string => {
    const i = hoisted.indexOf(obj)
    if (i >= 0) return '$cv' + i
    hoisted.push(obj)
    return '$cv' + (hoisted.length - 1)
  }
  // the children as the JSX transform passes them: JSX text cleaned as the JSX spec does (lines
  // trimmed, empty lines dropped, joined by a space), empty expressions dropped
  const children = (list: any[], html: boolean): string[] => {
    const out: string[] = []
    for (const c of list) {
      if (c.type == 'JSXText') { const t = cleanText(c.value); if (t) out.push(JSON.stringify(t)) }
      else if (c.type == 'JSXExpressionContainer') {
        const e = c.expression
        if (e.type == 'JSXEmptyExpression') continue
        if ((html || blocks) && !vnodes) { const subs: Sub[] = []; direct(e, subs); out.push('(' + src(e.start, e.end, subs) + ')') }
        else out.push('(' + expr(e) + ')')
      }
      else if (html && !vnodes && c.type == 'JSXElement' && compilable(c)) out.push(ssrInner(c))
      else out.push(jsx(c))
    }
    return out
  }

  const subs = subsIn(ast)
  if (!compiled) return null
  const ms = new MagicString(code)
  for (const [a, b, t] of subs) ms.overwrite(a, b, t)
  ms.prepend(`import { __cv${ssr ? ', __cvs' : ''}${nblocks ? ', __cvb' : ''} } from 'sygnal';\n` + hoisted.map((h, i) => `const $cv${i} = ${h};\n`).join(''))
  return {code: ms.toString(), map: ms.generateMap({hires: 'boundary', source: id, includeContent: true})}
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
