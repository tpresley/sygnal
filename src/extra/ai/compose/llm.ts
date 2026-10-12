/*
 * PLAN-9 B-3: compose.llm(), the GenAI LLM backend of the `compose` behavior (phase-1 contract,
 * dev-plans/research/ai-compose/phase1-contract.md). A port of the research's recommended path
 * (dev-plans/research/ai-compose/llm/llm-composer.mjs, REPORT.md §1–§6, §9) with its exact
 * prompt and schema, onto the normalized catalog:
 *
 * - start(): ONE chat request with structured output: the `tree+plan` schema (an `asked_for`
 *   list, then a nested tree: per place and depth an `anyOf` of one closed object per part, enum
 *   params, record enums from state, `in`, rows (leaves only, at most 4) and `maxDepth` (types.ts:
 *   a container at depth d, the page's children at 1, only when d <= maxDepth) in the
 *   grammar) and the system prompt (the catalog as text, the rules, the catalog's `guidance`,
 *   its `examples` as few-shot turns). `delta` when streaming.
 * - delta(): a preview of the complete nodes so far (a leaf shows once its object closes, so its
 *   params are final; containers show what they hold). Keys are identities (fromTree), so a part
 *   keeps its key as the reply grows.
 * - reply(): read (lenient: `type` / `component` / `name` for `part`, flat params, the list under
 *   another key), repair (unknown parts dropped, duplicates beyond `maxUses`, one per `group`,
 *   bad params → default, text cut to `maxLength`, unknown slots → default, containers too deep
 *   or in a row lifted, a row of one unwrapped, empty containers dropped), then a schema check
 *   of the repaired tree, fromTree, finish. An empty tree is `unavailable`; a reply that still
 *   violates the schema is `{ error }` (the behavior's status 'error') and SYG683, never a layout.
 * - fake(): the JSON text of a target tree in this schema (composeWith).
 *
 * Phase 1: `previous` keeps node keys (fromTree) and the request composes fresh; B-4 (ops2 edits)
 * adds `currentPage(previous)` to the user message. Pure apart from SYG683's report.
 */
import {jsonSchema, check} from '../schema/jsonSchema'
import {fromTree, finish} from './layout'
import {report} from '../../diagnostics/index'

export interface LlmOptions {
  /** the model id (the transport's default otherwise) */
  model?: string
  /** the chat driver's sink (default 'LLM') */
  sink?: string
  /** the request key (default: the behavior's key) */
  key?: string
  /** stream a preview through `delta` (default true) */
  stream?: boolean
  /** the `asked_for` plan field (default true; false when there are examples) */
  plan?: boolean
  /** more instructions after the rules, or a function of the system prompt that returns the one to send */
  instructions?: string | ((prompt: string) => string)
  /** few-shot examples: [prompt, tree, asked_for?] or { prompt, tree, asked_for? }; default: the catalog's */
  examples?: any[]
  /** anything else goes on the request as is (transport options: `body`, `coalesce`, ...) */
  [option: string]: unknown
}

type Issue = {kind: string; detail: string}
type TNode = {part: string; params?: Record<string, any>; slots?: Record<string, TNode[]>}

// ---------------------------------------------------------------- the catalog, as the model sees it
const ROOT = 'page'
const PLACE = ROOT + ':default'
/** a param's kind (types.ts' normalized `kind`, 'options' read as 'enum'; a raw declaration reads the same) */
const kindOf = (d: any) => {
  if (!d || typeof d != 'object') return ''
  const k = d.kind ?? (typeof d.from == 'function' ? 'record' : d.options ? 'options' : d.type)
  return k == 'options' ? 'enum' : k == 'record' || k == 'number' || k == 'list' || k == 'text' ? k : ''
}
const labelOf = (d: any) => d.label ?? d.description

function records(d: any, state: any): any[] {
  let r: any
  try { r = d.from(state) } catch (_) { return [] }
  return Array.isArray(r) ? r.filter(x => x && (typeof x.value == 'string' || typeof x.value == 'number')) : []
}

/** the choosable items (parts, then containers; required parts are added by finish, not asked) */
function context(catalog: any, state: any) {
  const items: any[] = []
  const byId: Record<string, any> = {}
  const add = (id: string, def: any, container: boolean) => {
    const params: any[] = []
    let rec: string | undefined
    for (const [name, d] of Object.entries<any>(def.params || {})) {
      const kind = kindOf(d)
      if (!kind) continue
      const p: any = {name, d, kind}
      if (kind == 'record') {
        p.records = records(d, state)
        if (!p.records.length) return   // nothing to show: not choosable now
        rec = name
      }
      params.push(p)
    }
    const row = container && (def.direction == 'row' || id == 'row')
    const slots = container ? Object.keys(def.slots || {default: null}) : []
    // leaves: holds parts only (a row; or a container declared `accepts: 'leaves'`)
    const it = {id, def, container, row, leaves: row || def.accepts == 'leaves', params, rec, slots,
      min: def.min ?? (row ? 2 : 0), max: def.max ?? (row ? 4 : undefined), uses: def.maxUses ?? 1}
    items.push(it)
    byId[id] = it
  }
  for (const [id, def] of Object.entries<any>(catalog.parts || {})) if (!def.required) add(id, def, false)
  for (const [id, def] of Object.entries<any>(catalog.containers || {})) if (id != ROOT) add(id, def, true)
  const required = new Set(Object.keys(catalog.parts || {}).filter(id => catalog.parts[id].required))
  return {items, byId, required, root: catalog.containers?.[ROOT] || {}, maxDepth: catalog.limits?.maxDepth ?? 4, maxParts: catalog.limits?.maxParts ?? 12}
}
type Ctx = ReturnType<typeof context>

