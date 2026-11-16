/**
 * Behaviors (PLAN-4 GS-1, GS-8; model/behaviors.js):
 *
 *   SYG127 (error)  a `uses` entry the core skips (not a defineBehavior()
 *                   result: an object literal, an uncalled factory), a `uses`
 *                   key the component's initialState already has (unless the
 *                   behavior's factory says `ownsState: false`), or an
 *                   option the behavior never reads (a typo: `pager({ nxt:
 *                   Newer })`, where pager reads `next`)
 *   SYG226 (warn)   undoable(model, { track, resetOn, coalesce }) or undo({ track,
 *                   resetOn, coalesce }) naming an action with no model entry
 *
 * Opaque behaviors (from packages, wrappers) are never reported.
 */
import { walk, unwrap, stringValue, propName, isFunction } from '../ast.js'
import { closestName } from '../names.js'
import { renameFix, stringEdit, keyEdit } from '../edits.js'
import { sygnalImport, behaviorActions, openPrefixes } from '../model/behaviors.js'
import { analyzeModel } from '../model/modelEntries.js'
import { resolveExpr } from '../model/resolve.js'
import { stateReads, reducerWrites } from '../model/stateAccess.js'

const REASONS = {
  factory: (e) => `is the behavior factory${e.factoryName ? ` '${e.factoryName}'` : ''} itself, not called`,
  object: () => 'is an object literal',
  literal: () => 'is not a behavior',
  function: () => 'is a function',
  empty: () => 'is empty',
}

function reportUses(project, report, comp) {
  const uses = comp.uses
  for (const e of uses?.entries || []) {
    if (e.status === 'invalid') {
      report({
        code: 'SYG127',
        component: comp.name,
        file: e.file,
        node: e.node,
        message: `uses entry '${e.key}' ${(REASONS[e.reason] || REASONS.literal)(e)}, not a defineBehavior() result; the core skips it, so state.${e.key} and its '${e.key}.*' actions don't exist`,
        fix: e.reason === 'factory' ? `call it: uses = { ${e.key}: ${e.factoryName && !/\(/.test(e.factoryName) ? e.factoryName : 'behavior'}({ ... }) }` : `use a defineBehavior() factory's result: uses = { ${e.key}: behavior(options) }`,
        data: { key: e.key, reason: 'unresolvable' },
      })
      continue
    }
    // a behavior that keeps the host's value (`ownsState: false`: sygnal/yjs shared()) needs it there
    if (comp.initialState?.keys.has(e.key) && e.ownsState !== false) {
      report({
        code: 'SYG127',
        component: comp.name,
        file: e.file,
        node: e.keyNode,
        message: `uses key '${e.key}' is also a key of ${comp.name}'s initialState; the behavior's slice replaces that value`,
        fix: `remove '${e.key}' from initialState (pass its values as the behavior's options), or rename the uses key`,
        data: { key: e.key, reason: 'initialState' },
      })
    }
    if (e.def?.firstParty && e.def.name === 'wizard') reportWizard(project, report, comp, e)
    const names = e.def?.optionNames
    if (!names) continue
    for (const [name, opt] of e.options) {
      if (names.has(name)) continue
      const near = closestName(name, [...names])
      report({
        code: 'SYG127',
        component: comp.name,
        file: opt.file,
        node: opt.keyNode,
        message: `behavior '${e.def.name}' (uses key '${e.key}') has no option '${name}'${near ? `; did you mean '${near}'?` : ''} It reads: ${[...names].join(', ') || 'none'}`,
        fix: near ? `rename '${name}' to '${near}'` : `remove '${name}', or use one of the options it reads`,
        data: { key: e.key, reason: 'option', option: name, ...(near ? { suggestion: near } : {}) },
        fixes: near && renameFix(`Rename '${name}' to '${near}'`, keyEdit(opt.file, opt.keyNode, near)),
      })
    }
  }
}

/**
 * wizard() (7.7 options): `guard` is 'flow' or 'step', and `host` names fields of the host's
 * state, on the wizard and on each step. A value the wizard doesn't know is read as the default
 * (the step isn't guarded); a `host` name the state doesn't have gives the step an undefined field.
 */
