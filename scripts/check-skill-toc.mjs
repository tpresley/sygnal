#!/usr/bin/env node
/**
 * PLAN-5 4-S (D226): fact coverage of the progressive-disclosure skill
 * (skills/sygnal-dev-toc: SKILL.md + references/*.md) against the single-file
 * skill (skills/sygnal-dev/SKILL.md).
 *
 * Every fact unit of the old skill must appear in the new one:
 *   - each fenced code block, exactly (after trimming trailing spaces);
 *   - each table row;
 *   - each prose line (paragraph or bullet). A line is found whole, or else
 *     each of its sentences must be found (a line split across files);
 *   - headings are reported as info only (they name a section, the facts are below them).
 * Section pointers are normalised on both sides: "§7" in the old skill and
 * "references/testing.md" / "section 3 below" in the new one both become "§".
 *
 * Usage: node scripts/check-skill-toc.mjs [--old <SKILL.md>] [--new <dir>] [--verbose] [--json]
 * Exit 1 when a fact unit is missing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const oldFile = path.resolve(repo, opt('--old', 'skills/sygnal-dev/SKILL.md'))
const newDir = path.resolve(repo, opt('--new', 'skills/sygnal-dev-toc'))
const verbose = args.includes('--verbose')
const asJson = args.includes('--json')

const norm = (s) => s
  .replace(/\[([^\]]*)\]\(references\/[\w-]+\.md\)/g, '§')   // markdown link to a reference
  .replace(/references\/[\w-]+\.md/g, '§')
  .replace(/section \d+ below/g, '§')
  .replace(/§\d+/g, '§')
  .replace(/\s+/g, ' ')
  .trim()

/** Units of a markdown file: { kind, text, line } */
function units(text) {
  const lines = text.split('\n')
  const out = []
  let i = 0
  if (lines[0] === '---') { i = lines.indexOf('---', 1) + 1 }   // frontmatter: compared separately
  for (; i < lines.length; i++) {
    const l = lines[i]
    const fence = l.match(/^(\s*)(`{3,}|~{3,})/)
    if (fence) {
      const start = i
      let j = i + 1
      while (j < lines.length && !lines[j].startsWith(fence[2])) j++
      out.push({ kind: 'code', text: lines.slice(start, j + 1).map((x) => x.trimEnd()).join('\n'), line: start + 1 })
      i = j
      continue
    }
    if (!l.trim()) continue
    if (/^#{1,6}\s/.test(l)) out.push({ kind: 'heading', text: l.replace(/^#+\s+/, '').replace(/^\d+\.\s+/, ''), line: i + 1 })
    else if (/^\|/.test(l)) { if (!/^\|[-| ]+\|$/.test(l)) out.push({ kind: 'row', text: l, line: i + 1 }) }
    else out.push({ kind: 'prose', text: l.replace(/^(\s*[-*]|\s*\d+\.)\s+/, ''), line: i + 1 })
  }
  return out
}

/** Sentences of a prose line, splitting only outside backtick spans. */
function sentences(s) {
  const out = []
  let cur = ''
  let tick = false
  for (let k = 0; k < s.length; k++) {
    const c = s[k]
    cur += c
    if (c === '`') tick = !tick
    if (!tick && /[.:;]/.test(c) && s[k + 1] === ' ' && /[A-Z`*(]/.test(s[k + 2] ?? '')) { out.push(cur.trim()); cur = '' }
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter((x) => x.length > 3)
}

// new skill corpus: per file, normalised text + line index for locations
const newFiles = []
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.md')) newFiles.push({ rel: path.relative(newDir, p), text: fs.readFileSync(p, 'utf8') })
  }
}
walk(newDir)
newFiles.sort((a, b) => (a.rel === 'SKILL.md' ? -1 : b.rel === 'SKILL.md' ? 1 : a.rel.localeCompare(b.rel)))
for (const f of newFiles) {
  f.lines = f.text.split('\n')
  f.normLines = f.lines.map(norm)
  f.norm = norm(f.text)
  f.raw = f.lines.map((x) => x.trimEnd()).join('\n')
}

function locate(u) {
  if (u.kind === 'code') {
    for (const f of newFiles) { const k = f.raw.indexOf(u.text); if (k >= 0) return `${f.rel}:${f.raw.slice(0, k).split('\n').length}` }
    return null
  }
  const needle = norm(u.text)
  for (const f of newFiles) {
    const li = f.normLines.findIndex((x) => x.includes(needle))
    if (li >= 0) return `${f.rel}:${li + 1}`
  }
  return null
}

const oldText = fs.readFileSync(oldFile, 'utf8')
const report = { found: [], split: [], missing: [], headings: { found: 0, missing: [] } }
for (const u of units(oldText)) {
  if (u.kind === 'heading') {
    if (locate(u)) report.headings.found++
    else report.headings.missing.push(`L${u.line}: ${u.text}`)
    continue
  }
  const loc = locate(u)
  if (loc) { report.found.push({ line: u.line, kind: u.kind, loc }); continue }
  if (u.kind === 'prose') {
    const parts = sentences(u.text).map((s) => ({ s, loc: locate({ kind: 'prose', text: s }) }))
    if (parts.every((p) => p.loc)) { report.split.push({ line: u.line, parts: [...new Set(parts.map((p) => p.loc))] }); continue }
    report.missing.push({ line: u.line, kind: u.kind, text: u.text.slice(0, 160), missingSentences: parts.filter((p) => !p.loc).map((p) => p.s) })
    continue
  }
  report.missing.push({ line: u.line, kind: u.kind, text: u.text.slice(0, 160) })
}

// frontmatter must be identical (same trigger), apart from nothing
const fm = (t) => (t.startsWith('---\n') ? t.slice(0, t.indexOf('\n---', 4) + 4) : '')
const newSkill = newFiles.find((f) => f.rel === 'SKILL.md')
report.frontmatterSame = fm(oldText) === fm(newSkill.text)

// sizes
const bytes = (t) => Buffer.byteLength(t)
report.sizes = {
  old: bytes(oldText),
  newSkillMd: bytes(newSkill.text),
  newTotal: newFiles.reduce((a, f) => a + bytes(f.text), 0),
  files: Object.fromEntries(newFiles.map((f) => [f.rel, bytes(f.text)])),
}

// reverse: new prose lines that are not from the old skill (navigation / additions)
const oldNorm = norm(oldText)
report.added = []
for (const f of newFiles) for (const u of units(f.text)) {
  if (u.kind === 'heading' || u.kind === 'code') continue
  const t = norm(u.text)
  if (!oldNorm.includes(t) && !sentences(u.text).every((s) => oldNorm.includes(norm(s)))) report.added.push(`${f.rel}:${u.line}: ${u.text.slice(0, 120)}`)
}

const total = report.found.length + report.split.length + report.missing.length
if (asJson) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`fact units in ${path.relative(repo, oldFile)}: ${total} (code blocks, table rows, prose lines)`)
  console.log(`  found whole: ${report.found.length}; split across files: ${report.split.length}; MISSING: ${report.missing.length}`)
  console.log(`  headings found: ${report.headings.found}${report.headings.missing.length ? `; not reused: ${report.headings.missing.length}` : ''}`)
  console.log(`  frontmatter identical: ${report.frontmatterSame ? 'yes' : 'NO'}`)
  console.log(`  sizes: old ${report.sizes.old} B; new SKILL.md ${report.sizes.newSkillMd} B; new total ${report.sizes.newTotal} B`)
  if (verbose) {
    for (const r of report.found) console.log(`  L${r.line} ${r.kind} -> ${r.loc}`)
    for (const r of report.split) console.log(`  L${r.line} split -> ${r.parts.join(', ')}`)
    for (const h of report.headings.missing) console.log(`  heading not reused: ${h}`)
  }
  for (const r of report.split) if (!verbose) console.log(`  split: L${r.line} -> ${r.parts.join(', ')}`)
  for (const m of report.missing) console.log(`  MISSING L${m.line} (${m.kind}): ${m.text}${m.missingSentences ? `\n    sentences not found: ${JSON.stringify(m.missingSentences)}` : ''}`)
  console.log(`  lines in the new skill not in the old one (navigation/additions): ${report.added.length}`)
  for (const a of report.added) console.log(`    + ${a}`)
}
process.exit(report.missing.length || !report.frontmatterSame ? 1 : 0)
