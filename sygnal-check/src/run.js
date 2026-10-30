/**
 * Rule runner shared by check() and graph(): runs the rules over a built
 * project, applies `// sygnal-ignore` comments, dedupes, and turns rule
 * crashes / parse errors into SYG900.
 */
import { makeDiagnostic } from './diagnostic.js'
import { loc, endLoc } from './ast.js'
import { lineStarts, locateEdit } from './edits.js'

function isSuppressed(file, line, code) {
  for (const l of [line, line - 1]) {
    const s = file.suppressions.get(l)
    if (s === '*' || (s && s.has(code))) return true
  }
  return false
}

/**
 * `report({ related })` → the diagnostic's `related` (PLAN-7 C-2): the other side of a pair or
 * cross-file finding, located like the finding itself. An entry's `file` (a FileInfo) defaults
 * to the finding's; entries without a node or a file are dropped.
 */
function relatedLocations(project, related, file) {
  const out = []
  for (const r of related || []) {
    const f = r?.file || file
    if (!r?.node || !f?.path) continue
    out.push({ file: project.relPath(f.path), ...loc(r.node), ...endLoc(r.node), message: r.message })
  }
  return out.length ? out : undefined
}

/**
 * `report({ fixes })` → the diagnostic's `fixes` (PLAN-7 C-4, edits.js): each edit gets its
 * line/column range and a path relative to cwd. A fix with an edit in a file the project
 * didn't load is dropped. A rule's legacy `edits` (strict --fix rewrites) become one
 * `fixAll` fix.
 */
function locatedFixes(project, r, starts) {
  const list = [...(r.fixes || [])]
  if (r.edits?.length && !list.some(f => f.fixAll)) list.push({ title: `Apply the ${r.code} rewrite`, kind: 'quickfix', preferred: true, fixAll: true, edits: r.edits })
  const out = []
  for (const f of list) {
    if (!f?.edits?.length) continue
    const edits = []
    for (const e of f.edits) {
      const abs = typeof e.file === 'string' ? e.file : e.file?.path
      const source = abs && project.files.get(abs)?.source
      if (source == null) { edits.length = 0; break }
      if (!starts.has(abs)) starts.set(abs, lineStarts(source))
      edits.push(locateEdit(starts.get(abs), project.relPath(abs), e))
    }
    if (!edits.length) continue
    out.push({ title: f.title, kind: f.kind || 'quickfix', ...(f.preferred ? { preferred: true } : {}), ...(f.fixAll ? { fixAll: true } : {}), edits })
  }
  return out.length ? out : undefined
}

/** The raw edits (absolute paths, offsets) of a report's `fixAll` fix: `diagnostic.edits`, kept for --fix's old API. */
function rawFixAllEdits(r) {
  const f = (r.fixes || []).find(x => x?.fixAll)
  const edits = f ? f.edits : r.edits
  return edits?.length ? edits.map(e => ({ file: typeof e.file === 'string' ? e.file : e.file.path, start: e.start, end: e.end, text: e.text })) : null
}

/**
 * Per-file rule memo (native-tooling round 2, incremental checking): `createRuleMemo()`, passed
 * as runRules(…, { memo }) across the builds of one project (Project `previous`), keeps what a
 * `perFile` rule reported for each FileInfo. A build that reuses a FileInfo (unchanged, nothing it
 * imports changed) replays its reports instead of running the rule on it again.
 *
 * A rule declares `perFile: true` when running it on a project narrowed to one scanned file
 * (`scanned` = that file, `components` = its components; everything else as in the project)
 * reports exactly that file's share of the whole run, and that share depends only on the file and
 * what it imports. `perFile: (project, file) => key` adds a key the share also depends on (say the
 * installed Sygnal's major): a memo entry is used only while the key is the same.
 */
const PERFILE_ALWAYS = typeof process !== 'undefined' && process.env?.SYGNAL_CHECK_PERFILE === '1'

export function createRuleMemo() {
  return new WeakMap() // rule → WeakMap<FileInfo, { key, reports }>
}

/** `project` narrowed to one scanned file (a perFile rule's run). */
function narrowed(project, path, components) {
  const v = Object.create(project)
  v.scanned = new Set([path])
  v.components = components
  return v
}