/**
 * the places `it` may go. The normalized catalog lists 'container:slot' entries (types.ts; the root
 * is 'page:default'); a raw `in` may name a container alone. A row's `in` is empty: it goes where its
 * parts may go (never checked here).
 */
const placesOf = (it: any): string[] => [].concat(it.def.in ?? [ROOT])
/** may `it` sit at `place` ('container:slot')? */
const placeOk = (it: any, place: string) => placesOf(it).some((e: string) => e == place || e == place.split(':')[0])

// ---------------------------------------------------------------- prompt (research wording, exact)
function paramText(p: any) {
  const {name, d, kind} = p
  const label = labelOf(d)
  const def = d.default !== undefined ? ` (default ${d.default})` : ''
  if (kind == 'enum') return `${name}: ${label ? label + '. ' : ''}one of ${Object.entries(d.options).map(([v, m]) => `${v} = ${m}`).join('; ')}${def}`
  if (kind == 'record') {
    const rs = p.records.map((r: any) => `${r.value} = ${[r.name, r.description].filter(Boolean).join(': ') || r.value}${r.aliases?.length ? ` (also ${r.aliases.join(', ')})` : ''}`)
    return `${name}: ${label || 'which record'}. one of ${rs.join('; ')}${def}`
  }
  if (kind == 'number') {
    const range = d.min != null && d.max != null ? ` from ${d.min} to ${d.max}` : d.min != null ? ` of at least ${d.min}` : d.max != null ? ` of at most ${d.max}` : ''
    const bins = d.bins ? `; ${Object.entries(d.bins).map(([v, m]) => `${v} = ${m}`).join('; ')}` : ''
    return `${name}: ${label ? label + '. ' : ''}a number${range}${bins}${def}`
  }
  if (kind == 'list') return `${name}: ${label}; a list of ${d.min ? `${d.min} to ` : 'at most '}${d.max ?? 6} short texts`
  return `${name}: ${label}; short text, at most ${d.maxLength ?? 40} characters${d.default !== undefined ? `; "${d.default}" when the request does not say` : d.required ? '; always set it' : ''}`
}

/** ' (only inside tabs or panel slot side)': a container whose every slot is allowed is named alone */
const onlyIn = (it: any, ctx: Ctx) => {
  const ins = placesOf(it)
  if (!ins.length || ins.some(e => e == ROOT || e == PLACE)) return ''
  const by = new Map<string, string[]>()
  for (const e of ins) {
    const [c, s] = e.split(':')
    if (!by.has(c)) by.set(c, [])
    if (s !== undefined) by.get(c)!.push(s)
  }
  const names = [...by].flatMap(([c, ss]) => {
    const all = ctx.byId[c]?.slots ?? []
    return !ss.length || all.every((x: string) => ss.includes(x)) ? [c] : ss.map(x => `${c} slot ${x}`)
  })
  return ` (only inside ${names.join(' or ')})`
}

/** the catalog as the prompt shows it */
export function catalogText(ctx: Ctx) {
  const lines = ['Parts (id: what it shows):']
  for (const it of ctx.items.filter(i => !i.container)) {
    lines.push(`- ${it.id}: ${it.def.description ?? it.id}${onlyIn(it, ctx)}`)
    for (const p of it.params) lines.push(`    param ${paramText(p)}`)
  }
  const cs = ctx.items.filter(i => i.container)
  if (cs.length) {
    lines.push('', 'Containers (hold other parts):')
    for (const it of cs) {
      const slots = it.slots.map((s: string) => {
        const lim = [it.min && `at least ${it.min}`, it.max && `at most ${it.max}`].filter(Boolean).join(', ')
        const acc = it.leaves ? 'parts only, no containers' : ''
        const desc = it.def.slots?.[s]
        return s == 'default' ? [lim, acc].filter(Boolean).join('; ') : `slot ${s}${desc ? `: ${desc}` : ''}`
      }).filter(Boolean).join('; ')
      const desc = it.def.description ?? (it.row ? 'Row: shows its parts side by side, left to right' : it.id)
      lines.push(`- ${it.id}: ${desc}${slots ? ` (${slots})` : ''}${onlyIn(it, ctx)}`)
      for (const p of it.params) lines.push(`    param ${paramText(p)}`)
    }
  }
  return lines.join('\n')
}

