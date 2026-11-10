/**
 * What a component does, action by action, as plain data (the behaviour report: see compare.js).
 * The graph (graph.js) says which actions and sinks exist; this adds what is inside them.
 *
 *   behaviourFacts(project, graph) → { [component key]: ComponentFacts }
 *   ComponentFacts {
 *     name, file, known (the model and intent can be listed whole),
 *     actions: { [name]: { trigger, sinks: { [sink]: SinkFacts } } },
 *     initial: { [key]: { h, text } }, calculated / context: { [name]: { fp, reads, partial } },
 *     view: fp, statics: { [name]: fp }, uses: { [key]: fp }, persist: { pick, text } | null,
 *   }
 *   trigger: { sources: ['click .add', 'EVENTS SAVED', 'CHILD Row', 'key j'], filters: [{ h, text }], fp }
 *   SinkFacts {
 *     fp, reads, readsPartial, guards: [{ h, text }], conds: [{ h, text }], branches,
 *     mutates (assigns through a local or calls an array mutator), opaque (can't be read),
 *     STATE: writes (keys, null unknown; reducerWrites with deep), removes,
 *            perKey { [key]: hash of what the returns put there }
 *     EVENTS: events [type]; PARENT / EVENTS: shape [keys of the returned literal] | null
 *     a driver sink (HTTP, LLM, ...): requests ['PUT /api/x/${…} → ok SAVED, error FAILED']
 *   }
 * fp is canon.js's fingerprint. A guard is a condition under which the sink does nothing (ABORT, or
 * `return state` from a STATE reducer); text is its path of conditions as written.
 */
import { walk, unwrap, isFunction, propName, memberName, stringValue, fileOfNode } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from '../model/resolve.js'
import { returnedExpressions, sourceAliases, isSourceRef } from '../model/intent.js'
import { eventSinkTypes, returnedObjects, requestProps, NON_REPLY_SINKS } from '../model/modelEntries.js'
import { stateReads, sygnalName, reducerWrites } from '../model/stateAccess.js'
import { renderGraph } from '../model/renderGraph.js'
import { findApps } from '../model/apps.js'
import { fingerprint, canonOf, canonText, hash, textOf, returnedLiterals } from './canon.js'

const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])
const bare = (n) => { n = unwrap(n); while (n?.type === 'ChainExpression') n = unwrap(n.expression); return n }

/**
 * A sink's value in the form that compares: set(fn) is fn with the state carried over, event('T', fn) is
 * fn with an event type. { fn, file, strip, eventType?, literal? } or { expr, file }.
 */
function sinkForm(project, file, value) {
  const r = resolveExpr(project, file, value)
  const v = bare(r?.node)
  if (!v) return { expr: value, file }
  if (v.type === 'CallExpression') {
    const helper = sygnalName(r.file, v.callee)
    const a0 = v.arguments[0], a1 = v.arguments[1]
    if (helper === 'set' && a0 && a0.type !== 'SpreadElement') {
      const a = resolveExpr(project, r.file, a0)
      if (a?.node && isFunction(a.node)) return { fn: a.node, file: a.file, setter: true }
      if (a?.node?.type === 'ObjectExpression') return { expr: a.node, file: a.file, setter: true }
    }
    if ((helper === 'event' || helper === 'emit') && stringValue(a0) != null) {
      const a = a1 && resolveExpr(project, r.file, a1)
      return a?.node && isFunction(a.node) ? { fn: a.node, file: a.file, eventType: stringValue(a0) } : { expr: a1 ?? v, file: r.file, eventType: stringValue(a0) }
    }
  }
  return isFunction(v) ? { fn: v, file: r.file } : { expr: v, file: r.file }
}

const shapeOf = (objs) => [...new Set(objs.flatMap(o => o.properties.map(p => p.type === 'SpreadElement' ? '...' : propName(p) ?? '?')))].sort()

function statementsOf(fn) {
  return fn.body.type === 'BlockStatement' ? fn.body : { type: 'ReturnStatement', argument: fn.body }
}

/** The function a call runs, when the checker can read it (not a package's). */
function helperOf(project, file, call) {
  const callee = bare(call.callee)
  if (callee?.type !== 'Identifier') return null
  const b = findBinding(file, callee.name, callee)
  if (!b || (b.kind === 'import' && !/^[./]/.test(b.source))) return null
  const h = resolveExpr(project, file, callee)
  return h?.node && isFunction(h.node) ? { fn: h.node, file: h.file, name: callee.name } : null
}

