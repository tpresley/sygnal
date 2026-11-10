/**
 * The behaviour report (`sygnal-check --report --base <ref>`; research:
 * dev-plans/research/behaviour-report): what a change does to the app, worked out from the code of the
 * two versions (facts.js), never from what the author says about it.
 *
 *   behaviourReport(base, head, meta) → BehaviourReport   (the --json output)
 *     base, head   { graph, facts, parseErrors }
 *     meta         { base, head, commit, changedFiles }
 *   BehaviourReport {
 *     base, head, commit, summary: { added, removed, changed, attention },
 *     attention: [{ severity: 'high' | 'medium' | 'low', kind, component, action?, sink?, text, at? }],
 *     components: [{ key, name, file, status: 'added' | 'removed' | 'changed', movedFrom?,
 *       actions: [ActionChange], state: [..], context: [..], calculated: [..], statics: [..],
 *       view: { changed, helpers, reads, children } | null, blast: [..] }],
 *     coverage: { files, explained, unexplained, tests, nonCode, partial, parseErrors },
 *   }
 *   ActionChange { name, change: 'added' | 'removed' | 'changed', trigger: TriggerChange | null,
 *     sinks: [SinkChange] }
 *   SinkChange { sink, change: 'added' | 'removed' | 'changed', reads, writes, removes, guards: { added,
 *     removed }, requests, events, touches, shape, logic: { kinds, notes, confidence } }
 * logic.kinds: 'helper', 'guard', 'branch', 'condition', 'writes', 'value', 'payload', 'other'.
 * logic.confidence 'low': the writes can't be listed, the code mutates locals, or uses state whole.
 */
import { graphDiff } from '../graphView/diff.js'
import { CLOCK_GLOBALS } from './canon.js'

/** Sinks that stay inside the app: changing them isn't a new side effect. */
const INTERNAL_SINKS = new Set(['STATE', 'EVENTS', 'PARENT', 'ELEMENT', 'DOM', 'CHILD', 'READY', 'LOG'])
const SEVERITY = { high: 0, medium: 1, low: 2 }
const uniq = (xs) => [...new Set(xs)].sort()
const listDiff = (a = [], b = []) => { const A = new Set(a), B = new Set(b); return { added: uniq(b.filter(x => !A.has(x))), removed: uniq(a.filter(x => !B.has(x))) } }
const some = (d) => !!d && (d.added.length > 0 || d.removed.length > 0)
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Did a fingerprint change, and through what: { changed, own, helpers: [names], files: [of the helpers] }. */
function fpDiff(a, b) {
  if (!a && !b) return { changed: false, own: false, helpers: [], files: [] }
  if (!a || !b) return { changed: true, own: true, helpers: [], files: [] }
  const helpers = [], files = []
  for (const k of new Set([...Object.keys(a.deps), ...Object.keys(b.deps)])) {
    if (a.deps[k]?.h !== b.deps[k]?.h) { helpers.push(k); const f = b.deps[k]?.file ?? a.deps[k]?.file; if (f) files.push(f) }
  }
  return { changed: a.own !== b.own || helpers.length > 0, own: a.own !== b.own, helpers: helpers.sort(), files: uniq(files) }
}

function triggerDiff(a, b) {
  if (!a && !b) return null
  const sources = listDiff(a?.sources, b?.sources)
  const f = listDiff((a?.filters || []).map(x => x.h), (b?.filters || []).map(x => x.h))
  const text = (list, h) => list.find(x => x.h === h)?.text
  const filters = { added: f.added.map(h => text(b.filters, h)), removed: f.removed.map(h => text(a.filters, h)) }
  const fp = fpDiff(a?.fp, b?.fp)
  if (!some(sources) && !some(filters) && !fp.changed) return null
  return { sources: b?.sources ?? [], before: a?.sources ?? [], ...{ added: sources.added, removed: sources.removed }, filters, rewired: some(sources), logic: fp.changed && !some(sources) && !some(filters), helpers: fp.helpers, files: fp.files }
}

