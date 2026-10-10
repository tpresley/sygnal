/**
 * Behaviors (PLAN-4 GS-1): a component's `uses` static, resolved to the
 * behavior definitions it names.
 *
 *   C.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }
 *
 * A `uses` value resolves when it is a call of
 *   - a `defineBehavior({ ... })` factory (same file, or through relative
 *     imports and re-exports), or
 *   - a first-party behavior imported from 'sygnal' (pager, selection, undo, form, sortable),
 *     modelled below as known definitions.
 *   - D199 (PLAN-5): a factory function that returns such a call with the options it got,
 *     `(opts) => base(opts)`, `(opts = {}) => base({ delay: 300, ...opts })`,
 *     `(opts) => defineBehavior({ ... })(opts)`: checked as a direct use (its options at the
 *     use site are the behavior's).
 * A call of anything else (a package's behavior, a wrapper that changes the options) is
 * opaque: the rules assume nothing about it. A value that is not a call (an
 * object literal, an uncalled factory) is invalid (SYG127).
 *
 * D197: a behavior reads its options in the intent (2nd parameter), in `timers` (2nd) and in
 * its model handlers (5th: `(slice, data, next, props, options, key)`, HOST entries too); a
 * `timers` spec's action is a trigger like a next() target.
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
 *     listens: [{ option, method, action|null, node? }],  // DOM.<method>(option); method 'select': any event
 *     optionNames: Set<string> | null (null: reads options in a way we can't follow),
 *     nextTargets: string[], replyTargets: string[], dynamic: boolean,
 *   }
 */
import { walk, unwrap, isFunction, propName, memberName, stringValue } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from './resolve.js'
import { analyzeModel } from './modelEntries.js'
import { analyzeIntent, selectorValue, returnedExpressions } from './intent.js'
import { analyzeTimers } from './timers.js'
import { resolveSelectorControls, resolveControl } from './controls.js'
import { GLOBAL_SELECTORS } from '../selectors.js'

const SYGNAL_MODULE = /^sygnal(\/|$)/

