/**
 * The per-project model that every rule queries.
 *
 * buildProject(files, { cwd?, sources?, cache?, tree? }) parses the files and produces:
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
 *     initialState: { known, keys: Map<key, { node (value), keyNode, file }> } | null
 *     calculatedKeys: Set<string>
 *     contextKeys: Set<string>
 *     calculatedEntries, contextEntries: Map<key, { node, keyNode, file }> | null   (PLAN-7 N-1:
 *                                      the same keys with their nodes; null when unknown)
 *     contextConsumed: [{ name, node }] | null   the context reads of the view (model/context.js)
 *     contextReadsModel: [{ name, node, file }]  the context reads of the model's handlers and statics
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
 * `sources` (Map<absPath, text> or a plain object; PLAN-7 C-1) holds an
 * editor's unsaved buffers: loadFile reads a file from it before the disk,
 * and import resolution counts a path in it as an existing file, so a new,
 * unsaved file resolves.
 *
 * `tree` ({ read(absPath) → text | null, isFile(absPath) → boolean }; PLAN-10 C-3) replaces the
 * disk: files are read and imports resolved only through it (`--base <ref>` builds the base graph
 * from a git commit this way). `sources` still come first.
 *
 * `cache` (a ParseCache, ../cache.js; PLAN-7 C-3) shares a file's parse
 * (ast, parents, suppressions) or its parse failure across builds while the
 * text is identical. Everything else (the FileInfo, components, the model,
 * parseErrors) is built per Project, unless `previous` is given.
 *
 * `previous` (a Project built before with the same inputs; native-tooling round 2, incremental
 * checking): this build reuses the previous one's FileInfo, with its analyzed components and
 * views, for every file whose text is unchanged and none of whose imports (transitively, through
 * loadImport) changed. The rest (`project.rebuilt`: the changed files and their importers, up the
 * import graph) is parsed (cache), discovered and analyzed again; the project-wide parts (events,
 * injected JSX) are joined again from the per-file parts. The model is the same as a fresh build's
 * because a component's analysis only reads its file and what it imports (model/*.js reach other
 * files only through loadImport / resolveExpr). A disk file whose size, mtime and inode are the
 * ones the previous build read isn't read again (unsaved buffers are compared as text). A
 * relative import that didn't resolve is retried,
 * and its importer rebuilt when it now does. The inputs must be the same files in the same order
 * with the same cwd, replyKeys and tree, else the build is a fresh one (`project.rebuilt` = null).
 *
 * The structure is plain data plus AST node references so later work (the
 * --graph output, strict rules) can serialize or query it without
 * re-parsing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseSource, indexParents, walk, unwrap, isFunction, memberName, propName, loc } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveImport, toSourceMap, diskIsFile } from '../files.js'
import { resolveExpr } from './resolve.js'
import { collectView, newSink } from './view.js'
import { analyzeIntent } from './intent.js'
import { analyzeModel, connectionNames, REPLY_KEYS } from './modelEntries.js'
import { scanFileEvents } from './events.js'
import { resolveSelectorControls } from './controls.js'
import { analyzeUses } from './behaviors.js'
import { analyzeTimers } from './timers.js'
import { analyzeAgent } from './agent.js'
import { contextReads, reducerContextReads, staticContextReads } from './context.js'
import { sygnalVersion } from './sygnalVersion.js'

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
  constructor({ cwd = process.cwd(), sources, cache, tree, replyKeys, previous } = {}) {
    this.cwd = cwd
    // PLAN-13 C-4: the config's custom reply keys (all sinks: an array; per sink: an object)
    this.replyKeys = replyKeys || []
    this.tree = tree || null // PLAN-10 C-3: a virtual file tree instead of the disk
    this.sources = toSourceMap(sources, cwd) // absPath → text (unsaved buffers)
    this.cache = cache || null // ParseCache (PLAN-7 C-3)
    this.files = new Map()
    this.scanned = new Set()
    this.components = []
    this.events = { selected: [], emitted: [], dynamicSelected: [], dynamicEmitted: [] }
    this.parseErrors = []
    this._componentFns = new WeakMap() // fn node → ComponentInfo-ish marker
    this._viewCache = new WeakMap()
    this._sygnalVersions = new Map()
    // incremental builds: what the next build needs to reuse this one's files
    this.previous = previous || null
    this.rebuilt = null // Set<absPath> re-analyzed by an incremental build; null: a fresh build
    this._inputs = null // [absPaths, cwd, replyKeys] of build()
    this._texts = new Map() // absPath → the text read (undefined: unreadable)
    this._fileErrors = new Map() // absPath → its parse error (FileInfo null)
    this._edges = new Map() // absPath → Set<absPath> it imports (loadImport)
    this._unresolved = new Map() // absPath → Set<spec>: relative imports that didn't resolve
    this._viewKeys = new Map() // absPath → fn nodes of that file with a viewOf() entry
    this._reused = new Set() // absPaths taken from `previous`
    this._stats = new Map() // absPath → size:mtime of the disk file read
  }

  /** Installed Sygnal and its timing contract, resolved independently for each package. */
  sygnalFor(file) {
    const p = typeof file === 'string' ? file : file.path
    return this._sygnalOfDir(path.dirname(p))
  }

  // sygnalVersion's walk up from `dir`, one directory at a time, each answer kept: the files of
  // one package share their ancestors' lookups (it read every ancestor's manifests once per dir)
  _sygnalOfDir(dir) {
    if (this._sygnalVersions.has(dir)) return this._sygnalVersions.get(dir)
    const parent = path.dirname(dir)
    const here = sygnalVersion(path.join(dir, '_'), this, { up: false })
    const v = here || (parent === dir ? sygnalVersion(path.join(dir, '_'), this) : this._sygnalOfDir(parent)) // (at the root: UNKNOWN)
    this._sygnalVersions.set(dir, v)
    return v
  }

  /** Parse (once) and index a file. Returns FileInfo or null if unreadable/unparseable. */
  loadFile(absPath) {
    if (this.files.has(absPath)) return this.files.get(absPath)
    const source = this._read(absPath)
    this._texts.set(absPath, source)
    if (source === undefined) { this.files.set(absPath, null); return null }
    const parsed = this.cache?.lookup(absPath, source) || this._parse(absPath, source)
    if (parsed.error) {
      const e = { file: absPath, ...parsed.error }
      this.parseErrors.push(e)
      this._fileErrors.set(absPath, e)
      this.files.set(absPath, null)
      return null
    }
    // the parse products may be shared through the cache; the FileInfo and what hangs off it are this build's
    const file = { path: absPath, source, ast: parsed.ast, parents: parsed.parents, suppressions: parsed.suppressions, components: [] }
    this.files.set(absPath, file)
    this._discoverComponents(file)
    return file
  }

  /** A file's text: an unsaved buffer, else `tree`, else the disk; undefined when unreadable. */
  _read(absPath) {
    if (this.sources.has(absPath)) return this.sources.get(absPath)
    if (this.tree) { const t = this.tree.read(absPath); return typeof t === 'string' ? t : undefined }
    try {
      const text = fs.readFileSync(absPath, 'utf8')
      this._stats.set(absPath, statKey(absPath))
      return text
    } catch { return undefined }
  }

  /**
   * Whether `absPath` may have changed since `prev` read it as `oldText`: an unsaved buffer is
   * compared as text; a disk file read last time with the same size and mtime now isn't read again.
   */
  _changedSince(prev, absPath, oldText) {
    if (!this.sources.has(absPath) && !prev.sources.has(absPath) && oldText !== undefined) {
      const was = prev._stats.get(absPath)
      if (was && was === statKey(absPath)) { this._stats.set(absPath, was); return false }
    }
    return this._read(absPath) !== oldText
  }

  /** Parse a text into { text, ast, parents, suppressions } or { text, error } (stored in the cache, if any). */
  _parse(absPath, text) {
    let entry
    try {
      const ast = parseSource(text, absPath)
      const parents = new WeakMap()
      indexParents(ast.program, parents)
      parents.set(ast.program, null)
      entry = { text, ast, parents, suppressions: parseSuppressions(ast) }
    } catch (err) {
      entry = { text, error: { message: err.message, line: err.loc?.line || 1, column: (err.loc?.column ?? 0) + 1 } }
    }
    return this.cache ? this.cache.store(absPath, entry) : entry
  }

  loadImport(fromFile, spec) {
    const target = resolveImport(fromFile.path, spec, { isFile: this._isFile })
    if (!target) {
      if (typeof spec === 'string' && (spec.startsWith('.') || spec.startsWith('/'))) addTo(this._unresolved, fromFile.path, spec)
      return null
    }
    addTo(this._edges, fromFile.path, target)
    return this.loadFile(target)
  }

  /** Whether a path exists for import resolution: an in-memory source, else a file on disk (or in `tree`). */
  _isFile = (p) => this.sources.has(p) || (this.tree ? this.tree.isFile(p) : diskIsFile(p))

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
    if (ref.file?.path) addTo(this._viewKeys, ref.file.path, ref.node, [])
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
      keys.set(k, { node: p.type === 'ObjectMethod' ? p : unwrap(p.value), keyNode: p.key, file: r.file })
    }
    return keys
  }

  _analyzeComponent(comp) {
    const { file, staticProps: sp } = comp
    if (sp.intent) {
      const r = resolveExpr(this, file, sp.intent)
      comp.intent = analyzeIntent(r.file, isFunction(r.node) ? r.node : null)
      for (const sel of comp.intent.selectors) resolveSelectorControls(this, comp.intent.file, sel)
      // PLAN-7 N-1: CHILD.select(Child) → the child's function
      for (const cs of comp.intent.childSelects) {
        const t = cs.arg && cs.arg.type !== 'StringLiteral' ? resolveExpr(this, comp.intent.file, cs.arg) : null
        cs.ref = t && isFunction(t.node) ? { file: t.file, node: t.node } : null
      }
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
    comp.calculatedEntries = null
    comp.contextEntries = null
    if (sp.calculated) {
      const keys = this.objectKeys(file, sp.calculated)
      if (keys) comp.calculatedKeys = new Set(keys.keys())
      comp.calculatedEntries = keys
    }
    if (sp.context) {
      const keys = this.objectKeys(file, sp.context)
      if (keys) comp.contextKeys = new Set(keys.keys())
      comp.contextEntries = keys
    }
    if (comp.view) comp.viewInfo = this.viewOf({ file, node: comp.view })
    // PLAN-7 N-1: the context entries the view and the reducers read (--graph contextConsumes: the view's)
    comp.contextConsumed = comp.view ? contextReads(comp.view) : null
    // (PLAN-13 F-1: and the declaration statics' context parameter)
    comp.contextReadsModel = [...(sp.model ? reducerContextReads(this, file, sp.model) : []), ...staticContextReads(this, file, sp)]
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
    this.cache?.beginBuild()
    this._inputs = [absPaths, this.cwd, JSON.stringify(this.replyKeys)]
    const prev = this.previous
    this.previous = null // (don't keep a chain of builds alive)
    if (prev && sameInputs(prev._inputs, this._inputs) && !prev.tree && !this.tree) this._reuse(prev)
    for (const p of absPaths) {
      this.scanned.add(p)
      this.loadFile(p)
    }
    for (const p of absPaths) {
      const file = this.files.get(p)
      if (!file) continue
      const reused = this._reused.has(p)
      for (const comp of file.components) {
        if (!reused) this._analyzeComponent(comp)
        this.components.push(comp)
      }
      const ev = fileEvents(file)
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
   * Take over `prev`'s files that can't have changed (see `previous` above): the files whose text
   * is the same and that import nothing that changed, transitively. Sets this.rebuilt.
   */
  _reuse(prev) {
    const changed = new Set()
    for (const [p, oldText] of prev._texts) if (this._changedSince(prev, p, oldText)) changed.add(p)
    // a relative import that now resolves (a new file) changes its importer
    for (const [p, specs] of prev._unresolved) {
      for (const spec of specs) if (resolveImport(p, spec, { isFile: this._isFile })) { changed.add(p); break }
    }
    // the changed files and everything that imports them
    const importers = new Map()
    for (const [from, tos] of prev._edges) for (const to of tos) addTo(importers, to, from)
    const rebuilt = new Set()
    const stack = [...changed]
    while (stack.length) {
      const p = stack.pop()
      if (rebuilt.has(p)) continue
      rebuilt.add(p)
      for (const q of importers.get(p) || []) stack.push(q)
    }
    this.rebuilt = rebuilt
    for (const [p, file] of prev.files) {
      if (rebuilt.has(p)) continue
      this._reused.add(p)
      this.files.set(p, file)
      this._texts.set(p, prev._texts.get(p))
      if (file) this.cache?.lookup(p, file.source) // keep its parse in the cache (beginBuild evicts unused entries)
      else if (prev._fileErrors.has(p)) {
        const e = prev._fileErrors.get(p)
        this.cache?.lookup(p, prev._texts.get(p))
        this.parseErrors.push(e)
        this._fileErrors.set(p, e)
      }
      if (prev._edges.has(p)) this._edges.set(p, new Set(prev._edges.get(p)))
      if (prev._unresolved.has(p)) this._unresolved.set(p, new Set(prev._unresolved.get(p)))
      for (const comp of file?.components || []) if (comp.view) this._componentFns.set(comp.view, comp)
      for (const node of prev._viewKeys.get(p) || []) {
        if (prev._viewCache.has(node)) this._viewCache.set(node, prev._viewCache.get(node))
        addTo(this._viewKeys, p, node, [])
      }
    }
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

function statKey(p) {
  try { const st = fs.statSync(p); return `${st.size}:${st.mtimeMs}:${st.ino}` } catch { return null }
}

function addTo(map, key, value, empty) {
  let c = map.get(key)
  if (!c) map.set(key, c = empty || new Set())
  if (Array.isArray(c)) c.push(value)
  else c.add(value)
}

function sameInputs(a, b) {
  return !!a && a[1] === b[1] && a[2] === b[2] && a[0].length === b[0].length && a[0].every((p, i) => p === b[0][i])
}

// scanFileEvents per FileInfo: a reused FileInfo keeps its scan
const eventsOf = new WeakMap()
function fileEvents(file) {
  if (!eventsOf.has(file)) eventsOf.set(file, scanFileEvents(file))
  return eventsOf.get(file)
}

export function buildProject(absPaths, options = {}) {
  return new Project(options).build(absPaths)
}

export { loc }
