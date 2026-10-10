import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [server, root, rel] = process.argv.slice(2)
const p = spawn('node', [server], { cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'inherit'] })
let buf = Buffer.alloc(0), nextId = 1
const pending = new Map(), diagWaiters = []
p.stdout.on('data', (c) => {
  buf = Buffer.concat([buf, c])
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n'); if (sep < 0) return
    const len = +/Content-Length: (\d+)/.exec(buf.slice(0, sep).toString())[1]
    if (buf.length < sep + 4 + len) return
    const m = JSON.parse(buf.slice(sep + 4, sep + 4 + len)); buf = buf.slice(sep + 4 + len)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
    else if (m.method === 'textDocument/publishDiagnostics' && m.params.uri.endsWith(rel)) diagWaiters.shift()?.(m.params.diagnostics)
  }
})
const write = (m) => { const b = JSON.stringify({ jsonrpc: '2.0', ...m }); p.stdin.write(`Content-Length: ${Buffer.byteLength(b)}\r\n\r\n${b}`) }
const req = (method, params) => new Promise(r => { const id = nextId++; pending.set(id, r); write({ id, method, params }) })
const notify = (method, params) => write({ method, params })
const nextDiags = () => new Promise(r => diagWaiters.push(r))
const show = (label, ds) => { console.log(`\n== ${label}: ${ds.length} diagnostics`); for (const d of ds) console.log(`  ${d.range.start.line + 1}:${d.range.start.character + 1}-${d.range.end.character + 1} ${d.code} ${d.message.slice(0, 110)}`) }

const abs = path.join(root, rel), uri = pathToFileURL(abs).href
const text = fs.readFileSync(abs, 'utf8')
await req('initialize', { rootUri: pathToFileURL(root).href, capabilities: {} })
let d = nextDiags(); notify('initialized', {}); show('on startup (disk)', await d)

d = nextDiags(); notify('textDocument/didOpen', { textDocument: { uri, languageId: 'javascriptreact', version: 1, text } }); const ds = await d
const sel = ds.find(x => x.code === 'SYG110')
const hover = await req('textDocument/hover', { textDocument: { uri }, position: { line: sel.range.start.line, character: sel.range.start.character + 2 } })
console.log('\n== hover on the selector:\n' + hover.contents.value.split('\n').map(l => '  ' + l).join('\n').slice(0, 700))
const actions = await req('textDocument/codeAction', { textDocument: { uri }, range: sel.range, context: { diagnostics: [sel] } })
console.log('\n== code actions:', actions.map(a => `${a.title} -> ${JSON.stringify(a.edit.changes[uri][0])}`))

// apply the quick fix and rename the model key in the *unsaved* buffer
const fixed = text.replace("'.incc'", "'.inc'").replace('INCREMNT', 'INCREMENT')
d = nextDiags(); notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] }); show('after unsaved edits', await d)
await req('shutdown'); notify('exit')
