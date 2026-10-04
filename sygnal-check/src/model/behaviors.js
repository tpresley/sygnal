/**
 * Behaviors (PLAN-4 GS-1): a component's `uses` static, resolved to the
 * behavior definitions it names.
 *
 *   C.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }
 *
 * A `uses` value resolves when it is a call of
 *   - a `defineBehavior({ ... })` factory (same file, or through relative
 *     imports and re-exports), or
 *   - a first-party behavior imported from 'sygnal' (pager, selection, undo),
 *     modelled below as known definitions.
 * A call of anything else (a package's behavior, a wrapper function) is
 * opaque: the rules assume nothing about it. A value that is not a call (an
 * object literal, an uncalled factory) is invalid (SYG127).
 *
 *   analyzeUses(project, comp) → {
 *     known: boolean,                  // the uses object itself was readable
 *     node, file,                      // the `uses` value
 *     entries: UsesEntry[],
 *   }
 *   UsesEntry {
 *     key, keyNode, node (the value), file,
 *     status: 'resolved' | 'opaque' | 'invalid', reason?,
 *     def: BehaviorDef | null,
 *     options: Map<name, { node, keyNode, file }>,  optionsKnown: boolean,
 *     selectors: Selector[],           // what the behavior's intent listens to through its
 *                                      // options, in the intent selector shape (+ file, behavior, option)
 *     actions: Map<ACTION, { intent: boolean, sinks: string[] }>   // un-namespaced
 *   }
 *   BehaviorDef {
 *     name, firstParty, file, node,
 *     stateKeys: string[] | null, calculated: string[],
 *     model: Map<ACTION, string[] (sinks)> | null (unknown),
 *     intentActions: string[] | null (unknown),  // unconditional intent actions
 *     listens: [{ option, method, action|null, node? }],  // DOM.<method>(option)
 *     optionNames: Set<string> | null (null: reads options in a way we can't follow),
 *     nextTargets: string[], replyTargets: string[], dynamic: boolean,
 *   }
 */
import { walk, unwrap, isFunction, propName, memberName, stringValue } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from './resolve.js'
import { analyzeModel } from './modelEntries.js'
import { analyzeIntent, selectorValue, returnedExpressions } from './intent.js'
import { resolveSelectorControls, resolveControl } from './controls.js'
import { GLOBAL_SELECTORS } from '../selectors.js'

const SYGNAL_MODULE = /^sygnal(\/|$)/

/** The first-party behaviors exported from 'sygnal' (src/extra/pager.ts, selection.ts, undo.ts). */
export const FIRST_PARTY = {
  pager: {
    stateKeys: ['page', 'pageSize', 'total'],
    calculated: ['offset', 'pages', 'hasPrev', 'hasNext'],
    model: ['NEXT', 'PREV', 'GOTO', 'SET_TOTAL'],
    options: ['pageSize', 'page', 'total', 'next', 'prev'],
    listens: [['next', 'NEXT'], ['prev', 'PREV']],
  },
  selection: {
    stateKeys: ['selected'],
    calculated: ['count'],
    model: ['SELECT', 'SELECT_ALL', 'TOGGLE_ALL', 'CLEAR'],
    options: ['multi', 'item', 'all', 'clear', 'attr', 'from', 'idField'],
    listens: [['item', 'SELECT'], ['all', 'TOGGLE_ALL'], ['clear', 'CLEAR']],
  },
  undo: {
    stateKeys: ['past', 'future'],
    calculated: ['canUndo', 'canRedo'],
    model: ['UNDO', 'REDO'],
    options: ['key', 'limit', 'track', 'coalesce', 'coalesceMs', 'resetOn', 'undo', 'redo'],
    listens: [['undo', 'UNDO'], ['redo', 'REDO']],
  },
}

/** The 'sygnal' export an identifier is bound to (any local name), or null. */
export function sygnalImport(file, ident) {
  ident = unwrap(ident)
  if (ident?.type !== 'Identifier') return null
  const b = findBinding(file, ident.name, ident)
  return b && b.kind === 'import' && SYGNAL_MODULE.test(b.source) ? b.imported : null
}