const RULES = [
  'Use only the parts the request asks for, by name or by what they show. Include every part it asks for. Do not add parts it does not ask for, even related ones.',
  'Use each part at most once.',
  'Order the parts top to bottom as the request says (first, at the top, above, then, below, under, at the bottom). When it does not say, keep the order in which the request mentions them.',
  'Use a container only when the request asks for it (a row only when it wants parts side by side, next to each other or in a row).',
  'Set a param only from what the request says; otherwise use its default.',
  'If nothing in the catalog fits the request, return an empty list.',
]
const PLAN = 'First write asked_for: each thing the request asks for, in its own words, one item per thing (an empty list when it asks for nothing the parts show). Then use exactly one part for each item, and no other parts.'
const SHAPE = `"children": [ {"part": "<id>", "params": {...}}, {"part": "<container id>", "children": [ ... ]} ]}   (top to bottom; a container's children in order)`

/** the system prompt (`tree`, or `tree+plan` with `plan`) */
export function systemPrompt(catalog: any, state: any, {plan = true, instructions}: {plan?: boolean; instructions?: LlmOptions['instructions']} = {}, ctx: Ctx = context(catalog, state)) {
  const intro = 'You compose a page of an app from parts the app has prepared. Each part already has its own data and wording; you only choose which parts the request asks for and arrange them.'
  const guidance = [].concat(catalog.guidance ?? []).flatMap((g: string) => String(g).split('\n')).map(s => s.trim()).filter(Boolean)
  const rules = [...RULES, ...guidance.map(g => g.replace(/^[-*]\s*/, ''))]
  if (plan) rules.push(PLAN)
  const named = ctx.items.some(i => i.container && i.slots.some((s: string) => s != 'default'))
  const extra = typeof instructions == 'string' && instructions ? `\n\n${instructions}` : ''
  const prompt = `${intro}\n\n${catalogText(ctx)}\n\nRules:\n${rules.map(r => `- ${r}`).join('\n')}${extra}\n\nReply with JSON only, in this shape:\n` +
    `{${plan ? '"asked_for": ["<thing the request asks for>", ...], ' : ''}${SHAPE}` +
    (named ? '\nA container with named slots lists each slot\'s parts under the slot\'s name instead of "children".' : '')
  return typeof instructions == 'function' ? instructions(prompt) : prompt
}

// ---------------------------------------------------------------- schema
function paramsSchema(it: any) {
  const props: any = {}
  const required: string[] = []
  for (const p of it.params) {
    const d = p.d
    if (p.kind == 'enum') { props[p.name] = {enum: Object.keys(d.options)}; required.push(p.name) }
    else if (p.kind == 'record') { props[p.name] = {enum: p.records.map((r: any) => r.value)}; if (d.default === undefined) required.push(p.name) }
    else if (p.kind == 'number') props[p.name] = {type: 'number', ...(d.min != null && {minimum: d.min}), ...(d.max != null && {maximum: d.max})}
    else if (p.kind == 'list') {
      props[p.name] = {type: 'array', items: {type: 'string', maxLength: d.items?.maxLength ?? 40}, ...(d.min && {minItems: d.min}), maxItems: d.max ?? 6}
      if (d.min) required.push(p.name)
    } else { props[p.name] = {type: 'string', maxLength: d.maxLength ?? 40}; if (d.required && d.default === undefined) required.push(p.name) }
  }
  return {props, required}
}

/**
 * The JSON Schema of the reply. Per place (container slot; a row takes its parent's place) and
 * depth, one `$defs` entry: an `anyOf` of one closed object per part allowed there. `relaxIn`
 * leaves `in` out (the post-repair check: `finish` moves misplaced parts).
 */