const GUARDS = ['flow', 'step']
function reportWizard(project, report, comp, e) {
  const keys = comp.initialState?.known ? new Set([...comp.initialState.keys.keys(), ...(comp.uses?.entries || []).map(x => x.key)]) : null
  const check = (where, props, file) => {
    for (const p of props) {
      if (p.type !== 'ObjectProperty') continue
      const k = propName(p)
      if (k === 'guard') {
        const v = stringValue(unwrap(p.value))
        if (v == null || GUARDS.includes(v)) continue
        const near = closestName(v, GUARDS)
        report({
          code: 'SYG127', component: comp.name, file, node: p.value,
          message: `${where} guard is '${v}'; the wizard reads 'flow' (the default: only leaving the flow is held) or 'step' (a move off the dirty step is held too), so this is read as 'flow'` + (near ? `; did you mean '${near}'?` : ''),
          fix: near ? `guard: '${near}'` : `use guard: 'step' or guard: 'flow'`,
          data: { key: e.key, reason: 'guard', value: v, ...(near ? { suggestion: near } : {}) },
          fixes: near && renameFix(`Change '${v}' to '${near}'`, stringEdit(file, unwrap(p.value), near)),
        })
      } else if (k === 'host' && keys) {
        for (const { name, node } of names(p.value) || []) {
          if (name == null || keys.has(name)) continue
          const near = closestName(name, [...keys])
          report({
            code: 'SYG127', component: comp.name, file, node,
            message: `${where} host names '${name}', which is no key of ${comp.name}'s initialState, so the step reads undefined for it` + (near ? `; did you mean '${near}'?` : ''),
            fix: near ? `rename '${name}' to '${near}'` : `name a key of ${comp.name}.initialState, or add '${name}' to it`,
            data: { key: e.key, reason: 'host', field: name, ...(near ? { suggestion: near } : {}) },
            fixes: near && renameFix(`Change '${name}' to '${near}'`, stringEdit(file, node, near)),
          })
        }
      }
    }
  }
  const top = [...e.options].filter(([k]) => k === 'guard' || k === 'host')
  for (const [k, o] of top) check(`wizard '${e.key}':`, [{ type: 'ObjectProperty', key: { type: 'Identifier', name: k }, value: o.node }], o.file)
  // rekey's result is merged into the host's state: a field the state doesn't have is a new one,
  // usually a typo of the field it meant to clear
  const rk = e.options.get('rekey'), rf = rk && keys && resolveExpr(project, rk.file, rk.node)
  if (rf && isFunction(rf.node)) for (const name of returnedKeys(rf.node)) {
    if (keys.has(name)) continue
    const near = closestName(name, [...keys])
    report({
      code: 'SYG127', component: comp.name, file: rk.file, node: rk.node,
      message: `wizard '${e.key}': rekey returns '${name}', which is no key of ${comp.name}'s initialState, so it adds a field to the state instead of changing one` + (near ? `; did you mean '${near}'?` : ''),
      fix: near ? `rename '${name}' to '${near}'` : `return keys of ${comp.name}.initialState, or add '${name}' to it`,
      data: { key: e.key, reason: 'rekey', field: name, ...(near ? { suggestion: near } : {}) },
    })
  }
  const st = e.options.get('steps'), sObj = st && resolveExpr(project, st.file, st.node)
  if (sObj?.node?.type !== 'ObjectExpression') return
  for (const p of sObj.node.properties) {
    const name = p.type === 'ObjectProperty' ? propName(p) : null, step = name && resolveExpr(project, sObj.file, p.value)
    if (step?.node?.type === 'ObjectExpression') check(`step '${name}' of wizard '${e.key}':`, step.node.properties, step.file)
  }
  reportUndeclaredHost(project, report, comp, e, sObj)
}

// the literal keys of the objects a function returns (its own returns, through ?: && ||; no spreads)
function returnedKeys(fn) {
  const out = []
  const of = (n) => {
    n = unwrap(n)
    if (!n) return
    if (n.type === 'ObjectExpression') { for (const p of n.properties) { const k = p.type !== 'SpreadElement' && !p.computed && propName(p); if (k && !out.includes(k)) out.push(k) } }
    else if (n.type === 'ConditionalExpression') { of(n.consequent); of(n.alternate) }
    else if (n.type === 'LogicalExpression') { of(n.left); of(n.right) }
  }
  if (fn.body.type !== 'BlockStatement') of(fn.body)
  else walk(fn.body, (n) => {
    if (n !== fn.body && isFunction(n)) return false
    if (n.type === 'ReturnStatement') of(n.argument)
    return true
  })
  return out
}

// a step's functions of its state (the 1st parameter), and those whose result is its state
const STEP_FNS = ['when', 'valid', 'label', 'visit', 'dirty', 'discard', 'back', 'next']
const STEP_WRITES = ['discard', 'back', 'next']

/**
 * A step that reads or writes a key of the host's initialState it doesn't declare in `host` (its
 * own, else the wizard's): its state has no such field, so a read is undefined and a write stays
 * in the step's own slice (the host never sees it). Checked in the step's wizard() functions and
 * in its component (the Outlet's `of`): the view's reads, its reducers' reads and writes. Only
 * with literal `host` arrays, a known host initialState and a step component the Outlet names
 * inline; keys the step's own initialState has are its own.
 */
