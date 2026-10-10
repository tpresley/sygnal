#!/usr/bin/env node
// lsp-tap.mjs <log.jsonl> <command> [args...]: run an LSP server over stdio and log every message
// in both directions as JSON lines ({ t, dir: 'in' | 'out', msg }; 'in' = client → server).
// Used as the editor's server command in I-2, so the client's traffic (initialize capabilities,
// configuration answers, registrations, code action contexts) can be read back afterwards.
// Example: node lsp-tap.mjs /tmp/nvim.jsonl npx --no-install sygnal-check lsp
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const [log, cmd, ...args] = process.argv.slice(2)
if (!log || !cmd) { process.stderr.write('usage: lsp-tap.mjs <log.jsonl> <command> [args...]\n'); process.exit(2) }
const t0 = Date.now()
const write = (o) => fs.appendFileSync(log, JSON.stringify({ t: Date.now() - t0, ...o }) + '\n')
write({ event: 'start', argv: [cmd, ...args], cwd: process.cwd(), pid: process.pid })

const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] })

function framer(dir) {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n')
      if (sep < 0) return
      const m = /content-length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString('ascii'))
      if (!m) { buf = buf.subarray(sep + 4); continue }
      const len = +m[1]
      if (buf.length < sep + 4 + len) return
      const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8')
      buf = buf.subarray(sep + 4 + len)
      try { write({ dir, msg: JSON.parse(body) }) } catch { write({ dir, raw: body }) }
    }
  }
}

const fromClient = framer('in')
const fromServer = framer('out')
process.stdin.on('data', (c) => { fromClient(c); child.stdin.write(c) })
process.stdin.on('end', () => { write({ event: 'stdin-end' }); child.stdin.end() })
child.stdout.on('data', (c) => { fromServer(c); process.stdout.write(c) })
child.on('exit', (code, signal) => { write({ event: 'exit', code, signal }); process.exit(code ?? 1) })
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => { write({ event: 'signal', signal: s }); child.kill(s) })