export function layoutSchema(catalog: any, state: any, {plan = true, relaxIn = false}: {plan?: boolean; relaxIn?: boolean} = {}, ctx: Ctx = context(catalog, state)) {
  const defs: any = {}
  const refs = new Map<string, any>()
  let n = 0
  const slot = (place: string, depth: number, inRow: boolean, arranged: boolean): any => {
    const k = `${place}|${depth}|${inRow}|${arranged}`
    if (refs.has(k)) return refs.get(k)
    const name = `d${++n}`
    const ref = {$ref: `#/$defs/${name}`}
    refs.set(k, ref)
    defs[name] = true
    const alts: any[] = []
    for (const it of ctx.items) {
      if (it.container && (inRow || depth > ctx.maxDepth || (it.row && arranged))) continue
      if (!relaxIn && !it.row && !placeOk(it, place)) continue
      const props: any = {part: {const: it.id}}
      const required = ['part']
      const ps = paramsSchema(it)
      if (Object.keys(ps.props).length) {
        props.params = {type: 'object', properties: ps.props, required: ps.required, additionalProperties: false}
        required.push('params')
      }
      if (it.container) {
        let any = false
        for (const s of it.slots) {
          const items = slot(it.row ? place : `${it.id}:${s}`, depth + 1, it.leaves, !!it.def.arranged)
          if (!items) continue
          any = true
          const key = s == 'default' ? 'children' : s
          props[key] = {type: 'array', items, ...(it.max && {maxItems: it.max})}
          required.push(key)
        }
        if (!any) continue
      }
      alts.push({type: 'object', properties: props, required, additionalProperties: false})
    }
    if (!alts.length) { delete defs[name]; refs.set(k, null); return null }
    // places that allow the same parts share one definition
    const body = JSON.stringify(alts)
    const same = Object.keys(defs).find(d => d != name && defs[d] !== true && JSON.stringify(defs[d].anyOf) == body)
    if (same) { delete defs[name]; refs.set(k, {$ref: `#/$defs/${same}`}); return refs.get(k) }
    defs[name] = {anyOf: alts}
    return ref
  }
  const items = slot(PLACE, 1, false, !!ctx.root.arranged)
  const children = items ? {type: 'array', items} : {type: 'array', maxItems: 0}
  const schema = {
    type: 'object',
    properties: {...(plan && {asked_for: {type: 'array', items: {type: 'string', maxLength: 60}, maxItems: 8}}), children},
    required: [...(plan ? ['asked_for'] : []), 'children'],
    additionalProperties: false,
    $defs: defs,
  }
  // names d1, d2, ... in order of first use (no gaps after sharing)
  const order: Record<string, string> = {}
  let i = 0
  const json = JSON.stringify(schema).replace(/"#\/\$defs\/(d\d+)"/g, (_, d) => `"#/$defs/${order[d] ??= `d${++i}`}"`)
  const out = JSON.parse(json)
  out.$defs = Object.fromEntries(Object.entries<any>(out.$defs).map(([d, v]): [string, any] => [order[d], v]).sort(([a], [b]) => +a.slice(1) - +b.slice(1)))
  return out
}

// ---------------------------------------------------------------- reading the reply
const PART_ALIASES = ['type', 'component', 'name', 'id']

function readNode(ctx: Ctx, n: any, issues: Issue[]): TNode | null {
  if (typeof n == 'string') return {part: n}
  if (!n || typeof n != 'object' || Array.isArray(n)) return null
  let part = n.part
  if (typeof part != 'string') {
    const k = PART_ALIASES.find(a => typeof n[a] == 'string' && ctx.byId[n[a]])
    if (k) { part = n[k]; issues.push({kind: 'alias', detail: `${k}: ${part}`}) }
  }
  const it = ctx.byId[part]
  let params = n.params
  if (!params && it?.params.length) {
    // params written flat on the node
    const flat = Object.fromEntries(Object.entries(n).filter(([k]) => it.params.some((p: any) => p.name == k)))
    if (Object.keys(flat).length) { params = flat; issues.push({kind: 'alias', detail: `flat params on ${part}`}) }
  }
  const t: TNode = {part, params}
  if (it?.container) {
    t.slots = {}
    for (const s of it.slots) t.slots[s] = (Array.isArray(n[s == 'default' ? 'children' : s]) ? n[s == 'default' ? 'children' : s] : []).map((x: any) => readNode(ctx, x, issues))
    // a slot the container does not have (or the list under another key): kept, repaired later
    for (const k of Object.keys(n)) if (!['part', 'params', 'children', ...it.slots].includes(k) && Array.isArray(n[k]) && !it.params.some((p: any) => p.name == k)) t.slots[k] = n[k].map((x: any) => readNode(ctx, x, issues))
  } else {
    const kids = Array.isArray(n.children) ? n.children : Array.isArray(n.parts) ? n.parts : null
    if (kids?.length) t.slots = {default: kids.map((x: any) => readNode(ctx, x, issues))}   // children on a leaf: lifted later
  }
  return t
}

/** the parsed reply → the page's children (lenient) and the plan */
export function readReply(ctx: Ctx, value: any, issues: Issue[] = []) {
  let list: any = undefined
  if (Array.isArray(value)) { list = value; issues.push({kind: 'alias', detail: 'a bare list'}) }
  else if (!value || typeof value != 'object') issues.push({kind: 'invalid', detail: 'not an object'})
  else {
    list = value.children
    if (!Array.isArray(list)) {
      // unconstrained output: the list under another name ('parts', 'items', 'ui', ...)
      const k = Object.keys(value).find(x => Array.isArray(value[x]) && value[x].some((n: any) => n && typeof n == 'object'))
      if (k) { list = value[k]; issues.push({kind: 'alias', detail: `${k} for children`}) }
      else if (value.part || value.type) { list = [value]; issues.push({kind: 'alias', detail: 'a single node'}) }
      else if (!('children' in value) && !Array.isArray(value.asked_for)) issues.push({kind: 'invalid', detail: 'no list of parts'})
    }
  }
  const raw = Array.isArray(list) ? list : []
  const asked = value && Array.isArray(value.asked_for) ? value.asked_for.filter((x: any) => typeof x == 'string').map((x: string) => x.slice(0, 60)).slice(0, 8) : undefined
  return {kids: raw.map((n: any) => readNode(ctx, n, issues)), raw: raw.length, asked, issues}
}

