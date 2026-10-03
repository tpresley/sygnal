/**
 * --fix --controls (PLAN-4 CT-1): convert a single-class intent selector into
 * a control.
 *
 *   function App() { return <button className="add">+</button> }
 *   App.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
 * →
 *   import { controls } from 'sygnal'
 *   const { Add } = controls({ Add: 'button' })
 *   function App() { return <Add>+</Add> }
 *   App.intent = ({ DOM }) => ({ ADD: DOM.click(Add) })
 *
 * A selector is converted when:
 *   - it is exactly one class ('.add'), passed to DOM.select() or a DOM.<event>()
 *     shorthand on the DOM source itself (not a nested or document/body select);
 *   - the component's view, intent and that element are in the same file;
 *   - exactly one intrinsic element in the component's own view has the class,
 *     as a static className string, and nothing else could produce it (no
 *     dynamic className, spread or Collection className that might);
 *   - no other component's view, no child view and no JSX passed in renders
 *     the class, and no other selector (compound, document/body) in the
 *     project needs it.
 * Every selector of the component's intent that is exactly that class becomes
 * the control. The control's key is the class in PascalCase ('add-lane-btn' →
 * AddLaneBtn), with a number added when the name is taken in the file.
 *
 * A selector is also left alone when a string in the project holds the
 * element's rendered markup (`'<button class="add">'`, as a test's
 * toContain() might): the control adds data-control to that markup.
 *
 * The class is kept on the element (className="add" stays) when keepClasses
 * is set, when a CSS/SCSS/Less/HTML file in the project mentions `.add`, or
 * when a string in another source file (a test, a querySelector) does;
 * otherwise only that class is removed.
 *
 * The declaration extends the file's existing `const { … } = controls({ … })`
 * or is added after the imports, and `controls` is merged into the file's
 * `import { … } from 'sygnal'` (or imported). Running it again changes nothing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildProject } from './model/project.js'
import { controlsOf } from './model/controls.js'
import { parseSource, walk, unwrap, jsxName, jsxAttr } from './ast.js'
import { selectorRequirements } from './selectors.js'
import { evalStrings, tokenize } from './strings.js'
import { isSourceRef, sourceAliases } from './model/intent.js'

const SINGLE_CLASS = /^\s*\.(-?[_a-zA-Z][\w-]*)\s*$/
const STYLE_FILES = /\.(css|scss|sass|less|styl|pcss|postcss|html|vue|svelte|astro)$/
const SOURCE_FILES = /\.(jsx?|tsx?|mjs|cjs|mts|cts)$/
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.astro', '.vite', '.next', '.svelte-kit', '.turbo', 'out'])

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const pascal = (cls) => cls.split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('')

/** Static className tokens of a JSX element: Set | null (dynamic) | undefined (no class attribute). */
function classAttrOf(opening) {
  const attr = jsxAttr(opening, 'className') || jsxAttr(opening, 'class')
  if (!attr) return { attr: null, tokens: undefined }
  let v = attr.value
  if (v?.type === 'JSXExpressionContainer') v = unwrap(v.expression)
  let text = null
  if (v?.type === 'StringLiteral') text = v.value
  else if (v?.type === 'TemplateLiteral' && v.expressions.length === 0) text = v.quasis[0].value.cooked
  return { attr, valueNode: v, tokens: text == null ? null : new Set(text.split(/\s+/).filter(Boolean)), text }
}

function mayHave(sinkLike, cls) {
  return sinkLike.classes.names.has(cls) || sinkLike.classes.patterns.some(p => p.re.test(cls))
}

/** Every view sink reachable from a component view: own, injected, children (recursive). */
function relatedSinks(project, comp) {
  const out = new Set()
  const visit = (sink, depth) => {
    if (!sink || out.has(sink) || depth > 8) return
    out.add(sink)
    for (const u of sink.children) {
      visit(u.injected, depth + 1)
      if (u.ref) visit(project.viewOf(u.ref), depth + 1)
    }
  }
  visit(comp.viewInfo, 0)
  for (const s of project.injectedInto(comp.view)) visit(s, 1)
  return out
}

