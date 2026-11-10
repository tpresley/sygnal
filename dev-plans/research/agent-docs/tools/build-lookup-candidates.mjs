#!/usr/bin/env node
// Builds the lookup candidates from the measured compact ones (which stay as they are, so earlier
// runs remain comparable): the compact core and compact skill with their "not shown here" row
// pointing at `sygnal-check docs` or at the greppable reference, and that reference generated
// against the compact topic set, since those are the files its "Read:" lines must name.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { outputs } from '../../../../scripts/build-reference.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '../candidates')
const OLD_ROW = '| a prop, option or field not shown here | `llms/api-facts.md`, or grep the name in `dist/index.d.ts` | one symbol, not the whole file |'
const OLD_SKILL_ROW = OLD_ROW.replace('llms/api-facts.md', 'references/api-facts.md')
const ROWS = {
  lookup: '| a prop, option, signature, source or sink not shown here | `npx --no-install sygnal-check docs <name>` (`FetchRequest`, `App.resources`, `latest`, `HTTP`) | not `dist/*` |',
  grep: "| a prop, option, signature, source or sink not shown here | `grep -A14 -E '^## (.*\\.)?NAME$' dist/reference.md` | not `dist/*.js`, `index.d.ts` |",
}

function swap(text, from, to, where) {
  if (!text.includes(from)) throw new Error(`no row to replace in ${where}`)
  return text.replace(from, () => to)
}
function copyDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true })
  fs.cpSync(from, to, { recursive: true })
}
const core = fs.readFileSync(path.join(out, 'compact-core/llms.txt'), 'utf8')
for (const [name, row] of Object.entries(ROWS)) {
  const dir = path.join(out, `compact-${name}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'llms.txt'), swap(core, OLD_ROW, row, 'the core'))
  const skillDir = path.join(out, `compact-${name}-skill`)
  copyDir(path.join(out, 'compact-skill'), skillDir)
  const skill = path.join(skillDir, 'SKILL.md')
  fs.writeFileSync(skill, swap(fs.readFileSync(skill, 'utf8'), OLD_SKILL_ROW, row, 'the skill'))
}
// The sentence alone, no lookup: no "grep index.d.ts" and the "not dist/*" cell the CLI row carries. Core only.
const SENTENCE_ROW = '| a prop, option or field not shown here | `llms/api-facts.md` | not `dist/*` |'
fs.mkdirSync(path.join(out, 'compact-sentence'), { recursive: true })
fs.writeFileSync(path.join(out, 'compact-sentence/llms.txt'), swap(core, OLD_ROW, SENTENCE_ROW, 'the core'))
const files = outputs(path.join(out, 'compact-core'), path.join(out, 'reference-compact'))
for (const f of files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text) }
for (const n of ['compact-core/llms.txt', 'compact-sentence/llms.txt', 'compact-lookup/llms.txt', 'compact-grep/llms.txt', 'compact-skill/SKILL.md', 'compact-lookup-skill/SKILL.md', 'compact-grep-skill/SKILL.md', 'reference-compact/reference.json', 'reference-compact/reference.md']) console.log(n, fs.statSync(path.join(out, n)).size)