// ---------------------------------------------------------------- repair
function fixParams(it: any, params: any, issues: Issue[]): {params?: Record<string, any>; drop?: boolean} {
  const out: any = {}
  const given = params && typeof params == 'object' && !Array.isArray(params) ? params : {}
  for (const p of it.params) {
    const {name: n, d, kind} = p
    const v = given[n]
    if (kind == 'enum') {
      const ok = v !== undefined && v !== null && Object.prototype.hasOwnProperty.call(d.options, String(v))
      if (v !== undefined && !ok) issues.push({kind: 'param', detail: `${it.id}.${n}=${v}`})
      const val = ok ? String(v) : d.default
      if (val !== undefined) out[n] = val
    } else if (kind == 'record') {
      const r = p.records.find((r: any) => String(r.value) == String(v))
      if (r) out[n] = r.value
      else {
        if (v !== undefined) issues.push({kind: 'param', detail: `${it.id}.${n}=${v}`})
        if (d.default === undefined) { issues.push({kind: 'param', detail: `${it.id}: no record`}); return {drop: true} }
        out[n] = d.default
      }
    } else if (kind == 'number') {
      const x = typeof v == 'number' ? v : typeof v == 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN
      if (isFinite(x)) out[n] = Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, x))
      else {
        if (v !== undefined) issues.push({kind: 'param', detail: `${it.id}.${n}=${v}`})
        if (d.default !== undefined) out[n] = d.default
      }
    } else if (kind == 'list') {
      const max = d.items?.maxLength ?? 40
      const items = (Array.isArray(v) ? v : typeof v == 'string' ? v.split(/\s*[,;|]\s*/) : []).filter((x: any) => typeof x == 'string' && x.trim()).map((x: string) => x.trim().slice(0, max))
      const uniq = [...new Set(items)].slice(0, d.max ?? 6)
      if (!Array.isArray(v) && v !== undefined) issues.push({kind: 'param', detail: `${it.id}.${n} not a list`})
      if (uniq.length >= (d.min || 1)) out[n] = uniq
      else if (d.default !== undefined) out[n] = d.default
      else if (d.min || d.required) { issues.push({kind: 'param', detail: `${it.id}.${n} missing`}); return {drop: true} }
    } else {
      if (typeof v == 'string' && v.trim()) out[n] = v.trim().slice(0, d.maxLength ?? 40)
      else if (d.default !== undefined && d.default !== '') out[n] = d.default
      else if (d.required && d.default === undefined) { issues.push({kind: 'param', detail: `${it.id}.${n} missing`}); return {drop: true} }
    }
  }
  for (const n of Object.keys(given)) if (!it.params.some((p: any) => p.name == n)) issues.push({kind: 'param', detail: `${it.id}.${n} unknown`})
  return {params: Object.keys(out).length ? out : undefined}
}

/**
 * Validate and repair the page's children (research `repairTree`, on the normalized catalog):
 * see the header. `relaxMin` (previews): a container under its minimum stays (a row of one
 * shows as that part's row until its second part arrives).
 */
