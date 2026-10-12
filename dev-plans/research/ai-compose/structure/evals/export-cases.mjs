// Writes evals/cases.json: every catalog (plain data) with its labelled cases, the expected layout both
// in the compact notation and in the shared layout format (null = nothing in the catalog fits).
import { writeFileSync } from 'node:fs'
import { CATALOGS } from './catalogs.mjs'
import { parse } from '../composer.mjs'

const out = {
  format: 'layout: { root, nodes: { key: { part, slots? } } }; part "row" = side-by-side container; null = nothing fits',
  catalogs: Object.fromEntries(Object.entries(CATALOGS).map(([id, { cases, ...catalog }]) => [id, {
    catalog,
    cases: cases.map(([prompt, expected]) => ({ prompt, expected, layout: parse(expected) })),
  }])),
}
writeFileSync(new URL('./cases.json', import.meta.url), JSON.stringify(out, null, 1))
console.log(Object.entries(out.catalogs).map(([k, v]) => `${k}: ${v.catalog.parts.length} parts, ${v.cases.length} cases`).join('\n'))
