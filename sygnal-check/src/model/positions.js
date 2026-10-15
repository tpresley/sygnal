/**
 * Positions in the project model (PLAN-7 N-1; spike 0-S3): an occurrence index built from the
 * project model, for go-to-definition / find-references (and code lens and rename). Every
 * occurrence comes from a node (or a token offset) the model keeps.
 *
 *   range(node, { inner?, sub? }) → Range | null
 *     Range = { start, end, line, column, endLine, endColumn }
 *     start/end: UTF-16 offsets (Babel's); line/column 1-based, endColumn exclusive, the units of
 *     the checker's diagnostics (README "JSON output"). `inner`: a string literal (or a template
 *     literal without expressions) narrowed to its contents; `sub: [offset, length]`: a part of
 *     the (inner) range on a single-line node (the action part of a `'A | SINK'` key).
 *
 *   buildIndex(project, { exclude? }) → Index      (plain data: structured-cloneable)
 *     exclude: absolute paths whose occurrences are left out (the language server's files
 *     checked with their last good text, whose positions may be off)
 *     Index = {
 *       components: [{ id, name, file, line, flags }]  id: 'absPath:line' of the definition;
 *                                                      flags: what makes a rename unsafe (below)
 *       occurrences: Occurrence[]                      sorted by file, then start
 *       flags: { dynamicSelected, dynamicEmitted }     project-wide EVENTS names it can't read (counts)
 *     }
 *     Occurrence = Range & {
 *       file,                 absolute path
 *       hit: Range,           what a cursor must be on: the whole string literal (quotes included)
 *                             or key; the action part of a shorthand key; a token itself
 *       name,                 the action ('SAVE', 'pager.NEXT'), EVENTS type, class / id name,
 *                             control key, state key, context entry, or component name
 *       ns?,                  absent: an action or EVENTS type (wave A); 'dom' | 'control' |
 *                             'state' | 'context' | 'child' (below)
 *       kind, role,           see the tables below
 *       component,            the component id (actions, and the component an occurrence belongs
 *                             to); null for EVENTS (project-wide); for a view token, the id of the
 *                             function whose view renders it (a component's, or 'path:line' of a
 *                             plain function rendered as a tag)
 *       via?,                 a name built from module constants: [Range & { file, name }] of the
 *                             constants' declarations (the occurrence's range is the use site)
 *       constant?,            true with `via`
 *       … wave A's flags: key?, sink?, builtin?, synthetic?, shorthand?, behavior?, firstParty?, implicit?
 *     }
 *
 *   Actions (no ns): kind 'intent' | 'model' | 'next' | 'reply' | 'connection' | 'resource' |
 *     'route' | 'timer' | 'browser' | 'agent' | 'uses', and for a user behavior's definition
 *     (`defineBehavior({...})`, in its own file, once per host that uses it, linked by the host's
 *     'key.ACTION' names): 'behavior-model' (handler), 'behavior-intent', 'behavior-next',
 *     'behavior-reply', 'behavior-timer', and 'behavior-option' (an option at the uses site naming
 *     an action the behavior dispatches: form's `submit: 'SIGN_UP'`); role 'handler' (model keys)
 *     or 'trigger'. EVENTS (no ns): kind/role 'emit' | 'select'. Computed intent / model keys,
 *     next() names and EVENTS types built from module constants (one value: string literals,
 *     `+`, template literals, consts across imports, `OBJ.KEY` of a const object literal) are
 *     occurrences of their kind with `via`.
 *
 *   ns 'dom' (class / id tokens): kind 'class' | 'id';
 *     role 'render': a token the view renders (className / class / id strings, template quasis,
 *       classes() / clsx() arguments and object keys, ?: / && / + branches, h('div.a#b') and
 *       div('.a') selectors, helper-function JSX the view follows); `scope`: the view sink's id
 *     role 'selector': a token of an intent (or behavior option) selector string ('.a .b' is two);
 *       `scopes`: the sinks of the component's own DOM scope (its view, JSX passed into it);
 *       `childScope`, `child`, `path`: when only a child renders it (SYG104), the child's sink;
 *       `dynamic`: the own view has dynamic class names (ids) that might produce it;
 *       `missing`: no static class / id of the own scope or a child renders it (with `dynamic`, or
 *       the component's dynamicClasses / dynamicIds flag: a dynamic value might)
 *   ns 'control': `target`: the control's id; role 'declare' (the controls() key), 'render' (an
 *     `<Add>` tag, with `scope`), 'selector' (`DOM.click(Add)`, with `scopes` / `childScope`)
 *   ns 'state': role 'declare' (kind 'state': an initialState key; kind 'calculated'), 'use'
 *     (kind 'from': a Collection / Switchable `from="x"` / `from={'x'}` in the component's view;
 *     for a path, `from="x.y"`, its first segment)
 *   ns 'context': kind 'context'; role 'provide' (a `.context` static key, `component`: the
 *     provider), 'consume' (`context.x` / `{ context: { x } }` in a view, a reducer's
 *     `props.context.x`, or a plain function rendered as a tag); `providers`: the ids of the nearest
 *     components providing x on every render path up from the consumer (itself included)
 *   ns 'child': `target`: the child component's id; kind/role 'component'/'declare' (a component's
 *     name), 'child-select'/'use' (the argument of `CHILD.select(Child)`), 'parent'/'parent' (a
 *     PARENT sink key in the child's model; name: the action)
 *
 *   Component flags (wave C, rename refusals): intentUnknown, modelUnknown (spreads, computed keys
 *   it can't read, an intent it can't see), dynamicNext, dynamicReplies, dynamicConnections,
 *   dynamicClasses, dynamicIds (the own view: className / id it can't read), stateUnknown,
 *   calculatedUnknown, contextUnknown, usesOpen (a behavior whose actions can't be listed),
 *   sharedModel / sharedIntent (another component has the same model / intent object).
 *
 *   createLookup(index) → {
 *     at(file, line, column)             occurrences whose `hit` contains the 1-based position
 *                                        (end inclusive: a cursor right after the token counts)
 *     definition(occs, notes?)           the targets (below), sorted, deduplicated; `notes` (an
 *                                        array) gets why nothing (or a child's element) was found
 *     references(occs, includeDeclaration)
 *   }
 *   Definition: from a trigger (intent key, next(), a reply name, a static's name, an
 *   agent.actions key, a `uses` key, a behavior definition's trigger) → the model entries
 *   handling that action in that component (a behavior definition's model keys included);
 *   from a model key → the intent keys triggering it, else its other triggers; from a select → the
 *   type's emits; from an emit → its selects; with `via` also the constants. A selector token →
 *   the view tokens rendering it in the component's own scope; else a child's (noted); else
 *   nothing (noted: dynamic class names, or not rendered). A view token → the selectors using it.
 *   A control selector → the controls() key and its tags in the own scope; a tag → the key; a key
 *   → the selectors. `from` → the initialState / calculated key; a state key → its `from` uses. A
 *   context read → the nearest providers; a provider entry → its consumers. `CHILD.select(Child)`
 *   → Child's name and its PARENT sink keys; a PARENT key or a component's name → the
 *   CHILD.select calls. References: every occurrence of the same name in the same scope (actions:
 *   the component; EVENTS: the project; dom: the scopes the selector resolves to; context: the
 *   providers and their consumers); without `includeDeclaration` the declarations are left out
 *   (model keys, emits, rendered tokens, controls() keys, state keys, providers, component names).
 *   Several occurrences at one position give the union. Unknown or dynamic names have no
 *   occurrence: nothing, never a guess.
 */
