// node transcript.mjs <run.jsonl>: a compact view of a `claude -p --output-format stream-json --verbose` transcript,
// flagging anything that mentions diagnostics / SYG codes / LSP.
import fs from 'node:fs'
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l) } catch { return { unparsed: l.slice(0, 200) } } })
const clip = (s, n = 900) => (s.length > n ? s.slice(0, n) + ` …[+${s.length - n}]` : s)
const flag = (s) => /SYG\d|diagnostic|sygnal|LSP/i.test(s) ? ' <<<' : ''
for (const e of lines) {
  if (e.type === 'system') {
    const keep = { subtype: e.subtype, model: e.model, tools: e.tools, plugins: e.plugins, mcp_servers: e.mcp_servers, permissionMode: e.permissionMode }
    const s = JSON.stringify(e.subtype === 'init' ? keep : e); console.log(`[system] ${clip(s, 1500)}${flag(s)}`); continue
  }
  if (e.type === 'assistant') for (const c of e.message.content) {
    if (c.type === 'text') console.log(`[assistant text] ${clip(c.text)}${flag(c.text)}`)
    else if (c.type === 'tool_use') console.log(`[assistant tool_use ${c.name}] ${clip(JSON.stringify(c.input), 400)}`)
    else if (c.type === 'thinking') console.log(`[assistant thinking] ${clip(c.thinking, 300)}${flag(c.thinking)}`)
  }
  else if (e.type === 'user') {
    const content = Array.isArray(e.message.content) ? e.message.content : [{ type: 'text', text: e.message.content }]
    for (const c of content) {
      const s = c.type === 'tool_result' ? (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)) : (c.text ?? JSON.stringify(c))
      console.log(`[user ${c.type}${e.isMeta ? ' meta' : ''}] ${clip(s, 1500)}${flag(s)}`)
    }
    if (e.tool_use_result && typeof e.tool_use_result === 'object') { const s = JSON.stringify(e.tool_use_result); if (flag(s)) console.log(`  [tool_use_result] ${clip(s, 1500)} <<<`) }
    const extra = Object.keys(e).filter(k => !['type', 'message', 'parent_tool_use_id', 'session_id', 'uuid', 'tool_use_result', 'timestamp'].includes(k))
    if (extra.length) console.log(`  [user extra keys] ${extra.join(',')}`)
  }
  else if (e.type === 'result') console.log(`[result] ${JSON.stringify({ subtype: e.subtype, num_turns: e.num_turns, duration_ms: e.duration_ms, total_cost_usd: e.total_cost_usd, usage: e.usage, modelUsage: e.modelUsage, is_error: e.is_error })}`)
  else { const s = JSON.stringify(e); console.log(`[${e.type}] ${clip(s, 600)}${flag(s)}`) }
}
