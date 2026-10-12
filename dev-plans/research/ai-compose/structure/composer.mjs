// Compose a UI tree from prepared parts with a decision model (choice / noul / score questions).
// Framework-neutral, pure functions: build each step's questions, read the answers into the layout.
//
// Layout format (shared):
//   { root: 'n0', nodes: { n0: { part: 'page', slots: { default: ['n1', 'n2'] } },
//                          n1: { part: 'revenue' }, n2: { part: 'row', slots: { default: ['n3'] } } } }
//   `part` = a catalog part id, the root id, or 'row' (the built-in side-by-side container);
//   `slots` only on containers; `params` reserved for the params/edit step (left untouched here).
//
// Steps (decide() calls), see REPORT.md:
//   [0. categories]  only with opts.prefilter: one use/omit choice per category (large catalogs)
//   1. select        use_<id> (omit/use) per part, pick_<resource> per variant group, count_<id> per
//                    repeatable part, the `row` noul gate ("side by side?")
//   2. layout        (2+ leaves, or a part with 2+ allowed places) parent_<k> where a part has 2+
//                    allowed places; with the row gate on: beside_<k> (which element is it next to?)
//                    and left_<a>_vs_<b> per pair; first_<a>_vs_<b> per pair ("which comes first?");
//                    gap_<x>_in_<id> for a part used 2+ times
// Everything else is deterministic code: required parts, companions, auto containers (present when
// non-empty), cycles, rows (guarded average-linkage clustering of `beside`, siblings only), order
// (summed pairwise probabilities; pins), unwrapping (tabs below minSlots), limits (maxParts, maxDepth).
// Alternatives kept for the evals: rows: 'pairs' | 'index' | 'relation' (REPORT.md: why not default).

const ROOT_SLOT = 'default'
export const ROW_MIN = 0.5

// ---------- wording (the instruction texts; REPORT.md quotes them) ----------
export const TEXT = {
  select: 'Is this element one of the things user_request asks to see? Choose use only when user_request names this element or describes what it shows. Choose omit for elements that are merely about the same topic, area or page as what user_request asks for.',
  variant: 'Which of these elements does user_request ask for, by name or by what it shows? Choose omit when it asks for none of them. When it asks for this kind of element without saying which, choose the first one.',
  count: (d) => `How many times does user_request want this element on the page: ${d}? Choose 0 when it does not ask for it.`,
  omit: 'None of these elements is needed.',
  selectNoul: (d) => `Does user_request ask for this element, by name or by what it shows: ${d}? Omit elements user_request does not ask for, even when related to the topic.`,
  category: 'Does user_request ask for anything in this area, by name or by what it shows?',
  row: 'Does user_request explicitly ask for some elements to be placed side by side, next to each other, beside each other or in a row?',
  parent: (d) => `Where does this element go: ${d}? Follow user_request when it says where. Otherwise choose the place whose description fits this element best.`,
  beside: (d) => `Which element does user_request want side by side with this element, in the same row: ${d}? Choose none unless user_request asks for these elements to be next to each other, beside each other or in a row.`,
  gap: (d, n, x, guidance) => `This page shows this element ${n} times: ${d}. Where does this other element go relative to those copies: ${x}? Follow user_request: it may say where each copy goes (for example at the top and again at the bottom) and what goes between them.${guidance ? ' When user_request does not say: ' + guidance : ''}`,
  group: (d) => `Is this element in a row, side by side with other elements, and if so in which row: ${d}? Choose none unless user_request asks for elements next to each other, beside each other or in a row.`,
  together: (a, b) => `Does user_request want these two elements side by side, in the same row: (1) ${a}; (2) ${b}? Answer no unless user_request asks for them to be next to each other, beside each other or in a row together.`,
  relation: (a, b, guidance) => `How are these two elements placed relative to each other: (1) ${a}; (2) ${b}? Follow user_request: side by side only when it asks for them to be next to each other, beside each other or in a row; an element it wants at the top, first or above comes above; on the left / right as it says. When user_request does not say, ${guidance ? guidance + ' Otherwise ' : ''}the one user_request mentions first comes first (above, or on the left).`,
  left: 'If these two elements are side by side in a row, which one is on the left? Follow user_request: the one it puts on the left, or names first when it lists them side by side, is on the left.',
  first: (guidance) => `Which of these two elements comes first on the page (higher up, or further left in a row)? Follow user_request: an element it wants at the top, first, above or on the left comes first; one it wants below, under, after, at the end or on the right comes later. When user_request does not say, ${guidance ? guidance + ' Otherwise ' : ''}the one user_request mentions first comes first.`,
}

