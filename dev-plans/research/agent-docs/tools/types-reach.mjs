#!/usr/bin/env node
// How much of the option / API reference in the context could live in the type declarations
// instead (dev-plans/research/agent-docs)? For each sentence of a kind-b paragraph: its backticked
// API names, whether dist/index.d.ts (or a subpath's .d.ts) already declares them, and whether a
// JSDoc comment explains them. A sentence is "movable" when it is an option list: at least three
// names, at least 80% of them declared. What cannot move is the prose about behaviour.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paragraphs, sentences } from './audit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const labels = JSON.parse(fs.readFileSync(path.join(here, '../data/labels.json'), 'utf8'))
const dts = fs.readdirSync(path.join(repo, 'src')).filter((f) => f.endsWith('.d.ts')).map((f) => fs.readFileSync(path.join(repo, 'src', f), 'utf8')).join('\n')
const jsdoc = [...dts.matchAll(/\/\*\*[\s\S]*?\*\//g)].map((m) => m[0]).join('\n')
const STOP = new Set('state data true false null undefined string number function return const props next event value name key url this type fn int any new'.split(' '))
const names = (s) => [...new Set([...s.matchAll(/`([^`]+)`/g)].flatMap((m) => [...m[1].matchAll(/[A-Za-z_$][\w$]{2,}/g)].map((x) => x[0])).filter((n) => !STOP.has(n)))]
const has = (hay, n) => new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(hay)

function measure(rel) {
  const kindAt = (line) => labels[rel].find(([a, b]) => line >= a && line <= b)[2]
  let b = 0, movable = 0, movableJs = 0, opt = 0, nameCount = 0, decl = 0, doc = 0
  const samples = []
  for (const p of paragraphs(rel)) {
    if (p.code || kindAt(p.line) !== 'b') continue
    for (const s of sentences(p.text)) {
      const sb = Buffer.byteLength(s)
      b += sb
      const ns = names(s)
      nameCount += ns.length
      const inD = ns.filter((n) => has(dts, n))
      const inJ = ns.filter((n) => has(jsdoc, n))
      decl += inD.length; doc += inJ.length
      if (ns.length >= 3 && inD.length / ns.length >= 0.8) { movable += sb; opt++; if (inJ.length / ns.length >= 0.8) movableJs += sb; else samples.push([p.line, ns.filter((n) => !has(jsdoc, n)).slice(0, 6), s.slice(0, 80)]) }
    }
  }
  return { rel, bBytes: b, names: nameCount, declared: decl, inJsdoc: doc, optionSentences: opt, movable, movableJs, samples: samples.slice(0, 12) }
}
for (const r of ['llms.txt', 'skills/sygnal-dev/SKILL.md']) {
  const m = measure(r)
  console.log(`${m.rel}: kind-b prose ${m.bBytes} B · API names ${m.names}, declared in .d.ts ${m.declared} (${Math.round((m.declared / m.names) * 100)}%), named in a JSDoc ${m.inJsdoc} (${Math.round((m.inJsdoc / m.names) * 100)}%) · option-list sentences ${m.optionSentences}: ${m.movable} B movable, ${m.movableJs} B of it already explained by JSDoc`)
  for (const s of m.samples) console.log('   needs JSDoc', s[0], s[1].join(','), '|', s[2])
}
