/**
 * `sygnal-check explain <code>`: the error reference entry for a code.
 *
 *   getExplanation('SYG104') → Explanation | undefined   ('syg104' and '104' work too)
 *   listExplanations()        → Explanation[]             (sorted by code)
 *   formatExplanation(e)      → string                    (text for the terminal)
 *
 * Explanation = { code, title, severity, staticSeverity?, strict, reportedBy,
 *                 explanation, fix, docsUrl }
 *   staticSeverity  sygnal-check's default when it differs from the runtime one
 *   strict          true for the strict-mode (canonical form) codes, SYG5xx
 */
import { EXPLANATIONS } from './explanations.js'
import { CODES, docsUrlFor } from './codes.js'

export function normalizeCode(input) {
  const m = /^(?:syg)?(\d{3})$/i.exec(String(input ?? '').trim())
  return m ? `SYG${m[1]}` : null
}

export function getExplanation(input) {
  const code = normalizeCode(input)
  const e = code && EXPLANATIONS[code]
  if (!e) return undefined
  const out = { code, title: e.title, severity: e.severity }
  const st = CODES[code]?.severity
  if (st && st !== e.severity) out.staticSeverity = st
  out.strict = /^SYG5/.test(code)
  out.reportedBy = [...e.reportedBy]
  out.explanation = e.explanation
  out.fix = e.fix
  out.docsUrl = docsUrlFor(code)
  return out
}

export function listExplanations() {
  return Object.keys(EXPLANATIONS).sort().map(getExplanation)
}

const WHO = { runtime: 'the Sygnal runtime', 'dev-entry': "the 'sygnal/diagnostics' dev checks", static: 'sygnal-check' }

function wrap(text, width = 78, indent = '  ') {
  const words = text.split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    if (line && (line + ' ' + w).length > width - indent.length) { lines.push(line); line = w } else line = line ? line + ' ' + w : w
  }
  if (line) lines.push(line)
  return lines.map(l => indent + l).join('\n')
}

export function formatExplanation(e) {
  const sev = e.staticSeverity ? `${e.severity} (sygnal-check: ${e.staticSeverity})` : e.severity
  const who = e.reportedBy.map(r => WHO[r] || r).join(', ') + (e.strict ? ' (strict mode)' : '')
  return [
    `${e.code}: ${e.title}`,
    `  severity: ${sev}`,
    `  reported by: ${who}`,
    '',
    wrap(e.explanation),
    '',
    '  Fix:',
    wrap(e.fix, 78, '    '),
    '',
    `  ${e.docsUrl}`,
  ].join('\n')
}

/** Closest known codes to an unknown input (same hundred). */
export function suggestCodes(input) {
  const m = /^(?:syg)?(\d)/i.exec(String(input ?? '').trim())
  if (!m) return []
  return Object.keys(EXPLANATIONS).filter(c => c[3] === m[1]).slice(0, 8)
}
