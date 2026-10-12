/*
 * PLAN-9 K-1: defineCatalog(decl), the declaration both backends compose from (phase1-contract.md,
 * PROPOSAL.md §1). Normalizes and validates the parts and containers (one id namespace; the
 * built-ins `page`, the root, and `row`, side by side), and returns the Catalog: `parts`,
 * `containers`, `get(id)`, `options(state)` (every selectable option, a record part once per
 * record), `records(part, state)`, `finish(layout, state)` (K-3), `render(slice, state, opts)`
 * (K-2), `guidance`, `limits` (`{ maxParts: 12, maxDepth: 4 }`) and `examples`.
 *
 * Errors: an id that can't be a node key (empty, or with ':', '~', '/'), a part id that is also a
 * container's, a part named `page` / `row`, a malformed param and two record params on a part throw
 * at the call (an authoring mistake). The rest are dev diagnostics (./diag.ts): SYG161 (a
 * container's `render` is a component with a model: it is still called as a view), SYG162 (a part
 * with neither `component` nor `render`: it renders nothing), SYG450 (`in` names an unknown
 * container or slot: that entry is dropped), SYG250 (an unknown companion: dropped) and, when the
 * records are read, SYG252.
 */
import {createElement as h} from '../../../pragma/index'
import {dev} from './diag'
import {finish} from './layout'
import {renderLayout} from './render'
import type {Catalog, Container, Entry, Option, Param, Part} from './types'

const BAD_ID = /^$|[:~/]/
const fail = (msg: string): never => { throw new Error(`[Sygnal] defineCatalog: ${msg}`) }

const pageView = ({slots}: any) => h('div', {className: 'compose-page'}, slots.default)
const rowView = ({slots}: any) => h('div', {className: 'compose-row'}, slots.default)
/** a container declared without `render`: its slots in order */
const slotsView = ({slots}: any) => h('div', {className: 'compose-container'}, Object.keys(slots).map(s => slots[s]))

function param(part: string, name: string, p: any): Param {
  const where = `part '${part}', param '${name}'`
  if (!p || typeof p != 'object') return fail(`${where} is not an object`)
  if (typeof p.from == 'function') return {kind: 'record', from: p.from, label: p.label}
  if (p.options && typeof p.options == 'object') {
    const keys = Object.keys(p.options)
    if (!keys.length) fail(`${where} has no options`)
    if (p.default !== undefined && !keys.includes(String(p.default))) fail(`${where}: the default '${p.default}' is not one of its options`)
    return {kind: 'options', options: p.options, default: p.default ?? keys[0], label: p.label, ask: p.ask}
  }
  if (p.type == 'number') {
    if (p.default !== undefined && typeof p.default != 'number') fail(`${where}: the default is not a number`)
    return {kind: 'number', min: p.min, max: p.max, default: p.default, bins: p.bins, label: p.label}
  }
  if (p.type == 'text') return {kind: 'text', maxLength: p.maxLength, default: p.default, required: !!p.required, label: p.label}
  if (p.type == 'list') return {kind: 'list', items: p.items, min: p.min, max: p.max, required: !!p.required, default: p.default, label: p.label}
  return fail(`${where} needs \`options\`, \`from\`, or \`type: 'number' | 'text' | 'list'\``)
}

const isComponent = (f: any) => typeof f == 'function' && !!(f.model || f.intent || f.initialState || f.uses)

function container(id: string, d: any): Container {
  const slots = d.slots && typeof d.slots == 'object' && Object.keys(d.slots).length ? d.slots : {default: null}
  let render = d.render
  if (isComponent(render)) {
    dev('SYG161', 'defineCatalog', `container '${id}': its render is a component with a model or intent; containers are view functions (a component would own the parts, so the host's CHILD.select and lenses stop reaching them). It is called as a view; its model doesn't run`, 'error')
  }
  if (typeof render != 'function') render = id == 'page' ? pageView : id == 'row' ? rowView : slotsView
  // min / max: children per slot (non-negative integers, min <= max); accepts: 'leaves' (no nested
  // containers). An invalid value is ignored (SYG450, like an invalid `in`)
  const count = (k: string) => {
    const v = d[k]
    if (v == null) return undefined
    if (Number.isInteger(v) && v >= 0) return v
    dev('SYG450', 'defineCatalog', `container '${id}': \`${k}\` must be a non-negative integer (children per slot); it is ignored`)
  }
  let min = count('min'), max = count('max')
  if (min != null && max != null && min > max) {
    dev('SYG450', 'defineCatalog', `container '${id}': \`min\` ${min} is above \`max\` ${max}; both are ignored`)
    min = max = undefined
  }
  let accepts = d.accepts
  if (accepts != null && accepts != 'leaves') {
    dev('SYG450', 'defineCatalog', `container '${id}': \`accepts\` takes only 'leaves'; it is ignored`)
    accepts = undefined
  }
  const params: Record<string, Param> = {}
  for (const k in d.params || {}) {
    const p = params[k] = param(id, k, d.params[k])
    if (p.kind == 'record') fail(`container '${id}', param '${k}': containers take no record params`)
  }
  return {id, kind: 'container', slots, slotNames: Object.keys(slots), minSlots: d.minSlots, min, max, accepts, params,
    arranged: !!d.arranged, direction: d.direction ?? (id == 'row' ? 'row' : undefined), description: d.description, render, in: d.in ?? ['page'], decl: d}
}