export function repairTree(ctx: Ctx, kids: Array<TNode | null>, issues: Issue[] = [], {relaxMin = false} = {}): TNode[] {
  const uses: Record<string, number> = {}
  const groups = new Set<string>()
  const walk = (n: TNode | null, depth: number, place: string, inRow: boolean, arranged: boolean): TNode[] => {
    if (!n || typeof n.part != 'string') { issues.push({kind: 'invalid', detail: 'node without part'}); return [] }
    const it = ctx.byId[n.part]
    const lift = (d: number) => Object.values(n.slots || {}).flat().flatMap(k => walk(k, d, place, inRow, arranged))
    if (!it) { issues.push({kind: ctx.required.has(n.part) ? 'required' : 'unknownPart', detail: n.part}); return lift(depth) }
    if (!it.container) {
      const lifted = n.slots ? (issues.push({kind: 'structure', detail: `children on leaf ${it.id}`}), lift(depth)) : []
      if (!placeOk(it, place)) issues.push({kind: 'structure', detail: `${it.id} not allowed in ${place}`})
      const fixed = fixParams(it, n.params, issues)
      if (fixed.drop) return lifted
      const ident = it.rec ? `${it.id}:${fixed.params?.[it.rec]}` : it.id
      if ((uses[ident] || 0) >= it.uses) { issues.push({kind: 'duplicate', detail: ident}); return lifted }
      const g = it.def.group
      if (g && groups.has(g) && !uses[ident]) { issues.push({kind: 'duplicate', detail: `group ${g}: ${it.id}`}); return lifted }
      uses[ident] = (uses[ident] || 0) + 1
      if (g) groups.add(g)
      return [{part: it.id, ...(fixed.params && {params: fixed.params}) }, ...lifted]
    }
    // a container
    if (depth > ctx.maxDepth || inRow || (it.row && arranged)) {
      issues.push({kind: 'structure', detail: `${it.id} too deep or not accepted`})
      return lift(depth)
    }
    const slots: Record<string, TNode[]> = {}
    for (const s of it.slots) slots[s] = []
    for (const [s, ks] of Object.entries(n.slots || {})) {
      const target = s in slots ? s : 'default' in slots ? 'default' : it.slots[0]
      if (target != s) issues.push({kind: 'structure', detail: `unknown slot ${it.id}.${s}`})
      slots[target].push(...(ks || []).flatMap(k => walk(k, depth + 1, it.row ? place : `${it.id}:${target}`, it.leaves, !!it.def.arranged)))
    }
    const all = Object.values(slots).flat()
    if (all.length == 0) { issues.push({kind: 'structure', detail: `empty ${it.id}`}); return [] }
    const fixed = fixParams(it, n.params, issues)
    if (fixed.drop) return all
    const make = (s: Record<string, TNode[]>): TNode => ({part: it.id, ...(fixed.params && {params: fixed.params}), slots: s})
    const filled = Object.values(slots).filter(k => k.length).length
    if (!relaxMin && (all.length < it.min || filled < (it.def.minSlots || 0))) {
      issues.push({kind: 'structure', detail: `${it.id} under min, unwrapped`})
      return all
    }
    if (it.max && it.slots.length == 1 && all.length > it.max) {
      // over the maximum: split into consecutive containers (a trailing one under the minimum is unwrapped)
      issues.push({kind: 'structure', detail: `${it.id} over max, split`})
      const out: TNode[] = []
      for (let i = 0; i < all.length; i += it.max) {
        const chunk = all.slice(i, i + it.max)
        if (!relaxMin && chunk.length < it.min) out.push(...chunk)
        else out.push(make({[it.slots[0]]: chunk}))
      }
      return out
    }
    return [make(slots)]
  }
  return kids.flatMap(k => walk(k, 1, PLACE, false, !!ctx.root.arranged))
}

// ---------------------------------------------------------------- trees: internal ↔ contract ↔ reply
const stripDefaults = (it: any, params?: Record<string, any>) => {
  if (!params) return undefined
  const out: any = {}
  for (const k in params) if (params[k] !== it.params.find((p: any) => p.name == k)?.d.default) out[k] = params[k]
  return Object.keys(out).length ? out : undefined
}

/** internal tree → the contract's Tree (params without defaults; `children` array for a default-only container) */
export function toContractTree(ctx: Ctx, kids: TNode[]): any[] {
  return kids.map(n => {
    const it = ctx.byId[n.part]
    const params = stripDefaults(it, n.params)
    const o: any = {part: n.part, ...(params && {params})}
    if (n.slots) {
      const names = Object.keys(n.slots)
      o.children = names.length == 1 && names[0] == 'default' ? toContractTree(ctx, n.slots.default)
        : Object.fromEntries(names.map(s => [s, toContractTree(ctx, n.slots![s])]))
    }
    return o
  })
}

/** a contract Tree → the reply shape (enum params filled with defaults, every slot present) */
function toReply(ctx: Ctx, tree: any[]): any[] {
  return (tree || []).map((n: any) => {
    let part = n.part, params = {...n.params}
    if (!ctx.byId[part] && typeof part == 'string' && part.includes(':')) {
      // `part:recordValue` as the part
      const [base, ...rest] = part.split(':')
      const it = ctx.byId[base]
      if (it?.rec) { part = base; params[it.rec] ??= rest.join(':') }
    }
    const it = ctx.byId[part]
    const o: any = {part}
    if (it?.params.length) {
      for (const p of it.params) if (params[p.name] === undefined && p.d.default !== undefined && (p.kind == 'enum' || p.kind == 'record')) params[p.name] = p.d.default
      if (it.rec && params[it.rec] !== undefined) {
        const r = it.params.find((p: any) => p.name == it.rec).records.find((r: any) => String(r.value) == String(params[it.rec]))
        if (r) params[it.rec] = r.value
      }
      o.params = params
    }
    if (it?.container) {
      for (const s of it.slots) {
        const kids = Array.isArray(n.children) ? (s == 'default' || it.slots.length == 1 ? n.children : []) : n.children?.[s] ?? []
        o[s == 'default' ? 'children' : s] = toReply(ctx, kids)
      }
    }
    return o
  })
}

// ---------------------------------------------------------------- streaming: partial JSON
const PARTIAL = Symbol.for('sygnal.partial')
const markPartial = (x: any) => (Object.defineProperty(x, PARTIAL, {value: true, enumerable: false}), x)

/**
 * Parse a JSON prefix: closes open containers, drops an unfinished string, number or key and the
 * key whose value never started; an object or array cut short is marked partial. Returns
 * undefined when nothing is usable yet.
 */