/** The root `DOM.select(x)` / `DOM.click(x)` call for a selector argument (not nested, not document). */
function isRootCall(intent, sel) {
  const call = intent.file.parents.get(sel.node)
  if (call?.type !== 'CallExpression' || call.arguments[0] !== sel.node) return false
  const callee = unwrap(call.callee)
  if (callee.type !== 'MemberExpression') return false
  return isSourceRef(callee.object, 'DOM', sourceAliases(intent.fn))
}

// ---------------------------------------------------------------- class usage

function projectRoot(file, cwd) {
  let dir = path.dirname(file)
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return cwd
}

function listFiles(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) listFiles(path.join(dir, e.name), out)
    } else if (e.isFile() && (STYLE_FILES.test(e.name) || SOURCE_FILES.test(e.name)) && !/\.d\.[cm]?ts$/.test(e.name)) {
      out.push(path.join(dir, e.name))
    }
  }
  return out
}

/**
 * Class references outside the selectors being converted:
 *   uses(cls, excludeNodes) → true when a style file mentions `.cls`, or a
 *   string in a source file (other than the excluded selector nodes) does.
 */
function classUsage(root, project) {
  const style = []
  const strings = [] // { node, text }
  for (const f of listFiles(root)) {
    let text
    try { text = fs.readFileSync(f, 'utf8') } catch { continue }
    if (STYLE_FILES.test(f)) {
      style.push(text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' '))
      continue
    }
    const info = project.files.get(f)
    let ast = info?.ast
    if (!ast) { try { ast = parseSource(text, f) } catch { continue } }
    walk(ast.program, (n) => {
      if (n.type === 'StringLiteral') strings.push({ node: n, text: n.value })
      else if (n.type === 'TemplateLiteral') strings.push({ node: n, text: n.quasis.map(q => q.value.cooked ?? '').join(' ') })
      return true
    })
  }
  return {
    uses(cls, exclude) {
      const re = new RegExp(`\\.${escapeRe(cls)}(?![\\w-])`)
      if (style.some(t => re.test(t))) return true
      return strings.some(s => !exclude.has(s.node) && re.test(s.text))
    },
    /** A string holds rendered markup of a <tag> with the class (e.g. a test's toContain('<h2 class="x">')). */
    markup(tag, cls) {
      const re = new RegExp(`<${escapeRe(tag)}(?:\\s[^<>]*)?\\sclass=(["'])([^"']*)\\1`, 'g')
      return strings.some(s => [...s.text.matchAll(re)].some(m => m[2].split(/\s+/).includes(cls)))
    },
  }
}

// ---------------------------------------------------------------- planning

/** Candidate conversions for one component: [{ cls, element, selectors: [sel], tag }] */
function planComponent(project, comp, blocked) {
  const intent = comp.intent
  const view = comp.viewInfo
  if (!intent?.fn || !view || !comp.view) return []
  if (intent.file !== comp.file) return []
  const byClass = new Map()
  const other = new Set()
  for (const sel of intent.selectors) {
    if (sel.dynamic || sel.selector == null || sel.controls) continue
    const m = SINGLE_CLASS.exec(sel.selector)
    if (m && !sel.global && isRootCall(intent, sel)) {
      if (!byClass.has(m[1])) byClass.set(m[1], [])
      byClass.get(m[1]).push(sel)
    } else {
      for (const r of selectorRequirements(sel.selector)) if (r.kind === 'class') other.add(r.name)
    }
  }
  const out = []
  const related = relatedSinks(project, comp)
  for (const [cls, sels] of byClass) {
    if (other.has(cls) || blocked.has(cls)) continue
    // own view: one class attribute may produce it, and nothing dynamic might
    if ((view.classCounts.get(cls) || 0) !== 1) continue
    if (view.classes.patterns.some(p => p.re.test(cls))) continue
    // children, JSX passed in, JSX passed to children
    if ([...related].some(s => s !== view && mayHave(s, cls))) continue
    const hits = []
    for (const el of view.elements) {
      const { tokens } = classAttrOf(el.node.openingElement)
      if (tokens === null) {
        // a dynamic className that might produce it
        const v = classAttrOf(el.node.openingElement).valueNode
        const into = tokenize(evalStrings(v, { fileInfo: el.file }))
        if (mayHave({ classes: into }, cls)) hits.push(null)
      } else if (tokens?.has(cls)) {
        hits.push(el)
      }
    }
    if (hits.length !== 1 || !hits[0] || hits[0].file !== comp.file) continue
    const el = hits[0]
    const opening = el.node.openingElement
    if (opening.name.type !== 'JSXIdentifier') continue
    if (opening.attributes.some(a => a.type === 'JSXAttribute' && jsxName(a.name) === 'data-control')) continue
    out.push({ cls, element: el, selectors: sels, tag: el.tag })
  }
  return out
}