/** P(use) of a use_<id> answer, choice or noul form */
export const useProbability = (a) => (!a ? 0 : a.type === 'noul' ? a.noul : a.probabilities?.use ?? (a.choice === 'use' ? 1 : 0))

// ---------- catalog helpers ----------
const byId = (catalog) => new Map(catalog.parts.map((p) => [p.id, p]))
const isContainer = (p) => !!p?.slots
const slotNames = (p) => Object.keys(p.slots)
const copyKey = (id, n) => (n === 1 ? id : `${id}__${n}`)
const partOf = (key) => key.split('__')[0]
const copyOf = (key) => Number(key.split('__')[1] || 1)

/** the allowed destinations of a part as 'container:slot' strings */
function allowed(catalog, part) {
  const parts = byId(catalog)
  const out = []
  for (const d of part.in || [catalog.root.id]) {
    if (d === catalog.root.id) out.push(`${d}:${ROOT_SLOT}`)
    else if (d.includes(':')) out.push(d)
    else for (const s of slotNames(parts.get(d))) out.push(`${d}:${s}`)
  }
  return out
}

// ---------- step 0: categories (optional pre-filter) ----------
export function categoryStep(catalog, prompt) {
  const questions = {}
  for (const [id, description] of Object.entries(catalog.categories || {})) {
    questions[`cat_${id}`] = { type: 'choice', instructions: TEXT.category, criteria: { omit: 'Nothing in this area is needed.', use: description } }
  }
  return { state: { user_request: prompt }, questions }
}
export function readCategories(catalog, answers) {
  return Object.keys(catalog.categories || {}).filter((id) => answers[`cat_${id}`]?.choice === 'use')
}

// ---------- step 1: select ----------
/** the parts the select step asks about: not auto containers, not required parts */
function askable(catalog, categories) {
  return catalog.parts.filter((p) => !p.auto && !p.required && (!categories || !p.category || categories.includes(p.category)))
}

export function selectStep(catalog, prompt, { categories, row = true, form = 'choice' } = {}) {
  const questions = {}
  const groups = new Map()
  for (const p of askable(catalog, categories)) {
    if (p.resource) {
      if (!groups.has(p.resource)) groups.set(p.resource, [])
      groups.get(p.resource).push(p)
    } else if ((p.maxUses ?? 1) > 1) {
      const criteria = { 0: 'Not on the page.' }
      for (let n = 1; n <= p.maxUses; n++) criteria[n] = n === 1 ? 'Once.' : `${n} times, in different places on the page.`
      questions[`count_${p.id}`] = { type: 'choice', instructions: TEXT.count(p.description), criteria }
    } else {
      questions[`use_${p.id}`] = form === 'noul'
        ? { type: 'noul', instructions: TEXT.selectNoul(p.description) }
        : { type: 'choice', instructions: TEXT.select, criteria: { omit: TEXT.omit, use: p.description } }
    }
  }
  for (const [resource, list] of groups) {
    questions[`pick_${resource}`] = {
      type: 'choice', instructions: TEXT.variant,
      criteria: { omit: 'None of these elements is needed.', ...Object.fromEntries(list.map((p) => [p.id, p.description])) },
    }
  }
  if (catalog.rows && row) questions.row = { type: 'noul', instructions: TEXT.row }
  return { state: { user_request: prompt }, questions }
}

/**
 * select answers → { items: [key], row, unavailable }. Keys are part ids, with `__2`, `__3` for
 * further copies of a repeatable part. Adds required parts and companions; caps at limits.maxParts.
 */