/**
 * The guards (conditions that end in ABORT / the state unchanged), conditions, branch count and
 * returned object literals of a function, following helpers in return position (3 calls deep): a guard
 * moved into a helper hashes as it did in place (canon.js args), a guard changed in one is a changed guard.
 */
function controlFlow(project, file0, fn0, isStateSink) {
  const out = { guards: [], conds: [], branches: 0, literals: [], mutates: false }
  const seen = new Set()
  const visit = (file, fn, path0, level) => {
    seen.add(fn)
    if (mutates(fn)) out.mutates = true
    const c = (n) => canonOf(file, n, fn, { args: level.args })
    const say = (t) => level.name ? `${t} (in ${level.name})` : t
    const stateParam = fn.params[level.state]
    const noop = (e) => {
      e = bare(e)
      if (!e) return false
      if (sygnalName(file, e) === 'ABORT') return true
      return isStateSink && e.type === 'Identifier' && stateParam?.type === 'Identifier' && e.name === stateParam.name
    }
    const neg = (x) => ({ text: `!(${x.text})`, h: 'not:' + x.h })
    // (conds: `!x` and `x` are one condition, an if / else written the other way round isn't a change)
    const positive = (n) => { const t = bare(n); return t.type === 'UnaryExpression' && t.operator === '!' ? bare(t.argument) : t }
    const seenConds = new Set()
    const addCond = (n) => { const p = positive(n); const x = { text: say(textOf(file, p)), h: c(p) }; if (!seenConds.has(x.text)) { seenConds.add(x.text); out.conds.push(x); out.branches++ } }
    const cond = (n) => { addCond(n); return { text: say(textOf(file, n)), h: c(n) } }
    const guard = (path) => path.length && out.guards.push({ text: path.map(x => x.text).join(' && '), h: hash(path.map(x => x.h).join('&')) })
    const expr = (e, path) => {
      e = bare(e)
      if (!e) return
      if (noop(e)) { guard(path); return }
      if (e.type === 'ConditionalExpression') {
        const x = cond(e.test)
        expr(e.consequent, [...path, x])
        expr(e.alternate, [...path, neg(x)])
      } else if (e.type === 'LogicalExpression') {
        // `a && ABORT`, `a || ABORT`
        const x = { text: say(textOf(file, e.left)), h: c(e.left) }
        if (noop(e.right)) guard([...path, e.operator === '&&' ? x : neg(x)])
        else { expr(e.right, path); if (e.operator !== '&&') expr(e.left, path) }
      } else if (e.type === 'ObjectExpression') {
        out.literals.push({ obj: e, file, fn, args: level.args })
      } else if (e.type === 'CallExpression' && level.depth < 3) {
        const h = helperOf(project, file, e)
        if (!h || seen.has(h.fn)) return
        const i = e.arguments.findIndex(a => bare(a)?.type === 'Identifier' && stateParam?.type === 'Identifier' && bare(a).name === stateParam.name)
        visit(h.file, h.fn, path, { depth: level.depth + 1, name: h.name, state: i < 0 ? -1 : i, args: e.arguments.map(a => a.type === 'SpreadElement' ? '...' : canonText(file, a, fn, { args: level.args })) })
      }
    }
    const stmt = (s, path) => {
      if (!s) return
      switch (s.type) {
        case 'BlockStatement': s.body.forEach(x => stmt(x, path)); break
        case 'ReturnStatement': expr(s.argument, path); break
        case 'IfStatement': {
          const x = cond(s.test)
          stmt(s.consequent, [...path, x])
          stmt(s.alternate, [...path, neg(x)])
          break
        }
        case 'SwitchStatement': {
          const d = { text: textOf(file, s.discriminant), h: c(s.discriminant) }
          for (const k of s.cases) {
            const x = k.test ? { text: say(`${d.text} === ${textOf(file, k.test)}`), h: d.h + c(k.test) } : { text: 'default', h: 'default' }
            if (k.test && !seenConds.has(x.text)) { seenConds.add(x.text); out.conds.push(x); out.branches++ }
            k.consequent.forEach(y => stmt(y, [...path, x]))
          }
          break
        }
        case 'TryStatement': stmt(s.block, path); stmt(s.handler?.body, path); stmt(s.finalizer, path); break
        case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': case 'WhileStatement': case 'DoWhileStatement': stmt(s.body, path); break
      }
    }
    stmt(statementsOf(fn), path0)
    // conditions the walk above doesn't reach (inside expressions, nested callbacks): counted as branches
    walk(fn.body, (n) => {
      if (n.type === 'ConditionalExpression' || n.type === 'IfStatement') addCond(n.test)
      else if (n.type === 'LogicalExpression' && ['&&', '||', '??'].includes(n.operator)) out.branches++
      return true
    })
  }
  visit(file0, fn0, [], { depth: 0, name: null, state: 0, args: null })
  return out
}