/** Classes some other component's view renders, or a selector elsewhere needs (document/body, compound…). */
function blockedClasses(project) {
  const owners = new Map() // cls → Set<sink>
  const all = new Set()
  for (const comp of project.components) for (const s of relatedSinks(project, comp)) all.add(s)
  for (const s of all) {
    for (const n of s.classes.names) {
      if (!owners.has(n)) owners.set(n, new Set())
      owners.get(n).add(s)
    }
  }
  const blocked = new Set()
  for (const [n, sinks] of owners) if (sinks.size > 1) blocked.add(n)
  for (const comp of project.components) {
    for (const sel of comp.intent?.selectors || []) {
      if (sel.selector == null) continue
      if (sel.global || !SINGLE_CLASS.test(sel.selector) || !isRootCall(comp.intent, sel)) {
        for (const r of selectorRequirements(sel.selector)) if (r.kind === 'class') blocked.add(r.name)
      }
    }
  }
  return blocked
}

// ---------------------------------------------------------------- edits

function identifiersIn(ast) {
  const names = new Set()
  walk(ast.program, (n) => {
    if (n.type === 'Identifier' || n.type === 'JSXIdentifier') names.add(n.name)
    return true
  })
  return names
}

function editsForFile(project, file, conversions, { keepClasses, usage }) {
  const ast = file.ast
  const source = file.source
  const names = identifiersIn(ast)
  // `controls` import (or bail when the name means something else here)
  let controlsName = null
  let mergeInto = null
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ImportDeclaration' || stmt.source.value !== 'sygnal' || stmt.importKind === 'type') continue
    for (const s of stmt.specifiers) {
      if (s.type === 'ImportSpecifier' && s.importKind !== 'type' && (s.imported.name || s.imported.value) === 'controls') controlsName = s.local.name
    }
    if (!mergeInto && stmt.specifiers.some(s => s.type === 'ImportSpecifier')) mergeInto = stmt
  }
  if (!controlsName && names.has('controls')) return null
  const edits = []
  const add = (start, end, text) => edits.push({ start, end, text })

  // existing destructured controls() declaration at module level
  const info = controlsOf(project, file)
  let target = null
  for (const entry of info.calls) {
    const decl = file.parents.get(entry.call)
    const stmt = decl && file.parents.get(decl)
    const top = stmt && file.parents.get(stmt)
    const topOk = top?.type === 'Program' || (top?.type === 'ExportNamedDeclaration' && file.parents.get(top)?.type === 'Program')
    const arg = unwrap(entry.call.arguments[0])
    if (decl?.type === 'VariableDeclarator' && decl.id.type === 'ObjectPattern' && topOk && arg?.type === 'ObjectExpression' &&
        !decl.id.properties.some(p => p.type === 'RestElement') && !arg.properties.some(p => p.type === 'SpreadElement')) {
      target = { pattern: decl.id, object: arg }
      break
    }
  }
  const taken = new Set([...names, ...info.calls.flatMap(e => e.controls.map(c => c.key))])

  const keys = []
  const ordered = [...conversions].sort((a, b) => a.element.node.start - b.element.node.start)
  for (const conv of ordered) {
    if (usage.markup(conv.tag, conv.cls)) continue
    const base = pascal(conv.cls)
    if (!/^[A-Za-z_$][\w$]*$/.test(base)) continue
    let key = base
    for (let i = 2; taken.has(key); i++) key = base + i
    taken.add(key)
    keys.push({ key, tag: conv.tag })
    const opening = conv.element.node.openingElement
    add(opening.name.start, opening.name.end, key)
    const closing = conv.element.node.closingElement
    if (closing) add(closing.name.start, closing.name.end, key)
    for (const sel of conv.selectors) add(sel.node.start, sel.node.end, key)
    const exclude = new Set(conv.selectors.map(s => unwrap(s.node)))
    const keep = keepClasses || usage.uses(conv.cls, exclude)
    if (!keep) {
      const { attr, valueNode, text } = classAttrOf(opening)
      const rest = text.split(/\s+/).filter(t => t && t !== conv.cls)
      if (!rest.length) {
        let start = attr.start
        while (start > 0 && /[ \t]/.test(source[start - 1])) start--
        // an attribute on its own line: drop the line break before it too
        if (source[start - 1] === '\n') start -= source[start - 2] === '\r' ? 2 : 1
        add(start, attr.end, '')
      } else {
        const q = source[valueNode.start]
        add(valueNode.start, valueNode.end, q + rest.join(' ') + q)
      }
    }
  }
  if (!keys.length) return null
  const callee = controlsName || 'controls'
  const lastImport = [...ast.program.body].reverse().find(s => s.type === 'ImportDeclaration')
  const semi = lastImport && source.slice(lastImport.start, lastImport.end).trimEnd().endsWith(';') ? ';' : ''
  let importText = ''
  if (!controlsName) {
    if (mergeInto) {
      const specs = mergeInto.specifiers.filter(s => s.type === 'ImportSpecifier')
      add(specs[specs.length - 1].end, specs[specs.length - 1].end, ', controls')
    } else {
      importText = `import { controls } from 'sygnal'${semi}`
    }
  }
  if (target) {
    const lp = target.pattern.properties[target.pattern.properties.length - 1]
    const lo = target.object.properties[target.object.properties.length - 1]
    const pText = keys.map(k => k.key).join(', ')
    const oText = keys.map(k => `${k.key}: '${k.tag}'`).join(', ')
    if (lp) add(lp.end, lp.end, ', ' + pText); else add(target.pattern.start + 1, target.pattern.start + 1, ' ' + pText + ' ')
    if (lo) add(lo.end, lo.end, ', ' + oText); else add(target.object.start + 1, target.object.start + 1, ' ' + oText + ' ')
    if (importText) {
      const at = lastImport ? lastImport.end : 0
      add(at, at, lastImport ? '\n' + importText : importText + '\n')
    }
  } else {
    let decl = `const { ${keys.map(k => k.key).join(', ')} } = ${callee}({ ${keys.map(k => `${k.key}: '${k.tag}'`).join(', ')} })${semi}`
    if (decl.length > 100) decl = `const { ${keys.map(k => k.key).join(', ')} } = ${callee}({\n${keys.map(k => `  ${k.key}: '${k.tag}',\n`).join('')}})${semi}`
    if (lastImport) {
      add(lastImport.end, lastImport.end, (importText ? '\n' + importText : '') + '\n\n' + decl)
    } else {
      add(0, 0, (importText ? importText + '\n\n' : '') + decl + '\n\n')
    }
  }
  return { edits, count: keys.length }
}