function classify(a, b, fp, writes) {
  const kinds = [], notes = []
  let dropped = null
  const guardH = (x) => x.guards.map(g => g.h)
  if (!fp.own) {
    kinds.push('helper')
    notes.push(`code is the same, but ${fp.helpers.map(h => `\`${h}\``).join(', ')} changed`)
  } else {
    if (some(listDiff(guardH(a), guardH(b)))) kinds.push('guard')
    if (a.branches !== b.branches) { kinds.push('branch'); notes.push(`${b.branches > a.branches ? 'more' : 'fewer'} branches (${a.branches} → ${b.branches})`) }
    const guardTexts = [...a.guards, ...b.guards].map(g => g.text)
    const inGuard = (t) => guardTexts.some(g => g.includes(t))
    const d = listDiff(a.conds.map(c => c.h), b.conds.map(c => c.h))
    const text = (list, h) => list.find(c => c.h === h)?.text
    const removed = d.removed.map(h => text(a.conds, h)).filter(t => !inGuard(t))
    const added = d.added.map(h => text(b.conds, h)).filter(t => !inGuard(t))
    if (removed.length || added.length) {
      kinds.push('condition')
      if (removed.length && !added.length || b.branches < a.branches) dropped = removed
      for (const t of removed.slice(0, 3)) notes.push(`condition gone: \`${t}\``)
      for (const t of added.slice(0, 3)) notes.push(`new condition: \`${t}\``)
    }
    if (writes && some(writes)) kinds.push('writes')
    if (a.perKey && b.perKey) {
      const keys = Object.keys(b.perKey).filter(k => k in a.perKey && a.perKey[k] !== b.perKey[k])
      if (keys.length) { kinds.push('value'); notes.push(`what it puts in ${keys.map(k => `\`${k}\``).join(', ')} differs${b.mutates || a.mutates ? ' (and it mutates locals, so other keys may too)' : ''}`) }
    }
    if (!sameList(a.shape, b.shape) || some(listDiff(a.requests, b.requests)) || some(listDiff(a.events, b.events))) kinds.push('payload')
    if (!kinds.length) { kinds.push('other'); notes.push('no guard, branch, condition or written key differs: the computation changed, or the code was only rearranged') }
    if (fp.helpers.length) notes.push(`also changed: ${fp.helpers.map(h => `\`${h}\``).join(', ')}`)
  }
  const low = a.opaque || b.opaque || a.mutates || b.mutates || a.readsPartial || b.readsPartial || a.fp.opaque.length > 0 || b.fp.opaque.length > 0 || (writes && writes.unknown)
  return { kinds, notes, confidence: low ? 'low' : 'high', helpers: fp.helpers, ...(dropped?.length ? { dropped } : {}) }
}

function sinkDiff(sink, a, b, ga, gb) {
  const w = sink === 'STATE' ? (() => {
    const x = ga?.writes, y = gb?.writes
    return { base: x ?? null, head: y ?? null, unknown: (a && x == null) || (b && y == null), added: x && y ? listDiff(x, y).added : [], removed: x && y ? listDiff(x, y).removed : [] }
  })() : null
  if (!a) return { sink, change: 'added', reads: b.reads, readsPartial: b.readsPartial, writes: w, removes: !!gb?.removes, guards: { added: b.guards.map(g => g.text), removed: [] }, requests: { added: b.requests || [], removed: [] }, events: { added: b.events || [], removed: [] }, touches: { added: b.fp.touches, removed: [] }, shape: b.shape ?? null, logic: null, files: [] }
  if (!b) return { sink, change: 'removed', reads: a.reads, readsPartial: a.readsPartial, writes: w, guards: { added: [], removed: [] }, requests: { added: [], removed: a.requests || [] }, events: { added: [], removed: a.events || [] }, touches: { added: [], removed: [] }, logic: null, files: [] }
  const fp = fpDiff(a.fp, b.fp)
  const gChanged = !sameList(w?.base && uniq(w.base), w?.head && uniq(w.head))
  if (!fp.changed && !gChanged) return null
  const g = listDiff(a.guards.map(x => x.h), b.guards.map(x => x.h))
  const text = (list, h) => list.find(x => x.h === h)?.text
  return {
    sink, change: 'changed',
    reads: b.reads, readsDiff: listDiff(a.reads, b.reads), readsPartial: b.readsPartial, writes: w, removes: !!gb?.removes, removesBefore: !!ga?.removes,
    guards: { added: g.added.map(h => text(b.guards, h)), removed: g.removed.map(h => text(a.guards, h)) },
    requests: listDiff(a.requests, b.requests), events: listDiff(a.events, b.events), touches: listDiff(a.fp.touches, b.fp.touches),
    shape: sameList(a.shape, b.shape) ? null : { base: a.shape ?? null, head: b.shape ?? null },
    logic: classify(a, b, fp, w), files: fp.files,
  }
}

function actionDiff(name, a, b, ga, gb) {
  const sinks = []
  for (const s of uniq([...Object.keys(a?.sinks || {}), ...Object.keys(b?.sinks || {})])) {
    const d = sinkDiff(s, a?.sinks[s], b?.sinks[s], ga, gb)
    if (d) sinks.push(d)
  }
  const trigger = triggerDiff(a?.trigger, b?.trigger)
  if (a && b && !sinks.length && !trigger) return null
  return { name, change: !a ? 'added' : !b ? 'removed' : 'changed', triggerKind: (gb || ga)?.trigger ?? null, sources: (b || a)?.trigger?.sources ?? [], trigger, sinks, at: gb?.modelAt?.line ?? gb?.line ?? null, sinksAfter: uniq(Object.keys(b?.sinks || {})) }
}

/** { added: [{ name, text? }], removed: [..], changed: [{ name, .. }] } of a map of { fp } / { h } values. */
function mapDiff(a = {}, b = {}, fpOf) {
  const out = []
  for (const k of uniq([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k]
    if (!x) out.push({ name: k, change: 'added', head: y })
    else if (!y) out.push({ name: k, change: 'removed', base: x })
    else { const c = fpOf(x, y); if (c) out.push({ name: k, change: 'changed', base: x, head: y, ...c }) }
  }
  return out
}

// ───── blast radius ─────

function graphIndex(graph, facts) {
  const byId = new Map(graph.components.map(c => [c.id, c]))
  const parents = new Map()
  for (const p of graph.components) for (const ch of p.children || []) if (ch.id != null) (parents.get(ch.id) || parents.set(ch.id, []).get(ch.id)).push({ p, ch })
  return { byId, parents, facts }
}

/** Components below `c` that see `key` of c's state. */
function readersBelow(c, key, G, out, seen) {
  if (seen.has(c.id)) return
  seen.add(c.id)
  for (const ch of c.children || []) {
    const child = G.byId.get(ch.id)
    if (!child || seen.has(child.id) || ch.via === 'layout') continue
    if (ch.via === 'collection') { if (ch.from === key) out.push(`${child.name} (Collection from '${key}')`); else if (ch.from == null) out.push(`${child.name} (Collection, source unknown)`); continue }
    if (ch.state != null) { if (ch.state.split('.')[0] === key) out.push(`${child.name} (state="${ch.state}")`); continue }
    if (G.facts[child.key]?.statics?.isolatedState) continue
    if (child.stateReads?.includes(key)) out.push(`${child.name} (view)`)
    else if (child.stateReadsPartial) out.push(`${child.name} (may read it)`)
    readersBelow(child, key, G, out, seen)
  }
}

function descendants(c, G, out = new Set()) {
  for (const ch of c.children || []) { const child = G.byId.get(ch.id); if (child && !out.has(child)) { out.add(child); descendants(child, G, out) } }
  return out
}

function readersOf(c, key, G) {
  const out = []
  const f = G.facts[c.key]
  const seen = new Set()
  readersBelow(c, key, G, out, seen)
  // the context fields computed from it
  for (const [field, e] of Object.entries(f?.context || {})) {
    if (!e.reads.includes(key) && !e.partial) continue
    for (const d of descendants(c, G)) if (d.contextConsumes?.includes(field)) out.push(`${d.name} (context ${field})`)
  }
  // up: a parent that shares this state (a lens or a Collection is one line: holdersOf)
  const up = (x, k, depth) => {
    if (depth > 4) return
    for (const { p, ch } of G.parents.get(x.id) || []) {
      if (p.id === c.id || seen.has('up:' + p.id)) continue
      seen.add('up:' + p.id)
      if (ch.via !== 'collection' && ch.state == null && !G.facts[x.key]?.statics?.isolatedState) {
        if (p.stateReads?.includes(k)) out.push(`${p.name} (view)`)
        readersBelow(p, k, G, out, new Set([x.id, ...seen].filter(s => !String(s).startsWith('up:'))))
        up(p, k, depth + 1)
      }
    }
  }
  up(c, key, 0)
  return uniq(out)
}

/** Where this component's state lives when a parent gives it a slice: { key, readers: [..] } per parent. */
function holdersOf(node, G) {
  const out = []
  for (const { p, ch } of G.parents.get(node.id) || []) {
    const key = ch.via === 'collection' ? ch.from : ch.state?.split('.')[0]
    if (!key) continue
    const others = []
    readersBelow(p, key, G, others, new Set([node.id]))
    out.push({ kind: 'holder', key, parent: p.name, readers: uniq(others) })
  }
  return out
}

function blastOf(comp, node, G, headGraph) {
  const lines = []
  if (!node) return lines
  const keys = new Set(comp.state.map(s => s.name))
  for (const a of comp.actions) {
    for (const s of a.sinks) {
      if (s.sink !== 'STATE') continue
      if (s.change === 'added' || s.change === 'removed') for (const k of (s.writes?.head || s.writes?.base || [])) keys.add(k)
      else if (s.logic?.kinds.includes('value') || s.logic?.kinds.includes('writes') || s.logic?.kinds.includes('other') || s.logic?.kinds.includes('guard') || s.logic?.kinds.includes('branch') || s.logic?.kinds.includes('condition') || s.logic?.kinds.includes('helper')) for (const k of [...(s.writes?.head || []), ...(s.writes?.removed || [])]) keys.add(k)
    }
  }
  const calc = G.facts[comp.key]?.calculated || {}
  for (let i = 0; i < 3; i++) for (const [f, e] of Object.entries(calc)) if (e.reads.some(k => keys.has(k))) keys.add(f)
  for (const k of [...keys].sort()) {
    const readers = readersOf(node, k, G)
    if (readers.length) lines.push({ kind: 'state', key: k, readers })
  }
  if (keys.size) lines.push(...holdersOf(node, G))
  const types = uniq(comp.actions.flatMap(a => a.sinks.flatMap(s => s.sink === 'EVENTS' ? [...(s.events?.added || []), ...(s.events?.removed || []), ...(s.change === 'changed' ? G.facts[comp.key]?.actions[a.name]?.sinks.EVENTS?.events || [] : [])] : [])))
  for (const t of types) lines.push({ kind: 'event', key: t, readers: headGraph.events[t]?.selectors || [] })
  if (comp.actions.some(a => a.sinks.some(s => s.sink === 'PARENT'))) {
    const receivers = headGraph.components.flatMap(p => (p.childSelects || []).filter(cs => cs.id === node.id).map(() => {
      // the intent actions fed by CHILD.select(this), also through a local
      const acts = Object.entries(G.facts[p.key]?.actions || {}).filter(([, a]) => a.trigger?.sources.includes(`CHILD ${comp.name}`)).map(([n]) => n)
      return `${p.name} (${acts.join(', ') || '?'})`
    }))
    if (receivers.length) lines.push({ kind: 'parent', key: 'PARENT', readers: uniq(receivers) })
  }
  return lines
}

// ───── attention ─────

function attentionFor(comp, ctx) {
  const out = []
  const push = (severity, kind, text, extra = {}) => out.push({ severity, kind, component: comp.name, text, ...extra })
  const label = (a) => `\`${comp.name}.${a.name}\``
  for (const a of comp.actions) {
    const at = a.at ? `${comp.file}:${a.at}` : comp.file
    if (a.trigger?.filters.removed.length && a.change === 'changed') {
      for (const t of a.trigger.filters.removed) push(a.trigger.filters.added.length ? 'medium' : 'high', a.trigger.filters.added.length ? 'trigger-filter-changed' : 'trigger-filter-removed', `${label(a)} no longer filters its trigger with \`${t}\`${a.trigger.filters.added.length ? ` (now \`${a.trigger.filters.added.join('`, `')}\`)` : ''}`, { action: a.name, at })
    }
    for (const s of a.sinks) {
      const x = { action: a.name, sink: s.sink, at }
      const external = !INTERNAL_SINKS.has(s.sink)
      if (s.change === 'added' && external) {
        const what = s.requests?.added.length ? `: ${s.requests.added.map(r => `\`${r}\``).join(', ')}` : s.touches?.added.length ? `: touches ${s.touches.added.map(t => `\`${t}\``).join(', ')}` : ''
        push('high', 'side-effect', `${label(a)} ${a.change === 'added' ? 'is new and' : 'now'} sends to ${s.sink}${what}`, { ...x, ...(a.change === 'added' ? { isNew: true } : {}) })
      } else if (s.change === 'removed' && external && a.change !== 'removed') {
        push('medium', 'side-effect-removed', `${label(a)} no longer sends to ${s.sink}${s.requests?.removed.length ? `: ${s.requests.removed.map(r => `\`${r}\``).join(', ')}` : ''}`, x)
      } else if (s.change === 'changed') {
        for (const r of s.requests.added) push('high', 'side-effect', `${label(a)} sends a new ${s.sink} request: \`${r}\`${s.requests.removed.length ? ` (was \`${s.requests.removed.join('`, `')}\`)` : ''}`, x)
        if (!s.requests.added.length) for (const r of s.requests.removed) push('medium', 'side-effect-removed', `${label(a)} no longer sends \`${r}\` to ${s.sink}`, x)
        if (external || s.sink === 'STATE') {
          for (const t of s.touches.added) {
            if (CLOCK_GLOBALS.test(t)) push('low', 'clock', `${label(a)} ${s.sink} now reads \`${t}\`: not replayable as written`, x)
            else push('high', 'side-effect', `${label(a)} ${s.sink} now touches \`${t}\``, x)
          }
        }
      }
      if (s.change === 'added' && s.sink === 'STATE') {
        const t = s.touches?.added.filter(x => !CLOCK_GLOBALS.test(x)) || []
        if (t.length) push('high', 'side-effect', `${label(a)}'s reducer touches ${t.map(k => `\`${k}\``).join(', ')}`, x)
      }
      if (s.change === 'changed') {
        const pairs = Math.min(s.guards.added.length, s.guards.removed.length)
        s.guards.removed.slice(0, pairs).forEach((t, i) => push('medium', 'guard-changed', `${label(a)} ${s.sink}: guard \`${t}\` became \`${s.guards.added[i]}\``, x))
        // (a guard may have moved into a helper that changed in the same edit: guards in helpers aren't read)
        const moved = s.logic?.helpers?.length ? ` (or moved into ${s.logic.helpers.map(h => `\`${h}\``).join(', ')})` : ''
        for (const t of s.guards.removed.slice(pairs)) push(moved ? 'medium' : 'high', 'guard-removed', `${label(a)} ${s.sink}: guard removed, it no longer stops when \`${t}\`${moved}`, x)
        if (s.writes) {
          if (s.writes.added.length) push('medium', 'writes-widened', `${label(a)} now also writes ${s.writes.added.map(k => `\`${k}\``).join(', ')}`, x)
          if (s.writes.base && s.writes.head === null) push('medium', 'writes-opaque', `${label(a)}: which keys it writes can no longer be listed`, x)
        }
        if (s.removes && !s.removesBefore) push('high', 'removes', `${label(a)} may now remove its Collection item (returns undefined)`, x)
        if (s.shape && (s.sink === 'PARENT' || s.sink === 'EVENTS')) push('medium', 'payload', `${label(a)} ${s.sink} payload changed shape: ${shapeText(s.shape.base)} → ${shapeText(s.shape.head)}; check the receivers`, x)
        if (s.logic?.kinds.includes('condition') && s.logic.dropped && !s.guards.removed.length) push('medium', 'branch-removed', `${label(a)} ${s.sink}: logic that depended on ${s.logic.dropped.map(t => `\`${t}\``).join(', ')} is gone`, x)
        if (s.logic?.confidence === 'low' && !s.guards.removed.length) push('low', 'unclear', `${label(a)} ${s.sink} changed in a way this report can't describe reliably: read the diff`, x)
      }
    }
  }
  for (const p of ctx.persist) push('high', 'persist', p)
  for (const t of ctx.events) out.push({ component: comp.name, ...t })
  for (const d of ctx.diagnostics) push('medium', 'diagnostic', d)
  for (const x of ctx.agent) push('high', 'agent', x)
  return out
}