/**
 * The first-party behaviors exported from 'sygnal' (src/extra/pager.ts, selection.ts, undo.ts,
 * form.ts) and 'sygnal/ui' (src/ui/*.ts: dialog, popover, tooltip, tabs, accordion, disclosure).
 */
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
  // PLAN-5 F-1: form(schema, options) (src/extra/form.ts). It listens to input/focusout/submit on
  // the form element (option `form`, default 'form'), so fields inside it count as listened
  // (SYG111); its model is open (CHANGE, SET (G-647), BLUR, SUBMIT, ADD, REMOVE, ERRORS, DONE, RESET,
  // RESULT, VALIDATE, and CHECKED_<field> per `check` entry); the host action named by
  // `submit` is dispatched with next() (a trigger for SYG102); options are the 2nd argument.
  form: {
    stateKeys: ['values', 'initial', 'errors', 'touched', 'server', 'remote', 'pending', 'submitting', 'submitted', 'submitCount', 'queued', 'validating', 'validated'],
    calculated: ['fields', 'valid', 'dirty', 'error'],
    model: null,
    options: ['values', 'submit', 'form', 'check', 'show', 'http', 'resetOnShow', 'tool'],
    listens: [['form', null, 'select']],
    defaults: { form: 'form' },
    nextOptions: ['submit'],
    optionsArg: 1,
  },
  // PLAN-5 B-1: sortable({ from, item, handle, ... }) (src/extra/sortable.ts). It listens on the
  // host's root and finds the item / handle from the event target (delegated: items are usually
  // rendered by Collection children, so the selectors may match elements of the views the host
  // renders, not only its own; SYG110 still reports one rendered nowhere). INIT, HELP, END and the pointer
  // actions come from its intent; DROPPED is dispatched with next() (a host entry extends it).
  sortable: {
    stateKeys: ['dragging', 'over', 'after', 'list', 'mode', 'press', 'origin', 'message', 'helpId'],
    calculated: [],
    model: ['INIT', 'HELP', 'END', 'PRESS', 'MOVE', 'UP', 'CANCEL', 'KEY', 'DROPPED'],
    options: ['from', 'item', 'handle', 'axis', 'threshold', 'attr', 'idField', 'label', 'messages'],
    listens: [['item', 'PRESS', 'select', true], ['handle', 'KEY', 'select', true]],
    intent: ['INIT', 'HELP', 'END', 'PRESS', 'MOVE', 'UP', 'CANCEL', 'KEY', 'DROPPED'],
  },
  undo: {
    stateKeys: ['past', 'future'],
    calculated: ['canUndo', 'canRedo'],
    model: ['UNDO', 'REDO'],
    options: ['key', 'limit', 'track', 'coalesce', 'coalesceMs', 'resetOn', 'undo', 'redo'],
    listens: [['undo', 'UNDO'], ['redo', 'REDO']],
  },
  // PLAN-6 L-3: chat(options) from 'sygnal/ai' (src/extra/ai/chat/behavior.ts). Its selectors are
  // the host's (the panel markup is part of the host's view, often a helper function it calls).
  // The chat driver's replies (DELTA, REPLY, FAILED), the tool loop (RESULTS, ASK) and DONE come
  // from outside its intent; a host entry 'assistant.DONE' extends DONE
  chat: {
    stateKeys: ['messages', 'prompt', 'draft', 'status', 'pending', 'error'],
    calculated: [],
    model: ['PROMPT', 'SEND', 'STOP', 'REGENERATE', 'APPROVE', 'DENY', 'DONE', 'DELTA', 'REPLY', 'FAILED', 'RESULTS', 'ASK'],
    options: ['sink', 'form', 'prompt', 'stop', 'approve', 'deny', 'regenerate', 'instructions', 'model', 'agent', 'maxSteps', 'transportOptions'],
    listens: [['form', 'SEND', 'select'], ['prompt', 'PROMPT', 'select'], ['stop', 'STOP'], ['approve', 'APPROVE'], ['deny', 'DENY'], ['regenerate', 'REGENERATE']],
    intent: ['DELTA', 'REPLY', 'FAILED', 'RESULTS', 'ASK', 'DONE'],
  },
  // PLAN-6 M-3: commandBar(options) from 'sygnal/ai' (src/extra/ai/commandBar.ts). Its selectors are
  // the host's. RUN comes from the input's Enter (or the form's submit); the fetch driver's replies
  // (DECIDED, FAILED), ASK and DONE come from outside its intent; a host entry 'cmd.DONE' extends DONE
  commandBar: {
    stateKeys: ['text', 'status', 'command', 'pending', 'unsure', 'result', 'error'],
    calculated: [],
    model: ['INPUT', 'RUN', 'DECIDED', 'FAILED', 'ASK', 'APPROVE', 'DENY', 'DONE'],
    options: ['input', 'form', 'decide', 'below', 'escalate', 'agent', 'sink', 'approve', 'deny', 'freeText'],
    listens: [['input', 'INPUT', 'select'], ['form', 'RUN', 'select'], ['approve', 'APPROVE'], ['deny', 'DENY']],
    intent: ['RUN', 'DECIDED', 'FAILED', 'ASK', 'DONE'],
  },
  // PLAN-5 2-U parts (sygnal/ui), G-392. `intent`: actions its intent always dispatches (the
  // element events of a required option, its timers' actions)
  dialog: {
    stateKeys: ['open', 'returnValue'],
    calculated: [],
    model: ['OPEN', 'CLOSE', 'TOGGLED', 'CLOSED', 'CANCEL'],
    options: ['dialog', 'trigger', 'close', 'modal', 'cancelable', 'returnFocus'],
    listens: [['trigger', 'OPEN'], ['close', 'CLOSE'], ['dialog', null, 'select']],
    intent: ['TOGGLED', 'CLOSED', 'CANCEL'],
  },
  popover: {
    stateKeys: ['open'],
    calculated: [],
    model: ['OPEN', 'CLOSE', 'TOGGLE', 'TOGGLED'],
    options: ['popover', 'close'],
    listens: [['close', 'CLOSE'], ['popover', 'TOGGLED', 'select']],
  },
  tooltip: {
    stateKeys: ['open', 'pending'],
    calculated: [],
    model: ['ENTER', 'LEAVE', 'SHOW', 'HIDE', 'ESCAPE', 'TOGGLED'],
    options: ['trigger', 'tip', 'showDelay', 'hideDelay'],
    listens: [['trigger', 'ENTER', 'select'], ['tip', 'TOGGLED', 'select']],
    intent: ['LEAVE', 'ESCAPE', 'SHOW', 'HIDE'],
  },
  tabs: {
    stateKeys: ['id', 'selected', 'orientation'],
    calculated: [],
    model: ['SELECT', 'MOVE'],
    options: ['tab', 'selected', 'orientation', 'activation', 'loop', 'id'],
    listens: [['tab', 'SELECT']],
    intent: ['MOVE'],
  },
  accordion: {
    stateKeys: ['id', 'expanded', 'collapsible'],
    calculated: [],
    model: ['TOGGLE', 'EXPAND', 'COLLAPSE', 'MOVE'],
    options: ['trigger', 'multiple', 'collapsible', 'expanded', 'loop', 'id'],
    listens: [['trigger', 'TOGGLE']],
    intent: ['MOVE'],
  },
  disclosure: {
    stateKeys: ['id', 'open'],
    calculated: [],
    model: ['TOGGLE', 'OPEN', 'CLOSE'],
    options: ['trigger', 'open', 'id'],
    listens: [['trigger', 'TOGGLE']],
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

// A FIRST_PARTY entry: `listens` items are [option, action, method = 'click', delegated = false] (a
// null action: the option's element is listened to for events of any action; delegated: heard
// on the host's root, so the element may be rendered by a child, SYG104 doesn't apply); `defaults`: an option's value when
// the use leaves it out (its selector is still listened to); `nextOptions`: options naming a HOST
// action the behavior dispatches (a trigger); `optionsArg`: which call argument holds the options;
// `model: null`: actions that can't be listed (open)
function firstPartyDef(name) {
  const fp = FIRST_PARTY[name]
  return {
    name, firstParty: true, file: null, node: null,
    stateKeys: fp.stateKeys, calculated: fp.calculated,
    model: fp.model ? new Map(fp.model.map(a => [a, ['STATE']])) : null,
    intentActions: fp.intent || [],
    listens: fp.listens.map(([option, action, method = 'click', delegated = false]) => ({ option, method, action, delegated })),
    defaults: fp.defaults || {}, nextOptions: fp.nextOptions || [], optionsArg: fp.optionsArg || 0,
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
    listens: [], optionNames: null, nextTargets: [], replyTargets: [], dynamic: false, nextOptions: [],
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
      // HOST (D197) is a STATE reducer on the host's whole state
      for (const e of m.entries) def.model.set(e.action, [...new Set([...(def.model.get(e.action) || []), ...e.sinks.map(k => k === 'HOST' ? 'STATE' : k)])])
    }
    def.nextTargets = m.nextTargets.map(t => t.name)
    def.replyTargets = m.replyTargets.map(t => t.name)
    def.dynamic = m.dynamicNext.length > 0 || m.replyDynamic.length > 0
  } else def.model = new Map()
  // D197: the timers' actions are triggers (namespaced when the behavior has the action)
  let read = new Set()
  if (at('timers')) {
    const tm = analyzeTimers(project, at('timers').file, at('timers').node)
    for (const t of tm.targets) def.nextTargets.push(t.name)
    // an action named by an option ({ action: ping }): the use's option value is the trigger
    const tf = resolveExpr(project, at('timers').file, at('timers').node)
    const op = tf?.node && isFunction(tf.node) ? optionParam(tf.file, tf.node, 1) : null
    for (const d of tm.dynamic) {
      const o = op?.optionOf(d.node)
      if (o) def.nextOptions.push(o)
      else def.dynamic = true
    }
    read = merge(read, op ? op.names : null)
  }
  if (at('model')) read = merge(read, modelOptionsRead(project, at('model').file, at('model').node))
  const stateOptions = def.stateKeys || []
  if (!at('intent')) {
    def.intentActions = []
    def.optionNames = def.stateKeys && read ? new Set([...stateOptions, ...read]) : null
    return def
  }
  const r = resolveExpr(project, at('intent').file, at('intent').node)
  const fn = r && isFunction(r.node) ? r.node : null
  if (!fn) return def
  const intent = analyzeIntent(r.file, fn)
  def.intentActions = intent.known ? intent.actions.map(a => a.name) : null
  const opts = optionParam(r.file, fn)
  def.optionNames = opts.names && read && def.stateKeys ? new Set([...opts.names, ...read, ...stateOptions]) : null
  for (const sel of intent.selectors) {
    const option = opts.optionOf(sel.node)
    if (option) def.listens.push({ option, method: sel.method, action: actionOf(r.file, fn, sel.node) })
  }
  return def
}

