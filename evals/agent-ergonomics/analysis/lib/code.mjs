// Final-code analysis: line diff vs the starter, canonical-form counts
// (dev-plans/PLAN-1-canonical-forms.md), sygnal-check diagnostics, and the
// agent's own tests.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { isTestPath } from './classify.mjs'

const SKIP_DIRS = new Set(['node_modules', 'dist', '__hidden__', 'vendor', '.git', '.vite', 'coverage'])
const CODE_RE = /\.(jsx?|tsx?|mjs|cjs|css|html|json)$/
const SKIP_FILES = new Set(['package-lock.json'])

/** Relative paths of the project files we compare (source, config, tests). */
export function listFiles(root) {
  const out = []
  const walk = (d, rel) => {
    if (!fs.existsSync(d)) return
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(path.join(d, ent.name), path.join(rel, ent.name))
      } else if (CODE_RE.test(ent.name) && !SKIP_FILES.has(ent.name) && !/\.bak$|\.orig/.test(ent.name)) out.push(path.join(rel, ent.name))
    }
  }
  walk(root, '')
  return out.sort()
}

/** Line diff by LCS: { added, removed }. */
export function lineDiff(a, b) {
  const x = a === '' ? [] : String(a).split('\n')
  const y = b === '' ? [] : String(b).split('\n')
  const n = x.length
  const m = y.length
  // Trim common prefix/suffix first (keeps the DP small).
  let p = 0
  while (p < n && p < m && x[p] === y[p]) p++
  let s = 0
  while (s < n - p && s < m - p && x[n - 1 - s] === y[m - 1 - s]) s++
  const xs = x.slice(p, n - s)
  const ys = y.slice(p, m - s)
  const N = xs.length
  const M = ys.length
  if (!N || !M) return { added: M, removed: N }
  let prev = new Uint16Array(M + 1)
  let cur = new Uint16Array(M + 1)
  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) cur[j] = xs[i - 1] === ys[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    ;[prev, cur] = [cur, prev]
  }
  const lcs = prev[M]
  return { added: M - lcs, removed: N - lcs }
}

/** Per-file diff of a trial dir against its starter. */
export function diffAgainstStarter(trialDir, starterDir) {
  const tFiles = listFiles(trialDir)
  const sFiles = new Set(listFiles(starterDir))
  const files = {}
  let added = 0
  let removed = 0
  for (const f of new Set([...tFiles, ...sFiles])) {
    const a = sFiles.has(f) ? fs.readFileSync(path.join(starterDir, f), 'utf8') : ''
    const b = tFiles.includes(f) ? fs.readFileSync(path.join(trialDir, f), 'utf8') : ''
    if (a === b) continue
    const d = lineDiff(a, b)
    files[f] = { ...d, status: !sFiles.has(f) ? 'new' : !tFiles.includes(f) ? 'deleted' : 'modified' }
    added += d.added
    removed += d.removed
  }
  return { added, removed, files }
}

/** Count non-canonical (and canonical) forms in Sygnal source text. */
export function canonicalForms(src) {
  const s = String(src)
  const count = (re) => (s.match(re) ?? []).length
  // Components: names with a .intent / .model / .view static.
  const comps = new Set([...s.matchAll(/\b([A-Z]\w*)\.(intent|model|initialState|context)\s*=/g)].map((m) => m[1]))
  let positionalView = 0
  for (const name of comps) {
    const m = s.match(new RegExp(`function\\s+${name}\\s*\\(([^)]*)\\)`)) ?? s.match(new RegExp(`const\\s+${name}\\s*=\\s*\\(([^)]*)\\)\\s*=>`))
    if (m) {
      const params = m[1].trim()
      // Positional: a non-destructured first param plus more params, e.g. (props, state, context).
      if (params && !params.startsWith('{') && params.split(',').length >= 2) positionalView++
    }
  }
  return {
    shorthandKeys: count(/['"][A-Z][A-Z0-9_]*\s*\|\s*[A-Z][A-Z0-9_]*['"]\s*:/g), // C5 non-canonical
    emitCalls: count(/\bemit\s*\(\s*['"]/g), // C6 non-canonical
    eventCalls: count(/\bevent\s*\(\s*['"]/g), // C6 canonical
    rawEventsObjects: count(/EVENTS\s*:\s*(?:\([^)]*\)|\w+)\s*=>\s*\(?\s*\{\s*type\s*:/g), // C6 non-canonical raw form
    childSelectString: count(/CHILD\.select\(\s*['"]/g), // C7 non-canonical
    childSelectFn: count(/CHILD\.select\(\s*[A-Z]\w*\s*\)/g), // C7 canonical
    positionalView, // C1 non-canonical
    abortReturns: count(/\bABORT\b/g),
    effectSinks: count(/\bEFFECT\s*:/g),
  }
}

/** Concatenate the non-test source files of a dir. */
export function sourceText(dir) {
  return listFiles(dir)
    .filter((f) => /\.(jsx?|tsx?|mjs)$/.test(f) && !isTestPath(f) && !/^vite\.config|^vitest\.config/.test(f))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n')
}

/** Test files the agent left in the trial. */
export function keptTests(dir) {
  return listFiles(dir).filter((f) => isTestPath(f))
}

/** How the agent's kept tests drive the app. */
export function testApproach(dir) {
  const kinds = new Set()
  for (const f of keptTests(dir)) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8')
    if (/renderComponent/.test(t)) kinds.add('renderComponent')
    if (/@testing-library/.test(t)) kinds.add('testing-library')
    if (/\brun\s*\(|\.run\s*\(|\brun as\b|\['ru'\s*\+/.test(t) && /sygnal/.test(t)) kinds.add('run+jsdom')
    if (!kinds.size) kinds.add('unit (reducers/functions)')
  }
  return [...kinds]
}

/** Run sygnal-check on a src dir. Returns { diagnostics: [{code, severity, message, file, line}], error }. */
export function runSygnalCheck(checkBin, srcDir) {
  if (!fs.existsSync(srcDir)) return { diagnostics: [], error: 'no src dir' }
  const r = spawnSync(process.execPath, [checkBin, srcDir, '--json'], { encoding: 'utf8', timeout: 60000 })
  try {
    const arr = JSON.parse(r.stdout || '[]')
    return { diagnostics: arr.map((d) => ({ code: d.code, severity: d.severity, component: d.component, message: d.message, file: path.basename(d.file ?? ''), line: d.line })) }
  } catch {
    return { diagnostics: [], error: (r.stderr || r.stdout || 'unparseable output').slice(0, 300) }
  }
}

/** Did the final driver code catch errors inside a driverFromAsync function (B-005 workaround)? */
export function driverCatchWorkaround(src) {
  const s = String(src)
  if (!/driverFromAsync/.test(s)) return false
  return /driverFromAsync[\s\S]{0,1500}(\bcatch\s*[({]|\.catch\()/.test(s) || /(\bcatch\s*[({]|\.catch\()[\s\S]{0,1500}driverFromAsync/.test(s)
}
