#!/usr/bin/env node
// No fact lost: every paragraph of today's llms.txt must be covered (8-word shingles) by the
// compact core plus its on-demand files. Paragraphs under the threshold are listed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paragraphs } from './audit.mjs'
const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, '../candidates/compact-core')
const all = fs.readFileSync(path.join(dir, 'llms.txt'), 'utf8') + '\n' + fs.readdirSync(path.join(dir, 'llms')).map((f) => fs.readFileSync(path.join(dir, 'llms', f), 'utf8')).join('\n')
const words = (s) => s.replace(/\s+/g, ' ').trim().split(' ')
const grams = (w, n = 8) => { const o = []; for (let i = 0; i + n <= w.length; i++) o.push(w.slice(i, i + n).join(' ')); return o }
const have = new Set(grams(words(all)))
let lost = 0
for (const p of paragraphs('llms.txt')) {
  const g = grams(words(p.text))
  if (!g.length) continue
  const hit = g.filter((x) => have.has(x)).length / g.length
  if (hit < 0.9) { lost += Buffer.byteLength(p.text) * (1 - hit); console.log(`${p.line}\t${Math.round(hit * 100)}%\t${Buffer.byteLength(p.text)} B\t${p.text.split('\n')[0].slice(0, 90)}`) }
}
console.log('uncovered bytes ≈', Math.round(lost))
