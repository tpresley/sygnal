// variant probe: keep/remove and move questions, scored per node over the edit cases
import { decideRaw } from './client.mjs'
import * as L from '../params-edits.mjs'
import { EDIT_CASES } from './cases.mjs'
const MOVED = { 'Move the tickets to the top': ['tickets'], 'Put the orders next to the revenue': ['orders'], 'Move the revenue chart below the orders': ['revenueChart'], 'Show the chart for this week and move my tasks to the top': ['tasks'] }
const KEEP = {
  K1: (d) => L.choice(L.W.keep, L.W.keepCriteria(d)),
  K2: (d) => L.choice(`Consider this element on the current page: ${d}. Does user_request ask to take this element off the page (remove, delete, hide or drop it, or swap it for a different element)? Changing its settings (time range, filter, category, sort, number of rows) keeps it on the page.`, { keep: 'Keep it on the page (settings may change)', remove: 'Take this element off the page' }),
  K3: (d) => L.noul(`Does user_request ask to take this element off the page (remove, delete, hide or drop it, or swap it for a different element)? The element: ${d}. Changing its settings (time range, filter, category, sort, number of rows) keeps it on the page. Answer no for elements user_request does not mention.`),
  K4: (d) => L.choice(`Consider this element on the current page: ${d}. What does user_request ask to do with this element?`, { keep: 'Nothing, or change its settings (time range, filter, category, sort, number of rows); user_request does not ask to take this element off the page', remove: 'Take this element off the page: remove, delete, hide or drop it, or swap it for a different element' }),
}
const MOVE = {
  M1: (d) => L.noul(L.W.move(d)),
  M2: (d) => L.noul(`This element is on the current page: ${d}. Does user_request ask to move this element to another place (to the top, the bottom, above, below, next to or beside another element)? An element user_request names only as the reference point (the X in "next to X" or "below X") is not moved.`),
}
const score = {}
for (const [catalog, prev, prompt, want, accept] of EDIT_CASES) {
  if (accept) continue
  const layout = L.layoutOf(prev)
  const wantParts = new Set(L.leaves(L.layoutOf(want)).map((l) => l.node.part))
  const qs = {}
  const truth = {}
  for (const { key, node } of L.leaves(layout)) {
    const d = L.describeNode(catalog, node)
    for (const [v, f] of Object.entries(KEEP)) { qs[`${v}_${key}`] = f(d); truth[`${v}_${key}`] = !wantParts.has(node.part) }
    for (const [v, f] of Object.entries(MOVE)) { qs[`${v}_${key}`] = f(d); truth[`${v}_${key}`] = (MOVED[prompt] || []).includes(node.part) }
  }
  const r = await decideRaw(L.editState(catalog, layout, prompt), qs)
  for (const [k, a] of Object.entries(r.answers)) {
    const v = k.split('_')[0]
    const yes = a.type === 'noul' ? a.noul >= 0.5 : a.choice === 'remove'
    score[v] ??= { ok: 0, n: 0, fp: [], fn: [] }
    score[v].n++
    if (yes === truth[k]) score[v].ok++
    else (yes ? score[v].fp : score[v].fn).push(`${prompt} / ${layout.nodes[k.split('_')[1]].part}`)
  }
}
for (const [v, s] of Object.entries(score)) console.log(v, `${s.ok}/${s.n}`, '\n  false yes:', s.fp.join(' | '), '\n  false no:', s.fn.join(' | '))