export function readSelect(catalog, answers, { categories, threshold = 0.5 } = {}) {
  const parts = byId(catalog)
  const scored = []   // [key, probability] in catalog order
  const seenGroup = new Set()
  for (const p of askable(catalog, categories)) {
    if (p.resource) {
      if (seenGroup.has(p.resource)) continue
      seenGroup.add(p.resource)
      const a = answers[`pick_${p.resource}`]
      if (a && a.choice !== 'omit') scored.push([a.choice, a.probabilities?.[a.choice] ?? 1])
    } else if ((p.maxUses ?? 1) > 1) {
      const a = answers[`count_${p.id}`]
      const n = Number(a?.choice ?? 0)
      for (let i = 1; i <= n; i++) scored.push([copyKey(p.id, i), a.probabilities?.[a.choice] ?? 1])
    } else {
      const a = answers[`use_${p.id}`]
      const pr = useProbability(a)
      if (pr >= threshold) scored.push([p.id, pr])
    }
  }
  if (!scored.length) return { items: [], row: false, unavailable: true }
  const max = catalog.limits?.maxParts ?? 12
  let keys = scored.map(([k]) => k)
  if (keys.length > max) {
    const keep = new Set([...scored].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k))
    keys = keys.filter((k) => keep.has(k))
  }
  const items = [...catalog.parts.filter((p) => p.required).map((p) => p.id), ...keys]
  for (const k of [...items]) for (const c of parts.get(partOf(k))?.companions || []) if (!items.includes(c)) items.push(c)
  return { items, row: (answers.row?.noul ?? 0) >= 0.5, unavailable: false }
}

// ---------- step 2: layout ----------
/** the auto containers some item (or another reachable auto container) may go into */
function reachableContainers(catalog, items) {
  const parts = byId(catalog)
  const present = new Set(items.map(partOf))
  const out = []
  let changed = true
  while (changed) {
    changed = false
    for (const id of [...present]) {
      for (const d of allowed(catalog, parts.get(id) || catalog.root)) {
        const c = d.split(':')[0]
        if (c !== catalog.root.id && !present.has(c)) { present.add(c); out.push(c); changed = true }
      }
    }
  }
  return out
}

function describeCopy(catalog, key) {
  const p = byId(catalog).get(partOf(key))
  return copyOf(key) > 1 ? `${p.description} (copy ${copyOf(key)})` : p.description
}

function destLabel(catalog, dest) {
  const [c, slot] = dest.split(':')
  if (c === catalog.root.id) return `${catalog.root.description}, at the top level (not inside any section, tab or group)`
  const p = byId(catalog).get(c)
  return p.slots[slot] || p.description
}

/** everything the layout step needs to know about the selection */
export function plan(catalog, selection) {
  const parts = byId(catalog)
  const containers = reachableContainers(catalog, selection.items)
  const nodes = [...selection.items, ...containers]
  const present = new Set(nodes.map(partOf))
  const dests = {}
  for (const k of nodes) {
    dests[k] = allowed(catalog, parts.get(partOf(k))).filter((d) => {
      const c = d.split(':')[0]
      return c !== partOf(k) && (c === catalog.root.id || present.has(c))
    })
    if (!dests[k].length) dests[k] = [`${catalog.root.id}:${ROOT_SLOT}`]
  }
  // leaves = the items that take part in order / row questions (auto containers are ranked by content)
  const leaves = nodes.filter((k) => !parts.get(partOf(k))?.auto)
  // a leaf may join a row when one of its places is not an arranged container
  const rowable = selection.row && catalog.rows
    ? leaves.filter((k) => dests[k].some((d) => { const c = d.split(':')[0]; return c === catalog.root.id || !parts.get(c).arranged }))
    : []
  return { nodes, containers, dests, leaves, rowable }
}