/** A perFile rule as a rule that runs it per file not in the memo, then replays every file's reports. */
function memoized(rule, memo, project) {
  return {
    id: rule.id,
    run(_, report) {
      let byFile = memo.get(rule)
      if (!byFile) memo.set(rule, byFile = new WeakMap())
      const compsOf = new Map()
      for (const c of project.components) {
        if (!compsOf.has(c.file.path)) compsOf.set(c.file.path, [])
        compsOf.get(c.file.path).push(c)
      }
      for (const p of project.scanned) {
        const file = project.files.get(p)
        if (!file) continue
        const key = typeof rule.perFile === 'function' ? rule.perFile(project, file) : null
        let entry = byFile.get(file)
        if (!entry || entry.key !== key) {
          const reports = []
          rule.run(narrowed(project, p, compsOf.get(p) || []), (r) => { reports.push(r) })
          byFile.set(file, entry = { key, reports })
        }
        for (const r of entry.reports) report(r)
      }
    },
  }
}

/**
 * Run rules over an already-built project. `parseErrors: false` leaves out the parse errors'
 * SYG900 (the language server runs the rules in two calls and adds them once). `memo`
 * (createRuleMemo()): run the `perFile` rules incrementally (above).
 */
export function runRules(project, rules, { parseErrors = true, memo = null } = {}) {
  // SYGNAL_CHECK_PERFILE=1 (tests): every run through the per-file split, so each rule test also
  // checks that a `perFile` rule's per-file runs add up to its whole run
  if (!memo && PERFILE_ALWAYS) memo = createRuleMemo()
  const out = []
  const seen = new Set()
  const starts = new Map() // absPath → line starts, for the fixes' positions
  for (const rule0 of rules) {
    const rule = memo && rule0.perFile ? memoized(rule0, memo, project) : rule0
    const report = (r) => {
      let file = r.file
      let node = r.node
      if (!file || !project.scanned.has(file.path)) return
      const { line, column } = loc(node)
      if (isSuppressed(file, line, r.code)) return
      // PLAN-7 C-2: a rule that narrowed its node below the line it used to report on passes
      // the old node as `anchor`, so `// sygnal-ignore` comments written for it still match
      if (r.anchor && isSuppressed(file, loc(r.anchor).line, r.code)) return
      const key = `${r.code}|${file.path}|${line}|${column}|${r.message}`
      if (seen.has(key)) return
      seen.add(key)
      const d = makeDiagnostic(r.code, {
        ...r,
        file: project.relPath(file.path),
        line,
        column,
        ...endLoc(r.endNode || node),
        related: relatedLocations(project, r.related, file),
        fixes: locatedFixes(project, r, starts),
      })
      // the --fix rewrite's raw edits (absolute paths), as before C-4; non-enumerable so JSON output is unchanged
      const raw = rawFixAllEdits(r)
      if (raw) Object.defineProperty(d, 'edits', { value: raw })
      out.push(d)
    }
    try {
      rule.run(project, report)
    } catch (err) {
      // A crashed rule has no file and no node: no range (no endLine/endColumn), line/column 0.
      // An editor logs it rather than placing it in a document (PLAN-7 C-2, spike 0-S1)
      out.push(makeDiagnostic('SYG900', {
        message: `sygnal-check rule '${rule.id}' threw: ${err?.message}`,
        fix: 'please report this with the file that triggers it',
        file: '',
        line: 0,
        column: 0,
        data: { stack: err?.stack },
      }))
    }
  }
  for (const e of parseErrors ? project.parseErrors : []) {
    out.push(makeDiagnostic('SYG900', {
      message: `could not parse file: ${e.message}`,
      fix: 'fix the syntax error (sygnal-check skipped this file)',
      file: project.relPath(e.file),
      line: e.line,
      column: e.column,
      // the parser's position, one character (exclusive end)
      endLine: e.line,
      endColumn: e.column + 1,
    }))
  }
  return out
}

export function sortDiagnostics(list) {
  return list.sort((a, b) =>
    (a.file || '').localeCompare(b.file || '') || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code))
}