const isDefineBehaviorCall = (file, node) =>
  node?.type === 'CallExpression' && sygnalImport(file, node.callee) === 'defineBehavior'

function firstPartyDef(name) {
  const fp = FIRST_PARTY[name]
  return {
    name, firstParty: true, file: null, node: null,
    stateKeys: fp.stateKeys, calculated: fp.calculated,
    model: new Map(fp.model.map(a => [a, ['STATE']])),
    intentActions: [],
    listens: fp.listens.map(([option, action]) => ({ option, method: 'click', action })),
    optionNames: new Set([...fp.options]),
    nextTargets: [], replyTargets: [], dynamic: false,
  }
}

const defCache = new WeakMap() // defineBehavior CallExpression → BehaviorDef

/** A defineBehavior({ ... }) call's definition. */
function userDef(project, file, call, name) {
  if (defCache.has(call)) return defCache.get(call)
  const def = {
    name, firstParty: false, file, node: call,
    stateKeys: null, calculated: [], model: null, intentActions: null,
    listens: [], optionNames: null, nextTargets: [], replyTargets: [], dynamic: false,
  }
  defCache.set(call, def)
  const keys = project.objectKeys(file, call.arguments[0])
  if (!keys) return def
  const at = (k) => keys.get(k)
  if (at('initialState')) {
    const s = project.objectKeys(at('initialState').file, at('initialState').node)
    def.stateKeys = s ? [...s.keys()] : null
  } else def.stateKeys = []
  if (at('calculated')) {
    const c = project.objectKeys(at('calculated').file, at('calculated').node)
    if (c) def.calculated = [...c.keys()]
  }
  if (at('model')) {
    const m = analyzeModel(project, at('model').file, at('model').node)
    if (m.known) {
      def.model = new Map()
      for (const e of m.entries) def.model.set(e.action, [...new Set([...(def.model.get(e.action) || []), ...e.sinks])])
    }
    def.nextTargets = m.nextTargets.map(t => t.name)
    def.replyTargets = m.replyTargets.map(t => t.name)
    def.dynamic = m.dynamicNext.length > 0 || m.replyDynamic.length > 0
  } else def.model = new Map()
  const stateOptions = def.stateKeys || []
  if (!at('intent')) {
    def.intentActions = []
    def.optionNames = def.stateKeys ? new Set(stateOptions) : null
    return def
  }
  const r = resolveExpr(project, at('intent').file, at('intent').node)
  const fn = r && isFunction(r.node) ? r.node : null
  if (!fn) return def
  const intent = analyzeIntent(r.file, fn)
  def.intentActions = intent.known ? intent.actions.map(a => a.name) : null
  const opts = optionParam(r.file, fn)
  def.optionNames = opts.names && def.stateKeys ? new Set([...opts.names, ...stateOptions]) : null
  for (const sel of intent.selectors) {
    const option = opts.optionOf(sel.node)
    if (option) def.listens.push({ option, method: sel.method, action: actionOf(r.file, fn, sel.node) })
  }
  return def
}

/**
 * The options parameter of a behavior intent (its 2nd parameter):
 *   ({ DOM }, { next, prev: back })  → names { next, prev }, next → 'next', back → 'prev'
 *   ({ DOM }, o) with o.next reads   → names { next }
 * names is null when the options are used another way (passed on, spread, rest).
 */
