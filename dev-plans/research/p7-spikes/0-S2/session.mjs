// node session.mjs <~/.claude/projects/<slug>/<session>.jsonl>: the stored session transcript in order,
// with attachments (where Claude Code puts LSP diagnostics; stream-json output omits them).
import fs from 'node:fs'
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => JSON.parse(l))
const clip = (s, n) => (s.length > n ? s.slice(0, n) + ` …[+${s.length - n}]` : s)
for (const e of lines) {
  const ts = e.timestamp ? e.timestamp.slice(11, 23) : '            '
  if (e.type === 'attachment') {
    const a = e.attachment || {}
    const s = JSON.stringify(a)
    const interesting = /diagnostic|SYG|lsp/i.test(s)
    console.log(`${ts} [attachment ${a.type}]${interesting ? ' <<<\n' + clip(JSON.stringify(a, null, 1), 4000) : ''}`)
  } else if (e.type === 'assistant') {
    for (const c of e.message.content) console.log(`${ts} [assistant ${c.type}] ${c.type === 'tool_use' ? c.name + ' ' + clip(JSON.stringify(c.input), 160) : clip(c.text || c.thinking || '', 160)}`)
  } else if (e.type === 'user') {
    const content = Array.isArray(e.message.content) ? e.message.content : [{ type: 'text', text: e.message.content }]
    for (const c of content) { const s = c.type === 'tool_result' ? JSON.stringify(c.content) : (c.text || ''); console.log(`${ts} [user ${c.type}${e.isMeta ? ' meta' : ''}] ${clip(s, /SYG|diagnostic/i.test(s) ? 3000 : 160)}`) }
  } else console.log(`${ts} [${e.type}${e.subtype ? ' ' + e.subtype : ''}]`)
}
