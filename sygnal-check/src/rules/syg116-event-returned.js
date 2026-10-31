/**
 * SYG116 (error, ui-sweep R5): a model sink entry that is a function returning `event(...)` (or
 * `emit(...)`) from 'sygnal': `SAVE: { EVENTS: (state) => event('SAVED', data) }`. event()
 * returns the handler, so the sink gets a function and sends nothing (the dev entry reports the
 * same value when it reaches the EVENTS bus, checks/events.ts). The sink entry must be event()
 * itself: `EVENTS: event('SAVED', (state, data) => payload)`.
 */
import { unwrap, isFunction } from '../ast.js'
import { resolveExpr } from '../model/resolve.js'
import { returnedExpressions } from '../model/intent.js'
import { sygnalImport } from '../model/behaviors.js'

const FACTORIES = new Set(['event', 'emit'])

export default {
  id: 'event-returned',
  codes: ['SYG116'],
  description: 'Sink entry returns an event() handler',
  run(project, report) {
    for (const comp of project.components) {
      for (const sv of comp.model?.sinkValues || []) {
        if (sv.sink === 'STATE' || sv.sink === 'HOST') continue
        const r = resolveExpr(project, sv.file, sv.node)
        const fn = r?.node
        if (!fn || !isFunction(fn)) continue
        for (const ret of returnedExpressions(fn)) {
          const call = unwrap(ret)
          if (call?.type !== 'CallExpression') continue
          const name = sygnalImport(r.file, call.callee)
          if (!FACTORIES.has(name)) continue
          report({
            code: 'SYG116',
            component: comp.name,
            file: r.file,
            node: call,
            message: `${comp.name}.model '${sv.action}' ${sv.sink}: the function returns ${name}(...), which is a handler, not a value, so the ${sv.sink} sink gets a function and nothing is sent`,
            fix: `make ${name}() the sink entry itself: ${sv.sink}: ${name}('TYPE', (state, data) => payload)`,
            data: { action: sv.action, sink: sv.sink, factory: name },
          })
        }
      }
    }
  },
}