function optionParam(file, fn) {
  let p = fn.params[1]
  if (p?.type === 'AssignmentPattern') p = p.left
  const locals = new Map()
  let names = new Set()
  let whole = null
  if (!p) return { names, optionOf: () => null }
  if (p.type === 'ObjectPattern') {
    for (const prop of p.properties) {
      if (prop.type !== 'ObjectProperty') { names = null; continue }
      const k = propName(prop)
      let v = prop.value
      if (v.type === 'AssignmentPattern') v = v.left
      if (k == null) { names = null; continue }
      names?.add(k)
      if (v.type === 'Identifier') locals.set(v.name, k)
    }
  } else if (p.type === 'Identifier') {
    whole = p.name
    // every use of `o` must be `o.name`
    const uses = []
    walk(fn.body, (n) => {
      if (n.type === 'Identifier' && n.name === whole) uses.push(file.parents.get(n))
      return true
    })
    for (const u of uses) {
      if ((u?.type === 'MemberExpression' || u?.type === 'OptionalMemberExpression') && !u.computed && memberName(u)) names?.add(memberName(u))
      else names = null
    }
  } else names = null
  const optionOf = (node) => {
    node = unwrap(node)
    if (node?.type === 'Identifier' && locals.has(node.name)) {
      const b = findBinding(file, node.name, node)
      return b?.kind === 'param' || b?.kind === 'pattern' || !b ? locals.get(node.name) : null
    }
    if (whole && (node?.type === 'MemberExpression' || node?.type === 'OptionalMemberExpression') &&
        unwrap(node.object)?.type === 'Identifier' && unwrap(node.object).name === whole) return memberName(node)
    return null
  }
  return { names, optionOf }
}

/** The intent action a selector argument's stream belongs to: `{ NEXT: DOM.click(next) }` → 'NEXT'. */
function actionOf(file, fn, node) {
  let n = node
  while (n && n !== fn) {
    const p = file.parents.get(n)
    if (p?.type === 'ObjectProperty' && p.value === n) {
      const obj = file.parents.get(p)
      if (obj?.type === 'ObjectExpression' && returnedExpressions(fn).some(r => unwrap(r) === obj)) return propName(p)
    }
    n = p
  }
  return null
}

/** Resolve one `uses` value. */
function resolveEntry(project, file, value) {
  const v = unwrap(value)
  if (!v) return { status: 'invalid', reason: 'empty' }
  if (v.type === 'CallExpression') {
    const callee = unwrap(v.callee)
    const imp = sygnalImport(file, callee)
    if (imp && FIRST_PARTY[imp]) return { status: 'resolved', def: firstPartyDef(imp), call: v, file }
    if (imp === 'defineBehavior') return { status: 'invalid', reason: 'factory', name: 'defineBehavior(...)' }
    // defineBehavior({ ... })(options) inline, or a factory bound to a name
    const r = isDefineBehaviorCall(file, callee) ? { file, node: callee } : resolveExpr(project, file, callee)
    if (r && isDefineBehaviorCall(r.file, r.node)) {
      return { status: 'resolved', def: userDef(project, r.file, r.node, calleeName(callee)), call: v, file }
    }
    // a first-party behavior re-exported through a relative module
    if (r?.node?.type === 'Identifier' && r.file !== file) {
      const imp2 = sygnalImport(r.file, r.node)
      if (imp2 && FIRST_PARTY[imp2]) return { status: 'resolved', def: firstPartyDef(imp2), call: v, file }
    }
    return { status: 'opaque', call: v, file }
  }
  if (v.type === 'Identifier' || v.type === 'MemberExpression') {
    const imp = sygnalImport(file, v)
    if (imp && FIRST_PARTY[imp]) return { status: 'invalid', reason: 'factory', name: imp }
    const r = resolveExpr(project, file, v)
    if (!r || r.node === v) return { status: 'opaque' }
    if (isDefineBehaviorCall(r.file, r.node)) return { status: 'invalid', reason: 'factory', name: calleeName(v) }
    if (r.node.type === 'CallExpression') return resolveEntry(project, r.file, r.node)
    return literalInvalid(r.node) || { status: 'opaque' }
  }
  return literalInvalid(v) || { status: 'opaque' }
}

function literalInvalid(n) {
  if (n.type === 'ObjectExpression') return { status: 'invalid', reason: 'object' }
  if (/Literal$/.test(n.type) || (n.type === 'Identifier' && n.name === 'undefined')) return { status: 'invalid', reason: 'literal' }
  if (isFunction(n)) return { status: 'invalid', reason: 'function' }
  return null
}