function mutates(fn) {
  let hit = false
  walk(fn.body, (n) => {
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression') hit = true
    // (`[...xs].sort()`, `xs.filter(f).sort()`: a fresh array, nothing else sees it)
    if (n.type === 'CallExpression' && bare(n.callee)?.type === 'MemberExpression' && MUTATORS.has(memberName(bare(n.callee))) && ['Identifier', 'MemberExpression'].includes(bare(bare(n.callee).object)?.type)) hit = true
    return !hit
  })
  return hit
}

/** Reads through a destructured previousState (the 4th parameter): `{ previousState }`. */
function previousStateReads(fn) {
  const p = fn.params[3]
  if (p?.type !== 'ObjectPattern' || !p.properties.some(x => x.type === 'ObjectProperty' && propName(x) === 'previousState')) return []
  const out = []
  walk(fn.body, (n) => {
    if (n.type === 'MemberExpression' && bare(n.object)?.type === 'Identifier' && bare(n.object).name === 'previousState') { const k = memberName(n); if (k && !out.includes(k)) out.push(k) }
    return true
  })
  return out
}

/** What each key of the state a reducer's returns put there (the state carried over isn't a key). */
function perKey(literals) {
  const lists = {}
  for (const { obj, file, fn, args } of literals) {
    for (const p of obj.properties) {
      if (p.type === 'SpreadElement') continue
      const k = propName(p)
      if (k == null) continue
      const v = p.type === 'ObjectMethod' ? p : p.value
      ;(lists[k] ||= []).push(canonOf(file, v, fn, { inline: true, args }))
    }
  }
  const out = {}
  for (const k of Object.keys(lists).sort()) out[k] = hash(lists[k].sort().join('|'))
  return out
}

function requestsOf(project, file, value) {
  const out = []
  for (const o of returnedObjects(project, file, value)) {
    const { props } = requestProps(project, o.node, o.file, o.bind)
    const get = (key) => props.find(({ p }) => propName(p) === key)
    const show = (x) => { if (!x) return null; const s = stringValue(x.p.value); return s ?? textOf(x.file, x.p.value).replace(/^`|`$/g, '') }
    const url = show(get('url'))
    const replies = ['ok', 'error', 'chunk', 'delta', 'tool'].map(k => [k, show(get(k))]).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')
    const what = url != null ? `${url.startsWith('/') || /^https?:/.test(url) || url.includes('${') ? (show(get('method')) || 'GET') + ' ' : ''}${url}`
      : props.length ? `{ ${[...new Set(props.map(({ p }) => propName(p)).filter(Boolean))].slice(0, 6).join(', ')} }` : null
    if (what) out.push(replies ? `${what} → ${replies}` : what)
  }
  return [...new Set(out)]
}

