/**
 * Behaviors (PLAN-4 GS-1, GS-8; model/behaviors.js):
 *
 *   SYG127 (error)  a `uses` entry the core skips (not a defineBehavior()
 *                   result: an object literal, an uncalled factory), a `uses`
 *                   key the component's initialState already has, or an
 *                   option the behavior never reads (a typo: `pager({ nxt:
 *                   Newer })`, where pager reads `next`)
 *   SYG226 (warn)   undoable(model, { track, resetOn, coalesce }) or undo({ track,
 *                   resetOn, coalesce }) naming an action with no model entry
 *
 * Opaque behaviors (from packages, wrappers) are never reported.
 */
import { walk, unwrap, stringValue, propName } from '../ast.js'
import { closestName } from '../names.js'
import { sygnalImport, behaviorActions, openPrefixes } from '../model/behaviors.js'
import { analyzeModel } from '../model/modelEntries.js'
import { resolveExpr } from '../model/resolve.js'

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
    if (comp.initialState?.keys.has(e.key)) {
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
      })
    }
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
      })
    }
  }
}

export default {
  id: 'behaviors',
  codes: ['SYG127', 'SYG226'],
  description: 'Behaviors: unresolvable uses entry, collision, unknown option; undo track/resetOn/coalesce naming an unknown action',
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