function applyEdits(source, edits) {
  let out = source
  for (const e of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

function syntaxErrors(source, file) {
  try { return parseSource(source, file).errors?.length || 0 } catch { return Infinity }
}

/**
 * Convert single-class selectors to controls in `files` (absolute paths), in place.
 * @returns {{ controls: number, files: string[], skipped: string[] }}
 */
export function convertControls(files, options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const project = buildProject(files, { cwd })
  const blocked = blockedClasses(project)
  const byFile = new Map()
  for (const comp of project.components) {
    if (!project.scanned.has(comp.file.path)) continue
    const plan = planComponent(project, comp, blocked)
    if (!plan.length) continue
    if (!byFile.has(comp.file)) byFile.set(comp.file, [])
    byFile.get(comp.file).push(...plan)
  }
  const usageByRoot = new Map()
  let controls = 0
  const changed = []
  const skipped = []
  for (const [file, conversions] of byFile) {
    const root = projectRoot(file.path, cwd)
    if (!usageByRoot.has(root)) usageByRoot.set(root, classUsage(root, project))
    const r = editsForFile(project, file, conversions, { keepClasses: !!options.keepClasses, usage: usageByRoot.get(root) })
    if (!r) continue
    const after = applyEdits(file.source, r.edits)
    if (after === file.source) continue
    if (syntaxErrors(after, file.path) > syntaxErrors(file.source, file.path)) { skipped.push(file.path); continue }
    fs.writeFileSync(file.path, after)
    controls += r.count
    changed.push(file.path)
  }
  return { controls, files: changed, skipped }
}
