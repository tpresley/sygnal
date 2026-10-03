/**
 * SYG112: a request names a reply action the component has no model entry
 * for, so its reply is dropped (the reply-action form of SYG101; PLAN-3 §1.1).
 *
 *   LOAD: { HTTP: (state) => ({ url, ok: 'LOADED', error: 'FIALED' }) }   // no FIALED entry
 *
 * Sources of names: string literal `ok` / `error` values in the objects a
 * non-STATE sink returns (not EFFECT, EVENTS, PARENT, READY), and the
 * message/open/close/error values in a `connections` static.
 *
 * Only names that look like actions are reported: UPPER_SNAKE_CASE, or close
 * to a model key (a case or spelling slip). Other strings (`error: 'Not found'`
 * on a custom driver) are taken as data, since the checker can't see which
 * driver a sink goes to.
 */
import { closestName } from '../names.js'

const ACTION_LIKE = /^[A-Z][A-Z0-9_]*$/

export default {
  id: 'unknown-reply-action',
  codes: ['SYG112'],
  description: 'Reply action has no model entry',
  run(project, report) {
    for (const comp of project.components) {
      if (comp.model && !comp.model.known) continue
      if (!comp.model && comp.staticProps.model) continue
      const keys = new Set((comp.model?.entries || []).map(e => e.action))
      const named = [
        ...(comp.model?.replyTargets || []).map(t => ({ ...t, via: `the ${t.sink} request of '${t.action}' names '${t.name}' as its ${t.key} reply action` })),
        ...(comp.connections?.targets || []).map(t => ({ ...t, via: `${comp.name}.connections names '${t.name}' as its ${t.key} reply action`, conn: true })),
      ]
      const seen = new Set()
      for (const t of named) {
        if (keys.has(t.name) || seen.has(t.node)) continue
        seen.add(t.node)
        const near = closestName(t.name, keys)
        if (!near && !ACTION_LIKE.test(t.name)) continue
        report({
          code: 'SYG112',
          component: comp.name,
          file: t.file,
          node: t.node,
          message: `${t.via}, but ${comp.name} has no model entry '${t.name}', so ${t.conn ? 'those events are' : 'the reply is'} dropped` +
            (near ? ` (did you mean '${near}'?)` : ''),
          fix: near
            ? `rename it to the existing entry: ${t.key}: '${near}'`
            : `add the entry to ${comp.name}.model, e.g. ${t.name}: (state, data) => ({ ...state, ... }), or fix the name to match an existing model key`,
          data: { action: t.name, key: t.key, ...(near ? { suggestion: near } : {}) },
        })
      }
    }
  },
}
