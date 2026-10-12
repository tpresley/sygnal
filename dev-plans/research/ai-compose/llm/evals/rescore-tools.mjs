// Re-reads the recorded tool-call arguments (results/tools.jsonl) through the current readLayout (no model calls).
import { readFileSync } from 'node:fs'
import { readLayout, layoutToString, checkSchema, layoutSchema } from '../llm-composer.mjs'
const { INTERACT_CATALOG: INTERACT, SCENARIOS, fit } = await import('./tools-data.mjs')
const schema = layoutSchema(INTERACT, 'tree')
const rows = readFileSync(new URL('./results/tools.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const by = {}
for (const r of rows) {
  if (!r.mode.startsWith('tool-')) continue
  const s = SCENARIOS.find((x) => x.id === r.id)
  const g = (by[r.mode] ||= { should: 0, called: 0, valid: 0, fit: 0, n: 0 })
  if (s.call === true) g.should++
  if (!r.called) continue
  g.n++
  const args = r.mode === 'tool-intent' ? Object.fromEntries(Object.entries(r.args || {}).filter(([k]) => k !== 'need')) : r.args
  if (checkSchema(schema, args).length === 0) g.valid++
  const { layout, issues } = readLayout(INTERACT, 'tree', args)
  const f = s.call !== false && fit(s, layout)
  if (s.call === true && f) g.fit++
  console.error(r.mode, r.id, layoutToString(layout), f, issues.map((i) => i.kind).join(','))
}
for (const [m, g] of Object.entries(by)) console.log(`| qwen3:8b ${m} (re-read with alias repair) | valid as emitted ${g.valid}/${g.n} | fit ${g.fit}/${g.should} |`)