export function parsePartialJSON(text: string): any {
  let i = 0
  const s = text
  const INCOMPLETE = Symbol('incomplete')
  const sp = () => { while (i < s.length && /\s/.test(s[i])) i++ }
  const value = (): any => {
    sp()
    if (i >= s.length) return INCOMPLETE
    const ch = s[i]
    if (ch == '{') {
      i++
      const o: any = {}
      for (;;) {
        sp()
        if (i >= s.length) return markPartial(o)
        if (s[i] == '}') { i++; return o }
        if (s[i] == ',') { i++; continue }
        const k = value()
        if (k === INCOMPLETE || typeof k != 'string') return markPartial(o)
        sp()
        if (s[i] != ':') return markPartial(o)
        i++
        const v = value()
        if (v === INCOMPLETE) return markPartial(o)
        o[k] = v
        if (v && typeof v == 'object' && v[PARTIAL]) return markPartial(o)
      }
    }
    if (ch == '[') {
      i++
      const a: any[] = []
      for (;;) {
        sp()
        if (i >= s.length) return markPartial(a)
        if (s[i] == ']') { i++; return a }
        if (s[i] == ',') { i++; continue }
        const v = value()
        if (v === INCOMPLETE) return markPartial(a)
        a.push(v)
        if (v && typeof v == 'object' && v[PARTIAL]) return markPartial(a)
      }
    }
    if (ch == '"') {
      let j = i + 1, out = ''
      while (j < s.length && s[j] != '"') { if (s[j] == '\\') { j++; if (j >= s.length) break } out += s[j]; j++ }
      if (j >= s.length) { i = s.length; return INCOMPLETE }
      const raw = s.slice(i, j + 1)
      i = j + 1
      try { return JSON.parse(raw) } catch (_) { return out }
    }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i))
    if (!m || i + m[0].length >= s.length) { i = s.length; return INCOMPLETE }
    i += m[0].length
    return JSON.parse(m[0])
  }
  const v = value()
  return v === INCOMPLETE ? undefined : v
}

// settled: a leaf shows once its object closes (its params are final); a container still filling shows what it holds
const prune = (x: any): any => {
  if (Array.isArray(x)) return x.filter(y => !(y && typeof y == 'object' && !Array.isArray(y) && y[PARTIAL] && !Object.values(y).some(Array.isArray))).map(prune)
  if (x && typeof x == 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, prune(y)]))
  return x
}

/** the model's text → a value (code fences, think blocks and prose around the JSON tolerated) */
function parseText(text: any): {value?: any; error?: string} {
  if (typeof text != 'string') return {error: 'no text'}
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1')
  try { return {value: JSON.parse(t)} } catch (_) {}
  const m = /[{[][\s\S]*[}\]]/.exec(t)
  if (m) try { return {value: JSON.parse(m[0])} } catch (_) {}
  return {error: `not JSON: ${t.length > 80 ? t.slice(0, 80) + '…' : t}`}
}

const cap = (kids: TNode[], max: number) => {
  let n = 0
  const go = (ks: TNode[]): TNode[] => ks.flatMap(k => {
    if (!k.slots) return n++ < max ? [k] : []
    const slots = Object.fromEntries(Object.entries(k.slots).map(([s, x]) => [s, go(x)]))
    return Object.values(slots).some(x => x.length) ? [{...k, slots}] : []
  })
  return go(kids)
}

// a Standard Schema that accepts any value: the reply's checks are the repair's (the schema still goes to the model)
const ANY = {'~standard': {version: 1, vendor: 'sygnal', validate: (value: unknown) => ({value})}}

const say = (message: string, data: any) => {
  try { report('SYG683', {component: 'compose.llm', message, data}) } catch (e) { queueMicrotask(() => { throw e }) }
}

/** examples → few-shot turns */
function shots(ctx: Ctx, examples: any[], plan: boolean) {
  return examples.flatMap((x: any) => {
    const [prompt, tree, asked] = Array.isArray(x) ? x : [x?.prompt, x?.tree ?? x?.layout, x?.asked_for]
    if (typeof prompt != 'string' || !Array.isArray(tree)) return []
    const children = toReply(ctx, tree)
    const leaves = (ks: any[]): string[] => ks.flatMap(k => ctx.byId[k.part]?.container ? Object.keys(k).filter(s => Array.isArray(k[s])).flatMap(s => leaves(k[s])) : [ctx.byId[k.part]?.def.description ?? k.part])
    return [
      {role: 'user', content: prompt},
      {role: 'assistant', content: JSON.stringify({...(plan && {asked_for: Array.isArray(asked) ? asked : leaves(children)}), children})},
    ]
  })
}

