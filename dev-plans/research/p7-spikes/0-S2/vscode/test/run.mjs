// Runs the probe headlessly in the *installed* VS Code (no download).
// node test/run.mjs [both|push|pull]  ->  ../logs/vscode-<mode>.lsp.jsonl and vscode-<mode>.results.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTests } from '@vscode/test-electron'

const here = path.dirname(fileURLToPath(import.meta.url))
const ext = path.resolve(here, '..')
const spike = path.resolve(ext, '..')
const repo = path.resolve(spike, '../../../..')
const mode = process.argv[2] || 'both'
const logs = path.join(spike, 'logs'); fs.mkdirSync(logs, { recursive: true })
const ws = path.join(logs, `ws-${mode}`)
fs.rmSync(ws, { recursive: true, force: true })
const fixture = path.join(repo, 'dev-plans/research/ide-tooling-poc/fixture')
for (const f of ['a', 'b']) fs.cpSync(fixture, path.join(ws, f), { recursive: true })
fs.mkdirSync(path.join(ws, 'a/.vscode'), { recursive: true })
fs.writeFileSync(path.join(ws, 'a/.vscode/settings.json'), JSON.stringify({ 'sygnal.a11y': true }))
const wsFile = path.join(ws, 'probe.code-workspace')
fs.writeFileSync(wsFile, JSON.stringify({ folders: [{ path: 'a' }, { path: 'b' }], settings: { 'sygnal.strict': true } }, null, 2))
const log = path.join(logs, `vscode-${mode}.lsp.jsonl`); fs.rmSync(log, { force: true })
const results = path.join(logs, `vscode-${mode}.results.json`); fs.rmSync(results, { force: true })

await runTests({
  vscodeExecutablePath: '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  extensionDevelopmentPath: ext,
  extensionTestsPath: path.join(here, 'suite.js'),
  extensionTestsEnv: {
    SYGNAL_CHECK_SRC: path.join(repo, 'sygnal-check/src'), SYGNAL_LSP_LOG: log, SYGNAL_LSP_DIAG: mode,
    SYGNAL_LSP_PULL_DELAY: '400', NODE_BIN: process.execPath, RESULTS: results,
  },
  launchArgs: [wsFile, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
    '--user-data-dir', fs.mkdtempSync(path.join(os.tmpdir(), 's2vsc-')), '--extensions-dir', path.join(ext, '.vscode-test/extensions')],
})
console.log('results:', results, '\nlog:', log)