import { unwrap, propName, memberName } from '../ast.js'
import { findBinding } from '../scope.js'
import { BUILTIN_ACTIONS } from './modelEntries.js'
import { resolveExpr, resolveExport } from './resolve.js'
import { selectorTokens } from '../selectors.js'
import { renderedUsages } from './usages.js'
import { openPrefixes } from './behaviors.js'
import { contextReads } from './context.js'
import { resolveControl } from './controls.js'
import { findInChildren } from '../rules/syg110-selector-in-view.js'

const isLiteral = (n) => n?.type === 'StringLiteral' || (n?.type === 'TemplateLiteral' && !n.expressions.length)

export function range(node, { inner = false, sub = null } = {}) {
  if (!node?.loc) return null
  let { start, end } = node
  let line = node.loc.start.line, column = node.loc.start.column + 1
  let endLine = node.loc.end.line, endColumn = node.loc.end.column + 1
  if (inner && isLiteral(node)) {
    start += 1; end -= 1; column += 1; endColumn -= 1
  }
  if (sub && line === endLine) {
    start += sub[0]; column += sub[0]
    end = start + sub[1]; endColumn = column + sub[1]
  }
  return { start, end, line, column, endLine, endColumn }
}

/** The offset of the action part inside a shorthand key's literal contents (raw text: escapes). */
function shorthandSub(node, action) {
  const raw = node.extra?.raw?.slice(1, -1) ?? node.value
  const m = /^\s*/.exec(raw)
  const i = raw.indexOf(action, m[0].length)
  return i < 0 ? null : [i, action.length]
}

/** The sink part of a shorthand key ('A | PARENT' → PARENT). */
function sinkSub(node, sink) {
  const raw = node.extra?.raw?.slice(1, -1)
  if (raw == null) return null
  const i = raw.indexOf(sink, raw.indexOf('|') + 1)
  return i < 0 ? null : [i, sink.length]
}

const pathOf = (f) => (typeof f === 'string' ? f : f?.path) || null

/** 1-based line starts of a text (\n, \r\n, \r, U+2028, U+2029: Babel's line breaks). */
function lineStarts(text) {
  const out = [0]
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 10 || c === 0x2028 || c === 0x2029) out.push(i + 1)
    else if (c === 13) { if (text.charCodeAt(i + 1) === 10) i++; out.push(i + 1) }
  }
  return out
}

/** A file's line starts, kept per AST (the parse cache reuses ASTs, and their texts, across builds). */
const lineStartsCache = new WeakMap()
function lineStartsOf(file) {
  const key = file.ast?.program
  const c = key && lineStartsCache.get(key)
  if (c && c.text === file.source) return c.starts
  const starts = lineStarts(file.source)
  if (key) lineStartsCache.set(key, { text: file.source, starts })
  return starts
}