// option-name sets, null: unknown (read in a way we can't follow)
const merge = (a, b) => a && b ? new Set([...a, ...b]) : null

/** The option names a function reads through its parameter `index` (null: can't tell). */
function optionsRead(project, file, node, index) {
  const r = resolveExpr(project, file, node)
  if (!r?.node || !isFunction(r.node)) return null
  return optionParam(r.file, r.node, index).names
}

/** The option names a behavior's model handlers read (5th parameter), entries' sinks included. */
function modelOptionsRead(project, file, node) {
  const r = resolveExpr(project, file, node)
  if (r?.node?.type !== 'ObjectExpression') return null
  let out = new Set()
  const handler = (f, n) => {
    const h = resolveExpr(project, f, n)
    if (h?.node && isFunction(h.node)) out = merge(out, optionParam(h.file, h.node, 4).names)
    return h
  }
  for (const p of r.node.properties) {
    if (p.type === 'SpreadElement') return null
    if (p.type === 'ObjectMethod') { out = merge(out, optionParam(r.file, p, 4).names); continue }
    const v = handler(r.file, p.value)
    if (v?.node?.type === 'ObjectExpression') {
      for (const q of v.node.properties) {
        if (q.type === 'SpreadElement') return null
        if (q.type === 'ObjectMethod') out = merge(out, optionParam(v.file, q, 4).names)
        else handler(v.file, q.value)
      }
    }
  }
  return out
}

