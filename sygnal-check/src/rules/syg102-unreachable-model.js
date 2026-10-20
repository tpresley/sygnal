/**
 * SYG102: a model entry nothing can trigger: no intent action of that name,
 * not a built-in action, no next('X') string literal targets it, no request
 * names it as a reply action (`ok: 'X'` / `error: 'X'` / `progress: 'X'` in a value a non-STATE sink
 * returns), and no `connections` entry names it (message/open/close/error), nor a `timers`
 * static (`{ every, action }`, `{ frame: 'FRAME' }`, PLAN-4 GS-7: comp.connections carries them).
 *
 * Element commands (PLAN-4 GS-2): the native events a command causes (`{ close: Dialog }` →
 * `close`) reach the model through intent actions (`DOM.close(Dialog)`), which are triggers like
 * any other; the graph lists them as the command's `triggers`.
 *
 * Behaviors (PLAN-4 GS-1): every action of a resolved behavior counts as a
 * trigger under its namespaced name ('pager.NEXT': a host entry for it runs
 * with the behavior's), and so do the behavior's next() targets (its own
 * actions namespaced, others as they are) and reply actions (not namespaced,
 * D123). A component with an opaque behavior (one from a package) is not
 * checked: that behavior may dispatch anything.
 *
 * Agents (PLAN-6 K-1, G-614): an `agent.actions` key is a trigger, and so are an LLM request's
 * `delta` / `tool` reply keys (model/modelEntries.js LLM_REPLY_KEYS). An agent declaration whose
 * actions can't be listed (a spread) makes the component's findings info, like a dynamic next().
 */
import { BUILTIN_ACTIONS } from '../model/modelEntries.js'
import { behaviorActions, openPrefixes } from '../model/behaviors.js'
import { removeEntryEdits } from '../model/modelEdits.js'

/**
 * PLAN-7 C-4 (editor only): "Remove the unreachable entry X", a refactor (never preferred:
 * the entry may be waiting for its trigger). Removes every entry of the action in the model
 * object literal (`X` and `'X | SINK'`).
 */
function removeFix(model, e) {
  const prop = e.file?.parents?.get(e.node)
  const obj = prop && e.file.parents.get(prop)
  if (prop?.key !== e.node || obj?.type !== 'ObjectExpression') return undefined
  const props = model.entries
    .filter(x => x.action === e.action && x.file === e.file)
    .map(x => e.file.parents.get(x.node))
    .filter(p => p && obj.properties.includes(p))
  const edits = removeEntryEdits(e.file, obj, [...new Set(props)])
  return edits ? [{ title: `Remove the unreachable entry '${e.action}'`, kind: 'refactor', edits }] : undefined
}

export default {
  id: 'unreachable-model',
  codes: ['SYG102'],
  description: 'Model entry is unreachable',
  run(project, report) {
    for (const comp of project.components) {
      const model = comp.model
      if (!model || model.entries.length === 0) continue
      // An intent we can't see through (single stream, spreads, imported helper) may produce any action.
      if (comp.staticProps.intent && (!comp.intent || !comp.intent.known)) continue
      const uses = comp.uses
      if (uses && (!uses.known || uses.entries.some(e => e.status === 'opaque'))) continue
      const triggers = new Set((comp.intent?.actions || []).map(a => a.name))
      // PLAN-4 GS-5: persist() sends RESTORE (after hydration, and with sync)
      if (comp.staticProps.persist) triggers.add('RESTORE')
      // PLAN-6 K-1 (G-614): an `agent.actions` entry is a trigger (agents dispatch it, cause 'agent')
      for (const a of comp.agent?.actions || []) triggers.add(a.name)
      const nextTargets = new Set(model.nextTargets.map(t => t.name))
      const replies = new Set([...model.replyTargets, ...(comp.connections?.targets || [])].map(t => t.name))
      const owned = behaviorActions(uses)
      const open = openPrefixes(uses)
      let behaviorDynamic = false
      for (const e of uses?.entries || []) {
        if (!e.def) continue
        for (const t of e.def.nextTargets) triggers.add(e.def.model?.has(t) ? `${e.key}.${t}` : t)
        for (const t of e.def.replyTargets) triggers.add(t)
        if (e.def.dynamic) behaviorDynamic = true
      }
      const dynamicNext = model.dynamicNext.length > 0
      const dynamicReplies = model.replyDynamic.length > 0 || (comp.connections?.dynamic.length || 0) > 0
      const agentDynamic = !!comp.agent && !comp.agent.actionsKnown
      const dynamic = dynamicNext || dynamicReplies || behaviorDynamic || agentDynamic
      const seen = new Set()
      for (const e of model.entries) {
        if (seen.has(e.action)) continue
        seen.add(e.action)
        if (BUILTIN_ACTIONS.has(e.action) || triggers.has(e.action) || nextTargets.has(e.action) || replies.has(e.action)) continue
        if (owned.has(e.action) || open.some(p => e.action.startsWith(p))) continue
        const entry = (uses?.entries || []).find(u => u.def && e.action.startsWith(u.key + '.'))
        if (entry) {
          const actions = [...entry.actions.keys()]
          report({
            code: 'SYG102',
            severity: dynamic ? 'info' : undefined,
            component: comp.name,
            file: e.file,
            node: e.node,
            message: `model entry '${e.action}' is never triggered: behavior '${entry.def.name}' (uses key '${entry.key}') has no action '${e.action.slice(entry.key.length + 1)}'` +
              (actions.length ? ` (its actions: ${actions.join(', ')})` : ''),
            fix: `use one of the behavior's actions (${actions.map(a => `'${entry.key}.${a}'`).join(', ') || 'none'}), or remove the entry`,
            data: { action: e.action, behavior: entry.key },
            fixes: removeFix(model, e),
          })
          continue
        }
        // PLAN-13 C-4: a request names it under a key the checker doesn't know (a custom driver's
        // reply key): info, pointing at replyKeys (never silent)
        const cand = model.replyCandidates?.find(c => c.name === e.action)
        if (cand) {
          report({
            code: 'SYG102',
            severity: 'info',
            component: comp.name,
            file: e.file,
            node: e.node,
            message: `model entry '${e.action}' is never triggered as far as the checker knows: the ${cand.sink} request of '${cand.action}' names it as '${cand.key}', which isn't a reply key it knows`,
            fix: `if ${cand.sink}'s driver replies with '${cand.key}', add it to replyKeys in sygnal-check.config.json: { "replyKeys": { "${cand.sink}": ["${cand.key}"] } }`,
            data: { action: e.action, key: cand.key, sink: cand.sink },
            related: [{ file: cand.file, node: cand.node, message: `'${cand.key}: ${e.action}' here` }],
            fixes: removeFix(model, e),
          })
          continue
        }
        report({
          code: 'SYG102',
          severity: dynamic ? 'info' : undefined,
          component: comp.name,
          file: e.file,
          node: e.node,
          message: `model entry '${e.action}' is never triggered: no intent action, built-in action, reply action (ok/error/progress), agent action or next('${e.action}') call uses it` +
            (dynamicNext ? ' (a next() call with a non-literal name might)' : dynamicReplies || behaviorDynamic ? ' (a request with a non-literal ok/error/progress name might)' : ''),
          fix: comp.intent
            ? `add '${e.action}' to ${comp.name}.intent, name it in a request (ok: '${e.action}'), call next('${e.action}') from another entry, or remove it`
            : `add an intent that returns '${e.action}', name it in a request (ok: '${e.action}'), call next('${e.action}') from another entry, or remove it`,
          data: { action: e.action },
          fixes: removeFix(model, e),
        })
      }
    }
  },
}