/**
 * A name built from module constants, when it has exactly one value: { value, via: [{ file, node }] }
 * (via: the declarations it went through), or null.
 */
export function constName(project, file, node, depth = 0) {
  node = unwrap(node)
  if (!node || depth > 8) return null
  switch (node.type) {
    case 'StringLiteral': return { value: node.value, via: [] }
    case 'TemplateLiteral': {
      let value = node.quasis[0].value.cooked
      const via = []
      for (let i = 0; i < node.expressions.length; i++) {
        const e = constName(project, file, node.expressions[i], depth + 1)
        if (!e || value == null) return null
        value += e.value + (node.quasis[i + 1].value.cooked ?? '')
        via.push(...e.via)
      }
      return value == null ? null : { value, via }
    }
    case 'BinaryExpression': {
      if (node.operator !== '+') return null
      const l = constName(project, file, node.left, depth + 1)
      const r = l && constName(project, file, node.right, depth + 1)
      return r ? { value: l.value + r.value, via: [...l.via, ...r.via] } : null
    }
    case 'Identifier': {
      const b = findBinding(file, node.name, node)
      if (b?.kind === 'var' && b.declKind === 'const' && b.init) {
        const v = constName(project, file, b.init, depth + 1)
        return v && { value: v.value, via: [{ file, node: b.node.id }, ...v.via] }
      }
      if (b?.kind === 'import' && b.imported !== '*' && b.imported !== 'default') {
        const target = project.loadImport(file, b.source)
        const t = target && resolveExport(project, target, b.imported)
        return t ? constDecl(project, t, depth) : null
      }
      return null
    }
    case 'MemberExpression': {
      const key = memberName(node)
      if (key == null || unwrap(node.object)?.type !== 'Identifier') return null
      const r = resolveExpr(project, file, node.object)
      if (r?.node?.type !== 'ObjectExpression' || !isConstObject(r)) return null
      let found = null
      for (const p of r.node.properties) {
        if (p.type !== 'ObjectProperty' || p.computed) return null
        if (propName(p) === key) found = p
      }
      if (!found) return null
      const v = constName(project, r.file, found.value, depth + 1)
      return v && { value: v.value, via: [{ file: r.file, node: found.key }, ...v.via] }
    }
    default: return null
  }
}

/** An exported value resolved by resolveExport: a string from a `const` declaration. */
function constDecl(project, t, depth) {
  const decl = t.file.parents.get(t.node)
  if (decl?.type !== 'VariableDeclarator' || decl.init !== t.node || decl.id.type !== 'Identifier') return null
  if (t.file.parents.get(decl)?.kind !== 'const') return null
  const v = constName(project, t.file, t.node, depth + 1)
  return v && { value: v.value, via: [{ file: t.file, node: decl.id }, ...v.via] }
}

const isConstObject = (r) => {
  const decl = r.file.parents.get(r.node)
  return decl?.type === 'VariableDeclarator' && r.file.parents.get(decl)?.kind === 'const'
}

/** The literal node and the offset of its contents for a selector argument, or null. */
function selectorLiteral(file, node) {
  node = unwrap(node)
  if (node?.type === 'Identifier') {
    const b = findBinding(file, node.name, node)
    if (b?.kind === 'var' && b.init) node = unwrap(b.init)
  }
  if (node?.type === 'StringLiteral') {
    const raw = node.extra?.raw
    return raw != null && raw.slice(1, -1) === node.value ? { text: node.value, base: node.start + 1 } : null
  }
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) {
    const q = node.quasis[0]
    return q.value.raw === q.value.cooked ? { text: q.value.cooked, base: q.start } : null
  }
  return null
}

function viewHas(sink, kind, name) {
  return (kind === 'class' ? sink.classes : sink.ids).names.has(name)
}
const patternHit = (sink, kind, name) => (kind === 'class' ? sink.classes : sink.ids).patterns.some(p => p.re.test(name))

