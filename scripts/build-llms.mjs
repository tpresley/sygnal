#!/usr/bin/env node
// Agent context (dev-plans/research/llms-context, compacted by dev-plans/research/agent-docs):
// `llms.txt` is the core and `llms/<topic>.md` the topic files its "Read before you write"
// section names; both are hand-written sources. This script writes every copy from them:
//   - docs/public/llms.txt, docs/public/llms/<topic>.md   the docs site (sygnal.js.org/llms.txt)
//   - llms-full.txt, docs/public/llms-full.txt            the core + every topic, in index order
//   - skills/sygnal-dev/SKILL.md                          the skill: its hand-written frontmatter + the core,
//                                                         with `llms/<topic>.md` read as `references/<topic>.md`
//   - skills/sygnal-dev/references/<topic>.md             the skill's references (same files)
// `--check` writes nothing and exits 1 when a copy is stale (test/llms-txt.test.js runs it).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8')

const SKILL = 'skills/sygnal-dev/SKILL.md'
// Where the files are, said once in the core; the skill's references sit next to it instead.
const WHERE = 'The file names are under `node_modules/sygnal/`.'
const SKILL_WHERE = 'The `references/` files sit next to this file; `dist/` is under `node_modules/sygnal/`.'

/** Topic names in the order the core's "Read before you write" section first names them. */
export function topics() {
  const core = read('llms.txt')
  const index = core.slice(core.indexOf('\n## Read before you write'), core.indexOf('\n## 1.'))
  return [...new Set([...index.matchAll(/`llms\/([\w-]+)\.md`/g)].map((m) => m[1]))]
}

/** The skill: the frontmatter kept from the current SKILL.md (hand-written), then the core. */
export function skill(core = read('llms.txt')) {
  const front = read(SKILL).match(/^---\n[\s\S]*?\n---\n/)
  if (!front) throw new Error(`${SKILL} has no frontmatter`)
  if (!core.includes(WHERE)) throw new Error(`llms.txt no longer says "${WHERE}": update scripts/build-llms.mjs`)
  return front[0] + '\n' + core.replace(/`llms\/([\w-]+)\.md`/g, '`references/$1.md`').replace(WHERE, SKILL_WHERE)
}

/** Every generated file: { rel, text }. */
export function outputs() {
  const core = read('llms.txt')
  const names = topics()
  const files = names.map((n) => ({ n, text: read(`llms/${n}.md`) }))
  const full = [core.replace(/\n*$/, '\n'), ...files.map((f) => f.text.replace(/\n*$/, '\n'))].join('\n')
  return [
    { rel: 'docs/public/llms.txt', text: core },
    { rel: 'llms-full.txt', text: full },
    { rel: 'docs/public/llms-full.txt', text: full },
    { rel: SKILL, text: skill(core) },
    ...files.map((f) => ({ rel: `docs/public/llms/${f.n}.md`, text: f.text })),
    ...files.map((f) => ({ rel: `skills/sygnal-dev/references/${f.n}.md`, text: f.text })),
  ]
}

/** Paths whose copy is missing or differs, plus copies of topics no longer listed. */
export function stale() {
  const out = outputs()
  const bad = out.filter(({ rel, text }) => !fs.existsSync(path.join(repo, rel)) || read(rel) !== text).map((o) => o.rel)
  const want = new Set(out.map((o) => o.rel))
  for (const dir of ['docs/public/llms', 'skills/sygnal-dev/references']) {
    if (!fs.existsSync(path.join(repo, dir))) continue
    for (const f of fs.readdirSync(path.join(repo, dir))) if (!want.has(`${dir}/${f}`)) bad.push(`${dir}/${f} (not listed)`)
  }
  return bad
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = stale()
    if (bad.length) {
      console.error(`stale agent-context copies (run node scripts/build-llms.mjs):\n  ${bad.join('\n  ')}`)
      process.exit(1)
    }
    console.log('agent-context copies are up to date')
  } else {
    const out = outputs()   // read SKILL.md's frontmatter before anything is rewritten
    for (const dir of ['docs/public/llms', 'skills/sygnal-dev/references']) fs.rmSync(path.join(repo, dir), { recursive: true, force: true })
    for (const { rel, text } of out) {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
      fs.writeFileSync(path.join(repo, rel), text)
    }
    console.log(`wrote ${out.length} files (${topics().length} topics)`)
  }
}