function reportUndeclaredHost(project, report, comp, e, sObj) {
  if (!comp.initialState?.known || !comp.initialState.keys.size || !comp.view) return
  const hostKeys = comp.initialState.keys
  const lit = (o) => { const l = names(o); return l && l.every(x => x.name != null) ? l.map(x => x.name) : null }
  const top = e.options.get('host'), all = top ? lit(top.node) : []
  if (!all) return
  const dk = e.options.get('draftKey'), DK = dk ? stringValue(unwrap(dk.node)) : 'draft'
  if (DK == null) return
  // the steps' components, from the Outlet of this wizard
  const pages = new Map()
  for (const u of project.viewOf({ file: comp.file, node: comp.view })?.collections || []) {
    const o = u.outlet
    if (!o || o.from !== e.key || !o.of || o.of.length !== u.targets.length) continue
    // (a plain function with no statics is a step too: its view only)
    o.of.forEach((x, i) => { const r = u.targets[i].ref; pages.set(x.key, r ? project.componentForFunction(r.node) || { name: u.targets[i].name, file: r.file, view: r.node } : null) })
  }
  for (const p of sObj.node.properties) {
    const name = p.type === 'ObjectProperty' ? propName(p) : null, step = name && resolveExpr(project, sObj.file, p.value)
    if (step?.node?.type !== 'ObjectExpression' || step.node.properties.some(q => q.type !== 'ObjectProperty')) continue
    const sc = pages.get(name)
    if (!sc || (sc.staticProps?.initialState && !sc.initialState?.known)) continue
    const own = sc.initialState?.keys || new Map()
    const hp = step.node.properties.find(q => propName(q) === 'host'), declared = hp ? lit(hp.value) : all
    if (!declared) continue
    const bad = (k) => hostKeys.has(k) && k !== DK && !declared.includes(k) && !own.has(k)
    const seen = new Set()
    const say = (k, access, file, node, where) => {
      if (!bad(k) || seen.has(k)) return
      seen.add(k)
      report({
        code: 'SYG127', component: comp.name, file, node,
        message: `step '${name}' of wizard '${e.key}' ${access} '${k}' (${where}), a key of ${comp.name}'s initialState its host doesn't name: the step's state has no such field` + (access === 'writes' ? `, so the write stays in the step's own slice and ${comp.name} never sees it` : ', so it reads undefined'),
        fix: `declare it on the step: host: [${[...declared, k].map(x => `'${x}'`).join(', ')}]` + (hp ? '' : ` (or on the wizard, for every step)`),
        data: { key: e.key, reason: 'host-undeclared', step: name, field: k, access },
      })
    }
    const fnOf = (file, node) => { const r = node && resolveExpr(project, file, node); return r && isFunction(r.node) ? r : null }
    // writes first: the more harmful of the two for a field both read and written
    for (const q of step.node.properties) {
      const k = propName(q)
      if (!STEP_WRITES.includes(k) || !fnOf(step.file, q.value)) continue
      for (const w of reducerWrites(project, step.file, q.value, { stateKeys: null }) || []) say(w, 'writes', step.file, q.key, `its ${k}`)
    }
    for (const m of sc.model?.entries || []) {
      if (!m.stateValue) continue
      for (const w of reducerWrites(project, m.stateValue.file, m.stateValue.node, { stateKeys: null }) || []) say(w, 'writes', m.file, m.node, `${sc.name}'s ${m.action}`)
    }
    for (const q of step.node.properties) {
      const k = propName(q), f = STEP_FNS.includes(k) && fnOf(step.file, q.value)
      if (!f) continue
      for (const r of stateReads(project, f.file, f.node, { state: true, reducer: true })?.keys || []) say(r, 'reads', step.file, q.key, `its ${k}`)
    }
    for (const m of sc.model?.entries || []) {
      const f = m.stateValue && fnOf(m.stateValue.file, m.stateValue.node)
      if (!f) continue
      for (const r of stateReads(project, f.file, f.node, { state: true, reducer: true })?.keys || []) say(r, 'reads', m.file, m.node, `${sc.name}'s ${m.action}`)
    }
    // the other sinks' functions get the step's state too
    for (const v of sc.model?.sinkValues || []) {
      const f = v.sink !== 'STATE' && v.sink !== 'HOST' && fnOf(v.file, v.node)
      if (!f) continue
      for (const r of stateReads(project, f.file, f.node, { state: true, reducer: true })?.keys || []) say(r, 'reads', v.file, v.keyNode || v.node, `${sc.name}'s ${v.action} ${v.sink}`)
    }
    // and its calculated fields (a function, or [deps, fn])
    const calc = sc.staticProps?.calculated && resolveExpr(project, sc.file, sc.staticProps.calculated)
    if (calc?.node?.type === 'ObjectExpression') for (const q of calc.node.properties) {
      if (q.type !== 'ObjectProperty' && q.type !== 'ObjectMethod') continue
      let v = q.type === 'ObjectMethod' ? q : unwrap(q.value)
      if (v?.type === 'ArrayExpression') v = v.elements[v.elements.length - 1]
      const f = q.type === 'ObjectMethod' ? { file: calc.file, node: q } : fnOf(calc.file, v)
      if (!f) continue
      for (const r of stateReads(project, f.file, f.node, { state: true, reducer: true })?.keys || []) say(r, 'reads', calc.file, q.key, `${sc.name}'s calculated ${propName(q)}`)
    }
    if (sc.view) for (const r of stateReads(project, sc.file, sc.view)?.keys || []) say(r, 'reads', sc.file, sc.view.id || sc.view, `${sc.name}'s view`)
  }
}