export function buildIndex(project, { exclude } = {}) {
  const components = []
  const occurrences = []
  const tags = [] // child component tags (`<Child>` opening names) rendered by a component's view
  const seen = new Map() // abs → Set of dedupe keys
  const lines = new Map() // abs → line starts
  // the long ids (component, target: 'absPath:…') as small numbers in the dedupe keys
  const ids = new Map()
  const short = (s) => {
    if (s == null) return String(s)
    let i = ids.get(s)
    if (i === undefined) ids.set(s, i = ids.size)
    return i
  }

  const push = (abs, r, h, props) => {
    let inFile = seen.get(abs)
    if (!inFile) seen.set(abs, inFile = new Set())
    const dedupe = `${r.start}\0${r.end}\0${props.kind}\0${props.name}\0${short(props.component)}\0${props.scope ?? ''}\0${props.target == null ? '' : short(props.target)}`
    if (inFile.has(dedupe)) return null
    inFile.add(dedupe)
    const o = { file: abs, ...r, hit: h, ...props }
    if (props.component && !props.ns && BUILTIN_ACTIONS.has(props.name)) o.builtin = true
    occurrences.push(o)
    return o
  }

  const add = (file, node, props, { sub = null, hit = null, part = null } = {}) => {
    const abs = pathOf(file)
    node = unwrap(node)
    if (!abs || !node?.loc || exclude?.has(abs)) return null
    let r, h
    if (part && isLiteral(node)) {
      r = h = range(node, { inner: true, sub: part })
    } else if (sub && isLiteral(node)) {
      const s = shorthandSub(node, props.name)
      r = h = range(node, { inner: true, sub: s })
    } else {
      r = range(node, { inner: true })
      h = hit || range(node)
    }
    if (!r) return null
    return push(abs, r, h, props)
  }

  /** An occurrence at offsets [start, end) of a file (FileInfo). */
  const addSpan = (file, start, end, props) => {
    const abs = pathOf(file)
    if (!abs || exclude?.has(abs) || typeof file.source !== 'string') return null
    let ls = lines.get(abs)
    if (!ls) lines.set(abs, ls = lineStartsOf(file))
    const lc = (off) => {
      let lo = 0, hi = ls.length - 1
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ls[mid] <= off) lo = mid; else hi = mid - 1 }
      return [lo + 1, off - ls[lo] + 1]
    }
    const [line, column] = lc(start)
    const [endLine, endColumn] = lc(end)
    const r = { start, end, line, column, endLine, endColumn }
    return push(abs, r, r, props)
  }

  const viaOf = (list) => list.filter(v => !exclude?.has(v.file.path))
    .map(({ file, node }) => ({ file: file.path, name: node.name ?? propName({ key: node }) ?? '', ...range(node, { inner: true }) })).filter(v => v.line)

  // ids: a component's definition line; a plain function rendered as a tag: its own line
  const compId = new Map()
  const idOf = (c) => compId.get(c) || `${c.file.path}:${c.node?.loc?.start.line ?? 1}`
  const fnId = (ref) => {
    const c = project.componentForFunction(ref.node)
    return c ? idOf(c) : `${ref.file.path}:${ref.node?.loc?.start.line ?? 1}`
  }

  // --- view sinks: ids, tokens (classes, ids, control tags) ---
  const sinkIds = new Map()
  const sinkId = (sink, owner) => {
    if (sinkIds.has(sink)) return sinkIds.get(sink)
    const id = `s${sinkIds.size}`
    sinkIds.set(sink, id)
    for (const t of sink.tokens || []) {
      if (t.kind === 'control') {
        const target = controlId(t.control)
        addSpan(t.file, t.start, t.end, { name: t.control.key, ns: 'control', kind: 'control', role: 'render', component: owner, scope: id, target })
        declareControl(t.control)
      } else addSpan(t.file, t.start, t.end, { name: t.name, ns: 'dom', kind: t.kind, role: 'render', component: owner, scope: id })
    }
    return id
  }
  const controlId = (c) => `${c.file.path}:${c.keyNode.start}`
  const declared = new Set()
  const declareControl = (c) => {
    if (declared.has(c)) return
    declared.add(c)
    add(c.file, c.keyNode, { name: c.key, ns: 'control', kind: 'control', role: 'declare', component: null, target: controlId(c) })
  }
  // every sink reachable from the components' views
  const walkSinks = (sink, owner) => {
    if (!sink || sinkIds.has(sink)) return
    sinkId(sink, owner)
    for (const u of sink.children) {
      const childOwner = u.ref ? fnId(u.ref) : null
      walkSinks(u.injected, childOwner)
      if (u.ref) walkSinks(project.viewOf(u.ref), childOwner)
    }
  }
  for (const c of project.components) compId.set(c, `${c.file.path}:${c.node?.loc?.start.line ?? 1}`)
  for (const c of project.components) if (c.viewInfo) walkSinks(c.viewInfo, idOf(c))

  // shared model / intent objects (rename: edits must cover every component)
  const modelOwners = new Map(), intentOwners = new Map()
  for (const c of project.components) {
    const m = c.staticProps.model && resolveExpr(project, c.file, c.staticProps.model)?.node
    if (m) modelOwners.set(m, (modelOwners.get(m) || 0) + 1)
    if (c.intent?.fn) intentOwners.set(c.intent.fn, (intentOwners.get(c.intent.fn) || 0) + 1)
  }

  const declaredComponents = new Set()
  const declareComponent = (ref, name) => {
    const id = fnId(ref)
    if (declaredComponents.has(id)) return id
    declaredComponents.add(id)
    const c = project.componentForFunction(ref.node)
    const n = c?.node || ref.node
    let ident = n.id || null
    if (!ident) {
      const p = ref.file.parents.get(ref.node)
      if (p?.type === 'VariableDeclarator') ident = p.id
    }
    if (ident?.type === 'Identifier') add(c?.file || ref.file, ident, { name: c?.name || ident.name || name, ns: 'child', kind: 'component', role: 'declare', component: id, target: id })
    return id
  }

  for (const c of project.components) {
    const id = idOf(c)
    const sp = c.staticProps
    const own = c.viewInfo ? [c.viewInfo, ...project.injectedInto(c.view)] : []
    const m = sp.model && resolveExpr(project, c.file, sp.model)?.node
    const flags = {
      intentUnknown: !!sp.intent && !c.intent?.known,
      modelUnknown: !!sp.model && !c.model?.known,
      dynamicNext: !!c.model?.dynamicNext.length,
      dynamicReplies: !!c.model?.replyDynamic.length,
      dynamicConnections: !!c.connections?.dynamic.length,
      dynamicClasses: own.some(s => s.classes.patterns.length > 0),
      dynamicIds: own.some(s => s.ids.patterns.length > 0),
      stateUnknown: !!sp.initialState && !c.initialState?.known,
      calculatedUnknown: !!sp.calculated && !c.calculatedEntries,
      contextUnknown: !!sp.context && !c.contextEntries,
      usesOpen: openPrefixes(c.uses).length > 0,
      sharedModel: !!m && modelOwners.get(m) > 1,
      sharedIntent: !!c.intent?.fn && intentOwners.get(c.intent.fn) > 1,
    }
    components.push({ id, name: c.name, file: c.file.path, line: c.node?.loc?.start.line ?? 1, flags })
    const act = (kind, extra = {}) => ({ name: extra.name, kind, role: kind === 'model' || kind === 'behavior-model' ? 'handler' : 'trigger', component: id, ...extra })

    for (const a of c.intent?.actions || []) add(c.intent.file, a.node, act('intent', { name: a.name }))
    for (const k of c.intent?.computed || []) {
      const v = constName(project, c.intent.file, k.node)
      if (v) add(c.intent.file, k.node, act('intent', { name: v.value, via: viaOf(v.via), constant: true }))
    }
    if (c.model) {
      for (const e of c.model.entries) {
        const props = act('model', { name: e.action })
        if (e.node?.type === 'Identifier' && e.node.name !== e.key) props.synthetic = true // undoable(): at its callee
        if (e.shorthand) props.shorthand = true
        const dot = e.action.indexOf('.')
        if (dot > 0 && c.uses?.entries?.some(u => u.key === e.action.slice(0, dot))) props.behavior = e.action.slice(0, dot)
        add(e.file, e.node, props, { sub: e.shorthand })
      }
      for (const k of c.model.computed || []) {
        const v = constName(project, k.file, k.node)
        if (v) add(k.file, k.node, act('model', { name: v.value, via: viaOf(v.via), constant: true }))
      }
      for (const t of c.model.nextTargets) add(t.file, t.node, act('next', { name: t.name }))
      for (const d of c.model.dynamicNext) {
        const arg = d.node.arguments?.[0]
        const v = arg && constName(project, d.file, arg)
        if (v) add(d.file, arg, act('next', { name: v.value, via: viaOf(v.via), constant: true }))
      }
      for (const t of c.model.replyTargets) add(t.file, t.node, act('reply', { name: t.name, key: t.key, sink: t.sink }))
      // PARENT sink keys: what CHILD.select(this) receives
      for (const sv of c.model.sinkValues) {
        if (sv.sink !== 'PARENT') continue
        const kn = unwrap(sv.keyNode)
        const props = { name: sv.action, ns: 'child', kind: 'parent', role: 'parent', component: id, target: id }
        if (isLiteral(kn) && /\|/.test(kn.extra?.raw || '')) add(sv.file, kn, props, { part: sinkSub(kn, 'PARENT') })
        else add(sv.file, kn, props)
      }
    }
    for (const t of c.connections?.targets || []) {
      const kind = t.route ? 'route' : t.timer ? 'timer' : t.browser ? 'browser' : t.res ? 'resource' : 'connection'
      add(t.file, t.node, act(kind, { name: t.name, key: t.key }))
    }
    for (const a of c.agent?.actions || []) add(a.file, a.node, act('agent', { name: a.name }))
    // behavior-owned names ('pager.NEXT'): the `uses` entry key stands for the behavior's own
    // intent and model (first-party behaviors have no source)
    for (const e of c.uses?.entries || []) {
      for (const a of e.actions.keys()) {
        add(e.file, e.keyNode, act('uses', { name: `${e.key}.${a}`, behavior: e.key, firstParty: !!e.def?.firstParty }))
      }
      const def = e.def
      if (!def) continue
      const own = (t) => (def.model?.has(t) ? `${e.key}.${t}` : t)
      // options naming an action the behavior dispatches (form's submit: 'SIGN_UP')
      for (const o of def.nextOptions || []) {
        const opt = e.options.get(o)
        const v = opt && isLiteral(unwrap(opt.node)) ? unwrap(opt.node) : null
        if (v) add(opt.file, v, act('behavior-option', { name: own(v.value ?? v.quasis[0].value.cooked), behavior: e.key, key: o }))
      }
      const an = !def.firstParty && def.analysis
      if (!an) continue
      const b = { behavior: e.key }
      for (const x of an.model?.entries || []) add(x.file, x.node, act('behavior-model', { name: `${e.key}.${x.action}`, ...b, ...(x.shorthand ? { shorthand: true } : {}) }), { sub: x.shorthand })
      for (const t of an.model?.nextTargets || []) add(t.file, t.node, act('behavior-next', { name: own(t.name), ...b }))
      for (const t of an.model?.replyTargets || []) add(t.file, t.node, act('behavior-reply', { name: t.name, key: t.key, sink: t.sink, ...b }))
      for (const a of an.intent?.actions || []) add(an.intent.file, a.node, act('behavior-intent', { name: `${e.key}.${a.name}`, ...b }))
      for (const t of an.timers?.targets || []) add(t.file, t.node, act('behavior-timer', { name: own(t.name), key: t.key, ...b }))
    }

    // --- selectors: class / id tokens and controls ---
    if (c.viewInfo) {
      const scopes = own.map(s => sinkId(s, null))
      const selectors = [...(c.intent?.selectors || []), ...(c.behaviorSelectors || [])]
      for (const sel of selectors) {
        const file = sel.file || c.intent?.file
        if (!file || sel.global) continue
        const extra = sel.behavior ? { behavior: sel.behavior } : {}
        if (sel.controls?.length) {
          const arg = unwrap(sel.node)
          const parts = sel.control ? [arg] : arg?.type === 'TemplateLiteral' ? arg.expressions : []
          for (const part of parts) {
            const ctrl = sel.control || resolveControl(project, file, part)
            if (!ctrl) continue
            declareControl(ctrl)
            const props = { name: ctrl.key, ns: 'control', kind: 'control', role: 'selector', component: id, target: controlId(ctrl), scopes, ...extra }
            if (!own.some(s => s.controls.has(ctrl))) {
              const inChild = findInChildren(project, c.viewInfo, 'control', ctrl, (s, k, n) => s.controls.has(n))
              if (inChild) Object.assign(props, { childScope: sinkId(inChild.sink, null), child: inChild.child, path: inChild.via })
              else props.missing = true
            }
            add(file, part, props)
          }
          if (sel.control) continue
        }
        if (sel.dynamic || sel.selector == null) continue
        const lit = selectorLiteral(file, sel.node)
        if (!lit || lit.text !== sel.selector) continue
        for (const t of selectorTokens(sel.selector)) {
          const props = { name: t.name, ns: 'dom', kind: t.kind, role: 'selector', component: id, scopes, ...extra }
          if (!own.some(s => viewHas(s, t.kind, t.name))) {
            const inChild = findInChildren(project, c.viewInfo, t.kind, t.name)
            if (inChild) Object.assign(props, { childScope: sinkId(inChild.sink, null), child: inChild.child, path: inChild.via })
            if (own.some(s => patternHit(s, t.kind, t.name))) props.dynamic = true
            if (!inChild) props.missing = true // no static token renders it (highlights; `dynamic`: one might)
          }
          addSpan(file, lit.base + t.index, lit.base + t.index + t.length, props)
        }
      }
    }

    // --- state keys, Collection from ---
    for (const [name, v] of c.initialState?.keys || []) if (v.keyNode) add(v.file, v.keyNode, { name, ns: 'state', kind: 'state', role: 'declare', component: id })
    for (const [name, v] of c.calculatedEntries || []) if (v.keyNode) add(v.file, v.keyNode, { name, ns: 'state', kind: 'calculated', role: 'declare', component: id })
    for (const col of c.viewInfo?.collections || []) {
      if (col.from == null || !col.fromNode) continue
      let v = col.fromNode.value
      if (v?.type === 'JSXExpressionContainer') v = unwrap(v.expression)
      if (!isLiteral(v)) continue
      const file = col.file || (c.viewInfo.children.find(u => u.node === col.node)?.file)
      // a path ('board.cards', 6.5.0): its first segment is the use of the state key `board`
      const first = col.from.split(/[.[]/)[0]
      if (file && first) add(file, v, { name: first, ns: 'state', kind: 'from', role: 'use', component: id }, first === col.from ? {} : { part: [0, first.length] })
    }

    // --- context provided ---
    for (const [name, v] of c.contextEntries || []) if (v.keyNode) add(v.file, v.keyNode, { name, ns: 'context', kind: 'context', role: 'provide', component: id })

    // --- CHILD.select(Child) ---
    for (const cs of c.intent?.childSelects || []) {
      if (!cs.ref || !cs.arg) continue
      const target = declareComponent(cs.ref, cs.arg.name)
      add(c.intent.file, cs.arg, { name: project.componentForFunction(cs.ref.node)?.name || cs.arg.name || '?', ns: 'child', kind: 'child-select', role: 'use', component: id, target })
    }
    declareComponent({ file: c.file, node: c.view || c.node }, c.name)

    // --- child component tags in the view (semantic highlighting spike; not occurrences) ---
    const walkTags = (sink) => {
      for (const u of sink.children || []) {
        if (u.kind === 'tag' && u.ref && u.node?.name?.loc) {
          const abs = pathOf(u.file)
          if (abs && !exclude?.has(abs)) tags.push({ file: abs, ...range(u.node.name), name: u.name, component: id, target: fnId(u.ref) })
        }
        if (u.injected) walkTags(u.injected)
      }
    }
    for (const sink of own) {
      walkTags(sink)
      // <Collection of={Child}> / <Switchable of={{ a: Child }}>: the target expressions
      for (const col of sink.collections || []) {
        for (const t of col.targets || []) {
          const abs = pathOf(col.file || sink.children.find(u => u.node === col.node)?.file)
          if (t.ref && t.node?.loc && abs && !exclude?.has(abs)) tags.push({ file: abs, ...range(t.node), name: t.name, component: id, target: fnId(t.ref) })
        }
      }
    }
  }

  // --- context consumed: views (components and plain functions rendered as tags), reducers ---
  const usages = renderedUsages(project)
  const parents = new Map() // fn node → Set<fn node>
  const refs = new Map() // fn node → ref
  for (const { owner, usage } of usages) {
    if (!usage.ref) continue
    refs.set(usage.ref.node, usage.ref)
    refs.set(owner.ref.node, owner.ref)
    if (!parents.has(usage.ref.node)) parents.set(usage.ref.node, new Set())
    parents.get(usage.ref.node).add(owner.ref.node)
  }
  const providersCache = new Map()
  const providersOf = (fn, name) => {
    const k = fn
    let byName = providersCache.get(k)
    if (!byName) providersCache.set(k, byName = new Map())
    if (byName.has(name)) return byName.get(name)
    const out = []
    const visited = new Set([fn])
    let frontier = [fn]
    while (frontier.length) {
      const next = []
      for (const f of frontier) {
        const comp = project.componentForFunction(f)
        if (comp?.contextKeys.has(name)) { if (!out.includes(idOf(comp))) out.push(idOf(comp)); continue }
        for (const p of parents.get(f) || []) if (!visited.has(p)) { visited.add(p); next.push(p) }
      }
      frontier = next
    }
    byName.set(name, out)
    return out
  }
  const consume = (fn, ownerId, file, reads) => {
    for (const r of reads || []) add(r.file || file, r.node, { name: r.name, ns: 'context', kind: 'context', role: 'consume', component: ownerId, providers: providersOf(fn, r.name) })
  }
  for (const c of project.components) {
    if (!c.view) continue
    consume(c.view, idOf(c), c.file, c.contextConsumed)
    consume(c.view, idOf(c), c.file, c.contextReadsModel)
  }
  for (const [node, ref] of refs) {
    if (project.componentForFunction(node)) continue
    consume(node, fnId(ref), ref.file, contextReads(node))
  }

  // EVENTS, project-wide
  for (const e of project.events.emitted) add(e.file, e.node, { name: e.type, kind: 'emit', role: 'emit', component: null })
  for (const e of project.events.selected) {
    add(e.file, e.node, { name: e.type, kind: 'select', role: 'select', component: null, ...(e.implicit ? { implicit: true } : {}) })
  }
  let dynamicSelected = 0, dynamicEmitted = 0
  for (const [list, kind] of [[project.events.dynamicSelected, 'select'], [project.events.dynamicEmitted, 'emit']]) {
    for (const d of list) {
      const arg = d.node?.type === 'CallExpression' ? d.node.arguments[0] : null
      const v = arg && constName(project, d.file, arg)
      if (v) add(d.file, arg, { name: v.value, kind, role: kind, component: null, via: viaOf(v.via), constant: true })
      else if (kind === 'select') dynamicSelected++
      else dynamicEmitted++
    }
  }

  // by file (each path's rank in code-unit order, not a string comparison per pair), then position
  const rank = new Map([...new Set(occurrences.map(o => o.file))].sort().map((f, i) => [f, i]))
  occurrences.sort((a, b) => rank.get(a.file) - rank.get(b.file) || a.hit.start - b.hit.start || a.start - b.start)
  return { components, occurrences, tags, flags: { dynamicSelected, dynamicEmitted } }
}

