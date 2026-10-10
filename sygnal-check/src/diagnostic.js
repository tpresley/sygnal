import { CODES, docsUrlFor } from './codes.js'

const sentence = (s) => (/[.!?]$/.test(s) ? s : s + '.')

/**
 * Same text format as the runtime formatDiagnostic():
 *   [Sygnal SYG123] <Component>: <message>. <fix>. <docsUrl>
 */
export function formatText(code, { component, message, fix }) {
  return `[Sygnal ${code}] ${component ? component + ': ' : ''}${sentence(message)}` +
    (fix ? ' ' + sentence(fix) : '') + ' ' + docsUrlFor(code)
}

/**
 * Build a Diagnostic. Shape = the runtime Diagnostic (code, severity,
 * component, message, fix, data, docsUrl, text) plus the source location
 * (file, line, column; line and column are 1-based), its end (endLine,
 * endColumn: exclusive), optional `related` locations and optional `fixes` (edits.js). There is no
 * `timestamp` (static results are not time-ordered).
 */
export function makeDiagnostic(code, details) {
  const severity = details.severity || CODES[code]?.severity || 'warn'
  const d = {
    code,
    severity,
    component: details.component || undefined,
    message: details.message,
    fix: details.fix,
    docsUrl: docsUrlFor(code),
    file: details.file,
    line: details.line,
    column: details.column,
  }
  // PLAN-7 C-2: the range end (1-based, endColumn exclusive, UTF-16 units like Babel's loc)
  if (details.endLine !== undefined) {
    d.endLine = details.endLine
    d.endColumn = details.endColumn
  }
  // other locations of a pair / cross-file finding: [{ file, line, column, endLine, endColumn, message }]
  if (details.related?.length) d.related = details.related
  // PLAN-7 C-4: fixes as edits: [{ title, kind, preferred?, fixAll?, edits: [{ file, start, end, line, column, endLine, endColumn, text }] }]
  if (details.fixes?.length) d.fixes = details.fixes
  if (details.data !== undefined) d.data = details.data
  d.text = formatText(code, d)
  return d
}

export const SEVERITY_RANK = { info: 0, warn: 1, error: 2 }
