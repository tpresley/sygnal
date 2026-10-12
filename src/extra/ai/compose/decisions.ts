/*
 * PLAN-9 B-1 / B-2: `compose.decisions()`, the decision-model backend of `compose` (TypeSafe Jev,
 * Ollama `nimble`, anything `decide()` reaches). It composes a layout from the catalog's parts with
 * choice / noul questions only: the model never writes text. Ported from the research encodings,
 * with their exact wording:
 *   - structure: dev-plans/research/ai-compose/structure/composer.mjs (TEXT, 189/210 on Jev);
 *   - params and records: dev-plans/research/ai-compose/params-edits/params-edits.mjs (W).
 *
 * Steps (one `decide()` request each, through the HTTP sink):
 *   0. categories (only with `prefilter: true` and parts with a `category`): `cat_<id>` per category.
 *   1. select (state: the request alone):
 *        use_<part> (omit / use; structure wording, params-edits wording for a part with params); count_<part> (0..maxUses) for a repeatable part;
 *        pick_<group> (omit + each member) for a `group` of alternatives;
 *        rec_<part>__<n> (n = 1..4; none + records) for a record part: "which <label> does user_request name
 *          first / second / …", over the records a lexical prefilter on name / aliases kept;
 *        param_<part>__<name> for an enum param or the bins of a number param, with not_stated
 *          (= the default); `type: 'text'` / `'list'` params keep their default (LLM-only; a part
 *          with a required one and no default is left out, SYG680);
 *        row: "side by side?" (a noul gate, when the catalog has the built-in `row`).
 *      Nothing chosen: nothing fits (1 call). One part in one possible place: done (1 call).
 *   2. layout (state: the request + the selected elements): parent_<k> over the places `in`
 *      allows; with the row gate on, beside_<k> and left_<a>_vs_<b>; first_<a>_vs_<b> per pair;
 *      gap_<x>_in_<part> for a part used 2+ times.
 * Reading is code: rows by average-linkage clustering of `beside` (`rowMean`), order by summed
 * pairwise probabilities, pins, required parts, companions, containers present only when filled,
 * `minSlots` unwrap, limits. The result goes through `finish()` (layout.ts), shared with `llm()`.
 *
 * `pending` is plain JSON (the behavior keeps it in state): the step, the prompt, the record
 * values the prefilter kept, the selected items. The questions are rebuilt from it to read a reply,
 * so a reply is checked against the criteria that were sent (a choice outside them: SYG682).
 *
 * Side-effect free (0 B for apps that don't import it).
 */
import {decide, choice, noul} from '../decide'
import {answers as answersFor} from '../answers'
import {report} from '../../diagnostics/index'
import {fromTree, toTree, finish} from './layout'

const ROOT = 'page'
const ROOT_SLOT = 'default'
const ROW = 'row'
const ROW_MIN = 0.5
const sep = '__'

// ---------- wording (structure/composer.mjs TEXT and params-edits.mjs W, verbatim) ----------
export const TEXT = {
  select: 'Is this element one of the things user_request asks to see? Choose use only when user_request names this element or describes what it shows. Choose omit for elements that are merely about the same topic, area or page as what user_request asks for.',
  variant: 'Which of these elements does user_request ask for, by name or by what it shows? Choose omit when it asks for none of them. When it asks for this kind of element without saying which, choose the first one.',
  count: (d: string) => `How many times does user_request want this element on the page: ${d}? Choose 0 when it does not ask for it.`,
  omit: 'None of these elements is needed.',
  category: 'Does user_request ask for anything in this area, by name or by what it shows?',
  row: 'Does user_request explicitly ask for some elements to be placed side by side, next to each other, beside each other or in a row?',
  parent: (d: string) => `Where does this element go: ${d}? Follow user_request when it says where. Otherwise choose the place whose description fits this element best.`,
  beside: (d: string) => `Which element does user_request want side by side with this element, in the same row: ${d}? Choose none unless user_request asks for these elements to be next to each other, beside each other or in a row.`,
  gap: (d: string, n: number, x: string, guidance?: string) => `This page shows this element ${n} times: ${d}. Where does this other element go relative to those copies: ${x}? Follow user_request: it may say where each copy goes (for example at the top and again at the bottom) and what goes between them.${guidance ? ' When user_request does not say: ' + guidance : ''}`,
  left: 'If these two elements are side by side in a row, which one is on the left? Follow user_request: the one it puts on the left, or names first when it lists them side by side, is on the left.',
  first: (guidance?: string) => `Which of these two elements comes first on the page (higher up, or further left in a row)? Follow user_request: an element it wants at the top, first, above or on the left comes first; one it wants below, under, after, at the end or on the right comes later. When user_request does not say, ${guidance ? guidance + ' Otherwise ' : ''}the one user_request mentions first comes first.`,
}
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']
export const W = {
  select: 'Does user_request ask for this element, by name or by what it shows? Every element user_request names must be used, wherever on the page it wants it. Omit elements user_request does not ask for, even when related to the topic.',
  param: (d: string, label: string, ask?: string) => `Consider this element: ${d}. ${ask ?? `Which ${label} does user_request ask for it?`} Choose not_stated when user_request does not mention a ${label}.`,
  notStated: (label: string) => `user_request does not mention a ${label}`,
  recordFamily: (d: string, label: string, names: string[]) => `${d}; one per ${label} that user_request names${names.length ? ` (the ${label}s: ${names.join(', ')})` : ''}`,
  slot: (d: string, label: string, n: number) => `${d}. Which ${label} does user_request name ${ORDINAL[n] ?? `as number ${n}`}? Choose none when user_request names fewer than ${n} ${label}${n > 1 ? 's' : ''} from this list.`,
  slotNone: (label: string, n: number) => `user_request names fewer than ${n} ${label}${n > 1 ? 's' : ''} from this list`,
}

