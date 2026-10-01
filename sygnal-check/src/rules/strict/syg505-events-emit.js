/**
 * SYG505 (C6): emit a global event with
 *   ACTION: { EVENTS: event('TYPE', (state, data) => payload) }
 * inside the object form. Flags:
 *   - `ACTION: emit('TYPE', fn)` as a whole model entry
 *   - `ACTION: { STATE: …, ...emit('TYPE', fn) }` (spread into the object form)
 *   - a raw EVENTS sink `s => ({ type: 'TYPE', data })` (object form or
 *     'A | EVENTS' shorthand) whose type is a static string
 *
 * --fix: the emit() entry and spread forms (adding `event` to the sygnal
 * import), and single-expression raw EVENTS arrows in the object form.
 */
import { unwrap } from '../../ast.js'
import { modelEntries, sinkProps, isEmitCall, fnOf, rawEventRewrite, ensureEventImport, text, keyText } from './shared.js'

const argsText = (file, call) => call.arguments.map(a => text(file, a)).join(', ')

export default {
  id: 'strict-events-emit',
  codes: ['SYG505'],
  description: 'Non-canonical EVENTS emit',
  strict: true,
  run(project, report) {
    for (const comp of project.components) {
      for (const e of modelEntries(project, comp)) {
        const { file } = e
        const hit = (node, message, rewrite, fix, edits) => report({
          code: 'SYG505', component: comp.name, file, node, message,
          fix: `${fix || 'use the object form with event()'}: \`${rewrite}\``,
          data: { action: e.action }, edits,
        })
        const withImport = (at, edit) => {
          const imp = ensureEventImport(file, at)
          return imp ? [...imp, edit] : undefined
        }

        // ACTION: emit('TYPE', fn)
        if (!e.shorthand && isEmitCall(file, e.value)) {
          const call = unwrap(e.value)
          const value = `{ EVENTS: event(${argsText(file, call)}) }`
          hit(call, `model entry '${e.action}' uses emit()`, `${keyText(e.action)}: ${value}`, null,
            withImport(e.prop, { file: file.path, start: e.value.start, end: e.value.end, text: value }))
          continue
        }

        // ACTION: { STATE: …, ...emit('TYPE', fn) }
        if (!e.shorthand && e.value?.type === 'ObjectExpression') {
          const hasEvents = sinkProps(e.value).some(s => s.sink === 'EVENTS')
          for (const p of e.value.properties) {
            if (p.type !== 'SpreadElement' || !isEmitCall(file, p.argument)) continue
            const value = `EVENTS: event(${argsText(file, unwrap(p.argument))})`
            hit(p, `model entry '${e.action}' spreads emit() into the object form`, value,
              `replace the spread with an EVENTS sink`,
              hasEvents ? undefined : withImport(p, { file: file.path, start: p.start, end: p.end, text: value }))
          }
        }

        // raw EVENTS sink: s => ({ type: 'TYPE', data })
        const eventsSinks = e.shorthand
          ? (e.sink === 'EVENTS' ? [{ prop: e.prop, value: e.value, shorthand: true }] : [])
          : sinkProps(e.value).filter(s => s.sink === 'EVENTS')
        for (const s of eventsSinks) {
          const fn = fnOf(project, file, s.value)
          if (!fn) continue
          const rw = rawEventRewrite(fn.file, fn.node)
          if (!rw) continue
          const inline = fn.node === s.value
          const edits = !s.shorthand && inline && rw.exact && s.prop.type === 'ObjectProperty'
            ? withImport(s.prop, { file: file.path, start: s.value.start, end: s.value.end, text: rw.rewrite })
            : undefined
          hit(s.value, `the EVENTS sink of '${e.action}' builds the { type: '${rw.type}', data } object by hand`,
            `${keyText(e.action)}: { EVENTS: ${rw.rewrite.length <= 80 ? rw.rewrite : `event('${rw.type}', (state, data) => payload)`} }`,
            null, edits)
        }
      }
    }
  },
}