export function layoutStep(catalog, prompt, selection, { rows = 'beside', leftRight = true } = {}) {
  const p = plan(catalog, selection)
  const questions = {}
  for (const k of p.nodes) {
    if (p.dests[k].length < 2) continue
    questions[`parent_${k}`] = {
      type: 'choice', instructions: TEXT.parent(describeCopy(catalog, k)),
      criteria: Object.fromEntries(p.dests[k].map((d) => [d, destLabel(catalog, d)])),
    }
  }
  if (p.rowable.length > 1 && rows === 'index') {
    // alternative (worse, see REPORT.md): number the side-by-side groups
    const n = Math.min(3, p.rowable.length >> 1)
    for (const k of p.rowable) {
      const criteria = { none: 'Not in a row: full width on its own.' }
      for (let g = 1; g <= n; g++) criteria[`row${g}`] = `In row ${g}: the ${['first', 'second', 'third'][g - 1]} group of side-by-side elements user_request mentions.`
      questions[`group_${k}`] = { type: 'choice', instructions: TEXT.group(describeCopy(catalog, k)), criteria }
    }
  } else if (rows === 'relation') {
    // asked below, with the order: one 4-way relation per pair of rowable parts
  } else if (p.rowable.length > 1 && rows === 'pairs') {
    // alternative: one yes/no per pair
    p.rowable.forEach((a, i) => p.rowable.slice(i + 1).forEach((b) => {
      questions[`together_${a}_vs_${b}`] = { type: 'noul', instructions: TEXT.together(describeCopy(catalog, a), describeCopy(catalog, b)) }
    }))
  } else if (p.rowable.length > 1) {
    for (const k of p.rowable) {
      questions[`beside_${k}`] = {
        type: 'choice', instructions: TEXT.beside(describeCopy(catalog, k)),
        criteria: { none: 'No element: this one is not side by side with another.', ...Object.fromEntries(p.rowable.filter((o) => o !== k).map((o) => [o, describeCopy(catalog, o)])) },
      }
    }
  }
  if (p.rowable.length > 1 && leftRight) {
    // left/right inside a row is its own question: "comes first" mixes it with above/below
    p.rowable.forEach((a, i) => p.rowable.slice(i + 1).forEach((b) => {
      questions[`left_${a}_vs_${b}`] = { type: 'choice', instructions: TEXT.left, criteria: { [a]: describeCopy(catalog, a), [b]: describeCopy(catalog, b) } }
    }))
  }
  const free = p.leaves.filter((k) => !pinOf(catalog, k))
  const multi = multiParts(free)
  const single = free.filter((k) => !multi.has(partOf(k)))
  const relational = new Set(rows === 'relation' && p.rowable.length > 1 ? p.rowable : [])
  single.forEach((a, i) => single.slice(i + 1).forEach((b) => {
    if (relational.has(a) && relational.has(b)) {
      const [da, db] = [describeCopy(catalog, a), describeCopy(catalog, b)]
      questions[relKey(a, b)] = {
        type: 'choice', instructions: TEXT.relation(da, db, catalog.guidance),
        criteria: {
          a_above: 'Element 1 is above element 2 (not side by side).',
          b_above: 'Element 2 is above element 1 (not side by side).',
          a_left: 'Side by side in the same row: element 1 on the left, element 2 on the right.',
          b_left: 'Side by side in the same row: element 2 on the left, element 1 on the right.',
        },
      }
      return
    }
    questions[pairKey(a, b)] = {
      type: 'choice', instructions: TEXT.first(catalog.guidance),
      criteria: { [a]: describeCopy(catalog, a), [b]: describeCopy(catalog, b) },
    }
  }))
  // a part used n times: each other element answers where it goes relative to the n copies
  for (const id of multi) {
    const n = free.filter((k) => partOf(k) === id).length
    const d = byId(catalog).get(id).description
    for (const x of single) {
      const criteria = { 0: `Above all ${n} copies of it (before the first one).` }
      for (let g = 1; g < n; g++) criteria[g] = `Between copy ${g} and copy ${g + 1} of it.`
      criteria[n] = `Below all ${n} copies of it (after the last one).`
      questions[`gap_${x}_in_${id}`] = { type: 'choice', instructions: TEXT.gap(d, n, describeCopy(catalog, x), catalog.guidance), criteria }
    }
  }
  const state = {
    user_request: prompt,
    selected_elements: p.leaves.map((k) => ({ id: k, content: describeCopy(catalog, k) })),
  }
  return { state, questions, plan: p }
}