// ---------- the catalog (normalized form, phase1-contract.md) ----------
const partIds = (c: any) => Object.keys(c.parts || {})
const partOf = (c: any, id: string) => c.parts?.[id]
const containerOf = (c: any, id: string) => c.containers?.[id]
const hasRows = (c: any) => !!containerOf(c, ROW)
const paramsOf = (part: any) => part?.params || {}
const labelOf = (name: string, p: any) => p.label ?? name
/**
 * a param's kind: the normalized catalog's `kind` (types.ts: 'options' | 'number' | 'text' | 'list' |
 * 'record'); a raw declaration (`options` / `from` / `type`) reads the same
 */
const kindOf = (p: any): string => p?.kind ?? (typeof p?.from == 'function' ? 'record' : p?.options ? 'options' : p?.type ?? '')
/** the record param of a part (at most one) */
const recordParam = (part: any) => Object.keys(paramsOf(part)).find(k => kindOf(part.params[k]) == 'record')
/** the options a decision model picks from: an enum's options, a number param's bins */
const optionsOf = (p: any) => (kindOf(p) == 'number' ? p.bins : kindOf(p) == 'options' ? p.options : null) || {}
const askable = (p: any) => (kindOf(p) == 'options' || kindOf(p) == 'number') && Object.keys(optionsOf(p)).length > 1
/** a required param a decision model can't fill (free text with no default): the part is LLM-only */
export const llmOnly = (part: any) => Object.values(paramsOf(part)).some((p: any) => kindOf(p) != 'record' && !askable(p) && p.required && p.default === undefined)
const maxUses = (part: any) => Math.max(1, part?.maxUses ?? 1)
/** record slots per record part: "the first … fourth <label> the request names" (params-edits maxRecords) */
const RECORD_SLOTS = 4
const slotNames = (k: any) => Object.keys(k?.slots || {default: null})

/** the allowed places of a part or container as 'container:slot' strings */
function allowed(c: any, entry: any): string[] {
  const out: string[] = []
  for (const d of entry?.in || [ROOT]) {
    if (d === ROOT) out.push(`${ROOT}:${ROOT_SLOT}`)
    else if (d.includes(':')) { if (containerOf(c, d.split(':')[0])) out.push(d) }
    else if (d !== ROW && containerOf(c, d)) for (const s of slotNames(containerOf(c, d))) out.push(`${d}:${s}`)
  }
  return out.length ? out : [`${ROOT}:${ROOT_SLOT}`]
}

