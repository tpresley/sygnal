#!/usr/bin/env node
/**
 * Extract the JS/JSX/TS/TSX code samples from the docs site and run
 * `sygnal-check --strict` on them, so the docs only show canonical forms
 * (dev-plans/PLAN-1-canonical-forms.md).
 *
 * Every fenced ```js / ```jsx / ```ts / ```tsx / ```javascript / ```typescript
 * block (``` or ~~~ fences, three or more) in docs/src/content/docs/**\/*.md(x)
 * and in the other agent-facing files (EXTRA_FILES: llms.txt, the sygnal-dev
 * skill, the create-sygnal-app AGENTS.md files) is written to its own file in a
 * temp directory (or --out <dir>), then sygnal-check runs on that directory
 * with --strict --a11y=error --json. Samples are fragments, so only the
 * strict-mode codes (SYG5xx) and the a11y lane (SYG7xx, PLAN-4 GS-3: the
 * a11y-clean gate) fail the run. The a11y lane is a warning under --strict
 * (D144); this gate fails on any 7xx finding whatever its severity; other findings (SYG101/102/105/110 on half a component) are listed
 * with --verbose. A11Y_PENDING lists a11y findings in files another workstream
 * owns, until it fixes them: they are printed but don't fail the run (an entry
 * whose finding is gone is reported as stale).
 *
 * Pages and blocks that are excluded on purpose:
 *   - the "Alternative forms" page (it shows the non-canonical forms);
 *   - reference/errors.md (generated; its "before" examples are wrong on purpose);
 *   - a block whose first line is a `// docs-check: skip` comment, or which is
 *     preceded by an `<!-- docs-check: skip -->` HTML comment.
 *
 * Usage: node scripts/check-doc-samples.mjs [--verbose] [--out <dir>]
 * Exit code 1 when a strict (SYG5xx) or a11y (SYG7xx) finding exists.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = path.join(repo, 'docs/src/content/docs')
const checker = path.join(repo, 'sygnal-check/bin/sygnal-check.js')

const EXCLUDED_PAGES = new Set(['advanced/alternative-forms.md', 'reference/errors.md'])
// Agent-facing files outside the docs site, relative to the repo root (3E/R10)
const EXTRA_FILES = [
  'llms.txt',
  'skills/sygnal-dev/SKILL.md',
  ...fs.readdirSync(path.join(repo, 'create-sygnal-app'), { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('template-'))
    .map(e => `create-sygnal-app/${e.name}/AGENTS.md`)
    .filter(f => fs.existsSync(path.join(repo, f)))
    .sort(),
]
// a11y findings (sample id → code) in agent-facing files PLAN-4 2-D may not edit
// (llms.txt, the skill: 4-A's); they print as PENDING and don't fail the run.
const A11Y_PENDING = new Map([])
const LANGS = { js: 'jsx', javascript: 'jsx', jsx: 'jsx', ts: 'tsx', typescript: 'tsx', tsx: 'tsx' }

const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const outIdx = args.indexOf('--out')
const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-doc-samples-'))

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.mdx?$/.test(e.name) ? [p] : []
  })
}

const samples = []
const skipped = []
const sources = [
  ...walk(docsDir).sort()
    .map(file => ({ file, rel: path.relative(docsDir, file).split(path.sep).join('/') }))
    .filter(({ rel }) => !EXCLUDED_PAGES.has(rel)),
  ...EXTRA_FILES.map(rel => ({ file: path.join(repo, rel), rel })),
]
for (const { file, rel } of sources) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    // an opening fence: 3+ backticks or tildes, optional info string (CommonMark)
    const open = lines[i].match(/^(\s*)(`{3,}|~{3,})\s*([\w-]*)/)
    if (!open) continue
    const lang = LANGS[open[3]]
    // the closing fence uses the same character, at least as many, and nothing else
    const close = new RegExp(`^\\s*${open[2][0] === '`' ? '`' : '~'}{${open[2].length},}\\s*$`)
    let j = i + 1
    while (j < lines.length && !close.test(lines[j])) j++
    if (lang) {
      const indent = open[1].length
      const body = lines.slice(i + 1, j).map(l => l.slice(Math.min(indent, l.length - l.trimStart().length)))
      const prev = lines.slice(Math.max(0, i - 2), i).join('\n')
      const id = `${rel}:${i + 1}`
      if (/^\s*\/\/\s*docs-check:\s*skip/.test(body[0] || '') || /<!--\s*docs-check:\s*skip\s*-->/.test(prev)) {
        skipped.push(id)
      } else {
        const name = rel.replace(/\.(mdx?|txt)$/, '').replace(/[^\w-]+/g, '__') + `__L${i + 1}.${lang}`
        samples.push({ id, name, code: body.join('\n') })
      }
    }
    i = j
  }
}

// A fragment like `App.model = { ... }` has no component definition, so the
// checker wouldn't treat App as a component: declare a stub view for it.
function withStubs(code) {
  const names = new Set()
  for (const m of code.matchAll(/^\s*([A-Z]\w*)\.(model|intent|initialState|context|calculated)\s*=/gm)) names.add(m[1])
  const stubs = [...names].filter(n => !new RegExp(`(function\\s+${n}\\b|(const|let|var)\\s+${n}\\b|import\\s[^;]*\\b${n}\\b)`).test(code))
  return stubs.map(n => `function ${n}({ state }) { return <div /> }\n`).join('') + code
}

// Text patterns for non-canonical forms the checker can't see in fragments
// (an object literal that isn't assigned to a component's .model, etc.).
const PATTERNS = [
  ['SYG504', /['"`][A-Z_][A-Z0-9_]*\s*\|\s*[A-Z_][A-Z0-9_]*['"`]\s*:/, "'ACTION | SINK' shorthand key"],
  ['SYG505', /(^|[^.\w])emit\(/, 'emit() helper'],
  ['SYG505', /EVENTS:\s*(\([^)]*\)|\w+)\s*=>\s*\(?\s*\{\s*type:/, 'raw EVENTS return'],
  ['SYG506', /CHILD\.select\(\s*['"`]/, 'CHILD.select() with a string'],
  ['SYG501', /function\s+[A-Z]\w*\s*\(\s*(\w+|\{[^}]*\})\s*,\s*\w+/, 'positional view arguments'],
  ['SYG501', /(const|let)\s+[A-Z]\w*\s*(:[^=]+)?=\s*\(\s*(\w+|\{[^}]*\})\s*,\s*\w+\s*\)\s*=>/, 'positional view arguments'],
  ['SYG502', /^\s*return\s+state\s*;?\s*(\/\/.*)?$/, "'return state' for no change"],
]

const patternHits = []
for (const s of samples) {
  s.code.split('\n').forEach((line, n) => {
    // comments ("// Flagged: …") show non-canonical code on purpose
    if (/\/\/\s*docs-check:\s*allow/.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return
    for (const [code, re, label] of PATTERNS) {
      // a widget's mount(el, props, emit) parameter is not the removed emit() helper (PLAN-5 W-1)
      if (label === 'emit() helper' && /\bdefineWidget\(/.test(s.code)) continue
      if (re.test(line)) patternHits.push({ id: s.id, line: n + 1, code, label, text: line.trim() })
    }
  })
}

fs.mkdirSync(outDir, { recursive: true })
for (const s of samples) fs.writeFileSync(path.join(outDir, s.name), withStubs(s.code) + '\n')

const res = spawnSync(process.execPath, [checker, outDir, '--strict', '--a11y=error', '--json', '--fail-on=never', '--verbose'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
if (res.status !== 0 && !res.stdout) {
  console.error(res.stderr)
  process.exit(2)
}
const diagnostics = JSON.parse(res.stdout)
const byName = Object.fromEntries(samples.map(s => [s.name, s.id]))
const where = d => byName[path.basename(d.file)] || d.file

const strict = diagnostics.filter(d => /^SYG5/.test(d.code))
const a11yAll = diagnostics.filter(d => /^SYG7/.test(d.code))
const isPending = d => A11Y_PENDING.get(where(d)) === d.code
const a11y = a11yAll.filter(d => !isPending(d))
const pending = a11yAll.filter(isPending)
const stale = [...A11Y_PENDING].filter(([id, code]) => !pending.some(d => where(d) === id && d.code === code))
const unparsable = diagnostics.filter(d => d.code === 'SYG900')
const other = diagnostics.filter(d => !/^SYG[57]/.test(d.code) && d.code !== 'SYG900')

for (const d of strict) console.log(`STRICT  ${where(d)} ${d.code} ${d.message}`)
for (const d of a11y) console.log(`A11Y    ${where(d)} ${d.code} ${d.message}`)
for (const d of pending) console.log(`PENDING ${where(d)} ${d.code} ${d.message} (A11Y_PENDING)`)
for (const [id, code] of stale) console.log(`STALE   A11Y_PENDING entry ${id} ${code} has no finding any more: remove it`)
for (const h of patternHits) console.log(`PATTERN ${h.id} (+${h.line}) ${h.code} ${h.label}: ${h.text}`)
for (const d of unparsable) console.log(`PARSE   ${where(d)} ${d.message}`)
if (verbose) for (const d of other) console.log(`other   ${where(d)} ${d.code} [${d.severity}] ${d.message}`)
if (verbose) for (const id of skipped) console.log(`skip    ${id}`)

const dirty = new Set([...strict.map(where), ...a11y.map(where), ...patternHits.map(h => h.id), ...unparsable.map(where)])
console.log(`\n${samples.length} samples checked, ${samples.length - dirty.size} clean, ${skipped.length} skipped by marker; ` +
  `${strict.length} strict findings, ${a11y.length} a11y findings (${pending.length} pending), ${patternHits.length} pattern findings, ${unparsable.length} unparsable, ` +
  `${other.length} non-strict findings (fragments; --verbose to list)`)
if (outIdx < 0) fs.rmSync(outDir, { recursive: true, force: true })
process.exit(strict.length || a11y.length || patternHits.length || unparsable.length ? 1 : 0)
