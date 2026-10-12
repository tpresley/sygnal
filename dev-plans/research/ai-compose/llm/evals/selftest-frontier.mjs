// perfect answers built from the expectations → score-frontier must print every case exact
import { readFileSync, writeFileSync } from 'node:fs'
import { layoutToReply, stringToLayout } from '../llm-composer.mjs'
import { allSets } from './sets.mjs'
const pack = JSON.parse(readFileSync(new URL('../frontier/pack.json', import.meta.url)))
const byId = {}
for (const s of await allSets()) for (const k of s.cases) byId[k.id] = k
const answers = pack.cases.map((c) => {
  const k = byId[c.id]
  const reply = layoutToReply(stringToLayout(c.expected), pack.encoding, k.catalog)
  if (c.text) for (const [path, v] of Object.entries(c.text)) {
    const [part, param] = path.split('.')
    const visit = (n) => { if (n.part === part) n.params = { ...(n.params || {}), [param]: v }; (n.children || []).forEach(visit) }
    reply.children.forEach(visit)
  }
  return { id: c.id, output: JSON.stringify({ asked_for: [], ...reply }) }
})
writeFileSync(new URL('../logs/perfect-answers.json', import.meta.url), JSON.stringify({ answers }))
