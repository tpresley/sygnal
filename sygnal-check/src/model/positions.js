/**
 * Positions of actions and EVENTS types (PLAN-7 N-1, the actions part; spike 0-S3): an
 * occurrence index built from the project model, for go-to-definition / find-references (and
 * later code lens and rename). Every occurrence comes from a node the model already keeps.
 *
 *   range(node, { inner?, sub? }) → Range | null
 *     Range = { start, end, line, column, endLine, endColumn }
 *     start/end: UTF-16 offsets (Babel's); line/column 1-based, endColumn exclusive, the units of
 *     the checker's diagnostics (README "JSON output"). `inner`: a string literal (or a template
 *     literal without expressions) narrowed to its contents; `sub: [offset, length]`: a part of
 *     the (inner) range on a single-line node (the action part of a `'A | SINK'` key).
 *
 *   buildIndex(project, { exclude? }) → Index      (plain data: structured-cloneable)
 *     exclude: absolute paths whose occurrences are left out (the language server's files
 *     checked with their last good text, whose positions may be off)
 *     Index = {
 *       components: [{ id, name, file, line }]        id: 'absPath:line' of the definition
 *       occurrences: Occurrence[]                      sorted by file, then start
 *     }
 *     Occurrence = Range & {
 *       file,                 absolute path
 *       hit: Range,           what a cursor must be on: the whole string literal (quotes included)
 *                             or key; the action part of a shorthand key
 *       name,                 the action ('SAVE', 'pager.NEXT') or EVENTS type
 *       kind,                 actions: 'intent' | 'model' | 'next' | 'reply' | 'connection' |
 *                             'resource' | 'route' | 'timer' | 'browser' | 'agent' | 'uses';
 *                             EVENTS: 'emit' | 'select'
 *       role,                 'handler' (model keys), 'trigger' (the other action kinds),
 *                             'emit' | 'select' (EVENTS)
 *       component,            the component id (actions); null for EVENTS (project-wide)
 *       key?,                 reply: the request key (ok, error, delta, tool, block) and `sink`;
 *                             connection/resource/timer/browser: the spec key
 *       builtin?,             a name the core dispatches (BOOTSTRAP, INITIALIZE, ...)
 *       synthetic?,           undoable()'s UNDO / REDO (at the `undoable` callee)
 *       shorthand?,           a removed-form 'A | SINK' model key (range: the action part)
 *       behavior?,            the `uses` key of a behavior-owned name ('pager' for 'pager.NEXT');
 *                             kind 'uses' marks the `uses` entry key itself (the behavior's own
 *                             actions have no source here: first-party, or not kept yet)
 *       firstParty?,          kind 'uses': a first-party behavior
 *       implicit?,            a select implied by an import (Toaster: TOAST, TOAST_DISMISS)
 *     }
 *
 *   createLookup(index) → {
 *     at(file, line, column)             occurrences whose `hit` contains the 1-based position
 *                                        (end inclusive: a cursor right after the token counts)
 *     definition(occs)                   the targets (below), sorted, deduplicated
 *     references(occs, includeDeclaration)
 *   }
 *   Definition: from a trigger (intent key, next(), a reply name, a static's name, an
 *   agent.actions key, a `uses` key) → the model entries handling that action in that component;
 *   from a model key → the intent keys triggering it, else its other triggers; from a select → the
 *   type's emits; from an emit → its selects. References: every occurrence of the action in that
 *   component (of the type in the project, for EVENTS); without `includeDeclaration` the
 *   declarations are left out (actions: the model keys; EVENTS: the emits). Several occurrences
 *   at one position (a model or intent shared by components, undoable()'s UNDO/REDO, a `uses`
 *   key) give the union. Unknown or dynamic names have no occurrence: nothing, never a guess.
 */
import { unwrap } from '../ast.js'
import { BUILTIN_ACTIONS } from './modelEntries.js'

const isLiteral = (n) => n?.type === 'StringLiteral' || (n?.type === 'TemplateLiteral' && !n.expressions.length)

export function range(node, { inner = false, sub = null } = {}) {
  if (!node?.loc) return null
  let { start, end } = node
  let line = node.loc.start.line, column = node.loc.start.column + 1
  let endLine = node.loc.end.line, endColumn = node.loc.end.column + 1
  if (inner && isLiteral(node)) {
    start += 1; end -= 1; column += 1; endColumn -= 1
  }
  if (sub && line === endLine) {
    start += sub[0]; column += sub[0]
    end = start + sub[1]; endColumn = column + sub[1]
  }
  return { start, end, line, column, endLine, endColumn }
}

/** The offset of the action part inside a shorthand key's literal contents (raw text: escapes). */
function shorthandSub(node, action) {
  const raw = node.extra?.raw?.slice(1, -1) ?? node.value
  const m = /^\s*/.exec(raw)
  const i = raw.indexOf(action, m[0].length)
  return i < 0 ? null : [i, action.length]
}

const pathOf = (f) => (typeof f === 'string' ? f : f?.path) || null

