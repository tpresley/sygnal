/**
 * `sygnal-check docs <symbol>`: the reference for one thing Sygnal defines, from the installed
 * package's dist/reference.json (scripts/build-reference.mjs writes it from the types and the
 * agent context). Reads no network and no source.
 *
 *   lookupDocs(symbol, { cwd }) → { status: 'found', answer }
 *                               | { status: 'unknown', message, matches }
 *                               | { status: 'no-reference', message }
 */
import fs from 'node:fs'
import path from 'node:path'
import { getExplanation, normalizeCode, formatExplanation } from './explain.js'

const NEAREST = 8
const cache = new Map()

function referencePath(cwd) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules/sygnal/dist/reference.json')
    if (fs.existsSync(file)) return file
    if (dir === path.dirname(dir)) return null
  }
}

function loadReference(file) {
  const mtime = fs.statSync(file).mtimeMs
  const hit = cache.get(file)
  if (hit?.mtime === mtime) return hit.ref
  const ref = JSON.parse(fs.readFileSync(file, 'utf8'))
  cache.set(file, { mtime, ref })
  return ref
}

/** One answer's text, the same bytes as its section of dist/reference.md. */
export function answerText(e) {
  return [
    e.title, e.summary, e.signature, e.label && `${e.label}:`, ...e.options.map((o) => `  ${o}`),
    e.example && `Example: ${e.example}`, e.note, e.topic && `Read: node_modules/sygnal/${e.topic}`,
  ].filter(Boolean).join('\n')
}

function resolveKey(ref, input) {
  const { entries, aliases } = ref
  const known = (k) => (entries[k] ? k : aliases[k] && entries[aliases[k]] ? aliases[k] : null)
  const direct = known(input)
  if (direct) return direct
  const code = normalizeCode(input)
  if (code && entries[code]) return code
  const name = input.startsWith('.') ? input.slice(1) : input
  if (input.startsWith('.') && ref.statics.includes(name)) return known(`Component.${name}`)
  const dot = name.indexOf('.')
  if (dot > 0) {
    const [owner, member] = [name.slice(0, dot), name.slice(dot + 1)]
    // App.drivers: the owner is the reader's own component, so the member is a static.
    if (!entries[owner] && ref.statics.includes(member)) return known(`Component.${member}`)
    // An undocumented member has no entry of its own; its owner's list has the line.
    if (entries[owner]?.options.some((o) => o.startsWith(`${member}:`) || o.startsWith(`${member}?:`))) return owner
  }
  const lower = input.toLowerCase()
  const folded = Object.keys(entries).find((k) => k.toLowerCase() === lower) ?? Object.keys(aliases).find((k) => k.toLowerCase() === lower)
  return folded ? known(folded) : null
}

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}

/** The closest known names: a shared prefix or substring first, then edit distance. */
export function nearestNames(ref, input, limit = NEAREST) {
  const q = input.replace(/^\./, '').toLowerCase()
  const score = (key) => {
    const whole = key.toLowerCase(), last = whole.slice(whole.lastIndexOf('.') + 1)
    const d = Math.min(distance(q, last), distance(q, whole))
    const near = last.startsWith(q) || q.startsWith(last) ? -3 : whole.includes(q) ? -2 : 0
    return d + near + (key.includes('.') ? 0.5 : 0)
  }
  return [...Object.keys(ref.entries), ...Object.keys(ref.aliases)]
    .filter((k) => !k.startsWith('DOM.'))
    .map((k) => [k, score(k)])
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit).map(([k]) => k)
}

function diagnosticAnswer(input) {
  const e = getExplanation(input)
  return e && { key: e.code, kind: 'diagnostic', title: `${e.code} (${e.severity}): ${e.title}`, text: formatExplanation(e) }
}

export function lookupDocs(symbol, { cwd = process.cwd() } = {}) {
  const input = String(symbol ?? '').trim()
  const file = referencePath(cwd)
  if (!file) {
    const answer = diagnosticAnswer(input)
    if (answer) return { status: 'found', answer }
    return { status: 'no-reference', message: `no Sygnal reference found: node_modules/sygnal/dist/reference.json is missing above ${cwd}. Install the project's dependencies, or update sygnal to a release that ships it.` }
  }
  const ref = loadReference(file)
  const key = resolveKey(ref, input)
  if (key) {
    const e = ref.entries[key]
    return { status: 'found', answer: { key, ...e, text: answerText(e) } }
  }
  const answer = normalizeCode(input) ? diagnosticAnswer(input) : null
  if (answer) return { status: 'found', answer }
  const matches = nearestNames(ref, input)
  return { status: 'unknown', matches, message: `Sygnal has nothing named '${input}'. Nearest: ${matches.join(', ')}. Run sygnal-check docs <one of those>.` }
}

const HELP = `Usage: sygnal-check docs <symbol> [--json]

The reference for one thing Sygnal defines, for the version installed in this project: an export
(makeFetchDriver, FetchRequest), a component static (App.resources, .intent), an option (latest,
FormOptions.show), a source or sink (DOM, HTTP, EFFECT), a subpath (sygnal/ui) or a code (SYG643).
Exits 1 and lists the nearest names when there is no such symbol.
`

export function docsMain(argv, { stdout, stderr, cwd = process.cwd() }) {
  if (argv.includes('--help') || argv.includes('-h')) { stdout.write(HELP); return 0 }
  const json = argv.includes('--json')
  const bad = argv.find((a) => a.startsWith('-') && a !== '--json')
  if (bad) { stderr.write(`sygnal-check docs: unknown option ${bad}\n\n${HELP}`); return 2 }
  const rest = argv.filter((a) => a !== '--json')
  if (rest.length !== 1) { stderr.write(`sygnal-check docs: expected one symbol\n\n${HELP}`); return 2 }
  const r = lookupDocs(rest[0], { cwd })
  if (r.status === 'found') {
    stdout.write(json ? JSON.stringify({ found: true, ...r.answer }, null, 2) + '\n' : r.answer.text + '\n')
    return 0
  }
  if (json) stdout.write(JSON.stringify({ found: false, query: rest[0], matches: r.matches ?? [], message: r.message }, null, 2) + '\n')
  stderr.write(r.message + '\n')
  return r.status === 'unknown' ? 1 : 2
}