/** compose.llm(options): the chat-LLM backend (one structured-output request, streamed preview) */
export function llm(options: LlmOptions = {}) {
  const {model, sink = 'LLM', key, stream = true, plan, instructions, examples, ...rest} = options
  const planFor = (catalog: any) => plan ?? !(examples ?? catalog.examples ?? []).length
  return {
    sink,
    kind: 'llm',
    start({catalog, state, prompt, previous, names}: any) {
      const ctx = context(catalog, state)
      const p = planFor(catalog)
      const request: any = {
        ...rest,
        ...(model && {model}),
        instructions: systemPrompt(catalog, state, {plan: p, instructions}, ctx),
        messages: [...shots(ctx, examples ?? catalog.examples ?? [], p), {role: 'user', content: String(prompt ?? '')}],
        output: jsonSchema(layoutSchema(catalog, state, {plan: p}, ctx), {validate: ANY}),
        key: key ?? names?.key ?? 'compose',
        latest: true,
        ...(names?.ok && {ok: names.ok}),
        ...(names?.error && {error: names.error}),
        ...(stream && names?.delta && {delta: names.delta}),
      }
      return {request, pending: {step: 'llm', prompt: String(prompt ?? ''), plan: p, ...(previous && {previous})}}
    },
    delta({catalog, state, pending, delta}: any) {
      const text = typeof delta == 'string' ? delta : delta?.text
      if (typeof text != 'string') return {}
      const v = parsePartialJSON(text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s*```(?:json)?\s*/, ''))
      if (!v || typeof v != 'object') return {}
      const ctx = context(catalog, state)
      const {kids} = readReply(ctx, prune(v))
      const fixed = cap(repairTree(ctx, kids, [], {relaxMin: true}), ctx.maxParts)
      if (!fixed.length) return {}
      return {preview: fromTree(catalog, toContractTree(ctx, fixed), pending?.previous)}
    },
    reply({catalog, state, pending, reply}: any) {
      let value = reply?.value
      if (value === undefined) {
        const r = parseText(reply?.text)
        if (r.error) { say(`the reply is not a layout: ${r.error}`, {text: reply?.text}); return {error: `The model's reply is not a layout (${r.error})`} }
        value = r.value
      }
      const ctx = context(catalog, state)
      const {kids, raw, asked, issues} = readReply(ctx, value)
      const fixed = repairTree(ctx, kids, issues)
      const decisions = {...(asked && {asked_for: asked}), ...(issues.length && {repairs: issues})}
      if (!fixed.length) {
        // nothing fits (an empty list) is `unavailable`; a reply that isn't a list of parts, or
        // whose every part is unknown or malformed, is an error
        const bad = issues.filter(i => i.kind == 'invalid' || i.kind == 'unknownPart')
        const notAList = issues.some(i => i.kind == 'invalid' && i.detail != 'node without part')
        const allBogus = raw > 0 && bad.length > 0 && !issues.some(i => i.kind == 'required' || i.kind == 'duplicate' || i.kind == 'param')
        if (notAList || allBogus) {
          const message = `the reply has no usable part: ${bad.map(i => i.detail).join(', ')}`
          say(message, {issues, value})
          return {error: `The model's reply is not a layout (${bad.map(i => i.detail).join(', ')})`, decisions}
        }
        return {layout: null, unavailable: true, decisions}
      }
      // the repaired tree must fit the schema (`in` left to finish): otherwise it is an error, never a layout
      const wrong = check(layoutSchema(catalog, state, {plan: false, relaxIn: true}, ctx), {children: toReply(ctx, toContractTree(ctx, fixed))})
      if (wrong.length) {
        const message = `the layout is still invalid after repair: ${wrong.slice(0, 3).map(i => `${(i.path || []).join('.')}: ${i.message}`).join('; ')}`
        say(message, {issues: wrong, value})
        return {error: `The model's layout is invalid (${message})`, decisions}
      }
      const layout = finish(catalog, fromTree(catalog, toContractTree(ctx, fixed), pending?.previous), state)
      return {layout, decisions}
    },
    fake({catalog, state, pending, target}: any) {
      const ctx = context(catalog, state)
      const children = toReply(ctx, target || [])
      const p = pending?.plan ?? planFor(catalog)
      const leaves = (ks: any[]): string[] => ks.flatMap(k => ctx.byId[k.part]?.container ? Object.keys(k).filter(s => Array.isArray(k[s])).flatMap(s => leaves(k[s])) : [k.part])
      return JSON.stringify({...(p && {asked_for: leaves(children)}), children})
    },
  }
}

/** a layout as an edit prompt shows it (B-4, ops2: one node per line, its key, params; slots indented) */
export function currentPage(layout: any): string {
  const lines: string[] = []
  const go = (key: string, depth: number) => {
    const n = layout.nodes[key]
    if (!n) return
    const ps = n.params ? ' ' + Object.entries(n.params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''
    lines.push(`${'  '.repeat(depth)}${key}: ${n.part}${ps}`)
    for (const [s, ks] of Object.entries<any>(n.slots || {})) {
      if (s != 'default') lines.push(`${'  '.repeat(depth + 1)}[${s}]`)
      ks.forEach((k: string) => go(k, depth + 1))
    }
  }
  go(layout.root, 0)
  return lines.join('\n')
}