export function buildIndex(project, { exclude } = {}) {
  const components = []
  const occurrences = []
  const seen = new Set()

  const add = (file, node, props, { sub = null, hit = null } = {}) => {
    const abs = pathOf(file)
    node = unwrap(node)
    if (!abs || !node?.loc || exclude?.has(abs)) return
    let r, h
    if (sub && isLiteral(node)) {
      const s = shorthandSub(node, props.name)
      r = h = range(node, { inner: true, sub: s })
    } else {
      r = range(node, { inner: true })
      h = hit || range(node)
    }
    if (!r) return
    const dedupe = `${abs}\0${r.start}\0${r.end}\0${props.kind}\0${props.name}\0${props.component}`
    if (seen.has(dedupe)) return
    seen.add(dedupe)
    const o = { file: abs, ...r, hit: h, ...props }
    if (props.component && BUILTIN_ACTIONS.has(props.name)) o.builtin = true
    occurrences.push(o)
  }

  for (const c of project.components) {
    const id = `${c.file.path}:${c.node?.loc?.start.line ?? 1}`
    components.push({ id, name: c.name, file: c.file.path, line: c.node?.loc?.start.line ?? 1 })
    const act = (kind, extra = {}) => ({ name: extra.name, kind, role: kind === 'model' ? 'handler' : 'trigger', component: id, ...extra })

    for (const a of c.intent?.actions || []) add(c.intent.file, a.node, act('intent', { name: a.name }))
    if (c.model) {
      for (const e of c.model.entries) {
        const props = act('model', { name: e.action })
        if (e.node?.type === 'Identifier' && e.node.name !== e.key) props.synthetic = true // undoable(): at its callee
        if (e.shorthand) props.shorthand = true
        const dot = e.action.indexOf('.')
        if (dot > 0 && c.uses?.entries?.some(u => u.key === e.action.slice(0, dot))) props.behavior = e.action.slice(0, dot)
        add(e.file, e.node, props, { sub: e.shorthand })
      }
      for (const t of c.model.nextTargets) add(t.file, t.node, act('next', { name: t.name }))
      for (const t of c.model.replyTargets) add(t.file, t.node, act('reply', { name: t.name, key: t.key, sink: t.sink }))
    }
    for (const t of c.connections?.targets || []) {
      const kind = t.route ? 'route' : t.timer ? 'timer' : t.browser ? 'browser' : t.res ? 'resource' : 'connection'
      add(t.file, t.node, act(kind, { name: t.name, key: t.key }))
    }
    for (const a of c.agent?.actions || []) add(a.file, a.node, act('agent', { name: a.name }))
    // behavior-owned names ('pager.NEXT'): the `uses` entry key stands for the behavior's own
    // intent and model (no source for first-party behaviors; a user behavior's aren't kept yet)
    for (const e of c.uses?.entries || []) {
      for (const a of e.actions.keys()) {
        add(e.file, e.keyNode, act('uses', { name: `${e.key}.${a}`, behavior: e.key, firstParty: !!e.def?.firstParty }))
      }
    }
  }

  // EVENTS, project-wide
  for (const e of project.events.emitted) add(e.file, e.node, { name: e.type, kind: 'emit', role: 'emit', component: null })
  for (const e of project.events.selected) {
    add(e.file, e.node, { name: e.type, kind: 'select', role: 'select', component: null, ...(e.implicit ? { implicit: true } : {}) })
  }

  occurrences.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.hit.start - b.hit.start || a.start - b.start)
  return { components, occurrences }
}

const EVENT_ROLES = new Set(['emit', 'select'])
const isEvent = (o) => EVENT_ROLES.has(o.role)
const keyOf = (o) => isEvent(o) ? `EVENTS\0${o.name}` : `${o.component}\0${o.name}`
const posKey = (line, column) => line * 1e7 + column
const sortOccs = (list) => list.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.start - b.start)

export function createLookup(index) {
  const byFile = new Map() // file → occurrences sorted by hit start
  const byKey = new Map()  // keyOf → occurrences
  for (const o of index.occurrences) {
    if (!byFile.has(o.file)) byFile.set(o.file, [])
    byFile.get(o.file).push(o)
    const k = keyOf(o)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(o)
  }
  for (const list of byFile.values()) list.sort((a, b) => posKey(a.hit.line, a.hit.column) - posKey(b.hit.line, b.hit.column))

  function at(file, line, column) {
    const list = byFile.get(file)
    if (!list) return []
    const p = posKey(line, column)
    // the last occurrence starting at or before p
    let lo = 0, hi = list.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (posKey(list[mid].hit.line, list[mid].hit.column) <= p) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    if (found < 0) return []
    // tokens don't nest, but several occurrences can share one range (UNDO/REDO, a `uses` key,
    // a model shared by components): they are contiguous and end at `found`
    const s = posKey(list[found].hit.line, list[found].hit.column)
    const out = []
    for (let i = found; i >= 0 && posKey(list[i].hit.line, list[i].hit.column) === s; i--) {
      if (p <= posKey(list[i].hit.endLine, list[i].hit.endColumn)) out.push(list[i])
    }
    return out.reverse()
  }

  const uniq = (list) => {
    const s = new Set()
    return sortOccs(list.filter(o => { const k = `${o.file}\0${o.start}\0${o.end}`; if (s.has(k)) return false; s.add(k); return true }))
  }

  function definition(occs) {
    const out = []
    for (const o of occs) {
      const same = byKey.get(keyOf(o)) || []
      if (o.role === 'select') out.push(...same.filter(x => x.role === 'emit'))
      else if (o.role === 'emit') out.push(...same.filter(x => x.role === 'select'))
      else if (o.role === 'handler') {
        const intents = same.filter(x => x.kind === 'intent')
        out.push(...(intents.length ? intents : same.filter(x => x.role === 'trigger')))
      } else out.push(...same.filter(x => x.role === 'handler'))
    }
    return uniq(out)
  }

  function references(occs, includeDeclaration = true) {
    const out = []
    for (const o of occs) {
      for (const x of byKey.get(keyOf(o)) || []) {
        if (!includeDeclaration && (x.role === 'handler' || x.role === 'emit')) continue
        out.push(x)
      }
    }
    return uniq(out)
  }

  return { at, definition, references }
}
