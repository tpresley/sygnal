#!/usr/bin/env node
/**
 * PLAN-7 spike 0-S3 (throwaway): what the current project model can locate.
 *
 *   node dev-plans/research/p7-spikes/0-S3/positions.mjs <dir> [--all] [--json]
 *
 * Builds the project for <dir> with the existing sygnal-check API (no changes to
 * sygnal-check/src) and prints, per component, every action name with every place it
 * occurs (file:line:col-endCol, role). Roles:
 *   intent   a key of the object the intent returns
 *   model    a model key (the action part; 'A | SINK' shorthand keys are sub-ranged)
 *   next     a next('X') literal
 *   reply    ok:/error:/delta:/tool:/block: literals, connections/resources/route, timers, browser
 *   agent    a key of agent.actions
 * With --all it also prints the other N-1 entities (selectors and the view elements they
 * match, EVENTS, Collection from, context, children) and what it had to re-derive.
 * Ends with the tally of what it could not locate.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '../../../../sygnal-check/src')
const { buildProject } = await import(path.join(SRC, 'model/project.js'))
const { expandInputs } = await import(path.join(SRC, 'files.js'))
const { behaviorActions } = await import(path.join(SRC, 'model/behaviors.js'))
const { analyzeModel } = await import(path.join(SRC, 'model/modelEntries.js'))
const { selectorRequirements, hyperscriptSel } = await import(path.join(SRC, 'selectors.js'))
const { walk, unwrap, jsxName, jsxAttrExpr, propName, memberName, stringValue } = await import(path.join(SRC, 'ast.js'))
const { resolveExpr } = await import(path.join(SRC, 'model/resolve.js'))

const args = process.argv.slice(2)
const dir = path.resolve(args.find(a => !a.startsWith('--')) || '.')
const ALL = args.includes('--all')
const JSON_OUT = args.includes('--json')
const cwd = process.cwd()

const { files } = expandInputs([dir], { cwd })
const t0 = performance.now()
const project = buildProject(files, { cwd })
const buildMs = performance.now() - t0

const rel = (f) => path.relative(cwd, f.path || f)
/** A range for a node; `inner` narrows a string literal to its contents (what a rename edits). */
function range(file, node, sub = null) {
  if (!node?.loc) return null
  let { start, end } = node
  if (node.type === 'StringLiteral' || (node.type === 'TemplateLiteral' && !node.expressions.length)) { start += 1; end -= 1 }
  if (sub) { start += sub[0]; end = start + sub[1] }
  const lc = (off) => {
    // offset → 1-based line/col via the source (node.loc is only for the whole node)
    const before = file.source.slice(0, off)
    const line = before.split('\n').length
    return { line, col: off - before.lastIndexOf('\n') }
  }
  const s = lc(start), e = lc(end)
  return { file: rel(file), start, end, line: s.line, col: s.col, endLine: e.line, endCol: e.col }
}
const fmt = (r) => r ? `${r.file}:${r.line}:${r.col}-${r.endLine === r.line ? '' : r.endLine + ':'}${r.endCol}` : '<no position>'

const tally = {}
const miss = (kind, n = 1) => { tally[kind] = (tally[kind] || 0) + n }
const out = []