function sinkFacts(project, entry, sink, value, vfile, stateKeys) {
  const form = sinkForm(project, vfile, value)
  const out = { reads: [], readsPartial: false, guards: [], conds: [], branches: 0, mutates: false, opaque: false }
  const f = form.file
  // the keys it writes, following helpers further than the graph's `writes` does
  if (sink === 'STATE') {
    const removes = {}
    out.writes = reducerWrites(project, vfile, value, { stateKeys, deep: true, out: removes })
    if (removes.removes) out.removes = true
  }
  if (form.fn) {
    const fn = form.fn
    const strip = sink === 'STATE' ? new Set(returnedLiterals(fn, returnedExpressions)) : null
    out.fp = fingerprint(project, f, fn, { strip })
    const reads = stateReads(project, f, fn, { state: true, reducer: true })
    out.reads = reads ? [...reads.keys] : []
    out.readsPartial = reads ? reads.partial : true
    for (const k of previousStateReads(fn)) if (!out.reads.includes(k)) out.reads.push(k)
    out.reads.sort()
    const flow = controlFlow(project, f, fn, sink === 'STATE')
    Object.assign(out, { guards: flow.guards, conds: flow.conds, branches: flow.branches, mutates: flow.mutates })
    if (sink === 'STATE') out.perKey = perKey(flow.literals)
    if (sink === 'EVENTS' || sink === 'PARENT') {
      const lits = returnedLiterals(fn, returnedExpressions)
      // `{ type: 'X', data }`: the payload is data, the same as event('X', fn) returning it
      const typed = sink === 'EVENTS' && lits.length && lits.every(o => o.properties.some(p => p.type === 'ObjectProperty' && propName(p) === 'type' && stringValue(p.value) != null))
      if (typed) {
        const dataOf = (o) => o.properties.find(p => p.type === 'ObjectProperty' && propName(p) === 'data')?.value ?? null
        const datas = lits.map(dataOf)
        out.fp.own = hash([...datas.map(d => d ? canonOf(f, d, fn) : '_'), ...out.guards.map(g => g.h), ...out.conds.map(c => c.h)].sort().join('|'))
        out.shape = datas.every(d => bare(d)?.type === 'ObjectExpression') ? shapeOf(datas.map(bare)) : null
      } else {
        if (sink === 'EVENTS' && form.eventType && lits.length) out.fp.own = hash([...lits.map(o => canonOf(f, o, fn)), ...out.guards.map(g => g.h), ...out.conds.map(c => c.h)].sort().join('|'))
        out.shape = lits.length ? shapeOf(lits) : null
      }
    }
  } else {
    const e = bare(form.expr)
    out.fp = fingerprint(project, f, e, form.setter && sink === 'STATE' && e?.type === 'ObjectExpression' ? { strip: new Set([e]) } : {})
    out.opaque = !e || (e.type !== 'ObjectExpression' && !/Literal$/.test(e.type) && sygnalName(f, e) !== 'ABORT' && !(e.type === 'CallExpression' && ['set', 'toggle', 'emit', 'event'].includes(sygnalName(f, e.callee))))
    if (sink === 'STATE' && e?.type === 'ObjectExpression') out.perKey = perKey([{ obj: e, file: f, fn: null, args: null }])
    if (sink === 'STATE' && e?.type === 'CallExpression' && sygnalName(f, e.callee) === 'toggle') out.perKey = { [stringValue(e.arguments[0]) ?? '?']: 'toggle' }
    if ((sink === 'PARENT' || sink === 'EVENTS') && e?.type === 'ObjectExpression') out.shape = shapeOf([e])
  }
  if (sink === 'EVENTS') {
    const t = eventSinkTypes(project, vfile, value)
    out.events = [...new Set([...(form.eventType ? [form.eventType] : []), ...t.types.map(x => x.type)])].sort()
  } else if (!NON_REPLY_SINKS.has(sink) && sink !== 'LOG') {
    out.requests = requestsOf(project, vfile, value)
  }
  return out
}

/** The call chain of `n`, innermost first: { root, segs: [{ name, args, node }] }; null when it isn't a chain. */
function flatten(n) {
  const segs = []
  let cur = bare(n)
  while (cur?.type === 'CallExpression' || cur?.type === 'OptionalCallExpression') {
    const c = bare(cur.callee)
    if (c?.type !== 'MemberExpression' && c?.type !== 'OptionalMemberExpression') return null
    if (c.computed) return null
    segs.unshift({ name: c.property.name, args: cur.arguments, node: cur })
    cur = bare(c.object)
  }
  return segs.length ? { root: cur, segs } : null
}

/** A keymap() call's entries: { action: [keys] } (`j: ['STEP', 1]` is a key for STEP). */
function keymapEntries(file, init) {
  const call = bare(init)
  if (call?.type !== 'CallExpression' || sygnalName(file, call.callee) !== 'keymap') return null
  const obj = bare(call.arguments[1])
  if (obj?.type !== 'ObjectExpression') return null
  const out = {}
  for (const p of obj.properties) {
    const key = p.type === 'ObjectProperty' ? propName(p) : null
    if (key == null) continue
    let v = bare(p.value)
    if (v.type === 'ArrayExpression') v = bare(v.elements[0])
    const a = stringValue(v)
    if (a != null) (out[a] ||= []).push(key)
  }
  return out
}