const pinOf = (catalog, key) => byId(catalog).get(partOf(key))?.pin
const pairKey = (a, b) => `first_${a}_vs_${b}`
const relKey = (a, b) => `rel_${a}_vs_${b}`
/** P(a before b), from a first_ or a rel_ answer; null when not asked */
function before(answers, a, b) {
  const f = answers[pairKey(a, b)]?.probabilities
  if (f) return [f[a] ?? 0, f[b] ?? 0]
  const r = answers[relKey(a, b)]?.probabilities
  if (r) return [(r.a_above ?? 0) + (r.a_left ?? 0), (r.b_above ?? 0) + (r.b_left ?? 0)]
  return null
}

/** the parts with 2+ copies among the keys */
const multiParts = (keys) => new Set(keys.filter((k) => copyOf(k) > 1).map(partOf))

/**
 * pairwise answers → rank per leaf (0 = first): summed win probabilities (Borda), ties keep selection
 * order. Copies of a repeated part go into the gaps the other elements chose (expected gap index).
 */
export function ranks(leaves, answers) {
  const multi = multiParts(leaves)
  const single = leaves.filter((k) => !multi.has(partOf(k)))
  const wins = Object.fromEntries(single.map((k) => [k, 0]))
  single.forEach((a, i) => single.slice(i + 1).forEach((b) => {
    const pr = before(answers, a, b)
    if (!pr) return
    wins[a] += pr[0]
    wins[b] += pr[1]
  }))
  const sorted = [...single].sort((a, b) => wins[b] - wins[a] || single.indexOf(a) - single.indexOf(b))
  const score = Object.fromEntries(sorted.map((k, i) => [k, i]))
  for (const id of multi) {
    const copies = leaves.filter((k) => partOf(k) === id).sort((a, b) => copyOf(a) - copyOf(b))
    const gap = (x) => {
      const pr = answers[`gap_${x}_in_${id}`]?.probabilities
      return pr ? Object.entries(pr).reduce((a, [g, q]) => a + Number(g) * q, 0) : copies.length
    }
    copies.forEach((c, i) => {
      // copy i+1 sits after every element whose gap is below i+0.5
      const before = sorted.filter((x) => gap(x) < i + 0.5)
      score[c] = (before.length ? Math.max(...before.map((x) => score[x])) : -1) + 0.5 + i * 0.01
    })
  }
  const out = [...leaves].sort((a, b) => score[a] - score[b] || leaves.indexOf(a) - leaves.indexOf(b))
  return Object.fromEntries(out.map((k, i) => [k, i]))
}

