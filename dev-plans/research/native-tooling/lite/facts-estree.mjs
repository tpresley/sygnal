// The prototype's rule subset on an ESTree AST (oxc-parser / oxlint), in plain JS: the reference
// the Rust port (../native/) mirrors line for line, and what the oxlint JS plugin runs.
//
// fileFacts(program) → per-file facts; rules(factsByFile) → findings. Four rules, simplified
// from sygnal-check (see README "Prototype"):
//   SYG101 an intent key with no model entry (no behaviors: a component with `uses` is skipped)
//   SYG105 an EVENTS type selected but never emitted / emitted but never selected, project-wide
//          (the cross-file rule: facts per file, joined over the project)
//   SYG110 lite: an intent selector '.x' / '#x' (one simple token) that the component's own view
//          never renders, when the view's class/id attributes are all literals
//   SYG302 a default import from 'xstream'
// A component is `X.intent = …` / `X.model = …` at the top level; its view is the function X.

const unparen = n => { while (n && (n.type === 'ParenthesizedExpression' || n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSNonNullExpression')) n = n.expression; return n }
const keyName = p => {
  if (p.computed) return p.key.type === 'Literal' && typeof p.key.value === 'string' ? p.key.value : null
  return p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' && typeof p.key.value === 'string' ? p.key.value : null
}
const strValue = n => {
  n = unparen(n)
  if (!n) return null
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked
  return null
}
const isFn = n => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration')

// Keys that hold no runtime code (types, positions).
const SKIP = new Set(['type', 'start', 'end', 'range', 'loc', 'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'superTypeArguments', 'parent'])
const TYPE_ONLY = new Set(['TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'TSDeclareFunction', 'TSModuleDeclaration', 'TSEnumDeclaration'])
function walk(node, visit) {
  if (!node || typeof node.type !== 'string' || TYPE_ONLY.has(node.type)) return
  if (visit(node) === false) return
  for (const k in node) {
    if (SKIP.has(k)) continue
    const v = node[k]
    if (!v || typeof v !== 'object') continue
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, visit) } else if (typeof v.type === 'string') walk(v, visit)
  }
}

/** The object an intent function returns: `=> ({…})` or its body's last top-level `return {…}`. */
function returnedObject(fn) {
  const b = unparen(fn.body)
  if (b.type === 'ObjectExpression') return b
  if (b.type !== 'BlockStatement') return null
  for (let i = b.body.length - 1; i >= 0; i--) {
    const s = b.body[i]
    if (s.type === 'ReturnStatement') { const a = unparen(s.argument); return a?.type === 'ObjectExpression' ? a : null }
  }
  return null
}

function objectKeys(obj, expand) {
  const keys = []
  for (const p of obj.properties) {
    if (p.type !== 'Property') return null // a spread: unknown
    const k = keyName(p)
    if (k == null) return null
    keys.push({ name: expand ? k.split('|')[0].trim() : k, node: p.key })
  }
  return keys
}

// '.name' or '#name' only (one token, no combinators, pseudo classes or attributes)
const SIMPLE = /^([.#])([A-Za-z_][\w-]*)$/

function viewOf(fn) {
  const classes = new Set(), ids = new Set()
  let dynamic = false
  walk(fn.body, (n) => {
    if (n.type !== 'JSXAttribute' || n.name.type !== 'JSXIdentifier') return true
    const name = n.name.name
    if (name !== 'className' && name !== 'class' && name !== 'id') return true
    const v = n.value?.type === 'JSXExpressionContainer' ? n.value.expression : n.value
    const s = strValue(v)
    if (s == null) { dynamic = true; return true }
    if (name === 'id') ids.add(s.trim())
    else for (const t of s.split(/\s+/)) if (t) classes.add(t)
    return true
  })
  return { classes, ids, dynamic }
}

export function fileFacts(program) {
  const facts = { components: [], selected: [], emitted: [], dynamicSelected: 0, dynamicEmitted: 0, xstreamDefault: [] }
  const fns = new Map() // top-level function name → node
  const statics = new Map() // component name → { intent, model, uses }
  const emitHelpers = new Set() // local names of emit/event imported from sygnal
  for (const s0 of program.body) {
    const s = (s0.type === 'ExportNamedDeclaration' || s0.type === 'ExportDefaultDeclaration') && s0.declaration ? s0.declaration : s0
    if (s.type === 'ImportDeclaration' && s.importKind !== 'type') {
      const src = s.source.value
      if (src === 'xstream' && s.specifiers.some(sp => sp.type === 'ImportDefaultSpecifier')) facts.xstreamDefault.push(s)
      if (/^sygnal(\/|$)/.test(src)) {
        for (const sp of s.specifiers) {
          if (sp.type !== 'ImportSpecifier' || sp.importKind === 'type') continue
          const imported = sp.imported.type === 'Identifier' ? sp.imported.name : sp.imported.value
          if (imported === 'emit' || imported === 'event') emitHelpers.add(sp.local.name)
        }
      }
    } else if (s.type === 'FunctionDeclaration' && s.id) {
      fns.set(s.id.name, s)
    } else if (s.type === 'VariableDeclaration') {
      for (const d of s.declarations) if (d.id.type === 'Identifier' && isFn(unparen(d.init))) fns.set(d.id.name, unparen(d.init))
    } else if (s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression' && s.expression.operator === '=') {
      const l = s.expression.left
      if (l.type === 'MemberExpression' && !l.computed && l.object.type === 'Identifier' && l.property.type === 'Identifier') {
        const k = l.property.name
        if (k === 'intent' || k === 'model' || k === 'uses') {
          if (!statics.has(l.object.name)) statics.set(l.object.name, {})
          statics.get(l.object.name)[k] = unparen(s.expression.right)
        }
      }
    }
  }

  // EVENTS, file-wide (sygnal-check's scanFileEvents): aliases from `{ EVENTS: ev }` patterns
  const aliases = new Set(['EVENTS'])
  walk(program, (n) => {
    if (n.type === 'ObjectPattern') {
      for (const p of n.properties) {
        if (p.type === 'Property' && keyName(p) === 'EVENTS') {
          const v = p.value.type === 'AssignmentPattern' ? p.value.left : p.value
          if (v.type === 'Identifier') aliases.add(v.name)
        }
      }
    }
    return true
  })
  walk(program, (n) => {
    if (n.type === 'ImportDeclaration') return false
    if (n.type !== 'CallExpression') return true
    const c = unparen(n.callee)
    if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'select') {
      const o = unparen(c.object)
      const isEvents = (o.type === 'Identifier' && aliases.has(o.name)) || (o.type === 'MemberExpression' && !o.computed && o.property.name === 'EVENTS')
      if (isEvents && n.arguments.length) {
        const t = strValue(n.arguments[0])
        if (t != null) facts.selected.push({ type: t, node: n.arguments[0] })
        else facts.dynamicSelected++
      }
    } else if (c.type === 'Identifier' && emitHelpers.has(c.name)) {
      const t = n.arguments.length ? strValue(n.arguments[0]) : null
      if (t != null) facts.emitted.push({ type: t, node: n.arguments[0] })
      else facts.dynamicEmitted++
    }
    return true
  })

  for (const [name, st] of statics) {
    const comp = { name, intentKeys: null, modelKeys: null, hasModel: !!st.model, uses: !!st.uses, selectors: [], view: null }
    if (isFn(st.intent)) {
      const obj = returnedObject(st.intent)
      if (obj) comp.intentKeys = objectKeys(obj, false)
      walk(st.intent.body, (n) => {
        if (n.type !== 'CallExpression' || !n.arguments.length) return true
        const c = unparen(n.callee)
        if (c.type === 'MemberExpression' && unparen(c.object).type === 'Identifier' && unparen(c.object).name === 'DOM') {
          const s = strValue(n.arguments[0])
          const m = s && SIMPLE.exec(s.trim())
          if (m) comp.selectors.push({ kind: m[1] === '.' ? 'class' : 'id', name: m[2], node: n.arguments[0] })
        }
        return true
      })
    }
    if (st.model?.type === 'ObjectExpression') comp.modelKeys = objectKeys(st.model, true)
    if (fns.has(name)) comp.view = viewOf(fns.get(name))
    facts.components.push(comp)
  }
  return facts
}

/** facts: Map<file, facts> → [{ code, file, node, message }] (sygnal-check's message texts). */
export function rules(factsByFile) {
  const out = []
  const allEmitted = new Set(), allSelected = new Set()
  let dynE = 0, dynS = 0
  for (const f of factsByFile.values()) {
    for (const e of f.emitted) allEmitted.add(e.type)
    for (const s of f.selected) allSelected.add(s.type)
    dynE += f.dynamicEmitted; dynS += f.dynamicSelected
  }
  for (const [file, f] of factsByFile) {
    for (const s of f.xstreamDefault) out.push({ code: 'SYG302', severity: 'info', file, node: s })
    for (const c of f.components) {
      if (c.intentKeys && !c.uses && (c.modelKeys || !c.hasModel)) {
        const model = new Set((c.modelKeys || []).map(k => k.name))
        for (const k of c.intentKeys) {
          if (!model.has(k.name)) out.push({ code: 'SYG101', file, node: k.node, message: `intent action '${k.name}' has no model entry, so it does nothing` })
        }
      }
      if (c.view && !c.view.dynamic) {
        for (const s of c.selectors) {
          const set = s.kind === 'class' ? c.view.classes : c.view.ids
          if (!set.has(s.name)) out.push({ code: 'SYG110', file, node: s.node, message: `${s.kind} '${s.name}' is not rendered by ${c.name}'s view` })
        }
      }
    }
    for (const s of f.selected) if (!allEmitted.has(s.type)) out.push({ code: 'SYG105', severity: dynE ? 'info' : 'warn', file, node: s.node, message: `EVENTS.select('${s.type}') but nothing in the scanned files emits '${s.type}'` })
    for (const e of f.emitted) if (!allSelected.has(e.type)) out.push({ code: 'SYG105', severity: dynS ? 'info' : 'warn', file, node: e.node, message: `EVENTS type '${e.type}' is emitted but nothing in the scanned files selects it` })
  }
  return out
}
