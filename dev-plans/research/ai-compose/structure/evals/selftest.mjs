// offline: notation round trip, and an oracle decide() that answers every question from the expected
// layout; the composer must then rebuild the expected layout exactly (checks the reading code).
import { CATALOGS } from './catalogs.mjs'
import { compose, format, parse, places } from '../composer.mjs'
let bad = 0
for (const c of Object.values(CATALOGS)) for (const [prompt, want] of c.cases) {
  const w = parse(want)
  if (format(w) !== want.replace(/\s+/g, ' ').trim()) { bad++; console.log('roundtrip', want, format(w)) }
  // oracle
  const pl = places(w)
  const leafOrder = []
  const walk = (k) => { const n = w.nodes[k]; if (!n.slots) leafOrder.push(n.part); else for (const l of Object.values(n.slots)) l.forEach(walk) }
  if (w) walk(w.root)
  const counts = {}; leafOrder.forEach((p) => (counts[p] = (counts[p] || 0) + 1))
  const keyOf = (() => { const seen = {}; return leafOrder.map((p) => { seen[p] = (seen[p] || 0) + 1; return seen[p] > 1 ? `${p}__${seen[p]}` : p }) })()
  const pos = Object.fromEntries(keyOf.map((k, i) => [k, i]))
  const placeOf = (k) => { const p = k.split('__')[0], n = Number(k.split('__')[1] || 1); return pl[n > 1 ? `${p}#${n}` : p] }
  const oracle = async (state, qs) => {
    const answers = {}
    for (const [name, q] of Object.entries(qs)) {
      const ch = (choice) => ({ type: 'choice', choice, probabilities: { [choice]: 1 } })
      if (name === 'row') answers[name] = { type: 'noul', noul: /row\(/.test(want) ? 1 : 0 }
      else if (name.startsWith('use_')) answers[name] = ch(counts[name.slice(4)] ? 'use' : 'omit')
      else if (name.startsWith('count_')) answers[name] = ch(String(counts[name.slice(6)] || 0))
      else if (name.startsWith('pick_')) answers[name] = ch(Object.keys(q.criteria).find((k) => counts[k]) || 'omit')
      else if (name.startsWith('cat_')) answers[name] = ch(c.parts.some((p) => p.category === name.slice(4) && counts[p.id]) ? 'use' : 'omit')
      else if (name.startsWith('parent_')) {
        const k = name.slice(7); const path = placeOf(k) ?? ''
        // deepest named container segment in the path
        const segs = path.split('/').filter((s) => !s.startsWith('row('))
        const last = segs[segs.length - 1]
        let dest = last.includes(':') ? last : `${last}:default`
        if (!(dest in q.criteria)) {
          // the expected tree unwrapped a container (minSlots): any slot of the original is fine; pick by tab descriptions is impossible offline → first
          dest = Object.keys(q.criteria).find((d) => d.startsWith(last)) || Object.keys(q.criteria)[0]
        }
        answers[name] = ch(dest)
      } else if (name.startsWith('beside_')) {
        const k = name.slice(7); const path = placeOf(k) || ''
        const m = path.match(/row\(([^)]*)\)$/)
        const mates = m ? m[1].split(',').filter((x) => x !== k) : []
        answers[name] = ch(mates.find((x) => x in q.criteria) || 'none')
      } else if (name.startsWith('together_')) {
        const [a, b] = name.slice(9).split('_vs_')
        const ra = (placeOf(a) || '').match(/row\(([^)]*)\)$/), rb = (placeOf(b) || '').match(/row\(([^)]*)\)$/)
        answers[name] = { type: 'noul', noul: ra && rb && ra[0] === rb[0] && placeOf(a) === placeOf(b) ? 1 : 0 }
      } else if (name.startsWith('gap_')) {
        const [x, id] = name.slice(4).split('_in_')
        const g = keyOf.filter((k) => k.split('__')[0] === id && pos[k] < pos[x]).length
        answers[name] = { type: 'choice', choice: String(g), probabilities: { [g]: 1 } }
      } else if (name.startsWith('first_')) {
        const [a, b] = Object.keys(q.criteria)
        answers[name] = { type: 'choice', choice: pos[a] < pos[b] ? a : b, probabilities: { [a]: pos[a] < pos[b] ? 1 : 0, [b]: pos[a] < pos[b] ? 0 : 1 } }
      }
    }
    return { answers }
  }
  const out = await compose(c, prompt, oracle, { prefilter: !!c.categories })
  if (format(out.layout) !== format(w)) { bad++; console.log(`oracle [${c.id}] ${prompt}\n  got  ${format(out.layout)}\n  want ${format(w)}`) }
}
console.log(bad ? `${bad} failures` : 'selftest ok')
