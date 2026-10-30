#!/usr/bin/env node
// Agent context (dev-plans/research/llms-context): `llms.txt` is the core and `llms/<topic>.md`
// the topic files it lists under "## Topic files"; both are hand-written sources. This script
// writes every copy from them:
//   - docs/public/llms.txt, docs/public/llms/<topic>.md   the docs site (sygnal.js.org/llms.txt)
//   - llms-full.txt, docs/public/llms-full.txt            the core + every topic, in index order
//   - skills/sygnal-dev/references/<topic>.md             the skill's references (same files)
// `--check` writes nothing and exits 1 when a copy is stale (test/llms-txt.test.js runs it).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8')

/** Topic names in the order the core's index lists them. */
export function topics() {
  const core = read('llms.txt')
  const index = core.slice(core.indexOf('\n## Topic files'), core.indexOf('\n## 1.'))
  return [...index.matchAll(/^- \[llms\/([\w-]+)\.md\]\(llms\/\1\.md\)/gm)].map((m) => m[1])
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
    for (const dir of ['docs/public/llms', 'skills/sygnal-dev/references']) fs.rmSync(path.join(repo, dir), { recursive: true, force: true })
    for (const { rel, text } of outputs()) {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
      fs.writeFileSync(path.join(repo, rel), text)
    }
    console.log(`wrote ${outputs().length} files (${topics().length} topics)`)
  }
}
