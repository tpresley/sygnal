// Launcher for the 0-S2 server under Claude Code: sets SYGNAL_CHECK_SRC and the message log, then runs ../server.mjs.
// SYGNAL_SPIKE_DIR overrides where the spike lives (in case Claude Code copies the plugin elsewhere).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const spike = process.env.SYGNAL_SPIKE_DIR || path.resolve(here, '..')
const repo = path.resolve(spike, '../../../..')
process.env.SYGNAL_CHECK_SRC ||= path.join(repo, 'sygnal-check/src')
const logs = path.join(spike, 'logs'); fs.mkdirSync(logs, { recursive: true })
process.env.SYGNAL_LSP_LOG ||= path.join(logs, `claude-${new Date().toISOString().replace(/[:.]/g, '-')}.lsp.jsonl`)
process.env.SYGNAL_LSP_DIAG ||= 'both'
fs.appendFileSync(path.join(logs, 'claude-launches.txt'), `${new Date().toISOString()} pid=${process.pid} here=${here} cwd=${process.cwd()} log=${process.env.SYGNAL_LSP_LOG}\n`)
await import(pathToFileURL(path.join(spike, 'server.mjs')).href)