/** layout answers → the layout tree */
export function readLayout(catalog, selection, answers, { plan: p0, rows = 'beside', rowMean = ROW_MIN / 2, rowLink = 'max' } = {}) {
  const parts = byId(catalog)
  const p = p0 || plan(catalog, selection)
  const rootId = catalog.root.id
  // 1. parents
  const parent = {}
  for (const k of p.nodes) {
    const a = answers[`parent_${k}`]?.choice
    parent[k] = p.dests[k].includes(a) ? a : p.dests[k][0]
  }
  // 2. cycles → the root
  const nodeOf = (dest) => dest.split(':')[0]
  for (const k of p.nodes) {
    const seen = new Set([k])
    let c = nodeOf(parent[k])
    while (c !== rootId) {
      if (seen.has(c)) { parent[k] = `${rootId}:${ROOT_SLOT}`; break }
      seen.add(c)
      c = nodeOf(parent[c])
    }
  }
  // 3. tree: id → { part, slots: { slot: [child] } }
  const free = p.leaves.filter((k) => !pinOf(catalog, k))
  const fr = ranks(free, answers)
  const rank = {}
  for (const k of p.leaves) rank[k] = pinOf(catalog, k) === 'start' ? -1000 + p.leaves.indexOf(k) : pinOf(catalog, k) === 'end' ? 1000 + p.leaves.indexOf(k) : fr[k]
  const tree = { [rootId]: { part: rootId, slots: { [ROOT_SLOT]: [] } } }
  for (const k of p.nodes) {
    const part = parts.get(partOf(k))
    tree[k] = { part: partOf(k), ...(isContainer(part) && { slots: Object.fromEntries(slotNames(part).map((s) => [s, []])) }) }
  }
  for (const k of p.nodes) { const [c, s] = parent[k].split(':'); tree[c].slots[s].push(k) }
  // 4. drop empty auto containers (repeat: a container may only hold empty containers)
  let dropped = true
  while (dropped) {
    dropped = false
    for (const k of p.containers) {
      if (!tree[k] || Object.values(tree[k].slots).some((l) => l.length)) continue
      const [c, s] = parent[k].split(':')
      tree[c].slots[s] = tree[c].slots[s].filter((x) => x !== k)
      delete tree[k]
      dropped = true
    }
  }
  // 5. unwrap containers with fewer non-empty slots than minSlots (their children take their place)
  for (const k of p.containers) {
    const part = parts.get(partOf(k))
    if (!tree[k] || !part.minSlots) continue
    const full = Object.values(tree[k].slots).filter((l) => l.length)
    if (full.length >= part.minSlots) continue
    const [c, s] = parent[k].split(':')
    const kids = full.flat()
    for (const x of kids) parent[x] = `${c}:${s}`
    tree[c].slots[s] = tree[c].slots[s].filter((x) => x !== k).concat(kids)
    delete tree[k]
  }
  // rank of a node: its own (leaf) or the best rank among its descendants
  const rankOf = (k) => {
    if (k in rank) return rank[k]
    const t = tree[k]
    const kids = t?.slots ? Object.values(t.slots).flat() : []
    return kids.length ? Math.min(...kids.map(rankOf)) : Infinity
  }
  // 6. rows: union-find over `beside` answers among siblings of a non-arranged slot
  let rowN = 0
  if (p.rowable.length > 1) {
    const up = {}
    const find = (x) => (up[x] === undefined || up[x] === x ? x : (up[x] = find(up[x])))
    const edge = (k, b) => { if (tree[b] && tree[k] && parent[b] === parent[k]) up[find(k)] = find(b) }
    if (rows === 'index') {
      const g = Object.fromEntries(p.rowable.map((k) => [k, answers[`group_${k}`]?.choice]))
      p.rowable.forEach((a, i) => p.rowable.slice(i + 1).forEach((b) => { if (g[a] && g[a] !== 'none' && g[a] === g[b]) edge(a, b) }))
    } else if (rows === 'relation') {
      p.rowable.forEach((a, i) => p.rowable.slice(i + 1).forEach((b) => {
        const r = answers[relKey(a, b)]?.probabilities
        if (r && (r.a_left ?? 0) + (r.b_left ?? 0) >= 0.5) edge(a, b)
      }))
    } else {
      // pairwise P(together): 'pairs' asks it; 'beside' derives it as max(P(a→b), P(b→a)).
      // average-linkage clustering per parent slot: merge the two groups whose mean P(together) is
      // highest while it stays >= 0.5, so one stray answer cannot chain two rows into one
      const pt = rows === 'pairs'
        ? (a, b) => answers[`together_${a}_vs_${b}`]?.noul ?? answers[`together_${b}_vs_${a}`]?.noul ?? 0
        : (a, b) => {
          const ab = answers[`beside_${a}`]?.probabilities?.[b] ?? 0
          const ba = answers[`beside_${b}`]?.probabilities?.[a] ?? 0
          return rowLink === 'max' ? Math.max(ab, ba) : (ab + ba) / 2
        }
      const bySlot = new Map()
      for (const k of p.rowable) if (tree[k]) { if (!bySlot.has(parent[k])) bySlot.set(parent[k], []); bySlot.get(parent[k]).push(k) }
      for (const members of bySlot.values()) {
        const groups = members.map((k) => [k])
        for (;;) {
          let best = null
          groups.forEach((g, i) => groups.slice(i + 1).forEach((h, j) => {
            const all = g.flatMap((x) => h.map((y) => pt(x, y)))
            const m = all.reduce((u, v) => u + v, 0) / all.length
            // a merge needs one confident link and enough support overall: 'beside' answers are
            // sparse (each part names one neighbour), so its mean bar is lower
            if (Math.max(...all) >= ROW_MIN && m >= (rows === 'pairs' ? ROW_MIN : rowMean) && (!best || m > best.m)) best = { m, i, j: i + 1 + j }
          }))
          if (!best) break
          groups[best.i] = groups[best.i].concat(groups[best.j])
          groups.splice(best.j, 1)
        }
        for (const g of groups) for (const x of g.slice(1)) edge(g[0], x)
      }
    }
    for (const [id, t] of Object.entries(tree)) {
      if (!t.slots || (id !== rootId && parts.get(t.part)?.arranged)) continue
      for (const [s, list] of Object.entries(t.slots)) {
        const groups = new Map()
        for (const x of list) if (p.rowable.includes(x)) { const r = find(x); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x) }
        let next = [...list]
        for (const members of groups.values()) {
          if (members.length < 2) continue
          const rowKey = `row#${++rowN}`
          tree[rowKey] = { part: 'row', slots: { default: members } }
          next = next.filter((x) => !members.includes(x)).concat(rowKey)
        }
        t.slots[s] = next
      }
    }
  }
  // 7. order every slot (named slots keep their declared order); inside a row, left/right answers win
  const leftWins = (k, members) => members.reduce((w, o) => {
    if (o === k) return w
    const pr = answers[`left_${k}_vs_${o}`]?.probabilities ?? answers[`left_${o}_vs_${k}`]?.probabilities
    return w + (pr ? pr[k] ?? 0 : rankOf(k) < rankOf(o) ? 1 : 0)
  }, 0)
  for (const t of Object.values(tree)) {
    if (!t.slots) continue
    for (const s of Object.keys(t.slots)) {
      if (t.part === 'row') {
        const m = t.slots[s]
        const w = Object.fromEntries(m.map((k) => [k, leftWins(k, m)]))
        m.sort((a, b) => w[b] - w[a] || rankOf(a) - rankOf(b))
      } else t.slots[s].sort((a, b) => rankOf(a) - rankOf(b))
    }
  }
  // 8. depth limit: a node deeper than maxDepth moves up to the root
  // (counted in container levels below the root; rows count as a level)
  return toLayout(tree, rootId, catalog.limits?.maxDepth ?? 4)
}