const calleeName = (c) => {
  c = unwrap(c)
  return c?.type === 'Identifier' ? c.name : c?.type === 'MemberExpression' ? memberName(c) : null
}

/** A component's `uses`, resolved (memoized on the component). */
export function analyzeUses(project, comp) {
  if (comp.uses !== undefined) return comp.uses
  const sp = comp.staticProps.uses
  if (!sp) return (comp.uses = null)
  const r = resolveExpr(project, comp.file, sp)
  const out = { known: false, node: sp, file: comp.file, entries: [] }
  comp.uses = out
  if (!r?.node || r.node.type !== 'ObjectExpression') return out
  out.known = true
  for (const p of r.node.properties) {
    const key = p.type === 'ObjectProperty' ? propName(p) : null
    if (key == null) { out.known = false; continue }
    const res = resolveEntry(project, r.file, p.value)
    const entry = {
      key, keyNode: p.key, node: unwrap(p.value), file: r.file,
      status: res.status, reason: res.reason, factoryName: res.name || null,
      def: res.def || null, options: new Map(), optionsKnown: true, selectors: [], actions: new Map(),
    }
    // options: the call's first argument (an object literal, or a const bound to one)
    const call = res.call
    if (call) {
      const arg = call.arguments[0]
      if (arg) {
        const a = resolveExpr(project, res.file, arg)
        if (a?.node?.type === 'ObjectExpression') {
          for (const op of a.node.properties) {
            const k = op.type === 'ObjectProperty' ? propName(op) : null
            if (k == null) { entry.optionsKnown = false; continue }
            entry.options.set(k, { node: unwrap(op.value), keyNode: op.key, file: a.file })
          }
        } else entry.optionsKnown = false
      }
    }
    const def = entry.def
    if (def) {
      for (const [a, sinks] of def.model || []) entry.actions.set(a, { intent: false, sinks })
      for (const a of def.intentActions || []) {
        const e = entry.actions.get(a) || { intent: false, sinks: [] }
        e.intent = true
        entry.actions.set(a, e)
      }
      for (const l of def.listens) {
        const opt = entry.options.get(l.option)
        if (!opt) continue
        if (l.action) {
          const e = entry.actions.get(l.action) || { intent: false, sinks: [] }
          e.intent = true
          entry.actions.set(l.action, e)
        }
        const v = selectorValue(opt.node, opt.file)
        const sel = { ...v, node: opt.node, method: l.method, global: v.selector != null && GLOBAL_SELECTORS.has(v.selector.trim()), file: opt.file, behavior: key, option: l.option }
        resolveSelectorControls(project, opt.file, sel)
        entry.selectors.push(sel)
      }
    }
    out.entries.push(entry)
  }
  return out
}

/**
 * Controls passed as options the static side can't see used (an opaque or
 * unanalysable behavior, or an option of a known one we can't follow): they
 * count as listened (SYG126), with no false positives.
 */
export function assumedListened(project, uses) {
  const out = new Set()
  for (const e of uses?.entries || []) {
    const names = e.def?.optionNames
    for (const [name, opt] of e.options) {
      if (names) {
        if (e.def.listens.some(l => l.option === name)) continue    // in e.selectors
        if (!names.has(name)) continue                               // not an option it reads (SYG127)
        if (e.def.firstParty) continue                               // first-party: exactly known
        // a user behavior reads it some other way (passes it to a helper): assume it listens
      }
      const c = resolveControl(project, opt.file, opt.node)
      if (c) out.add(c)
    }
  }
  return out
}

/** Every behavior-owned action name ('pager.NEXT') of a component, with its entry. */
export function behaviorActions(uses) {
  const out = new Map()
  for (const e of uses?.entries || []) for (const [a, info] of e.actions) out.set(`${e.key}.${a}`, { entry: e, action: a, ...info })
  return out
}

/** Prefixes ('pager.') whose actions can't be listed: opaque/invalid entries, unknown models. */
export function openPrefixes(uses) {
  return (uses?.entries || []).filter(e => !e.def || !e.def.model).map(e => e.key + '.')
}

export { stringValue }
