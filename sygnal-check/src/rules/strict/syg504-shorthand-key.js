/**
 * SYG504 (C5): every non-STATE sink uses the object form
 *   ACTION: { SINK: fn }
 * not an 'ACTION | SINK' shorthand key.
 *
 * --fix: rewrites `'A | SINK': value` to `A: { SINK: value }` when no other
 * entry of the model handles action A (otherwise the entries must be merged
 * by hand). A raw EVENTS function becomes event('TYPE', ...) on the way
 * (see SYG505).
 */
import { modelEntries, fnOf, rawEventRewrite, ensureEventImport, text, keyText } from './shared.js'

/** Canonical value text for a shorthand entry, and whether it is exact. */
function canonicalValue(project, e) {
  if (e.sink === 'EVENTS') {
    const fn = fnOf(project, e.file, e.value)
    if (fn && fn.node === e.value) {
      const rw = rawEventRewrite(e.file, fn.node)
      if (rw) return { text: rw.rewrite, exact: rw.exact, usesEvent: true }
    }
  }
  if (e.prop.type === 'ObjectMethod') return { text: '(state, data, next) => { … }', exact: false }
  return { text: text(e.file, e.value), exact: true }
}

export default {
  id: 'strict-shorthand-key',
  codes: ['SYG504'],
  description: "'ACTION | SINK' shorthand model key",
  strict: true,
  run(project, report) {
    for (const comp of project.components) {
      const entries = modelEntries(project, comp)
      for (const e of entries) {
        if (!e.shorthand) continue
        const others = entries.filter(o => o !== e && o.action === e.action)
        const value = canonicalValue(project, e)
        const shown = value.text.length <= 70 && !value.text.includes('\n') ? value.text : '…'
        const rewrite = `${keyText(e.action)}: { ${e.sink}: ${shown} }`
        let edits
        if (!others.length && value.exact && e.prop.type === 'ObjectProperty' && !e.prop.computed) {
          const imp = value.usesEvent ? ensureEventImport(e.file, e.prop) : []
          if (imp) {
            edits = [...imp, { file: e.file.path, start: e.prop.start, end: e.prop.end, text: `${keyText(e.action)}: { ${e.sink}: ${value.text} }` }]
          }
        }
        report({
          code: 'SYG504',
          component: comp.name,
          file: e.file,
          node: e.prop.key,
          message: `model key '${e.key}' uses the 'ACTION | SINK' shorthand`,
          fix: others.length
            ? `use the object form and merge it into the existing '${e.action}' entry: \`${keyText(e.action)}: { …, ${e.sink}: ${shown} }\``
            : `use the object form: \`${rewrite}\``,
          data: { key: e.key, action: e.action, sink: e.sink },
          edits,
        })
      }
    }
  },
}