/** internal tree → the shared layout format with stable n0.. keys (depth-first) */
function toLayout(tree, rootId, maxDepth) {
  const nodes = {}
  let n = 0
  const overflow = []
  const visit = (k, depth) => {
    const key = `n${n++}`
    const t = tree[k]
    nodes[key] = { part: t.part }
    if (t.slots) {
      nodes[key].slots = {}
      for (const [s, list] of Object.entries(t.slots)) {
        if (!list.length) continue
        const kids = []
        for (const x of list) {
          if (depth + 1 > maxDepth && tree[x].slots) { overflow.push(x); continue }
          kids.push(visit(x, depth + 1))
        }
        if (kids.length) nodes[key].slots[s] = kids
      }
    }
    return key
  }
  const root = visit(rootId, 0)
  for (const x of overflow) nodes[root].slots[ROOT_SLOT].push(visit(x, 1))
  return { root, nodes }
}

/** a single part (or nothing): no layout call */
export function trivialLayout(catalog, selection) {
  return readLayout(catalog, selection, {})
}

// ---------- the whole composition ----------
/**
 * decide(state, questions) → Promise<{ answers, ms?, tokens? }>
 * → { layout|null, unavailable, calls, tokens, ms, steps }
 */
export async function compose(catalog, prompt, decide, opts = {}) {
  const steps = []
  const call = async (name, { state, questions }) => {
    const r = await decide(state, questions)
    steps.push({ name, questions: Object.keys(questions).length, ms: r.ms ?? 0, tokens: r.tokens ?? 0, answers: r.answers })
    return r.answers
  }
  let categories
  if (opts.prefilter && catalog.categories) {
    categories = readCategories(catalog, await call('categories', categoryStep(catalog, prompt)))
    if (!categories.length) return done(null, true)
  }
  const sel = readSelect(catalog, await call('select', selectStep(catalog, prompt, { categories })), { categories })
  if (sel.unavailable) return done(null, true)
  const p = plan(catalog, sel)
  const needsLayout = p.nodes.length > 1 && (p.leaves.length > 1 || p.nodes.some((k) => p.dests[k].length > 1))
  if (!needsLayout) return done(readLayout(catalog, sel, {}, { plan: p }), false)
  const step = layoutStep(catalog, prompt, sel, opts)
  const answers = await call('layout', step)
  return done(readLayout(catalog, sel, answers, { plan: step.plan, rows: opts.rows }), false)

  function done(layout, unavailable) {
    return {
      layout, unavailable, steps, calls: steps.length,
      tokens: steps.reduce((a, s) => a + s.tokens, 0), ms: steps.reduce((a, s) => a + s.ms, 0),
    }
  }
}