const EVENT_ROLES = new Set(['emit', 'select'])
const isEvent = (o) => !o.ns && EVENT_ROLES.has(o.role)
const keyOf = (o) => {
  switch (o.ns) {
    case 'dom': return `dom\0${o.kind}\0${o.name}`
    case 'control': return `control\0${o.target}`
    case 'state': return `state\0${o.component}\0${o.name}`
    case 'context': return `context\0${o.name}`
    case 'child': return `child\0${o.target}`
  }
  return isEvent(o) ? `EVENTS\0${o.name}` : `${o.component}\0${o.name}`
}
// declarations, left out of references without includeDeclaration
const isDeclaration = (o) => {
  switch (o.ns) {
    case 'dom': return o.role === 'render'
    case 'control': case 'state': case 'child': return o.role === 'declare'
    case 'context': return o.role === 'provide'
  }
  return o.role === 'handler' || o.role === 'emit'
}
const posKey = (line, column) => line * 1e7 + column
const sortOccs = (list) => list.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.start - b.start)
const show = (o) => (o.kind === 'id' ? '#' : '.') + o.name

export function createLookup(index) {
  const byFile = new Map() // file → occurrences sorted by hit start
  const byKey = new Map()  // keyOf → occurrences
  const names = new Map((index.components || []).map(c => [c.id, c.name]))
  for (const o of index.occurrences) {
    if (!byFile.has(o.file)) byFile.set(o.file, [])
    byFile.get(o.file).push(o)
    const k = keyOf(o)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(o)
  }
  for (const list of byFile.values()) list.sort((a, b) => posKey(a.hit.line, a.hit.column) - posKey(b.hit.line, b.hit.column))

  function at(file, line, column) {
    const list = byFile.get(file)
    if (!list) return []
    const p = posKey(line, column)
    // the last occurrence starting at or before p
    let lo = 0, hi = list.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (posKey(list[mid].hit.line, list[mid].hit.column) <= p) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    if (found < 0) return []
    // tokens don't nest, but several occurrences can share one range (UNDO/REDO, a `uses` key,
    // a model shared by components, a helper's token in two views): they are contiguous and end at `found`
    const s = posKey(list[found].hit.line, list[found].hit.column)
    const out = []
    for (let i = found; i >= 0 && posKey(list[i].hit.line, list[i].hit.column) === s; i--) {
      if (p <= posKey(list[i].hit.endLine, list[i].hit.endColumn)) out.push(list[i])
    }
    return out.reverse()
  }

  const uniq = (list) => {
    const s = new Set()
    return sortOccs(list.filter(o => { const k = `${o.file}\0${o.start}\0${o.end}`; if (s.has(k)) return false; s.add(k); return true }))
  }
  const compName = (id) => names.get(id) || id

  /** A selector's (dom / control) targets: the own scope's renders, else the child's; and why. */
  function selectorTargets(o, same, notes) {
    const renders = same.filter(x => x.role === 'render')
    const own = renders.filter(x => o.scopes?.includes(x.scope))
    if (own.length) return { list: own, scopes: o.scopes }
    const what = o.ns === 'control' ? `control <${o.name}>` : `'${show(o)}'`
    if (o.childScope) {
      notes?.push(`${what} is only rendered inside child component <${o.child}>${o.path?.length > 1 ? ` (${o.path.join(' > ')})` : ''}; ${compName(o.component)} can't see its DOM events`)
      return { list: renders.filter(x => x.scope === o.childScope), scopes: [o.childScope] }
    }
    if (o.dynamic) notes?.push(`${what}: ${compName(o.component)}'s view has dynamic ${o.kind === 'id' ? 'ids' : 'class names'} and no literal ${what}`)
    else notes?.push(`${what} is not rendered in ${compName(o.component)}'s view`)
    return { list: [], scopes: [] }
  }

  function definition(occs, notes) {
    const out = []
    for (const o of occs) {
      const same = byKey.get(keyOf(o)) || []
      if (o.via) out.push(...o.via)
      switch (o.ns) {
        case 'dom':
          if (o.role === 'selector') out.push(...selectorTargets(o, same, notes).list)
          else out.push(...same.filter(x => x.role === 'selector' && (x.scopes?.includes(o.scope) || x.childScope === o.scope)))
          continue
        case 'control':
          if (o.role === 'selector') out.push(...same.filter(x => x.role === 'declare'), ...selectorTargets(o, same, notes).list)
          else if (o.role === 'render') out.push(...same.filter(x => x.role === 'declare'))
          else out.push(...same.filter(x => x.role === 'selector'))
          continue
        case 'state': {
          const want = o.role === 'use' ? 'declare' : 'use'
          const list = same.filter(x => x.role === want)
          if (!list.length && o.role === 'use') notes?.push(`${compName(o.component)} has no initialState or calculated key '${o.name}' (a Collection item or a child gets its state from its parent)`)
          out.push(...list)
          continue
        }
        case 'context':
          if (o.role === 'consume') {
            const list = same.filter(x => x.role === 'provide' && o.providers?.includes(x.component))
            if (!list.length) notes?.push(`no component rendering ${compName(o.component)} provides context '${o.name}'`)
            out.push(...list)
          } else out.push(...same.filter(x => x.role === 'consume' && x.providers?.includes(o.component)))
          continue
        case 'child':
          if (o.role === 'use') out.push(...same.filter(x => x.role === 'declare' || x.role === 'parent'))
          else out.push(...same.filter(x => x.role === 'use'))
          continue
      }
      if (o.role === 'select') out.push(...same.filter(x => x.role === 'emit'))
      else if (o.role === 'emit') out.push(...same.filter(x => x.role === 'select'))
      else if (o.role === 'handler') {
        const intents = same.filter(x => x.kind === 'intent')
        out.push(...(intents.length ? intents : same.filter(x => x.role === 'trigger')))
      } else out.push(...same.filter(x => x.role === 'handler'))
    }
    return uniq(out)
  }

  function references(occs, includeDeclaration = true) {
    const out = []
    for (const o of occs) {
      const same = byKey.get(keyOf(o)) || []
      let list = same
      if (o.ns === 'dom' || o.ns === 'control') {
        const scopes = o.role === 'selector' ? selectorTargets(o, same, null).scopes : o.role === 'render' ? [o.scope] : null
        list = scopes === null ? same : same.filter(x => x === o || x.role === 'declare' ||
          (x.role === 'render' ? scopes.includes(x.scope) : x.scopes?.some(s => scopes.includes(s)) || scopes.includes(x.childScope)))
      } else if (o.ns === 'context') {
        const providers = o.role === 'provide' ? [o.component] : o.providers || []
        list = same.filter(x => x === o || (x.role === 'provide' ? providers.includes(x.component) : x.providers?.some(p => providers.includes(p))))
      }
      for (const x of list) {
        if (!includeDeclaration && isDeclaration(x)) continue
        out.push(x)
      }
    }
    return uniq(out)
  }

  return { at, definition, references }
}
