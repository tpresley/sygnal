#!/usr/bin/env node
// Builds the generated halves of the candidates (dev-plans/research/agent-docs):
//   - candidates/compact-core/llms/<topic>.md: every paragraph that left the compact core, moved
//     verbatim from the repository's llms.txt by line range, plus the existing topic files, so
//     no fact is lost: the core shrinks, the corpus does not.
//   - candidates/compact-skill/: the skill as frontmatter + the compact core + the same topics
//     as references, so the skill and llms.txt stop being two hand-kept copies.
// The compact core itself (candidates/compact-core/llms.txt) and the AGENTS.md index are written
// by hand. Line ranges are of llms.txt at commit ff281f3c.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const out = path.join(here, '../candidates')
const SNAPSHOT = 'ff281f3c'
const lines = spawnSync('git', ['-C', repo, 'show', `${SNAPSHOT}:llms.txt`], { encoding: 'utf8' }).stdout.split('\n')
const take = (a, b = a) => lines.slice(a - 1, b).join('\n')

const header = (title) => `# Sygnal: ${title}\n\nIt assumes the core (\`llms.txt\`).\n\n`
const TOPICS = {
  testing: ['testing: the full reference', [[319, 328]]],
  http: ['HTTP requests', [[182, 184]]],
  resources: ['resources and the query cache', [[225, 232]]],
  sockets: ['WebSocket and SSE', [[209, 209]]],
  router: ['router and HEAD', [[258, 267]]],
  forms: ['forms', [[141, 146]]],
  behaviors: ['behaviors', [[137, 139]]],
  commands: ['commands, ELEMENT, timers, persistence', [[148, 151]]],
  widgets: ['third-party widgets and web components', [[153, 157]]],
  'api-facts': ['more API facts', [[52, 52], [55, 55], [135, 135], [273, 277], [280, 283]]],
  diagnostics: ['wiring rules and diagnostics in full', [[288, 294], [297, 301]]],
  details: ['what the core shortened, in full', [[3, 3], [20, 23], [51, 51], [53, 54], [269, 270], [278, 279], [284, 285]]],
  examples: ['the full canonical examples', [[59, 86], [88, 105], [159, 181], [186, 208], [234, 264], [304, 318]]],
}
// Lines 258-264 are the middle of a fenced block in llms.txt; the router topic gets the whole
// App.model and TaskPage.model fence so guards and leave prompts read as code.
const FENCED = { router: '```jsx\n' + take(236, 239) + '\n' + take(241, 241) + '\n' + take(252, 263) + '\n```\n' }

const compact = path.join(out, 'compact-core')
fs.mkdirSync(path.join(compact, 'llms'), { recursive: true })
for (const [name, [title, ranges]] of Object.entries(TOPICS)) {
  const body = ranges.map(([a, b]) => take(a, b)).join('\n')
  const clean = name === 'router' ? FENCED.router + take(265, 267) : body
  fs.writeFileSync(path.join(compact, 'llms', `${name}.md`), header(title) + clean + '\n')
}
for (const f of fs.readdirSync(path.join(repo, 'llms'))) fs.copyFileSync(path.join(repo, 'llms', f), path.join(compact, 'llms', f))

// The skill: same bytes, a frontmatter, and references/ in place of llms/.
const skill = path.join(out, 'compact-skill')
fs.rmSync(skill, { recursive: true, force: true })
fs.mkdirSync(path.join(skill, 'references'), { recursive: true })
const front = fs.readFileSync(path.join(repo, 'skills/sygnal-dev/SKILL.md'), 'utf8').match(/^---\n[\s\S]*?\n---\n/)[0]
const core = fs.readFileSync(path.join(compact, 'llms.txt'), 'utf8')
fs.writeFileSync(path.join(skill, 'SKILL.md'), front + '\n' + core.replace(/`llms\/([\w-]+)\.md`/g, '`references/$1.md`').replace('The file names are under `node_modules/sygnal/`.', 'The `references/` files sit next to this file; `dist/` is under `node_modules/sygnal/`.'))
for (const f of fs.readdirSync(path.join(compact, 'llms'))) fs.copyFileSync(path.join(compact, 'llms', f), path.join(skill, 'references', f))
console.log('built', Object.keys(TOPICS).length, 'moved topics;', fs.readdirSync(path.join(compact, 'llms')).length, 'on-demand files')