// ---------- records: the lexical prefilter (params-edits.mjs narrowRecords) ----------
const words = (t: any) => String(t).toLowerCase().replace(/'s\b/g, '').match(/[\p{L}\p{N}]+/gu) || []
function recordsOf(part: any, rp: string, state: any): any[] {
  let list: any
  try { list = part.params[rp].from(state) } catch (_) { return [] }
  return Array.isArray(list) ? list.filter((r: any) => r && r.value != null) : []
}
/** the records whose every name word (or every word of an alias) is in the prompt, best first */
export function narrowRecords(list: any[], prompt: string, max = 254) {
  const have = new Set(words(prompt))
  return list
    .map(r => ({r, s: Math.max(...[r.name ?? r.value, ...(r.aliases || [])].map(n => { const w = words(n); return w.filter(x => have.has(x)).length / (w.length || 1) }))}))
    .filter(x => x.s >= 1).slice(0, max).map(x => x.r)
}
const recordText = (r: any) => r.description ?? r.name ?? String(r.value)
const recordName = (r: any) => r.name ?? recordText(r).split(/[:,]/)[0]

// ---------- choices over a backend's candidate limit (params-edits.mjs chunkedChoice) ----------
function chunked(qs: any, meta: any, name: string, instructions: string, head: any, options: any, m: any, max: number) {
  const entries = Object.entries(options)
  const room = Math.max(1, max - Object.keys(head).length)
  if (entries.length <= room) { qs[name] = choice(instructions, {...head, ...options}); meta[name] = m; return }
  for (let i = 0, k = 0; i < entries.length; i += room, k++) {
    qs[`${name}${sep}c${k}`] = choice(instructions, {...head, ...Object.fromEntries(entries.slice(i, i + room))})
    meta[`${name}${sep}c${k}`] = {...m, chunk: k}
  }
}
/** the answer of a (possibly chunked) choice: the most probable non-head answer of the chunks */
function readChunked(a: any, name: string, head: string[]) {
  if (a[name]) return a[name]
  let best: any = null
  for (let k = 0; a[`${name}${sep}c${k}`]; k++) {
    const x = a[`${name}${sep}c${k}`]
    if (head.includes(x.choice)) { best ??= x; continue }
    if (!best || head.includes(best.choice) || (x.probabilities?.[x.choice] ?? 0) > (best.probabilities?.[best.choice] ?? 0)) best = x
  }
  return best
}

// ---------- step 0: categories ----------
const categoriesOf = (c: any) => {
  const out: string[] = []
  for (const id of partIds(c)) { const k = partOf(c, id).category; if (k != null && !out.includes(k)) out.push(k) }
  return out
}
export function categoryStep(c: any, prompt: string) {
  const questions: any = {}, meta: any = {}
  for (const id of categoriesOf(c)) {
    questions[`cat_${id}`] = choice(TEXT.category, {omit: 'Nothing in this area is needed.', use: c.categories?.[id] ?? id})
    meta[`cat_${id}`] = {kind: 'cat', category: id}
  }
  return {state: {user_request: prompt}, questions, meta}
}

// ---------- step 1: select ----------
const said = new Set<string>()
function excluded(id: string) {
  if (said.has(id)) return
  said.add(id)
  dev('SYG680', `part '${id}' has a required text param with no default: a decision model can't fill it, so compose.decisions() never places it (it is LLM-only)`, 'info')
}
function dev(code: string, message: string, severity: 'error' | 'warn' | 'info') {
  try { report(code, {component: 'compose.decisions', message, severity}) } catch (e) { queueMicrotask(() => { throw e }) }
}

/** the parts the select step asks about: not required ones, not LLM-only ones, in the chosen categories */
function selectable(c: any, categories?: string[] | null) {
  return partIds(c).filter(id => {
    const p = partOf(c, id)
    if (p.required) return false
    if (llmOnly(p)) { excluded(id); return false }
    return !categories || p.category == null || categories.includes(p.category)
  })
}

/**
 * The select questions. `records`: the record values the prefilter kept per record part (start()
 * computes it; reply() and fake() rebuild the same questions from it). Returns `meta` per question.
 */
export function selectStep(c: any, prompt: string, {categories = null, records = {}, max = 255}: any = {}) {
  const questions: any = {}, meta: any = {}
  const ids = selectable(c, categories).filter(id => !recordParam(partOf(c, id)) || records[id]?.length)
  const seen = new Set<string>()
  for (const id of ids) {
    const part = partOf(c, id)
    const rp = recordParam(part)
    if (part.group != null) {
      if (!seen.has(part.group)) {
        seen.add(part.group)
        const members = ids.filter(m => partOf(c, m).group === part.group)
        const withRecords = members.some(m => recordParam(partOf(c, m)))
        questions[`pick_${part.group}`] = choice(withRecords ? W.select : TEXT.variant, {
          omit: TEXT.omit,
          ...Object.fromEntries(members.map(m => {
            const mp = partOf(c, m), mr = recordParam(mp)
            return [m, mr ? W.recordFamily(mp.description, labelOf(mr, mp.params[mr]), records[m].map((r: any) => r.name)) : mp.description]
          })),
        })
        meta[`pick_${part.group}`] = {kind: 'pick', group: part.group, members}
      }
    } else if (!rp && maxUses(part) > 1) {
      const criteria: any = {0: 'Not on the page.'}
      for (let n = 1; n <= maxUses(part); n++) criteria[n] = n === 1 ? 'Once.' : `${n} times, in different places on the page.`
      questions[`count_${id}`] = choice(TEXT.count(part.description), criteria)
      meta[`count_${id}`] = {kind: 'count', part: id}
    } else if (!rp) {
      // a part with choice params takes params-edits' select wording: the strict structure wording
      // drops a part the request names by a param value ("refunded orders", "complaints"), which
      // the description leaves out on purpose (Jev, params set x3: 57/60 mixed, 46/60 strict only,
      // 54/60 params wording only; the structure set keeps 64/70: its parts have no params)
      const withParams = Object.values<any>(paramsOf(part)).some(askable)
      questions[`use_${id}`] = choice(withParams ? W.select : TEXT.select, {omit: TEXT.omit, use: part.description})
      meta[`use_${id}`] = {kind: 'use', part: id}
    }
    if (rp) {
      const label = labelOf(rp, part.params[rp])
      const options = Object.fromEntries(records[id].map((r: any) => [String(r.value), r.description]))
      for (let n = 1; n <= RECORD_SLOTS; n++) {
        questions[`rec_${id}${sep}${n}`] = choice(W.slot(part.description, label, n), {none: W.slotNone(label, n), ...options})
        meta[`rec_${id}${sep}${n}`] = {kind: 'rec', part: id, n}
      }
    }
  }
  // params: of the asked parts and the required ones (read only for the parts that are used)
  const required = partIds(c).filter(id => partOf(c, id).required && !llmOnly(partOf(c, id)))
  for (const id of [...required, ...ids]) {
    const part = partOf(c, id)
    for (const [name, p] of Object.entries<any>(paramsOf(part))) {
      if (!askable(p)) continue
      const label = labelOf(name, p)
      chunked(questions, meta, `param_${id}${sep}${name}`, W.param(part.description, label, p.ask), {not_stated: W.notStated(label)},
        Object.fromEntries(Object.entries(optionsOf(p)).map(([v, d]) => [String(v), d])), {kind: 'param', part: id, param: name}, max)
    }
  }
  if (hasRows(c)) { questions.row = noul(TEXT.row); meta.row = {kind: 'row'} }
  return {state: {user_request: prompt}, questions, meta}
}

/** the record values the prefilter keeps for each record part, as `{ value, name, description }` */
function prefilterRecords(c: any, state: any, prompt: string, categories: string[] | null, max: number) {
  const out: any = {}
  for (const id of selectable(c, categories)) {
    const part = partOf(c, id), rp = recordParam(part)
    if (!rp) continue
    const kept = narrowRecords(recordsOf(part, rp, state), prompt, max - 1)
    if (kept.length) out[id] = kept.map(r => ({value: r.value, name: recordName(r), description: recordText(r)}))
  }
  return out
}

const useProbability = (a: any) => (!a ? 0 : a.type === 'noul' ? a.noul : a.probabilities?.use ?? (a.choice === 'use' ? 1 : 0))
const keyPart = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_')

/** an enum / number param's value from its answer (not_stated or nothing: the default; only non-defaults kept) */
function readParams(c: any, id: string, a: any) {
  const out: any = {}
  for (const [name, p] of Object.entries<any>(paramsOf(partOf(c, id)))) {
    if (!askable(p)) continue
    const x = readChunked(a, `param_${id}${sep}${name}`, ['not_stated'])
    const v = x?.choice
    if (!v || v === 'not_stated' || !(v in optionsOf(p))) continue
    const value = kindOf(p) == 'number' ? Number(v) : v
    if (String(value) !== String(p.default)) out[name] = value
  }
  return out
}

/** describes a selected node to the model: description, record, params in force (params-edits describeNode) */
function describe(c: any, id: string, params: any, record?: any) {
  const part = partOf(c, id)
  let d = part.description
  if (record) d += `, for ${record.description}`
  for (const [name, p] of Object.entries<any>(paramsOf(part))) {
    if (!askable(p)) continue
    const v = params?.[name] ?? p.default
    if (v === undefined) continue
    d += `; ${labelOf(name, p)}: ${optionsOf(p)[v] ?? v}`
  }
  return d
}

/**
 * select answers → { items: [{ key, part, params?, d }], row, unavailable }. Keys: the part id, `__2`
 * for further copies, `<part>__<record>` for records. Adds required parts and companions; caps at
 * limits.maxParts (keeping the most probable).
 */
export function readSelect(c: any, a: any, {categories = null, records = {}}: any = {}) {
  const scored: any[] = [] // [{ part, params, record?, p }] in catalog order
  const ids = selectable(c, categories).filter(id => !recordParam(partOf(c, id)) || records[id]?.length)
  const seen = new Set<string>()
  const prob = (x: any) => x?.probabilities?.[x.choice] ?? 1
  const recordsFor = (id: string, atLeastOne: boolean) => {
    const out: any[] = []
    for (let n = 1; n <= RECORD_SLOTS; n++) {
      const x = a[`rec_${id}${sep}${n}`]
      if (!x) break
      // the group choice already said "these records": slot 1 is the best record even when none wins
      const best = Object.entries<any>(x.probabilities || {}).filter(([k]) => k !== 'none').sort((u, v) => v[1] - u[1])[0]
      const v = n === 1 && atLeastOne && x.choice === 'none' && best ? best[0] : x.choice
      if (v === 'none' || v == null) break
      const r = records[id].find((r: any) => String(r.value) === v)
      if (r && !out.some(o => o.r === r)) out.push({r, p: v === x.choice ? prob(x) : best[1]})
    }
    return out
  }
  const add = (id: string, p: number) => {
    const rp = recordParam(partOf(c, id))
    if (!rp) { scored.push({part: id, params: readParams(c, id, a), p}); return }
    for (const {r, p: q} of recordsFor(id, partOf(c, id).group != null)) scored.push({part: id, params: {...readParams(c, id, a), [rp]: r.value}, record: r, p: q})
  }
  for (const id of ids) {
    const part = partOf(c, id)
    if (part.group != null) {
      if (seen.has(part.group)) continue
      seen.add(part.group)
      const x = a[`pick_${part.group}`]
      if (x && x.choice !== 'omit' && partOf(c, x.choice)?.group === part.group) add(x.choice, prob(x))
    } else if (recordParam(part)) add(id, 1)
    else if (maxUses(part) > 1) {
      const x = a[`count_${id}`]
      const n = Math.min(maxUses(part), Number(x?.choice ?? 0) || 0)
      for (let i = 0; i < n; i++) add(id, prob(x))
    } else {
      const p = useProbability(a[`use_${id}`])
      if (p >= 0.5) add(id, p)
    }
  }
  if (!scored.length) return {items: [], row: false, unavailable: true}
  const max = c.limits?.maxParts ?? 12
  let list = scored
  if (list.length > max) {
    const keep = new Set([...list].sort((x, y) => y.p - x.p).slice(0, max))
    list = list.filter(x => keep.has(x))
  }
  const required = partIds(c).filter(id => partOf(c, id).required && !llmOnly(partOf(c, id))).map(id => ({part: id, params: readParams(c, id, a)}))
  list = [...required, ...list]
  for (const x of [...list]) {
    for (const id of partOf(c, x.part)?.companions || []) if (partOf(c, id) && !list.some(y => y.part === id)) list.push({part: id, params: {}})
  }
  // keys
  const used = new Set<string>(), count: any = {}
  const items = list.map(x => {
    let key = x.record ? `${x.part}${sep}${keyPart(String(x.record.value))}` : x.part
    if (!x.record) { count[x.part] = (count[x.part] || 0) + 1; if (count[x.part] > 1) key = `${x.part}${sep}${count[x.part]}` }
    for (let i = 2; used.has(key); i++) key = `${key}_${i}`
    used.add(key)
    const params = Object.keys(x.params || {}).length ? x.params : undefined
    return {key, part: x.part, ...(params && {params}), ...(x.record && {record: true}), d: describe(c, x.part, x.params, x.record)}
  })
  return {items, row: !!a.row && (a.row.noul ?? 0) >= 0.5, unavailable: false}
}

// ---------- step 2: layout ----------
const copyOf = (items: any[], key: string) => {
  const it = items.find(i => i.key === key)
  if (!it || it.record) return 1
  return items.filter(i => i.part === it.part && !i.record).findIndex(i => i.key === key) + 1
}
const multiParts = (items: any[], keys: string[]) => new Set(keys.map(k => items.find(i => i.key === k)).filter(i => i && !i.record && copyOf(items, i.key) > 1).map(i => i.part))

/** everything the layout step needs to know about the selection */
export function plan(c: any, sel: any) {
  const items = sel.items
  const nodes: string[] = items.map((i: any) => i.key)
  const containers: string[] = []
  const entry = (k: string) => containerOf(c, k) && !items.some((i: any) => i.key === k) ? containerOf(c, k) : partOf(c, items.find((i: any) => i.key === k)?.part)
  for (let i = 0; i < nodes.length; i++) {
    for (const d of allowed(c, entry(nodes[i]))) {
      const k = d.split(':')[0]
      if (k !== ROOT && !nodes.includes(k)) { nodes.push(k); containers.push(k) }
    }
  }
  const dests: any = {}
  for (const k of nodes) {
    // a container never goes into a container that accepts only parts (`accepts: 'leaves'`)
    const box = !items.some((i: any) => i.key === k)
    dests[k] = allowed(c, entry(k)).filter(d => { const x = d.split(':')[0]; return x !== k && (x === ROOT || nodes.includes(x)) && !(box && containerOf(c, x)?.accepts === 'leaves') })
    if (!dests[k].length) dests[k] = [`${ROOT}:${ROOT_SLOT}`]
  }
  const leaves: string[] = items.map((i: any) => i.key)
  const rowable = sel.row && hasRows(c)
    ? leaves.filter(k => dests[k].some((d: string) => { const x = d.split(':')[0]; return x === ROOT || !containerOf(c, x)?.arranged }))
    : []
  return {nodes, containers, dests, leaves, rowable}
}

const pinOf = (c: any, items: any[], key: string) => partOf(c, items.find(i => i.key === key)?.part)?.pin
const describeCopy = (items: any[], key: string) => {
  const it = items.find(i => i.key === key)
  const n = copyOf(items, key)
  return n > 1 ? `${it.d} (copy ${n})` : it.d
}
function destLabel(c: any, dest: string) {
  const [k, slot] = dest.split(':')
  if (k === ROOT) return `${containerOf(c, ROOT)?.description ?? c.description ?? 'The page'}, at the top level (not inside any section, tab or group)`
  const x = containerOf(c, k)
  return x?.slots?.[slot] || x?.description || k
}
const needsLayout = (p: any) => p.nodes.length > 1 && (p.leaves.length > 1 || p.nodes.some((k: string) => p.dests[k].length > 1))

export function layoutStep(c: any, prompt: string, sel: any) {
  const p = plan(c, sel)
  const items = sel.items
  const questions: any = {}, meta: any = {}
  const label = (k: string) => (items.some((i: any) => i.key === k) ? describeCopy(items, k) : containerOf(c, k)?.description ?? k)
  for (const k of p.nodes) {
    if (p.dests[k].length < 2) continue
    questions[`parent_${k}`] = choice(TEXT.parent(label(k)), Object.fromEntries(p.dests[k].map((d: string) => [d, destLabel(c, d)])))
    meta[`parent_${k}`] = {kind: 'parent', key: k}
  }
  if (p.rowable.length > 1) {
    for (const k of p.rowable) {
      questions[`beside_${k}`] = choice(TEXT.beside(label(k)), {
        none: 'No element: this one is not side by side with another.',
        ...Object.fromEntries(p.rowable.filter((o: string) => o !== k).map((o: string) => [o, label(o)])),
      })
      meta[`beside_${k}`] = {kind: 'beside', key: k}
    }
    p.rowable.forEach((a: string, i: number) => p.rowable.slice(i + 1).forEach((b: string) => {
      questions[`left_${a}_vs_${b}`] = choice(TEXT.left, {[a]: label(a), [b]: label(b)})
      meta[`left_${a}_vs_${b}`] = {kind: 'left', a, b}
    }))
  }
  const free = p.leaves.filter(k => !pinOf(c, items, k))
  const multi = multiParts(items, free)
  const single = free.filter(k => !multi.has(items.find((i: any) => i.key === k).part))
  single.forEach((a, i) => single.slice(i + 1).forEach(b => {
    questions[`first_${a}_vs_${b}`] = choice(TEXT.first(c.guidance), {[a]: label(a), [b]: label(b)})
    meta[`first_${a}_vs_${b}`] = {kind: 'first', a, b}
  }))
  for (const id of multi) {
    const n = free.filter(k => items.find((i: any) => i.key === k).part === id).length
    for (const x of single) {
      const criteria: any = {0: `Above all ${n} copies of it (before the first one).`}
      for (let g = 1; g < n; g++) criteria[g] = `Between copy ${g} and copy ${g + 1} of it.`
      criteria[n] = `Below all ${n} copies of it (after the last one).`
      questions[`gap_${x}_in_${id}`] = choice(TEXT.gap(partOf(c, id).description, n, label(x), c.guidance), criteria)
      meta[`gap_${x}_in_${id}`] = {kind: 'gap', key: x, part: id}
    }
  }
  const state = {user_request: prompt, selected_elements: p.leaves.map(k => ({id: k, content: describeCopy(items, k)}))}
  return {state, questions, meta, plan: p}
}

/** pairwise answers → rank per leaf (0 = first): summed win probabilities; copies go into the gaps chosen */
function ranks(items: any[], leaves: string[], a: any) {
  const partKey = (k: string) => items.find(i => i.key === k).part
  const multi = multiParts(items, leaves)
  const single = leaves.filter(k => !multi.has(partKey(k)))
  const wins: any = Object.fromEntries(single.map(k => [k, 0]))
  single.forEach((x, i) => single.slice(i + 1).forEach(y => {
    const f = a[`first_${x}_vs_${y}`]?.probabilities
    if (!f) return
    wins[x] += f[x] ?? 0
    wins[y] += f[y] ?? 0
  }))
  const sorted = [...single].sort((x, y) => wins[y] - wins[x] || single.indexOf(x) - single.indexOf(y))
  const score: any = Object.fromEntries(sorted.map((k, i) => [k, i]))
  for (const id of multi) {
    const copies = leaves.filter(k => partKey(k) === id).sort((x, y) => copyOf(items, x) - copyOf(items, y))
    const gap = (x: string) => {
      const pr = a[`gap_${x}_in_${id}`]?.probabilities
      return pr ? Object.entries<any>(pr).reduce((s, [g, q]) => s + Number(g) * q, 0) : copies.length
    }
    copies.forEach((k, i) => {
      const before = sorted.filter(x => gap(x) < i + 0.5)
      score[k] = (before.length ? Math.max(...before.map(x => score[x])) : -1) + 0.5 + i * 0.01
    })
  }
  const out = [...leaves].sort((x, y) => score[x] - score[y] || leaves.indexOf(x) - leaves.indexOf(y))
  return Object.fromEntries(out.map((k, i) => [k, i]))
}

/** layout answers → the composition as a Tree (contract format), before `finish()` */
export function readLayout(c: any, sel: any, a: any, {rowMean = 0.25}: any = {}): any[] {
  const p = plan(c, sel)
  const items = sel.items
  const itemOf = (k: string) => items.find((i: any) => i.key === k)
  const parent: any = {}
  for (const k of p.nodes) {
    const x = a[`parent_${k}`]?.choice
    parent[k] = p.dests[k].includes(x) ? x : p.dests[k][0]
  }
  // cycles → the root
  const nodeOf = (dest: string) => dest.split(':')[0]
  for (const k of p.nodes) {
    const seen = new Set([k])
    let x = nodeOf(parent[k])
    while (x !== ROOT) {
      if (seen.has(x)) { parent[k] = `${ROOT}:${ROOT_SLOT}`; break }
      seen.add(x)
      x = nodeOf(parent[x])
    }
  }
  const free = p.leaves.filter(k => !pinOf(c, items, k))
  const fr = ranks(items, free, a)
  const rank: any = {}
  for (const k of p.leaves) {
    const pin = pinOf(c, items, k)
    rank[k] = pin === 'start' ? -1000 + p.leaves.indexOf(k) : pin === 'end' ? 1000 + p.leaves.indexOf(k) : fr[k]
  }
  const tree: any = {[ROOT]: {part: ROOT, slots: {[ROOT_SLOT]: []}}}
  for (const k of p.nodes) {
    const it = itemOf(k)
    tree[k] = it ? {part: it.part, params: it.params} : {part: k, slots: Object.fromEntries(slotNames(containerOf(c, k)).map(s => [s, []]))}
  }
  for (const k of p.nodes) { const [x, s] = parent[k].split(':'); tree[x].slots[s].push(k) }
  // drop empty containers (repeat: a container may hold only empty containers)
  for (let dropped = true; dropped;) {
    dropped = false
    for (const k of p.containers) {
      if (!tree[k] || Object.values<any>(tree[k].slots).some(l => l.length)) continue
      const [x, s] = parent[k].split(':')
      tree[x].slots[s] = tree[x].slots[s].filter((y: string) => y !== k)
      delete tree[k]
      dropped = true
    }
  }
  // unwrap containers with fewer non-empty slots than minSlots
  for (const k of p.containers) {
    const min = containerOf(c, k)?.minSlots
    if (!tree[k] || !min) continue
    const full = Object.values<any>(tree[k].slots).filter(l => l.length)
    if (full.length >= min) continue
    const [x, s] = parent[k].split(':')
    const kids = full.flat()
    for (const y of kids) parent[y] = `${x}:${s}`
    tree[x].slots[s] = tree[x].slots[s].filter((y: string) => y !== k).concat(kids)
    delete tree[k]
  }
  const rankOf = (k: string): number => {
    if (k in rank) return rank[k]
    const kids = tree[k]?.slots ? Object.values<any>(tree[k].slots).flat() : []
    return kids.length ? Math.min(...kids.map(rankOf)) : Infinity
  }
  // rows: average-linkage clustering of `beside` among the siblings of one non-arranged slot
  let rowN = 0
  if (p.rowable.length > 1) {
    const up: any = {}
    const find = (x: string): string => (up[x] === undefined || up[x] === x ? x : (up[x] = find(up[x])))
    const pt = (x: string, y: string) => Math.max(a[`beside_${x}`]?.probabilities?.[y] ?? 0, a[`beside_${y}`]?.probabilities?.[x] ?? 0)
    const rowMax = containerOf(c, ROW)?.max ?? Infinity
    const bySlot = new Map<string, string[]>()
    for (const k of p.rowable) if (tree[k]) { if (!bySlot.has(parent[k])) bySlot.set(parent[k], []); bySlot.get(parent[k])!.push(k) }
    for (const members of bySlot.values()) {
      const groups = members.map(k => [k])
      for (;;) {
        let best: any = null
        groups.forEach((g, i) => groups.slice(i + 1).forEach((h, j) => {
          const all = g.flatMap(x => h.map(y => pt(x, y)))
          const m = all.reduce((u, v) => u + v, 0) / all.length
          // one confident link and enough support overall (beside answers are sparse)
          // and a row never grows past the row container's `max` (the built-in row: 4)
          if (g.length + h.length <= rowMax && Math.max(...all) >= ROW_MIN && m >= rowMean && (!best || m > best.m)) best = {m, i, j: i + 1 + j}
        }))
        if (!best) break
        groups[best.i] = groups[best.i].concat(groups[best.j])
        groups.splice(best.j, 1)
      }
      for (const g of groups) for (const x of g.slice(1)) up[find(x)] = find(g[0])
    }
    for (const [id, t] of Object.entries<any>(tree)) {
      if (!t.slots || (id !== ROOT && containerOf(c, t.part)?.arranged)) continue
      for (const [s, list] of Object.entries<any>(t.slots)) {
        const groups = new Map<string, string[]>()
        for (const x of list) if (p.rowable.includes(x)) { const r = find(x); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(x) }
        let next = [...list]
        for (const members of groups.values()) {
          if (members.length < 2) continue
          const rowKey = `row#${++rowN}`
          tree[rowKey] = {part: ROW, slots: {default: members}}
          next = next.filter(x => !members.includes(x)).concat(rowKey)
        }
        t.slots[s] = next
      }
    }
  }
  // order every slot; inside a row, left/right answers win
  const leftWins = (k: string, members: string[]) => members.reduce((w, o) => {
    if (o === k) return w
    const pr = a[`left_${k}_vs_${o}`]?.probabilities ?? a[`left_${o}_vs_${k}`]?.probabilities
    return w + (pr ? pr[k] ?? 0 : rankOf(k) < rankOf(o) ? 1 : 0)
  }, 0)
  for (const t of Object.values<any>(tree)) {
    if (!t.slots) continue
    for (const s of Object.keys(t.slots)) {
      if (t.part === ROW) {
        const m = t.slots[s]
        const w = Object.fromEntries(m.map((k: string) => [k, leftWins(k, m)]))
        m.sort((x: string, y: string) => w[y] - w[x] || rankOf(x) - rankOf(y))
      } else t.slots[s].sort((x: string, y: string) => rankOf(x) - rankOf(y))
    }
  }
  return toContractTree(c, tree, c.limits?.maxDepth ?? 4)
}

/** the internal tree → the contract's Tree; a container deeper than maxDepth moves to the root */
function toContractTree(c: any, tree: any, maxDepth: number): any[] {
  const overflow: string[] = []
  const visit = (k: string, depth: number): any => {
    const t = tree[k]
    if (!t.slots) return {part: t.part, ...(t.params && {params: t.params})}
    const kids: any = {}
    for (const [s, list] of Object.entries<any>(t.slots)) {
      const out: any[] = []
      for (const x of list) {
        if (depth + 1 > maxDepth && tree[x].slots) { overflow.push(x); continue }
        out.push(visit(x, depth + 1))
      }
      if (out.length) kids[s] = out
    }
    const named = slotNames(t.part === ROW ? null : containerOf(c, t.part))
    return {part: t.part, children: named.length === 1 && named[0] === ROOT_SLOT ? kids[ROOT_SLOT] || [] : kids}
  }
  const root = visit(ROOT, 0).children
  for (const x of overflow) root.push(visit(x, 1))
  return root
}

// ---------- replies: validation (SYG682) ----------
function validate(questions: any, a: any) {
  const out: any = {}
  let bad = 0
  for (const [name, x] of Object.entries<any>(a || {})) {
    const q = questions[name]
    if (!q || !x) continue
    if (q.type === 'choice' && !(String(x.choice) in q.criteria)) {
      dev('SYG682', `the answer to '${name}' is ${JSON.stringify(x.choice)}, not one of its options (${Object.keys(q.criteria).join(', ')}): ignored`, 'warn')
      bad++
      continue
    }
    out[name] = q.type === 'choice' ? {...x, choice: String(x.choice)} : x
  }
  return {answers: out, bad}
}

// ---------- the backend ----------
export interface DecisionsOptions {
  url?: string
  model?: string
  key?: string
  rowMean?: number
  prefilter?: boolean
  maxOptions?: number
}

const isOllama = (url: string) => /:11434\b|ollama/i.test(url)

export function decisions({url = '/api/decide', model, key, rowMean = 0.25, prefilter = false, maxOptions}: DecisionsOptions = {}) {
  // a decide() server picks no default model: every request needs one (SYG681, the contract's
  // backend option problem; compose.llm() doesn't report it: a chat transport has its own default)
  if (typeof model != 'string' || !model) dev('SYG681', "compose.decisions() needs a `model` (the decision model's id, e.g. compose.decisions({ model: 'jev-latest' })); its requests go without one", 'error')
  const max = maxOptions ?? (isOllama(url) ? 25 : 255)
  const request = (names: any, step: any) => decide({
    url, model, state: step.state, questions: step.questions,
    key: key ?? names?.key, latest: true, ok: names?.ok, error: names?.error,
  } as any)
  const answersOf = (reply: any) => (reply && typeof reply == 'object' ? reply.answers : undefined)

  /** the questions of a pending step (rebuilt from it, as sent) */
  function stepOf(catalog: any, pending: any) {
    if (pending.step === 'categories') return categoryStep(catalog, pending.prompt)
    if (pending.step === 'select') return selectStep(catalog, pending.prompt, {categories: pending.categories, records: pending.records, max})
    return layoutStep(catalog, pending.prompt, {items: pending.items, row: pending.row})
  }
  function selectPending(catalog: any, state: any, prompt: string, categories: string[] | null, base: any) {
    const records = prefilterRecords(catalog, state, prompt, categories, max)
    return {...base, step: 'select', prompt, categories, records}
  }
  const done = (catalog: any, state: any, tree: any[], previous: any) => finish(catalog, fromTree(catalog, tree, previous), state)

  /** a reply → the backend's result (pure; fake() reads with it too) */
  function read({catalog, state, pending, reply, names}: any) {
    const step = stepOf(catalog, pending)
    const body = answersOf(reply)
    // a reply that can't be read: the behavior's status 'error' (contract), not a throw
    if (!body || typeof body != 'object' || Array.isArray(body)) return {error: 'compose.decisions(): the decision reply has no answers'}
    const {answers: a, bad} = validate(step.questions, body)
    if (bad && !Object.keys(a).length) return {error: `compose.decisions(): every answer of the ${pending.step} step is outside its question's options (SYG682)`}
    const decisions = {...(pending.decisions || {}), [pending.step]: a}
    const base = {previous: pending.previous ?? null, decisions}
    if (pending.step === 'categories') {
      const chosen = categoriesOf(catalog).filter(id => a[`cat_${id}`]?.choice === 'use')
      const open = partIds(catalog).some(id => !partOf(catalog, id).required && partOf(catalog, id).category == null)
      if (!chosen.length && !open) return {layout: null, unavailable: true as const, decisions}
      const next = selectPending(catalog, state, pending.prompt, chosen, base)
      return {request: request(names, stepOf(catalog, next)), pending: next, decisions}
    }
    if (pending.step === 'select') {
      const sel = readSelect(catalog, a, {categories: pending.categories, records: pending.records})
      if (sel.unavailable) return {layout: null, unavailable: true as const, decisions}
      const p = plan(catalog, sel)
      if (!needsLayout(p)) return {layout: done(catalog, state, readLayout(catalog, sel, {}, {rowMean}), pending.previous), decisions}
      const next = {...base, step: 'layout', prompt: pending.prompt, items: sel.items, row: sel.row}
      const preview = done(catalog, state, sel.items.map((i: any) => ({part: i.part, ...(i.params && {params: i.params})})), pending.previous)
      return {preview, request: request(names, stepOf(catalog, next)), pending: next, decisions}
    }
    const tree = readLayout(catalog, {items: pending.items, row: pending.row}, a, {rowMean})
    return {layout: done(catalog, state, tree, pending.previous), decisions}
  }

  return {
    sink: 'HTTP',
    kind: 'decisions',
    start({catalog, state, prompt, previous, names}: any) {
      const base = previous ? {previous} : {}
      const pending = prefilter && categoriesOf(catalog).length
        ? {...base, step: 'categories', prompt}
        : selectPending(catalog, state, prompt, null, base)
      return {request: request(names, stepOf(catalog, pending)), pending}
    },
    reply: read,
    /** the reply body that makes the pending step read as `target` (for composeWith); throws when it can't */
    fake({catalog, state, pending, target}: any) {
      const step = stepOf(catalog, pending)
      const want = toTree(finish(catalog, fromTree(catalog, target || [], pending.previous ?? undefined), state))
      const picks = fakePicks(catalog, pending, step, want)
      const reply = answersFor(step.questions, picks)
      check(catalog, state, pending, want, read({catalog, state, pending, reply, names: {}}))
      return reply
    },
  }
}

// ---------- fake: answers that read as a target tree (structure/evals/selftest.mjs) ----------
/** the target's leaves (DFS order) and containers, with their places */
function walkTarget(c: any, tree: any[]) {
  const leaves: any[] = [], containers: any = {}, rows: any[] = []
  const visit = (list: any[], where: string, row: any) => {
    for (const n of list || []) {
      if (n.part === ROW) {
        const r: any[] = []
        rows.push(r)
        visit(Array.isArray(n.children) ? n.children : n.children?.[ROOT_SLOT] || [], where, r)
      } else if (containerOf(c, n.part)) {
        containers[n.part] = where
        if (Array.isArray(n.children)) visit(n.children, `${n.part}:${ROOT_SLOT}`, null)
        else for (const [s, l] of Object.entries<any>(n.children || {})) visit(l, `${n.part}:${s}`, null)
      } else {
        const leaf = {part: n.part, params: n.params || {}, where, row, i: leaves.length}
        leaves.push(leaf)
        row?.push(leaf)
      }
    }
  }
  visit(tree, `${ROOT}:${ROOT_SLOT}`, null)
  return {leaves, containers, rows}
}
const one = (choice: string) => ({choice, probabilities: {[choice]: 1}})

function fakePicks(c: any, pending: any, step: any, want: any[]) {
  const {leaves, containers} = walkTarget(c, want)
  const picks: any = {}
  const has = (id: string) => leaves.filter(l => l.part === id)
  if (pending.step === 'categories' || pending.step === 'select') {
    for (const [name, m] of Object.entries<any>(step.meta)) {
      const q = step.questions[name]
      if (m.kind === 'cat') picks[name] = one(leaves.some(l => partOf(c, l.part)?.category === m.category) ? 'use' : 'omit')
      else if (m.kind === 'use') picks[name] = one(has(m.part).length ? 'use' : 'omit')
      else if (m.kind === 'count') picks[name] = one(String(Math.min(has(m.part).length, maxUses(partOf(c, m.part)))))
      else if (m.kind === 'pick') picks[name] = one(m.members.find((id: string) => has(id).length) ?? 'omit')
      else if (m.kind === 'rec') {
        const rp = recordParam(partOf(c, m.part))
        const values = has(m.part).map(l => String(l.params?.[rp as string]))
        const v = values[m.n - 1]
        picks[name] = one(v !== undefined && v in q.criteria ? v : 'none')
      } else if (m.kind === 'param') {
        const v = has(m.part).map(l => l.params?.[m.param]).find(x => x !== undefined)
        const s = v === undefined ? 'not_stated' : String(v)
        picks[name] = one(s in q.criteria ? s : 'not_stated')
      } else if (m.kind === 'row') picks[name] = leaves.some(l => l.row)
    }
    return picks
  }
  // layout: match the selected items to the target's leaves (part + record, in order)
  const items = pending.items
  const taken = new Set<any>()
  const leafOf: any = {}
  for (const it of items) {
    const rp = recordParam(partOf(c, it.part))
    const l = leaves.find(l => !taken.has(l) && l.part === it.part && (!rp || String(l.params?.[rp]) === String(it.params?.[rp])))
    if (l) { taken.add(l); leafOf[it.key] = l }
  }
  const pos = (k: string) => leafOf[k]?.i ?? Infinity
  for (const [name, m] of Object.entries<any>(step.meta)) {
    const q = step.questions[name], keys = Object.keys(q.criteria)
    if (m.kind === 'parent') {
      const where = leafOf[m.key]?.where ?? containers[m.key]
      picks[name] = one(keys.includes(where) ? where : keys[0])
    } else if (m.kind === 'beside') {
      const row = leafOf[m.key]?.row
      if (!row) { picks[name] = one('none'); continue }
      // a ring: each member names the next one (the last names the first), so average-linkage keeps
      // the row together at rowMean 0.25 for up to 6 members
      const mates = row.map((l: any) => Object.keys(leafOf).find(k => leafOf[k] === l))
      const next = mates[(mates.indexOf(m.key) + 1) % mates.length]
      picks[name] = one(keys.includes(next) ? next : 'none')
    } else if (m.kind === 'left' || m.kind === 'first') picks[name] = one(pos(m.a) <= pos(m.b) ? m.a : m.b)
    else if (m.kind === 'gap') {
      const g = leaves.filter(l => l.part === m.part && l.i < pos(m.key)).length
      picks[name] = one(String(Math.min(g, keys.length - 1)))
    }
  }
  return picks
}

const canon = (x: any): any => Array.isArray(x) ? x.map(canon)
  : x && typeof x == 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x
const show = (t: any) => JSON.stringify(t)

/** throws when reading the fake's answers doesn't give the target (an unreachable target) */
function check(c: any, state: any, pending: any, want: any[], out: any) {
  const fail = (why: string) => { throw new Error(`[Sygnal] compose.decisions() fake: can't reach the target ${show(want)}: ${why}`) }
  if (pending.step === 'select') {
    for (const l of walkTarget(c, want).leaves) {
      const rp = recordParam(partOf(c, l.part))
      if (rp && !(pending.records?.[l.part] || []).some((r: any) => String(r.value) === String(l.params?.[rp]))) {
        fail(`the prompt ${JSON.stringify(pending.prompt)} doesn't name the ${l.part} record ${JSON.stringify(l.params?.[rp])} (records are found by name or alias in the prompt)`)
      }
    }
  }
  if (out.request) {
    if (pending.step !== 'select') return
    const got = out.pending.items.map((i: any) => show(canon({part: i.part, params: i.params || {}}))).sort()
    const exp = walkTarget(c, want).leaves.map(l => show(canon({part: l.part, params: l.params || {}}))).sort()
    if (show(got) !== show(exp)) fail(`the select step reads as ${got.join(' ')}`)
    return
  }
  if (out.unavailable) {
    // nothing fits: the target holds nothing but required parts (which finish() adds anyway)
    if (walkTarget(c, want).leaves.some(l => !partOf(c, l.part)?.required)) fail('the answers read as "nothing fits"')
    return
  }
  const got = toTree(out.layout)
  if (show(canon(got)) !== show(canon(want))) fail(`the answers read as ${show(got)}`)
}
