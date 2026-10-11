/**
 * The completion index (PLAN-7 N-2 completions, P4-1): what the language server's main thread
 * needs to complete Sygnal names without building a project per keystroke. Built in the check
 * worker (core.js) from the project of each check, so it describes the last good parse of every
 * file (core.js substitutes a file that doesn't parse with its last good text), and sent with the
 * check results as plain data.
 *
 *   completionIndex(project, { substituted?: Set<absPath> }) → {
 *     files: [{ file (abs), hash, text?, regions: [{ start, end, kind, comp, keys?, values? }] }]
 *            the files with a region; hash: textHash of the text they were analysed with; the
 *            text itself only for the files in `substituted` (core.js checked their last good
 *            text, which the main thread may no longer have); comp: an index into components
 *     components: [{ name, triggers, entries, classes, ids, stateKeys }]
 *     events: { emitted: [{ type, file }], selected: [{ type, file }] }   one per type and file
 *   }
 *
 * Region kinds (offsets into that text; end exclusive):
 *   intent        the intent function (DOM / EVENTS selector strings)
 *   intentObject  an object the intent returns (its keys are intent actions); `values` are the
 *                 properties' value ranges (a cursor inside one is not at a key)
 *   model         the model object (keys, next(), reply names, event()/emit()); `values` likewise
 *   modelHelper   a module-level function the model object refers to by name (a reducer or a
 *                 request helper: next() and reply names, not keys)
 *   view          the view function (<Collection from>)
 *   names         a static that names actions: timers, browser, resources, connections, with the
 *                 property `keys` whose string values are action names
 *
 * Names per component:
 *   triggers   [{ name, via }]  the actions something dispatches: intent / next / reply / timer /
 *              browser / resource / connection / route / agent
 *   entries    [name]           the model's action names (shorthand keys' action part)
 *   classes, ids               the view's own literal class and id names
 *   stateKeys  [{ name, via }]  initialState and calculated keys
 */
import { unwrap, walk, isFunction } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from '../model/resolve.js'
import { returnedExpressions } from '../model/intent.js'
import { CONNECTION_KEYS } from '../model/modelEntries.js'
import { textHash } from './convert.js'

/** The property keys whose string values name actions, per action-naming static. */
export const NAME_KEYS = {
  timers: ['action', 'frame'],
  browser: ['action', 'error'],
  resources: ['ok', 'error'],
  connections: [...CONNECTION_KEYS],
}

const valueRanges = (obj) => obj.properties
  .filter(p => p.type === 'ObjectProperty' || p.type === 'ObjectMethod')
  .map(p => p.type === 'ObjectMethod' ? [p.key.end, p.end] : [p.value.start, p.value.end])

/** The model's object literal: the static itself, through identifiers/imports and undoable(). */
function modelObject(project, file, node) {
  let r = resolveExpr(project, file, node)
  if (r?.node?.type === 'CallExpression' && r.node.arguments[0]) r = resolveExpr(project, r.file, r.node.arguments[0])
  return r?.node?.type === 'ObjectExpression' ? r : null
}

/** Module-level functions an object refers to by name (analyzeModel's scanNext follows the same ones). */
function helpers(file, obj) {
  const out = new Set()
  const top = new Set() // names of module-level functions: only these are looked up
  for (let st of file.ast.program.body) {
    if (st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration') st = st.declaration
    if (st?.type === 'FunctionDeclaration' && st.id) top.add(st.id.name)
    else if (st?.type === 'VariableDeclaration') for (const d of st.declarations) if (d.id.type === 'Identifier' && isFunction(unwrap(d.init))) top.add(d.id.name)
  }
  if (!top.size) return out
  walk(obj, (n) => {
    if (n.type !== 'Identifier' || !top.has(n.name)) return true
    const b = findBinding(file, n.name, n)
    if (b?.kind === 'function' && file.parents.get(b.node)?.type === 'Program') out.add(b.node)
    else if (b?.kind === 'var' && isFunction(unwrap(b.init)) && file.parents.get(file.parents.get(b.node))?.type === 'Program') out.add(unwrap(b.init))
    return true
  })
  return out
}

export function completionIndex(project, { substituted = new Set() } = {}) {
  const components = []
  const files = new Map() // absPath → { file, hash, text?, regions }
  const region = (file, node, kind, comp, extra = {}) => {
    if (!file || !node || typeof node.start !== 'number') return
    let f = files.get(file.path)
    if (!f) {
      f = { file: file.path, hash: textHash(file.source), regions: [] }
      if (substituted.has(file.path)) f.text = file.source
      files.set(file.path, f)
    }
    f.regions.push({ start: node.start, end: node.end, kind, comp, ...extra })
  }

  for (const c of project.components) {
    const i = components.length
    const sp = c.staticProps || {}
    const triggers = []
    const add = (name, via) => { if (typeof name === 'string' && name) triggers.push({ name, via }) }
    if (c.intent?.fn) {
      region(c.intent.file, c.intent.fn, 'intent', i)
      for (const e of returnedExpressions(c.intent.fn)) {
        const o = unwrap(e)
        if (o?.type === 'ObjectExpression') region(c.intent.file, o, 'intentObject', i, { values: valueRanges(o) })
      }
      for (const a of c.intent.actions) add(a.name, 'intent')
    }
    if (sp.model) {
      const m = modelObject(project, c.file, sp.model)
      if (m) {
        region(m.file, m.node, 'model', i, { values: valueRanges(m.node) })
        for (const fn of helpers(m.file, m.node)) region(m.file, fn, 'modelHelper', i)
      }
    }
    for (const t of c.model?.nextTargets || []) add(t.name, 'next')
    for (const t of c.model?.replyTargets || []) add(t.name, 'reply')
    for (const t of c.connections?.targets || []) {
      add(t.name, t.timer ? 'timer' : t.browser ? 'browser' : t.res ? 'resource' : t.route ? 'route' : 'connection')
    }
    for (const a of c.agent?.actions || []) add(a.name, 'agent')
    for (const [key, keys] of Object.entries(NAME_KEYS)) {
      if (!sp[key]) continue
      const r = resolveExpr(project, c.file, sp[key])
      if (r?.node) region(r.file, r.node, 'names', i, { keys })
    }
    if (c.view) region(c.file, c.view, 'view', i)
    const stateKeys = [
      ...[...(c.initialState?.keys?.keys() || [])].map(name => ({ name, via: 'initialState' })),
      ...[...(c.calculatedKeys || [])].map(name => ({ name, via: 'calculated' })),
    ]
    components.push({
      name: c.name,
      triggers,
      entries: (c.model?.entries || []).map(e => e.action),
      classes: [...(c.viewInfo?.classes.names || [])],
      ids: [...(c.viewInfo?.ids.names || [])],
      stateKeys,
    })
  }

  // one entry per type and file (what the details name)
  const ev = (list) => {
    const seen = new Map()
    for (const e of list) {
      const file = e.file?.path ?? null
      const key = `${e.type}\0${file}`
      if (!seen.has(key)) seen.set(key, { type: e.type, file })
    }
    return [...seen.values()]
  }
  return {
    files: [...files.values()],
    components,
    events: { emitted: ev(project.events.emitted), selected: ev(project.events.selected) },
  }
}
