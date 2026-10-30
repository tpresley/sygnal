/**
 * sygnal/yjs (research: dev-plans/research/crdt-state, Q4):
 *
 *   SYG260 (warn)  undo({ key }) in `uses`, or the model wrapped in undoable(model, { key }),
 *                  recording a key that shared() (sygnal/yjs) syncs. Sygnal's undo restores a
 *                  snapshot of the whole slice, so it reverts other users' changes made since;
 *                  the Yjs driver's per-user undo command reverts this client's own changes only.
 *
 * The runtime reports the undo() case too (shared()'s merge, dev). Keys are read from literals
 * (`key: 'board'`, `key: ['board', 'x']`); anything else is skipped.
 */
import { unwrap, propName, stringValue } from '../ast.js'
import { sygnalImport } from '../model/behaviors.js'
import { resolveExpr } from '../model/resolve.js'

// the literal key names of an undo options object (null: not readable)
function keysOf(project, file, node) {
  const o = node && resolveExpr(project, file, node)
  const obj = unwrap(o?.node)
  if (obj?.type !== 'ObjectExpression') return null
  for (const p of obj.properties) {
    if (p.type !== 'ObjectProperty' || propName(p) !== 'key') continue
    const v = unwrap(p.value)
    if (v?.type === 'ArrayExpression') return { keys: v.elements.map(e => stringValue(e)).filter(Boolean), node: p.value, file: o.file }
    const s = stringValue(v)
    return s ? { keys: [s], node: p.value, file: o.file } : null
  }
  return null
}

const message = (where, key) =>
  `${where} records '${key}', which shared() syncs: its UNDO restores a snapshot of the whole slice and reverts other users' changes made since`
const fix = (key) =>
  `Use the driver's per-user undo: UNDO: { SHARED: { undo: '${key}' } }, REDO: { SHARED: { redo: '${key}' } } (shared({ history: 'history' }) gives canUndo / canRedo), and remove the snapshot undo for '${key}'`

export default {
  id: 'shared-undo',
  codes: ['SYG260'],
  description: "undo() / undoable() recording a key shared() syncs (sygnal/yjs): use the Yjs driver's per-user undo",
  perFile: true,
  run(project, report) {
    for (const comp of project.components) {
      const entries = comp.uses?.entries || []
      const sharedKeys = new Set(entries.filter(e => e.def?.firstParty && e.def.name === 'shared').map(e => e.key))
      if (!sharedKeys.size) continue
      // undo({ key }) in uses
      for (const e of entries) {
        if (!e.def?.firstParty || e.def.name !== 'undo') continue
        const call = unwrap(e.node)
        const k = call?.type === 'CallExpression' ? keysOf(project, e.file, call.arguments[0]) : null
        for (const key of k?.keys || []) if (sharedKeys.has(key)) {
          report({
            code: 'SYG260', component: comp.name, file: k.file, node: k.node,
            message: message(`undo() (uses key '${e.key}')`, key), fix: fix(key), data: { key, uses: e.key },
          })
        }
      }
      // Comp.model = undoable(model, { key })
      const m = comp.staticProps.model && resolveExpr(project, comp.file, comp.staticProps.model)
      const call = unwrap(m?.node)
      if (call?.type === 'CallExpression' && sygnalImport(m.file, call.callee) === 'undoable') {
        const k = keysOf(project, m.file, call.arguments[1])
        for (const key of k?.keys || []) if (sharedKeys.has(key)) {
          report({
            code: 'SYG260', component: comp.name, file: k.file, node: k.node,
            message: message('undoable()', key), fix: fix(key), data: { key },
          })
        }
      }
    }
  },
}