/**
 * The options parameter of a behavior intent (its 2nd parameter; `index`: another one, the 5th
 * of a model handler, D197):
 *   ({ DOM }, { next, prev: back })  → names { next, prev }, next → 'next', back → 'prev'
 *   ({ DOM }, o) with o.next reads   → names { next }
 * names is null when the options are used another way (passed on, spread, rest).
 */
function optionParam(file, fn, index = 1) {
  let p = fn.params[index]
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
function resolveEntry(project, file, value, depth = 0) {
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
    // D199: a factory function returning a behavior call with the options it got
    if (r && isFunction(r.node)) {
      const inner = wrapperCall(r.file, r.node)
      if (inner) {
        const res = depth < 4 ? resolveEntry(project, r.file, inner, depth + 1) : { status: 'opaque' }
        if (res.status === 'resolved') return { ...res, call: v, file, def: { ...res.def, name: calleeName(callee) || res.def.name } }
      }
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
    if (r.node.type === 'CallExpression') return depth < 8 ? resolveEntry(project, r.file, r.node, depth + 1) : { status: 'opaque' }
    return literalInvalid(r.node) || { status: 'opaque' }
  }
  return literalInvalid(v) || { status: 'opaque' }
}

/**
 * A factory function's behavior call that gets the function's options unchanged (D199): the one
 * returned expression is a call whose options argument is the first parameter, or an object of
 * defaults with that parameter spread last. null otherwise.
 */
function wrapperCall(file, fn) {
  let p = fn.params[0]
  if (p?.type === 'AssignmentPattern') p = p.left
  if (p?.type !== 'Identifier' || fn.params.length > 1) return null
  const rets = returnedExpressions(fn).map(unwrap)
  if (rets.length !== 1 || rets[0]?.type !== 'CallExpression') return null
  const call = rets[0], a = unwrap(call.arguments[0])
  if (call.arguments.length !== 1) return null
  const last = a?.type === 'ObjectExpression' ? a.properties[a.properties.length - 1] : null
  const passes = a?.type === 'Identifier' ? a.name === p.name
    : !!last && last.type === 'SpreadElement' && unwrap(last.argument)?.type === 'Identifier' &&
      unwrap(last.argument).name === p.name && a.properties.slice(0, -1).every(q => q.type === 'ObjectProperty')
  return passes ? call : null
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
      const arg = call.arguments[res.def?.optionsArg || 0]
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
      // options naming an action the behavior dispatches: the use's literal value is a trigger
      // (a copy of the def per use: a user def is shared); a non-literal value: unknown names
      for (const o of def.nextOptions || []) {
        const opt = entry.options.get(o)
        if (!opt) continue
        const name = stringValue(opt.node)
        entry.def = name ? { ...entry.def, nextTargets: [...entry.def.nextTargets, name] } : { ...entry.def, dynamic: true }
      }
      for (const l of def.listens) {
        const opt = entry.options.get(l.option)
        if (!opt && def.defaults?.[l.option]) {
          entry.selectors.push({ selector: def.defaults[l.option], node: entry.node, method: l.method, global: false, file: entry.file, behavior: key, option: l.option })
          continue
        }
        if (!opt) continue
        if (l.action) {
          const e = entry.actions.get(l.action) || { intent: false, sinks: [] }
          e.intent = true
          entry.actions.set(l.action, e)
        }
        const v = selectorValue(opt.node, opt.file)
        const sel = { ...v, node: opt.node, method: l.method, global: v.selector != null && GLOBAL_SELECTORS.has(v.selector.trim()), file: opt.file, behavior: key, option: l.option, delegated: l.delegated }
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
