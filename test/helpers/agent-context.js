// The agent context as one text per audience (dev-plans/research/llms-context): a fact may sit
// in the core or in a topic file, so fragment tests read the whole set.
//   llms:  llms-full.txt (llms.txt + llms/<topic>.md, generated; test/llms-txt.test.js keeps it current)
//   skill: skills/sygnal-dev/SKILL.md + its references/<topic>.md
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8')

export const llmsText = () => read('llms-full.txt')

export function skillText() {
  const dir = path.join(repo, 'skills/sygnal-dev/references')
  const refs = fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => read(`skills/sygnal-dev/references/${f}`)) : []
  return [read('skills/sygnal-dev/SKILL.md'), ...refs].join('\n')
}
