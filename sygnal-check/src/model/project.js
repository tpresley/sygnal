/**
 * The per-project model that every rule queries.
 *
 * buildProject(files) parses the files and produces:
 *
 *   project.files        Map<absPath, FileInfo>   (scanned + loaded on demand)
 *   project.scanned      Set<absPath>             files diagnostics are reported for
 *   project.components   ComponentInfo[]          components in scanned files
 *   project.events       { selected, emitted, dynamicSelected, dynamicEmitted }
 *   project.parseErrors  [{ file, message, line, column }]
 *
 *   FileInfo {
 *     path, source, ast, parents: WeakMap<node, parent>,
 *     suppressions: Map<line, Set<code> | '*'>,
 *     components: ComponentInfo[]
 *   }
 *
 *   ComponentInfo {
 *     name, file, node (definition), view (function node | null),
 *     staticProps: { intent?, model?, initialState?, context?, calculated?, connections? }  (assigned value nodes)
 *     intent:  IntentInfo | null       (model/intent.js)
 *     model:   ModelInfo  | null       (model/modelEntries.js)
 *     initialState: { known, keys: Map<key, valueNode> } | null
 *     calculatedKeys: Set<string>
 *     contextKeys: Set<string>
 *     connections: { targets, dynamic } | null  (action names in a `connections`, `resources`,
 *                                                `route` or `timers` static: reply actions)
 *     timers: TimersInfo | null        (model/timers.js: the `timers` static, PLAN-4 GS-7)
 *     commands: Command[]              (model/elementCommands.js: ELEMENT commands, PLAN-4 GS-2)
 *     viewInfo: Sink | null            (model/view.js: classes, ids, children, collections)
 *     uses: UsesInfo | null            (model/behaviors.js: the `uses` static, resolved)
 *     behaviorSelectors: Selector[]    what its behaviors listen to through their options
 *     agent: AgentInfo | null          (model/agent.js: the `agent` static, PLAN-6 K-1)
 *   }
 *
 * The structure is plain data plus AST node references so later work (the
 * --graph output, strict rules) can serialize or query it without
 * re-parsing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseSource, indexParents, walk, unwrap, isFunction, memberName, propName, loc } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveImport } from '../files.js'
import { resolveExpr } from './resolve.js'
import { collectView, newSink } from './view.js'
import { analyzeIntent } from './intent.js'
import { analyzeModel, connectionNames, REPLY_KEYS } from './modelEntries.js'
import { scanFileEvents } from './events.js'
import { resolveSelectorControls } from './controls.js'
import { analyzeUses } from './behaviors.js'
import { analyzeTimers } from './timers.js'
import { analyzeAgent } from './agent.js'

const BROWSER_KEYS = ['action', 'error']
import { analyzeCommands } from './elementCommands.js'

// isolatedState: PLAN-4 4-G2 (static SYG405)
// agent: PLAN-6 K-1 (model/agent.js)
export const STATIC_PROPS = ['intent', 'model', 'initialState', 'isolatedState', 'context', 'calculated', 'connections', 'resources', 'route', 'head', 'uses', 'timers', 'persist', 'viewTransitions', 'browser', 'agent']

function parseSuppressions(ast) {
  const map = new Map()
  for (const c of ast.comments || []) {
    const m = /sygnal-ignore(?:-next-line|-line)?\b([^\n]*)/.exec(c.value)
    if (!m) continue
    const codes = m[1].match(/SYG\d{3}/g)
    const line = c.loc.end.line
    const entry = codes ? new Set(codes) : '*'
    const prev = map.get(line)
    if (prev === '*' || entry === '*') map.set(line, '*')
    else map.set(line, new Set([...(prev || []), ...entry]))
  }
  return map
}

export class Project {
  constructor({ cwd = process.cwd() } = {}) {
    this.cwd = cwd
    this.files = new Map()
    this.scanned = new Set()
    this.components = []
    this.events = { selected: [], emitted: [], dynamicSelected: [], dynamicEmitted: [] }
    this.parseErrors = []
    this._componentFns = new WeakMap() // fn node → ComponentInfo-ish marker
    this._viewCache = new WeakMap()
  }

  /** Parse (once) and index a file. Returns FileInfo or null if unreadable/unparseable. */
  loadFile(absPath) {
    if (this.files.has(absPath)) return this.files.get(absPath)
    let source
    try { source = fs.readFileSync(absPath, 'utf8') } catch { this.files.set(absPath, null); return null }
    let ast
    try {
      ast = parseSource(source, absPath)
    } catch (err) {
      this.parseErrors.push({ file: absPath, message: err.message, line: err.loc?.line || 1, column: (err.loc?.column ?? 0) + 1 })
      this.files.set(absPath, null)
      return null
    }
    const file = { path: absPath, source, ast, parents: new WeakMap(), suppressions: parseSuppressions(ast), components: [] }
    indexParents(ast.program, file.parents)
    file.parents.set(ast.program, null)
    this.files.set(absPath, file)
    this._discoverComponents(file)
    return file
  }

  loadImport(fromFile, spec) {
    const target = resolveImport(fromFile.path, spec)
    return target ? this.loadFile(target) : null
  }

  isComponentFunction(file, fnNode) {
    return this._componentFns.has(fnNode)
  }

  componentForFunction(fnNode) {
    return this._componentFns.get(fnNode) || null
  }

  /**
   * Component discovery: `X.intent = …` (and the other static props, or
   * Object.assign(X, {…})) in any statement of the file — module level or
   * nested (e.g. components declared inside a test). Assignments are
   * grouped by the binding they refer to, so two local `App`s in different
   * functions stay separate.
   */
  _discoverComponents(file) {
    const assigned = new Map() // binding node → { name, binding, props, propNodes, firstNode }
    const note = (ident, prop, value, at) => {
      const b = findBinding(file, ident.name, ident)
      if (!b || b.kind === 'import' || b.kind === 'param' || b.kind === 'pattern') return
      if (!assigned.has(b.node)) assigned.set(b.node, { name: ident.name, binding: b, props: {}, propNodes: {} })
      const e = assigned.get(b.node)
      e.props[prop] = value
      e.propNodes[prop] = at
    }
    walk(file.ast.program, (stmt) => {
      if (stmt.type !== 'ExpressionStatement') return true
      const ex = unwrap(stmt.expression)
      const exprs = ex.type === 'SequenceExpression' ? ex.expressions.map(unwrap) : [ex]
      for (const e of exprs) {
        if (e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'MemberExpression') {
          const obj = unwrap(e.left.object)
          const prop = memberName(e.left)
          if (obj.type === 'Identifier' && STATIC_PROPS.includes(prop)) note(obj, prop, e.right, e.left)
        } else if (e.type === 'CallExpression') {
          const c = unwrap(e.callee)
          const target = unwrap(e.arguments[0])
          const src = unwrap(e.arguments[1])
          if (c.type === 'MemberExpression' && unwrap(c.object).type === 'Identifier' && unwrap(c.object).name === 'Object' &&
              memberName(c) === 'assign' && target?.type === 'Identifier' && src?.type === 'ObjectExpression') {
            for (const p of src.properties) {
              const k = p.type === 'ObjectProperty' ? propName(p) : null
              if (k && STATIC_PROPS.includes(k)) note(target, k, p.value, p.key)
            }
          }
        }
      }
      return true
    })
    for (const info of assigned.values()) {
      const b = info.binding
      let view = null
      if (b.kind === 'function') view = b.node
      else if (b.kind === 'var' && isFunction(unwrap(b.init))) view = unwrap(b.init)
      const comp = {
        name: info.name, file, node: b.node, view,
        staticProps: info.props, staticPropNodes: info.propNodes,
        intent: null, model: null, initialState: null, connections: null,
        calculatedKeys: new Set(), contextKeys: new Set(), viewInfo: null,
      }
      file.components.push(comp)
      if (view) this._componentFns.set(view, comp)
    }
  }

  /** Own-scope view of a function (memoized). */
  viewOf(ref) {
    if (!ref?.node) return null
    if (this._viewCache.has(ref.node)) return this._viewCache.get(ref.node)
    const sink = newSink()
    this._viewCache.set(ref.node, sink) // recursion guard
    collectView(this, ref.file, ref.node, sink)
    return sink
  }

  /** Static object keys of an expression (follows identifiers / spreads). null when unknown. */
  objectKeys(file, node, depth = 0) {
    const r = resolveExpr(this, file, node)
    const obj = r?.node
    if (!obj || obj.type !== 'ObjectExpression' || depth > 6) return null
    const keys = new Map()
    for (const p of obj.properties) {
      if (p.type === 'SpreadElement') {
        const inner = this.objectKeys(r.file, p.argument, depth + 1)
        if (!inner) return null
        for (const [k, v] of inner) keys.set(k, v)
        continue
      }
      const k = propName(p)
      if (k == null) return null
      keys.set(k, { node: p.type === 'ObjectMethod' ? p : unwrap(p.value), file: r.file })
    }
    return keys
  }

  _analyzeComponent(comp) {
    const { file, staticProps: sp } = comp
    if (sp.intent) {
      const r = resolveExpr(this, file, sp.intent)
      comp.intent = analyzeIntent(r.file, isFunction(r.node) ? r.node : null)
      for (const sel of comp.intent.selectors) resolveSelectorControls(this, comp.intent.file, sel)
    }
    if (sp.model) comp.model = analyzeModel(this, file, sp.model)
    // PLAN-3 §1.3: action names a `connections` static sends socket/SSE events to
    comp.connections = sp.connections ? connectionNames(this, file, sp.connections) : null
    // PLAN-3 3-A (exp): and the ok/error names of a `resources` static's requests
    if (sp.resources) {
      const r = connectionNames(this, file, sp.resources, REPLY_KEYS)
      r.targets.forEach(t => { t.res = true })
      comp.connections = { targets: [...(comp.connections?.targets || []), ...r.targets], dynamic: [...(comp.connections?.dynamic || []), ...r.dynamic] }
    }
    // PLAN-3 5-4b: `App.route = 'ROUTE'` names the router's reply action
    if (sp.route) {
      const conn = comp.connections || (comp.connections = { targets: [], dynamic: [] })
      if (sp.route.type === 'StringLiteral') conn.targets.push({ name: sp.route.value, key: 'route', node: sp.route, file, route: true })
      else conn.dynamic.push({ node: sp.route, file })
    }
    // PLAN-4 GS-7: the action names a `timers` static dispatches (reply actions of the timer driver)
    comp.timers = sp.timers ? analyzeTimers(this, file, sp.timers) : null
    if (comp.timers) {
      const conn = comp.connections || (comp.connections = { targets: [], dynamic: [] })
      conn.targets.push(...comp.timers.targets)
      conn.dynamic.push(...comp.timers.dynamic)
    }
    // PLAN-5 B-3: the action names a `browser` static dispatches (`action`, `error`: reply actions
    // of the browser driver); its specs aren't judged statically (the dev entry's SYG663)
    if (sp.browser) {
      const b = analyzeTimers(this, file, sp.browser, BROWSER_KEYS)
      const conn = comp.connections || (comp.connections = { targets: [], dynamic: [] })
      conn.targets.push(...b.targets.map(t => ({ ...t, timer: false, browser: true })))
      conn.dynamic.push(...b.dynamic)
    }
    if (sp.initialState) {
      const keys = this.objectKeys(file, sp.initialState)
      comp.initialState = { known: !!keys, keys: keys || new Map() }
    }
    if (sp.calculated) {
      const keys = this.objectKeys(file, sp.calculated)
      if (keys) comp.calculatedKeys = new Set(keys.keys())
    }
    if (sp.context) {
      const keys = this.objectKeys(file, sp.context)
      if (keys) comp.contextKeys = new Set(keys.keys())
    }
    if (comp.view) comp.viewInfo = this.viewOf({ file, node: comp.view })
    // PLAN-4 GS-2: the ELEMENT commands its model sends (literal command objects)
    comp.commands = analyzeCommands(this, comp)
    // PLAN-4 GS-1: `uses` resolved to behavior definitions; what their intents listen to
    // through the options (controls passed at the uses site) joins the intent's selectors
    comp.uses = undefined
    analyzeUses(this, comp)
    comp.behaviorSelectors = (comp.uses?.entries || []).flatMap(e => e.selectors)
    // PLAN-6 K-1: the `agent` static (its actions are triggers: SYG102; SYG150, SYG440, ...)
    comp.agent = sp.agent ? analyzeAgent(this, file, sp.agent) : null
  }

  /** Scan the given files and build the full model. */
  build(absPaths) {
    for (const p of absPaths) {
      this.scanned.add(p)
      this.loadFile(p)
    }
    for (const p of absPaths) {
      const file = this.files.get(p)
      if (!file) continue
      for (const comp of file.components) {
        this._analyzeComponent(comp)
        this.components.push(comp)
      }
      const ev = scanFileEvents(file)
      this.events.selected.push(...ev.selected)
      this.events.emitted.push(...ev.emitted)
      this.events.dynamicSelected.push(...ev.dynamicSelected)
      this.events.dynamicEmitted.push(...ev.dynamicEmitted)
    }
    this._indexInjected()
    for (const comp of this.components) {
      if (!comp.model) continue
      this.events.emitted.push(...comp.model.eventsEmitted.map(e => ({ ...e, component: comp.name })))
      this.events.dynamicEmitted.push(...comp.model.eventsDynamic.map(e => ({ ...e, component: comp.name })))
    }
    return this
  }

  /**
   * JSX passed INTO a child (children / slots / JSX props) renders in the
   * child's scope. Index it per child function so the child's own selector
   * checks can see it: this.injected: WeakMap<fnNode, Sink[]>.
   */
  _indexInjected() {
    this.injected = new WeakMap()
    const seenViews = new Set()
    const visitSink = (sink) => {
      for (const usage of sink.children) {
        if (usage.ref) {
          if (!this.injected.has(usage.ref.node)) this.injected.set(usage.ref.node, [])
          this.injected.get(usage.ref.node).push(usage.injected)
          const childView = this.viewOf(usage.ref)
          if (childView && !seenViews.has(childView)) { seenViews.add(childView); visitSink(childView) }
        }
        visitSink(usage.injected)
      }
    }
    for (const comp of this.components) {
      if (comp.viewInfo && !seenViews.has(comp.viewInfo)) { seenViews.add(comp.viewInfo); visitSink(comp.viewInfo) }
    }
  }

  /** Sinks of JSX that parents pass into this component function. */
  injectedInto(fnNode) {
    return (fnNode && this.injected?.get(fnNode)) || []
  }

  relPath(abs) {
    return path.relative(this.cwd, abs) || abs
  }

  /** Name of the scanned component whose source range contains `node` (for events). */
  componentAt(file, node) {
    let n = node
    while (n) {
      for (const c of file.components) {
        if (c.view === n) return c
        for (const v of Object.values(c.staticProps)) if (v === n) return c
      }
      n = file.parents.get(n)
    }
    return null
  }
}

export function buildProject(absPaths, options = {}) {
  return new Project(options).build(absPaths)
}

export { loc }