// ---------- the compact notation (evals, logs) ----------
/** layout → 'page(a row(b c) tabs[overview: d | billing: e])'; null → '' */
export function format(layout) {
  if (!layout) return ''
  const f = (key) => {
    const n = layout.nodes[key]
    if (!n.slots) return n.part
    const names = Object.keys(n.slots)
    if (names.length === 1 && names[0] === 'default') return `${n.part}(${n.slots.default.map(f).join(' ')})`
    return `${n.part}[${names.map((s) => `${s}: ${n.slots[s].map(f).join(' ')}`).join(' | ')}]`
  }
  return f(layout.root)
}

/** the notation → a layout (inverse of format) */
export function parse(text) {
  if (!text.trim()) return null
  const tokens = text.match(/[A-Za-z0-9_]+|[()[\]:|]/g)
  let i = 0
  const nodes = {}
  let n = 0
  const node = () => {
    const key = `n${n++}`
    const part = tokens[i++]
    nodes[key] = { part }
    if (tokens[i] === '(') {
      i++
      const kids = []
      while (tokens[i] !== ')') kids.push(node())
      i++
      nodes[key].slots = { default: kids }
    } else if (tokens[i] === '[') {
      i++
      nodes[key].slots = {}
      while (tokens[i] !== ']') {
        const slot = tokens[i++]
        i++ // ':'
        const kids = []
        while (tokens[i] !== '|' && tokens[i] !== ']') kids.push(node())
        nodes[key].slots[slot] = kids
        if (tokens[i] === '|') i++
      }
      i++
    }
    return key
  }
  return { root: node(), nodes }
}

/** the parts in a layout (multiset, no root, no rows) */
export function partsIn(layout, catalog) {
  if (!layout) return []
  const auto = new Set(catalog.parts.filter((p) => p.auto).map((p) => p.id))
  return Object.values(layout.nodes).map((x) => x.part).filter((x) => x !== catalog.root.id && x !== 'row' && !auto.has(x))
}

/** each part's place, ignoring sibling order: 'page/tabs:overview/row' (copies get #n) */
export function places(layout) {
  if (!layout) return {}
  const out = {}
  const seen = {}
  const walk = (key, path) => {
    const x = layout.nodes[key]
    const id = x.part + (seen[x.part] = (seen[x.part] || 0) + 1 > 1 ? `#${seen[x.part]}` : '')
    if (!x.slots) { out[id] = path; return }
    const named = !(Object.keys(x.slots).length === 1 && x.slots.default)
    for (const [s, kids] of Object.entries(x.slots)) {
      const here = path ? `${path}/` : ''
      const seg = x.part === 'row' ? `row(${kids.map((k) => layout.nodes[k].part).sort().join(',')})` : named ? `${x.part}:${s}` : x.part
      for (const k of kids) walk(k, here + seg)
    }
  }
  walk(layout.root, '')
  return out
}
