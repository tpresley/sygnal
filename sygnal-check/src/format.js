/**
 * Text output: one line per diagnostic
 *   file:line:col SYG123 Component: message (fix hint)
 */
export function formatDiagnostic(d) {
  const where = d.file ? `${d.file}:${d.line}:${d.column}` : '<sygnal-check>'
  const msg = (d.component ? d.component + ': ' : '') + d.message
  const sev = d.severity === 'warn' ? '' : ` [${d.severity}]`
  return `${where} ${d.code}${sev} ${msg}${d.fix ? ` (${d.fix})` : ''}`
}

export function formatDiagnostics(diags, { verbose = false } = {}) {
  const shown = verbose ? diags : diags.filter(d => d.severity !== 'info')
  const lines = shown.map(formatDiagnostic)
  const count = (s) => diags.filter(d => d.severity === s).length
  const errors = count('error')
  const warns = count('warn')
  const infos = count('info')
  const parts = []
  if (errors) parts.push(`${errors} error${errors === 1 ? '' : 's'}`)
  parts.push(`${warns} warning${warns === 1 ? '' : 's'}`)
  if (infos) parts.push(`${infos} info${verbose ? '' : ' (hidden; use --verbose)'}`)
  lines.push((lines.length ? '\n' : '') + 'sygnal-check: ' + parts.join(', '))
  return lines.join('\n')
}