for (const c of project.components) {
  const occ = new Map() // action → [{ role, range, note }]
  const add = (name, role, file, node, note, sub) => {
    if (!occ.has(name)) occ.set(name, [])
    occ.get(name).push({ role, range: range(file, node, sub), note })
  }
  const unlocated = []

  // intent keys (node: the property key)
  if (c.intent) {
    for (const a of c.intent.actions) add(a.name, 'intent', c.intent.file, a.node)
    if (!c.intent.known) { unlocated.push('intent: not fully known (spread / computed key / single stream)'); miss('intent not known') }
  }
  // model keys (node: the property key; shorthand 'A | SINK' → sub-range of the action part)
  if (c.model) {
    for (const e of c.model.entries) {
      if (e.node?.type === 'Identifier' && e.node.name === 'undoable') { add(e.action, 'model', e.file, e.node, 'synthetic (undoable())'); continue }
      let sub = null
      if (e.shorthand) {
        const i = e.key.indexOf(e.action)
        sub = [i, e.action.length]
      }
      add(e.action, 'model', e.file, e.node, e.shorthand ? `shorthand '${e.key}'` : null, e.node.type === 'StringLiteral' && sub ? sub : null)
    }
    for (const t of c.model.nextTargets) add(t.name, 'next', t.file, t.node)
    for (const t of c.model.replyTargets) add(t.name, 'reply', t.file, t.node, `${t.sink}.${t.key}`)
    if (!c.model.known) { unlocated.push('model: not fully known (spread / computed key / not an object)'); miss('model not known') }
    if (c.model.dynamicNext.length) { unlocated.push(`next(): ${c.model.dynamicNext.length} dynamic call(s)`); miss('next dynamic', c.model.dynamicNext.length) }
    if (c.model.replyDynamic.length) { unlocated.push(`reply: ${c.model.replyDynamic.length} dynamic name(s)`); miss('reply dynamic', c.model.replyDynamic.length) }
  }
  // connections / resources / route / timers / browser (node: the string literal)
  for (const t of c.connections?.targets || []) {
    const kind = t.route ? 'route' : t.timer ? 'timers' : t.browser ? 'browser' : t.res ? 'resources' : 'connections'
    add(t.name, 'reply', t.file, t.node, `${kind}.${t.key}`)
  }
  if (c.connections?.dynamic.length) { unlocated.push(`reply statics: ${c.connections.dynamic.length} dynamic name(s)`); miss('static reply dynamic', c.connections.dynamic.length) }
  // agent.actions keys
  for (const a of c.agent?.actions || []) add(a.name, 'agent', a.file, a.node)
  if (c.agent && !c.agent.actionsKnown) { unlocated.push('agent.actions: not fully known'); miss('agent not known') }

  // behaviors: 'pager.NEXT' names. The host's own 'pager.NEXT' model keys are model entries
  // (located above). The behavior definition's actions are names only (def.model: Map<string, sinks>).
  for (const [name, b] of behaviorActions(c.uses)) {
    if (!occ.has(name)) {
      // throwaway re-derivation for a user behavior: re-analyze the definition's model
      const def = b.entry.def
      let found = false
      if (def && !def.firstParty && def.node?.arguments?.[0]) {
        const opts = resolveExpr(project, def.file, def.node.arguments[0])
        const mp = opts?.node?.properties?.find(p => propName(p) === 'model')
        if (mp) {
          const m = analyzeModel(project, opts.file, mp.value)
          for (const e of m.entries) if (e.action === b.action) { add(name, 'model', e.file, e.node, `behavior def (re-derived; key '${b.action}')`); found = true }
        }
      }
      if (!found) { add(name, 'model', null, null, def?.firstParty ? `first-party behavior '${def.name}' (no source)` : 'behavior def: names only'); miss(def?.firstParty ? 'behavior first-party (no source)' : 'behavior def not located') }
    }
  }
  for (const e of c.uses?.entries || []) {
    if (e.def && (e.def.nextTargets.length || e.def.replyTargets.length)) { unlocated.push(`uses.${e.key}: next/reply names inside the behavior (${[...e.def.nextTargets, ...e.def.replyTargets].join(', ')}) kept as strings only`); miss('behavior next/reply strings', e.def.nextTargets.length + e.def.replyTargets.length) }
  }

  const comp = { name: c.name, file: rel(c.file), actions: [...occ].map(([name, list]) => ({ name, occurrences: list })), unlocated }

  if (ALL) comp.other = otherEntities(c)
  out.push(comp)
}