const shapeText = (s) => s ? `{ ${s.join(', ')} }` : 'a value'

function agentDiff(ga, gb) {
  const out = []
  const of = (g) => new Map((g?.agent?.actions || []).map(a => [a.name, a]))
  const A = of(ga), B = of(gb)
  const name = (gb || ga).name
  for (const [k, v] of B) {
    if (!A.has(k)) out.push(`\`${name}\`: an agent can now call \`${k}\`${v.consequential ? ' (consequential)' : ''}`)
    else if (A.get(k).consequential && !v.consequential) out.push(`\`${name}\`: agent action \`${k}\` is no longer marked consequential`)
  }
  for (const k of A.keys()) if (!B.has(k)) out.push(`\`${name}\`: an agent can no longer call \`${k}\``)
  return out
}

const isTest = (f) => /(^|\/)__tests__\/|\.(test|spec|vtest)\.[cm]?[jt]sx?$/.test(f)
const isCode = (f) => /\.[cm]?[jt]sx?$/.test(f)

export function behaviourReport(base, head, meta = {}) {
  // a component in a renamed or moved file: same name, half its actions or more
  const movedFrom = new Map()
  const bKeys = Object.keys(base.facts), hKeys = Object.keys(head.facts)
  const onlyB = bKeys.filter(k => !head.facts[k]), onlyH = hKeys.filter(k => !base.facts[k])
  for (const k of onlyH) {
    const h = head.facts[k]
    const names = Object.keys(h.actions)
    const m = onlyB.find(x => {
      const b = base.facts[x]
      if (b.name !== h.name || [...movedFrom.values()].includes(x)) return false
      const bn = Object.keys(b.actions)
      if (!names.length && !bn.length) return true
      return names.filter(n => bn.includes(n)).length * 2 >= Math.max(names.length, bn.length)
    })
    if (m) movedFrom.set(k, m)
  }
  const renamed = new Map([...movedFrom].map(([h, b]) => [b, h]))
  const baseGraph = { ...base.graph, components: base.graph.components.map(c => renamed.has(c.key) ? { ...c, key: renamed.get(c.key) } : c) }
  const baseFacts = Object.fromEntries(Object.entries(base.facts).map(([k, v]) => [renamed.get(k) ?? k, v]))

  const d = graphDiff(baseGraph, head.graph, meta)
  const fieldsOf = new Map(d.changed.map(c => [c.key, c.fields]))
  const G = graphIndex(head.graph, head.facts)
  const nodeB = new Map(baseGraph.components.map(c => [c.key, c])), nodeH = new Map(head.graph.components.map(c => [c.key, c]))
  const components = [], attention = []
  const explained = new Set()

  for (const key of uniq([...Object.keys(baseFacts), ...Object.keys(head.facts)])) {
    const b = baseFacts[key], h = head.facts[key]
    const gb = nodeB.get(key), gh = nodeH.get(key)
    const f = (b || h)
    const comp = { key, name: f.name, file: (h || b).file, status: !b ? 'added' : !h ? 'removed' : 'changed', actions: [], state: [], context: [], calculated: [], statics: [], uses: [], view: null, blast: [] }
    if (movedFrom.has(key)) comp.movedFrom = b.file
    const actB = new Map((gb?.actions || []).map(a => [a.name, a])), actH = new Map((gh?.actions || []).map(a => [a.name, a]))
    for (const n of uniq([...Object.keys(b?.actions || {}), ...Object.keys(h?.actions || {})])) {
      const a = actionDiff(n, b?.actions[n], h?.actions[n], actB.get(n), actH.get(n))
      if (a) comp.actions.push(a)
    }
    const fileNote = []
    for (const a of comp.actions) { for (const s of a.sinks) fileNote.push(...(s.files || [])); fileNote.push(...(a.trigger?.files || [])) }
    if (b && h) {
      comp.state = mapDiff(b.initial, h.initial, (x, y) => x.h !== y.h ? {} : null).map(x => ({ name: x.name, change: x.change, base: x.base?.text, head: x.head?.text }))
      const entryDiff = (x, y) => { const fp = fpDiff(x.fp, y.fp); if (fp.files.length) fileNote.push(...fp.files); return fp.changed || !sameList(x.reads, y.reads) ? { reads: listDiff(x.reads, y.reads), helpers: fp.helpers } : null }
      comp.context = mapDiff(b.context, h.context, entryDiff).map(({ base: _b, head: _h, ...r }) => r)
      comp.calculated = mapDiff(b.calculated, h.calculated, entryDiff).map(({ base: _b, head: _h, ...r }) => r)
      const staticDiff = (x, y) => { const fp = fpDiff(x, y); if (fp.files.length) fileNote.push(...fp.files); return fp.changed ? { helpers: fp.helpers } : null }
      comp.statics = mapDiff(b.statics, h.statics, staticDiff).map(({ base: _b, head: _h, ...r }) => r)
      comp.uses = mapDiff(b.uses, h.uses, staticDiff).map(({ base: _b, head: _h, ...r }) => r)
      const v = fpDiff(b.view, h.view)
      fileNote.push(...v.files)
      const fields = fieldsOf.get(key) || {}
      if (v.changed || fields.stateReads || fields.children || fields.contextConsumes) comp.view = { changed: v.changed, helpers: v.helpers, reads: fields.stateReads ?? null, children: fields.children ?? null, context: fields.contextConsumes ?? null }
    }
    const ctx = { persist: [], events: [], diagnostics: [], agent: [] }
    const pb = b?.persist, ph = h?.persist
    if ((pb || ph) && pb?.text !== ph?.text) {
      const pd = listDiff(pb?.pick ?? [], ph?.pick ?? [])
      ctx.persist.push(`\`${comp.name}\`: what is persisted changed${some(pd) ? ` (${[...pd.added.map(k => `+${k}`), ...pd.removed.map(k => `-${k}`)].join(', ')})` : ''}`)
      comp.persist = { base: pb?.text ?? null, head: ph?.text ?? null }
    }
    if (ph?.pick) {
      for (const a of comp.actions) for (const s of a.sinks) {
        if (s.sink !== 'STATE') continue
        const newly = (s.change === 'added' ? s.writes?.head || [] : s.writes?.added || []).filter(k => ph.pick.includes(k))
        if (newly.length && (a.change === 'changed' || s.change === 'changed')) ctx.persist.push(`\`${comp.name}.${a.name}\` now writes persisted key${newly.length > 1 ? 's' : ''} ${newly.map(k => `\`${k}\``).join(', ')}`)
      }
    }
    const fields = fieldsOf.get(key) || {}
    for (const t of fields.eventsEmitted?.added || []) {
      const others = head.graph.events[t]?.selectors || []
      const pkg = uniq(head.graph.components.flatMap(c => (c.children || []).filter(ch => ch.external).map(ch => ch.name)))
      const noneHere = !others.length
      ctx.events.push({ severity: noneHere && !pkg.length ? 'medium' : 'low', kind: noneHere ? 'event-no-listener' : 'event-new', text: noneHere ? `\`${comp.name}\` emits \`${t}\`, and no scanned component listens${pkg.length ? ` (a package component may: ${pkg.join(', ')})` : ''}` : `\`${comp.name}\` now emits \`${t}\` → ${others.join(', ')}` })
    }
    for (const t of fields.eventsEmitted?.removed || []) {
      const e = head.graph.events[t]
      if (e?.selectors.length && !e.emitters.length) ctx.events.push({ severity: 'medium', kind: 'event-orphan', text: `\`${comp.name}\` stopped emitting \`${t}\`, and nothing else does: ${e.selectors.join(', ')} still listen${e.selectors.length === 1 ? 's' : ''}` })
    }
    // (a finding whose message names a line isn't new because the line moved)
    const noLine = (x) => x.replace(/\(line \d+\)/g, '')
    const wasThere = new Set((fields.diagnostics?.removed || []).map(noLine))
    for (const dx of fields.diagnostics?.added || []) if (!dx.startsWith('SYG5') && !wasThere.has(noLine(dx))) ctx.diagnostics.push(`\`${comp.name}\`: new finding: ${dx}`)
    if (gb || gh) ctx.agent.push(...agentDiff(gb, gh))
    // (actions, sinks, selectors and state keys are compared above, from the facts)
    const other = Object.keys(fields).filter(x => !['actions', 'sinks', 'selectors', 'stateKeys'].includes(x))
    const empty = b && h && !comp.movedFrom && !comp.actions.length && !comp.state.length && !comp.context.length && !comp.calculated.length && !comp.statics.length && !comp.uses.length && !comp.view && !comp.persist && !other.length
    if (empty) continue
    comp.structure = fields
    comp.blast = blastOf(comp, gh, G, head.graph)
    attention.push(...attentionFor(comp, ctx))
    components.push(comp)
    explained.add(comp.file)
    if (comp.movedFrom) explained.add(comp.movedFrom)
    for (const x of fileNote) explained.add(x)
  }

  // the drivers given to run(): the app's side-effect surface
  const driversOf = (s) => uniq((s.apps || []).flatMap(a => a.drivers || []))
  const drivers = listDiff(driversOf(base), driversOf(head))
  for (const name of drivers.added) attention.push({ severity: 'high', kind: 'driver', text: `The app now gives \`run()\` a driver \`${name}\`` })
  for (const name of drivers.removed) attention.push({ severity: 'medium', kind: 'driver', text: `The app no longer gives \`run()\` a driver \`${name}\`` })
  if (some(drivers)) for (const a of head.apps || []) explained.add(a.file)

  attention.sort((x, y) => SEVERITY[x.severity] - SEVERITY[y.severity])
  const files = meta.changedFiles || []
  const coverage = {
    files: files.length,
    explained: files.filter(f => explained.has(f)),
    unexplained: files.filter(f => isCode(f) && !isTest(f) && !explained.has(f)),
    tests: files.filter(isTest),
    nonCode: files.filter(f => !isCode(f)),
    partial: uniq(Object.values(head.facts).filter(f => !f.known).map(f => f.name)),
    parseErrors: uniq([...(base.parseErrors || []).map(e => `${meta.base ?? 'base'}: ${e}`), ...(head.parseErrors || []).map(e => `${meta.head ?? 'head'}: ${e}`)]),
  }
  const count = (s) => components.filter(c => c.status === s).length
  const out = { base: meta.base ?? 'base', head: meta.head ?? 'working tree' }
  if (meta.commit) out.commit = meta.commit
  out.summary = { added: count('added'), removed: count('removed'), changed: count('changed'), attention: attention.length }
  out.attention = attention
  out.components = components
  out.events = d.events
  out.drivers = drivers
  out.coverage = coverage
  return out
}