function part(id: string, d: any): Part {
  if (!d || typeof d != 'object') return fail(`part '${id}' is not an object`)
  if (typeof d.component != 'function' && typeof d.render != 'function') {
    dev('SYG162', 'defineCatalog', `part '${id}' has neither a component nor a render function; it renders nothing`, 'error')
  }
  const params: Record<string, Param> = {}
  let record: string | undefined
  for (const k in d.params || {}) {
    const p = params[k] = param(id, k, d.params[k])
    if (p.kind == 'record') {
      if (record) fail(`part '${id}' has two record params ('${record}', '${k}'); a part takes at most one`)
      record = k
    }
  }
  const pin = d.pin == 'start' || d.pin == 'end' ? d.pin : undefined
  return {id, kind: 'part', component: typeof d.component == 'function' ? d.component : undefined,
    render: typeof d.component != 'function' && typeof d.render == 'function' ? d.render : undefined,
    props: d.props, description: String(d.description ?? id), state: d.state, local: d.local, hasLocal: 'local' in d,
    params, record, in: d.in ?? ['page'], group: d.group, maxUses: Math.max(1, Number(d.maxUses) || 1),
    required: !!d.required, pin, companions: Array.isArray(d.companions) ? d.companions : [], category: d.category,
    result: !!d.result, decl: d}
}

/** 'container' | 'container:slot' entries → 'container:slot' (SYG450 for an unknown one) */
function places(e: Entry, containers: Record<string, Container>): string[] {
  const out: string[] = []
  for (const x of Array.isArray(e.in) ? e.in : [e.in]) {
    const [c, s] = String(x).split(':')
    const ct = containers[c]
    if (!ct || c == 'row' || (s !== undefined && !ct.slotNames.includes(s))) {
      dev('SYG450', 'defineCatalog', `'${e.id}': \`in\` names ${!ct ? `an unknown container '${c}'` : c == 'row' ? "'row' (a row is placed where its parts may go)" : `an unknown slot '${s}' of '${c}'`}; that entry is ignored`)
      continue
    }
    for (const n of s === undefined ? ct.slotNames : [s]) if (!out.includes(c + ':' + n)) out.push(c + ':' + n)
  }
  return out.length ? out : ['page:default']
}

/** a record part's records, validated (SYG252: not an array of `{ value }`, or `from` threw) */
function records(cat: Catalog, p: any, state: any): any[] {
  const part: Part | undefined = typeof p == 'string' ? cat.parts[p] : p
  const rp = part?.record && (part.params[part.record] as any)
  if (!rp) return []
  let list: any
  try { list = rp.from(state) } catch (e: any) {
    dev('SYG252', 'catalog', `part '${part!.id}': the record param's from() threw (${e?.message ?? e}); no records`, 'warn', cat, part!.id + 'threw')
    return []
  }
  const ok = (r: any) => r && typeof r == 'object' && (typeof r.value == 'string' || (typeof r.value == 'number' && isFinite(r.value)))
  if (!Array.isArray(list) || !list.every(ok)) {
    dev('SYG252', 'catalog', `part '${part!.id}': the record param's from() must return an array of { value, name?, aliases?, description? } (value: a string or a number); ${Array.isArray(list) ? 'entries without one are skipped' : 'no records'}`, 'warn', cat, part!.id)
    return Array.isArray(list) ? list.filter(ok) : []
  }
  return list
}

/**
 * defineCatalog({ parts, containers?, guidance?, limits?, examples? }): the normalized, validated
 * catalog. Types: src/ai.d.ts.
 */
export function defineCatalog(decl: any = {}): any {
  const containers: Record<string, Container> = {}
  const parts: Record<string, Part> = {}
  const dc = decl.containers || {}
  containers.page = container('page', {...dc.page, in: [], slots: {default: null}})
  containers.row = container('row', {direction: 'row', min: 2, max: 4, accepts: 'leaves', ...dc.row, slots: {default: null}})
  for (const id in dc) {
    if (id == 'page' || id == 'row') continue
    if (BAD_ID.test(id)) fail(`the container id '${id}' can't be a node key (no ':', '~' or '/')`)
    containers[id] = container(id, dc[id] || {})
  }
  for (const id in decl.parts || {}) {
    if (BAD_ID.test(id)) fail(`the part id '${id}' can't be a node key (no ':', '~' or '/')`)
    if (containers[id]) fail(`'${id}' is both a part and a container (they share one id namespace${id == 'page' || id == 'row' ? `; '${id}' is built in` : ''})`)
    parts[id] = part(id, decl.parts[id])
  }
  const cat: any = {
    parts,
    containers,
    guidance: decl.guidance,
    limits: {maxParts: 12, maxDepth: 4, ...decl.limits},
    examples: Array.isArray(decl.examples) ? decl.examples : [],
    get: (id: string): Entry | undefined => Object.prototype.hasOwnProperty.call(parts, id) ? parts[id]
      : Object.prototype.hasOwnProperty.call(containers, id) ? containers[id] : undefined,
    records: (p: any, state: any) => records(cat, p, state),
    options: (state: any): Option[] => {
      const out: Option[] = []
      for (const id in parts) {
        const p = parts[id]
        if (!p.record) { out.push({option: id, part: id, description: p.description}); continue }
        for (const r of records(cat, p, state)) {
          out.push({option: `${id}:${r.value}`, part: id, params: {[p.record]: r.value},
            description: `${p.description}: ${r.description ?? r.name ?? r.value}`})
        }
      }
      return out
    },
    finish: (layout: any, state?: any) => finish(cat, layout, state),
    render: (slice: any, state: any, opts?: any) => renderLayout(cat, slice, state, opts),
  }
  for (const id in containers) if (id != 'page') containers[id].in = places(containers[id], containers)
  containers.row.in = []
  for (const id in parts) {
    const p = parts[id]
    p.in = places(p, containers)
    p.companions = p.companions.filter(c => {
      if (parts[c] && c != id) return true
      dev('SYG250', 'defineCatalog', `part '${id}': the companion '${c}' is not a part of this catalog; it is ignored`)
      return false
    })
  }
  return cat as Catalog
}