function triggersOf(project, c) {
  const out = new Map()
  const intent = c.intent
  if (!intent?.fn) return out
  const file = intent.file
  const sa = sourceAliases(intent.fn)
  const names = [...sa.aliases.keys()]
  const sourceName = (r) => names.find(s => isSourceRef(r, s, sa)) ?? (sa.sourcesParam && r?.type === 'MemberExpression' && memberName(r)) ?? null
  const argText = (a) => { if (!a) return ''; const s = stringValue(a); return s ?? textOf(file, a) }
  const describe = (src, segs) => {
    const [a, b] = segs
    if (src === 'DOM') {
      if (a.name === 'select') return `${b?.name === 'events' ? argText(b.args[0]) : b?.name ?? 'select'} ${argText(a.args[0])}`
      return `${a.name} ${argText(a.args[0])}`
    }
    if (src === 'EVENTS') return `EVENTS ${argText(a.args[0])}`
    if (src === 'CHILD') return `CHILD ${argText(a.args[0])}`
    return `${src}.${a.name}(${a.args[0] ? argText(a.args[0]) : ''})${b && b.name !== 'map' && b.name !== 'filter' ? `.${b.name}(${argText(b.args[0])})` : ''}`
  }
  const keymapOf = (id) => {
    const b = id?.type === 'Identifier' ? findBinding(file, id.name, id) : null
    return b?.kind === 'var' ? keymapEntries(file, b.init) : null
  }
  const scan = (root, t, seen) => {
    const done = new Set()
    walk(bare(root), (n) => {
      if (n.type === 'MemberExpression' && !n.computed) {
        const m = keymapOf(bare(n.object))
        if (m) { for (const k of m[n.property.name] || []) t.sources.add(`key ${k}`); return false }
      }
      if (n.type === 'Identifier') {
        const b = findBinding(file, n.name, n)
        if (b?.kind === 'var' && b.init && b.init.start >= intent.fn.start && b.init.end <= intent.fn.end && !keymapEntries(file, b.init) && !seen.has(b.init)) { seen.add(b.init); scan(b.init, t, seen) }
        return true
      }
      if (n.type === 'CallExpression' || n.type === 'OptionalCallExpression') {
        const chain = flatten(n)
        if (chain) {
          const last = chain.segs[chain.segs.length - 1]
          if (last.name === 'filter' && last.args[0]) t.filters.push({ h: canonOf(file, last.args[0], intent.fn, { inline: true }), text: textOf(file, last.args[0]) })
          if (!done.has(n)) {
            const src = sourceName(chain.root)
            if (src) { t.sources.add(describe(src, chain.segs)); chain.segs.forEach(s => done.add(s.node)) }
          }
        }
      }
      return true
    })
  }
  for (const a of intent.actions) {
    const prop = file.parents.get(a.node)
    const v = prop?.value ?? null
    const t = { sources: new Set(), filters: [] }
    if (v) scan(v, t, new Set())
    out.set(a.name, {
      sources: [...t.sources].sort(), filters: t.filters,
      fp: v ? fingerprint(project, file, v, { root: intent.fn, localNames: true, inline: true, noInline: (b) => !!keymapEntries(file, b.init) }) : null,
    })
  }
  // `...keys`: the actions a keymap() spread into the intent adds
  const add = (ret) => {
    const obj = bare(ret)
    if (obj?.type !== 'ObjectExpression') return
    for (const p of obj.properties) {
      if (p.type !== 'SpreadElement') continue
      const m = keymapOf(bare(p.argument))
      if (!m) continue
      for (const [action, keys] of Object.entries(m)) {
        const t = out.get(action) ?? { sources: [], filters: [], fp: null }
        t.sources = [...new Set([...t.sources, ...keys.map(k => `key ${k}`)])].sort()
        out.set(action, t)
      }
    }
  }
  returnedExpressions(intent.fn).forEach(add)
  // a keymap() spread doesn't make the action list incomplete
  out.listed = intent.known || (returnedExpressions(intent.fn).every(r => bare(r)?.type === 'ObjectExpression' && bare(r).properties.every(p => p.type !== 'SpreadElement' || keymapOf(bare(p.argument)))) && !intent.computed.length)
  return out
}

const staticFp = (project, c, name) => {
  const node = c.staticProps[name]
  if (!node) return null
  const r = resolveExpr(project, c.file, node)
  return r?.node ? fingerprint(project, r.file, r.node) : null
}

