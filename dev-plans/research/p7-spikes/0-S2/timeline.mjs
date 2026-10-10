// node timeline.mjs <log.jsonl>: one line per LSP message with wall-clock time (to line up with a session transcript).
import fs from 'node:fs'
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => JSON.parse(l))
const startIso = fs.statSync(process.argv[2]).birthtime // approx; the launcher log has the exact start
const name = (u) => u.split('/').pop()
for (const e of lines) {
  const m = e.msg
  if (!m) { console.log(`${String(e.t).padStart(6)}ms ${e.event}${e.text ? ' ' + e.text : ''}`); continue }
  const p = m.params || {}
  let extra = ''
  if (m.method === 'textDocument/publishDiagnostics') extra = `${name(p.uri)} [${p.diagnostics.map(d => d.code).join(',')}]`
  else if (p.textDocument?.uri) extra = `${name(p.textDocument.uri)} v${p.textDocument.version ?? ''}`
  console.log(`${String(e.t).padStart(6)}ms ${e.dir.padEnd(3)} ${m.method ?? 'response ' + m.id} ${extra}`)
}
void startIso