function otherEntities(c) {
  const o = {}
  // selectors: node kept; the view elements they match are NOT (sink.classes is a Set of names).
  // Re-derive: walk sink.elements (JSXElement nodes are kept for intrinsic elements) and
  // match class / id tokens in literal className / id attributes.
  const sinks = c.viewInfo ? [c.viewInfo] : []
  const elementsFor = (kind, name) => {
    const hits = []
    for (const s of sinks) for (const el of s.elements) {
      for (const a of el.node.openingElement.attributes) {
        if (a.type !== 'JSXAttribute') continue
        const an = jsxName(a.name)
        const want = kind === 'class' ? ['className', 'class'] : ['id']
        if (!want.includes(an)) continue
        const v = jsxAttrExpr(a)
        walk(v, (n) => {
          const s = n.type === 'StringLiteral' ? n.value : n.type === 'TemplateElement' ? n.value.cooked : null
          if (s == null) return true
          const re = new RegExp(`(^|\\s)${name.replace(/[-]/g, '\\-')}(\\s|$)`)
          const m = re.exec(s)
          if (m) {
            const off = m.index + m[1].length + (n.type === 'StringLiteral' ? 1 : 0)
            hits.push(fmt(range(el.file, { ...n, type: 'X', start: n.start + off, end: n.start + off + name.length, loc: n.loc })))
          }
          return true
        })
      }
    }
    return hits
  }
  o.selectors = [...(c.intent?.selectors || []), ...(c.behaviorSelectors || [])].map(sel => {
    const f = sel.file || c.intent.file
    const reqs = sel.selector ? selectorRequirements(sel.selector) : []
    return {
      selector: sel.selector ?? '<dynamic>', at: fmt(range(f, sel.node)), control: sel.control?.key,
      matches: sel.control ? [`control ${sel.control.key} declared ${fmt(range(sel.control.file, sel.control.keyNode))}`]
        : reqs.flatMap(r => elementsFor(r.kind, r.name)),
    }
  })
  // EVENTS: nodes kept (file-wide scan + model sinks)
  const inComp = (e) => project.componentAt(e.file, e.node) === c
  o.eventsSelected = project.events.selected.filter(e => !e.implicit && inComp(e)).map(e => `${e.type} ${fmt(range(e.file, e.node))}`)
  o.eventsEmitted = project.events.emitted.filter(e => e.component === c.name || inComp(e)).map(e => `${e.type} ${fmt(range(e.file, e.node))}`)
  // Collection from: fromNode = the JSXAttribute (whole attribute, not the string)
  o.collections = (c.viewInfo?.collections || []).map(col => {
    const v = col.fromNode && jsxAttrExpr(col.fromNode)
    const key = col.from != null && c.initialState?.keys.get(col.from)
    const keyNode = key && key.file.parents.get(key.node)
    return { from: col.from, at: v ? fmt(range(c.file, v)) : '<none>', stateKey: keyNode?.key ? fmt(range(key.file, keyNode.key)) + ' (via parents of the value node)' : (c.calculatedKeys.has(col.from) ? 'calculated (name only)' : '<not located>') }
  })
  // context provided: contextKeys is a Set of names; re-derive with objectKeys (value nodes)
  if (c.staticProps.context) {
    const keys = project.objectKeys(c.file, c.staticProps.context)
    o.contextProvides = keys ? [...keys].map(([k, v]) => { const p = v.file.parents.get(v.node); return `${k} ${fmt(range(v.file, p?.key || v.node))}` }) : '<unknown>'
  }
  // children: usage.node kept (the opening element)
  o.children = (c.viewInfo?.children || []).map(u => `${u.name} (${u.kind}) ${fmt(range(u.file, u.node.name || u.node))}${u.ref ? ' → def ' + fmt(range(u.ref.file, u.ref.node.id || u.ref.node)) : ''}`)
  return o
}

if (JSON_OUT) {
  console.log(JSON.stringify({ dir: rel(dir), buildMs, components: out, tally }, null, 2))
} else {
  console.log(`# ${rel(dir)}: ${files.length} files, ${project.components.length} components, model built in ${buildMs.toFixed(0)} ms`)
  let nAct = 0, nOcc = 0, nNoPos = 0
  for (const c of out) {
    console.log(`\n## ${c.name}  (${c.file})`)
    for (const a of c.actions) {
      nAct++
      console.log(`  ${a.name}`)
      for (const o of a.occurrences) {
        nOcc++
        if (!o.range) nNoPos++
        console.log(`    ${o.role.padEnd(7)} ${fmt(o.range)}${o.note ? '  ' + o.note : ''}`)
      }
    }
    for (const u of c.unlocated) console.log(`  ! ${u}`)
    if (c.other) console.log('  other: ' + JSON.stringify(c.other, null, 2).replace(/\n/g, '\n  '))
  }
  console.log(`\n# totals: ${nAct} actions, ${nOcc} occurrences, ${nNoPos} without a position`)
  console.log('# not locatable with the current model: ' + (Object.keys(tally).length ? JSON.stringify(tally) : 'none'))
}