function entriesFacts(project, entries) {
  const out = {}
  for (const [name, e] of entries || []) {
    const r = resolveExpr(project, e.file, e.node)
    if (!r?.node) continue
    const reads = isFunction(r.node) ? stateReads(project, r.file, r.node, { state: true }) : null
    out[name] = { fp: fingerprint(project, r.file, r.node), reads: reads?.keys ?? [], partial: reads ? reads.partial : true }
  }
  return out
}

function persistFacts(project, c) {
  const node = c.staticProps.persist
  if (!node) return null
  const r = resolveExpr(project, c.file, node)
  const call = bare(r?.node)
  const arg = call?.type === 'CallExpression' ? bare(call.arguments[0]) : null
  let pick = null
  if (arg?.type === 'ObjectExpression') {
    const p = arg.properties.find(x => x.type === 'ObjectProperty' && propName(x) === 'pick')
    const list = p && bare(p.value)
    if (list?.type === 'ArrayExpression' && list.elements.every(e => stringValue(e) != null)) pick = list.elements.map(e => stringValue(e)).sort()
  }
  return { pick, text: r?.node ? textOf(r.file, r.node) : '' }
}

/** The drivers each run() call is given, relative file and sorted names (null: can't be listed). */
export function appDrivers(project) {
  return findApps(project).map(a => ({ file: project.relPath(a.file.path), root: a.root?.name ?? null, drivers: a.drivers ? [...a.drivers].sort() : null }))
}

export function behaviourFacts(project, graph) {
  const out = {}
  project.components.forEach((c, i) => {
    const node = graph.components[i]
    const triggers = triggersOf(project, c)
    const actions = {}
    const stateKeys = c.initialState?.known ? node.stateKeys : null
    for (const a of node.actions) actions[a.name] = { trigger: triggers.get(a.name) ?? null, sinks: {} }
    for (const e of c.model?.entries || []) {
      const a = actions[e.action] ||= { trigger: triggers.get(e.action) ?? null, sinks: {} }
      for (const sv of (c.model.sinkValues || []).filter(x => x.action === e.action)) a.sinks[sv.sink] = sinkFacts(project, e, sv.sink, sv.node, sv.file, stateKeys)
      if (e.stateValue && !a.sinks.STATE) {
        // `SAVE: emit('SAVED', fn)`: an entry that is an EVENTS sink, though the model reads it as a reducer
        const form = sinkForm(project, e.stateValue.file, e.stateValue.node)
        a.sinks[form.eventType ? 'EVENTS' : 'STATE'] = sinkFacts(project, e, form.eventType ? 'EVENTS' : 'STATE', e.stateValue.node, e.stateValue.file, stateKeys)
      }
    }
    const initial = {}
    for (const [k, v] of c.initialState?.keys || []) initial[k] = { h: fingerprint(project, v.file ?? c.file, v.node).own, text: textOf(v.file ?? c.file, v.node).slice(0, 80) }
    const uses = {}
    const usesNode = c.staticProps.uses && resolveExpr(project, c.file, c.staticProps.uses)?.node
    if (usesNode?.type === 'ObjectExpression') for (const p of usesNode.properties) { const k = p.type === 'ObjectProperty' ? propName(p) : null; if (k) uses[k] = fingerprint(project, fileOfNode(project, p, c.file) ?? c.file, p.value) }
    const statics = {}
    for (const s of ['connections', 'resources', 'route', 'head', 'timers', 'browser', 'viewTransitions', 'isolatedState', 'agent']) { const fp = staticFp(project, c, s); if (fp) statics[s] = fp }
    out[node.key] = {
      name: c.name, file: node.file, known: (c.model?.known ?? true) && (triggers.listed ?? c.intent?.known ?? true),
      actions, initial, uses, statics,
      calculated: entriesFacts(project, c.calculatedEntries), context: entriesFacts(project, c.contextEntries),
      view: c.view ? fingerprint(project, c.file, c.view) : null,
      persist: persistFacts(project, c),
    }
  })
  // view-only components: the view alone
  const { units } = renderGraph(project)
  graph.components.slice(project.components.length).forEach((node, i) => {
    const u = units[project.components.length + i]
    out[node.key] = { name: node.name, file: node.file, known: true, actions: {}, initial: {}, uses: {}, statics: {}, calculated: {}, context: {}, view: u?.view ? fingerprint(project, u.file, u.view) : null, persist: null, viewOnly: true }
  })
  return out
}
