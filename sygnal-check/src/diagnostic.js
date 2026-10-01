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
 * (file, line, column; line and column are 1-based). There is no
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
  if (details.data !== undefined) d.data = details.data
  d.text = formatText(code, d)
  return d
}

export const SEVERITY_RANK = { info: 0, warn: 1, error: 2 }
