#!/usr/bin/env node
// Audit of what the agent context spends its bytes on (dev-plans/research/agent-docs).
// Paragraph = a fenced code block, a bullet, a heading or a run of body text. Each gets the hand
// label from data/labels.json; each sentence of a prose paragraph is then moved to c (a trap: it
// names a SYG code, or starts with never / don't / not) or d (a version note) or e (names a
// non-core subpath) where its own text says so. Writes data/audit.json and prints the tables.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const labels = JSON.parse(fs.readFileSync(path.join(here, '../data/labels.json'), 'utf8'))
export const KINDS = { a: 'mental model, canonical forms', b: 'option / API reference', c: 'trap warnings', d: 'migration / version', e: 'non-core subpaths', f: 'testing', n: 'navigation' }
const bytes = (s) => Buffer.byteLength(s)
const TOK = 3.6 // bytes per token, measured with cl100k_base on these files (llms-context README)

const SUBPATH = /sygnal\/(?:api|replay|sandbox|worker|yjs|canvas|three|terminal|react-native|agent-ui|primitives|host)\b|llms\/(?:graphics|typed-apis|collaboration|renderers|sandbox|replay)\.md|references\/(?:graphics|typed-apis|collaboration|renderers|sandbox|replay)\.md/
const VERSION = /Sygnal 6\b|\b6\.x\b|Upgrading|migrating-to-|before 7|for 6 and 7|code for 6|Sygnal 7\)|timing audit|SYG257|SYG454|SYG612/
const TRAP = /SYG\d{3}|^\W*(?:\*\*)?(?:never|don't|do not|not )\b/i

export function paragraphs(rel) {
  const lines = fs.readFileSync(path.join(repo, rel), 'utf8').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.trim() === '') { i++; continue }
    const start = i
    if (l.startsWith('```')) {
      i++
      while (i < lines.length && !lines[i].startsWith('```')) i++
      i++
      out.push({ line: start + 1, code: true, text: lines.slice(start, i).join('\n') })
      continue
    }
    i++
    out.push({ line: start + 1, code: false, text: l })
  }
  return out
}

const kindAt = (rel, line) => {
  const r = labels[rel].find(([a, b]) => line >= a && line <= b)
  if (!r) throw new Error(`${rel}:${line} has no label`)
  return r[2]
}

/** Sentences: split after . ; or : when a capital, a backtick or ** follows; never inside code spans. */
export function sentences(text) {
  const parts = []
  let cur = '', tick = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    cur += ch
    if (ch === '`') tick = !tick
    if (!tick && /[.;]/.test(ch) && /\s/.test(text[i + 1] ?? '') && /[A-Z`*]/.test(text[i + 2] ?? '')) { parts.push(cur); cur = '' }
  }
  if (cur) parts.push(cur)
  return parts
}

export function audit(rel) {
  const totals = Object.fromEntries(Object.keys(KINDS).map((k) => [k, { para: 0, refined: 0 }]))
  const rows = []
  for (const p of paragraphs(rel)) {
    const kind = kindAt(rel, p.line)
    const b = bytes(p.text) + 1
    totals[kind].para += b
    const row = { line: p.line, kind, bytes: b, moved: {} }
    if (p.code || kind === 'n' || kind === 'e') totals[kind].refined += b
    else {
      for (const s of sentences(p.text)) {
        const sb = bytes(s) + 0
        const to = VERSION.test(s) ? 'd' : SUBPATH.test(s) ? 'e' : kind !== 'c' && kind !== 'f' && TRAP.test(s) ? 'c' : kind === 'f' && /SYG\d{3}/.test(s) ? 'c' : kind
        totals[to].refined += sb
        if (to !== kind) row.moved[to] = (row.moved[to] ?? 0) + sb
      }
      totals[kind].refined += b - bytes(p.text) // the newline
    }
    row.head = p.text.split('\n')[0].slice(0, 70)
    rows.push(row)
  }
  return { rel, total: bytes(fs.readFileSync(path.join(repo, rel), 'utf8')), totals, rows }
}

// ---- duplication between llms.txt and the skill
const norm = (s) => s.replace(/\s+/g, ' ').trim()
function grams(text, n = 8) {
  const w = norm(text).split(' ')
  const out = new Set()
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '))
  return out
}
export function duplication(aRel, bRel) {
  const A = paragraphs(aRel), B = paragraphs(bRel)
  const gA = new Set(A.flatMap((p) => [...grams(p.text)])), gB = new Set(B.flatMap((p) => [...grams(p.text)]))
  const covered = (ps, other) => {
    let dup = 0, total = 0, code = 0, codeDup = 0
    const perPara = []
    for (const p of ps) {
      const g = [...grams(p.text)]
      const hit = g.length ? g.filter((x) => other.has(x)).length / g.length : 0
      const b = bytes(p.text) + 1
      total += b; dup += b * hit
      if (p.code) { code += b; codeDup += b * hit }
      perPara.push({ line: p.line, bytes: b, hit: Math.round(hit * 100) })
    }
    return { total, dupBytes: Math.round(dup), dupPct: Math.round((dup / total) * 100), code, codeDup: Math.round(codeDup), perPara }
  }
  return { a: covered(A, gB), b: covered(B, gA) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = ['llms.txt', 'skills/sygnal-dev/SKILL.md']
  const res = files.map(audit)
  const dup = duplication(...files)
  fs.writeFileSync(path.join(here, '../data/audit.json'), JSON.stringify({ audits: res, dup: { a: { ...dup.a, perPara: undefined }, b: { ...dup.b, perPara: undefined } }, perPara: { llms: dup.a.perPara, skill: dup.b.perPara } }, null, 0))
  for (const r of res) {
    console.log(`\n${r.rel}: ${r.total} B ≈ ${Math.round(r.total / TOK)} tok`)
    console.log('kind | by paragraph | sentence-refined | %')
    for (const k of Object.keys(KINDS)) console.log(`${k} ${KINDS[k]} | ${r.totals[k].para} | ${r.totals[k].refined} | ${Math.round((r.totals[k].refined / r.total) * 100)}%`)
    const sum = Object.values(r.totals).reduce((s, x) => s + x.refined, 0)
    console.log(`sum refined ${sum} (the rest is blank lines)`)
  }
  console.log('\nduplication (8-word shingles)')
  console.log('llms.txt found in SKILL:', dup.a.dupBytes, `${dup.a.dupPct}% of`, dup.a.total, 'code:', dup.a.codeDup, '/', dup.a.code)
  console.log('SKILL found in llms.txt:', dup.b.dupBytes, `${dup.b.dupPct}% of`, dup.b.total, 'code:', dup.b.codeDup, '/', dup.b.code)
}