/** String literals of an array option; null when the array (or an element) isn't literal. */
function names(node) {
  node = unwrap(node)
  if (node?.type !== 'ArrayExpression') return null
  return node.elements.map(el => ({ name: stringValue(el), node: el }))
}

// what a name in each undo option does, for SYG226's message (coalesce: 4-G1, D143)
const EFFECT_OF = {
  track: 'its changes are never recorded',
  resetOn: 'it never clears the history',
  coalesce: 'nothing is grouped under that name',
}

function checkNames(report, comp, file, optionsNode, known, open, where) {
  const obj = unwrap(optionsNode)
  if (obj?.type !== 'ObjectExpression') return
  for (const p of obj.properties) {
    if (p.type !== 'ObjectProperty') continue
    const opt = propName(p)
    if (!EFFECT_OF[opt]) continue
    for (const { name, node } of names(p.value) || []) {
      if (name == null || known.has(name) || open.some(x => name.startsWith(x))) continue
      const near = closestName(name, [...known])
      report({
        code: 'SYG226',
        component: comp?.name,
        file,
        node,
        message: `${where} ${opt} names '${name}', which has no model entry, so ${EFFECT_OF[opt]}${near ? `; did you mean '${near}'?` : ''}`,
        fix: near ? `rename '${name}' to '${near}'` : `use the name of a model entry, or add '${name}' to the model`,
        data: { action: name, option: opt },
        fixes: near && renameFix(`Change '${name}' to '${near}'`, stringEdit(file, node, near)),
      })
    }
  }
}

export default {
  id: 'behaviors',
  codes: ['SYG127', 'SYG226'],
  description: 'Behaviors: unresolvable uses entry, collision, unknown option; undo track/resetOn/coalesce naming an unknown action',
  perFile: true, // run.js createRuleMemo: one file at a time, from the file and its imports
  run(project, report) {
    for (const comp of project.components) {
      if (!comp.uses) continue
      reportUses(project, report, comp)
      // undo({ track, resetOn }) in uses: the host's actions (its model and its behaviors')
      if (comp.model && !comp.model.known) continue
      if (!comp.model && comp.staticProps.model) continue
      const known = new Set([...(comp.model?.entries || []).map(e => e.action), ...behaviorActions(comp.uses).keys()])
      const open = openPrefixes(comp.uses)
      for (const e of comp.uses.entries) {
        if (e.def?.firstParty && e.def.name === 'undo' && e.optionsKnown) {
          const call = unwrap(e.node)
          const arg = call?.type === 'CallExpression' ? resolveExpr(project, e.file, call.arguments[0]) : null
          if (arg) checkNames(report, comp, arg.file, arg.node, known, open, `undo() (uses key '${e.key}')`)
        }
      }
    }
    // undoable(model, { track, resetOn }) anywhere in the scanned files
    for (const path of project.scanned) {
      const file = project.files.get(path)
      if (!file) continue
      walk(file.ast.program, (n) => {
        if (n.type !== 'CallExpression' || sygnalImport(file, n.callee) !== 'undoable' || n.arguments.length < 2) return true
        const m = analyzeModel(project, file, n.arguments[0])
        if (!m.known) return true
        const opts = resolveExpr(project, file, n.arguments[1])
        const comp = project.componentAt(file, n)
        checkNames(report, comp, opts.file, opts.node, new Set(m.entries.map(x => x.action)), [], 'undoable()')
        return true
      })
    }
  },
}
