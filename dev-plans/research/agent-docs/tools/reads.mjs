#!/usr/bin/env node
// What agents opened in past eval runs (evals/agent-ergonomics/results/analysis/<run>.json,
// `skill.library.sygnal`: paths read under node_modules/sygnal, one entry per trial and path).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(here, '../../../../evals/agent-ergonomics/results/analysis')
const RUNS = [
  // skill trials, by model; the recent ones first
  'p9-final-opus', 'p6-final-opus', 'p6-final-sonnet', 'p6-final-haiku', 'p5-final-opus', 'p5-final-sonnet', 'p4-final6-opus', 'p46-ev-opus',
  // no skill: only llms.txt + the package
  'llms-ctx-new-noskill-sonnet', 'llms-ctx-old-noskill-sonnet', 'p9-no-skill-opus',
]
const CODE = /^dist\/(?!guide).*\.(?:m?js|cjs)$|^src\//
const out = ['| Run | Trials | Skill read | llms.txt | a topic file | a shipped guide | built JS or src | dist/index.d.ts | mean bytes read under the package |', '|---|---|---|---|---|---|---|---|---|']
const totals = { skill: { n: 0, code: 0, dts: 0, llms: 0 }, none: { n: 0, code: 0, dts: 0, llms: 0 } }
for (const r of RUNS) {
  const f = path.join(dir, `${r}.json`)
  if (!fs.existsSync(f)) continue
  const ts = JSON.parse(fs.readFileSync(f, 'utf8')).trials.filter((t) => t.arm === 'sygnal')
  const n = ts.length
  let skill = 0, llms = 0, topic = 0, guide = 0, code = 0, dts = 0, bytes = 0
  for (const t of ts) {
    const s = t.skill ?? {}
    if ((s.skillBytes ?? 0) > 0) skill++
    const files = [].concat(s.library?.sygnal ?? [])
    if (files.includes('llms.txt')) llms++
    if (files.some((x) => /^llms\/.+\.md$/.test(x))) topic++
    if (files.some((x) => /^dist\/guide\/.+\.md$/.test(x))) guide++
    if (files.some((x) => CODE.test(x))) code++
    if (files.includes('dist/index.d.ts')) dts++
    bytes += s.libraryBytes ?? 0
  }
  const p = (x) => `${x}/${n}`
  out.push(`| ${r} | ${n} | ${p(skill)} | ${p(llms)} | ${p(topic)} | ${p(guide)} | ${p(code)} | ${p(dts)} | ${Math.round(bytes / n / 100) / 10} KB |`)
  const g = /noskill|no-skill/.test(r) ? totals.none : totals.skill
  g.n += n; g.code += code; g.dts += dts; g.llms += llms
}
fs.writeFileSync(path.join(here, '../data/reads.md'), out.join('\n') + '\n')
console.log(out.join('\n'))
console.log(totals)
