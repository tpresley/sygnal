// PLAN-7 I-1: the Claude Code plugin (editors/claude-code) and the marketplace file (.claude-plugin/marketplace.json).
// - the manifests parse and carry the fields Claude Code and the marketplace need;
// - lspServers is inline (D307: `claude plugin validate` doesn't read .lsp.json), with "settings": {} so the server
//   gets a workspace/configuration channel, and no MCP server (D304);
// - the plugin's skill is skills/sygnal-dev itself (a symlink, so there is no copy to drift);
// - the launcher runs the project's own sygnal-check language server (what `npx --no-install sygnal-check lsp` runs),
//   and without a capable sygnal-check it answers as an empty server instead of failing on every edit.
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = path.join(repo, 'editors/claude-code')
const launcher = path.join(pluginDir, 'scripts/sygnal-lsp.mjs')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const plugin = readJson(path.join(pluginDir, '.claude-plugin/plugin.json'))
const marketplace = readJson(path.join(repo, '.claude-plugin/marketplace.json'))

// The lspServers fields Claude Code 2.1.287 accepts (an unknown key fails validation and the plugin doesn't load).
const LSP_KEYS = ['command', 'extensionToLanguage', 'args', 'transport', 'env', 'initializationOptions', 'settings',
  'workspaceFolder', 'startupTimeout', 'shutdownTimeout', 'requestTimeout', 'restartOnCrash', 'maxRestarts', 'diagnostics']

const temps = []
function tempDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'p7-i1-')))
  temps.push(dir)
  return dir
}
afterAll(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }) })

function writeFiles(root, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), text)
  }
}

/** Start the launcher in `cwd`, send `messages` (framed), close stdin after `closeAfter` ms; collect replies and stderr. */
function runLauncher(cwd, messages, { closeAfter = 300, waitFor } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher], { cwd, env: { ...process.env, SYGNAL_LSP_PROJECT: '' } })
    let out = Buffer.alloc(0)
    let stderr = ''
    const replies = []
    let closed = false
    const close = () => { if (!closed) { closed = true; child.stdin.end() } }
    const timer = setTimeout(close, 15000)
    child.stdout.on('data', chunk => {
      out = Buffer.concat([out, chunk])
      for (;;) {
        const end = out.indexOf('\r\n\r\n')
        if (end === -1) break
        const length = Number(/content-length:\s*(\d+)/i.exec(out.subarray(0, end).toString())[1])
        if (out.length < end + 4 + length) break
        replies.push(JSON.parse(out.subarray(end + 4, end + 4 + length).toString()))
        out = out.subarray(end + 4 + length)
        if (waitFor && !closed && waitFor(replies)) { send({ id: 99, method: 'shutdown' }); setTimeout(close, 100) }
      }
    })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', code => { clearTimeout(timer); resolve({ code, replies, stderr }) })
    function send(message) {
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }))
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
      child.stdin.write(body)
    }
    for (const message of messages) send(message)
    if (!waitFor) setTimeout(close, closeAfter)
  })
}

const initialize = cwd => ({ id: 1, method: 'initialize', params: { processId: process.pid, rootUri: `file://${cwd}`, capabilities: {}, workspaceFolders: [{ uri: `file://${cwd}`, name: 'p' }] } })

describe('plugin.json', () => {
  it('has the metadata a marketplace listing needs', () => {
    expect(plugin.name).toBe('sygnal')
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/) // semver; bumped with each plugin release (RELEASING §9)
    expect(plugin.description).toMatch(/skill/)
    expect(plugin.description).toMatch(/language server/)
    expect(plugin.author.name).toBe('Troy Presley')
    expect(() => new URL(plugin.homepage)).not.toThrow()
    expect(plugin.repository).toBe('https://github.com/tpresley/sygnal')
    expect(plugin.license).toBe('MIT')
  })

  it('declares the language server inline, with a settings channel and no MCP server', () => {
    expect(Object.keys(plugin.lspServers)).toEqual(['sygnal'])
    const server = plugin.lspServers.sygnal
    for (const key of Object.keys(server)) expect(LSP_KEYS).toContain(key)
    expect(server.command).toBe('node')
    expect(server.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/scripts/sygnal-lsp.mjs'])
    expect(server.extensionToLanguage).toEqual({
      '.js': 'javascript', '.jsx': 'javascriptreact', '.ts': 'typescript', '.tsx': 'typescriptreact',
      '.mjs': 'javascript', '.cjs': 'javascript',
    })
    expect(server.settings).toEqual({})
    expect(server.diagnostics).not.toBe(false)
    expect(Number.isInteger(server.startupTimeout) && server.startupTimeout > 0).toBe(true)
    expect(plugin).not.toHaveProperty('mcpServers')
    expect(fs.existsSync(path.join(pluginDir, '.mcp.json'))).toBe(false)
    expect(fs.existsSync(path.join(pluginDir, '.lsp.json'))).toBe(false)
  })

  it('keeps executables out of a top-level bin/ (claude.ai org sync rejects it)', () => {
    expect(fs.existsSync(path.join(pluginDir, 'bin'))).toBe(false)
    expect(fs.existsSync(launcher)).toBe(true)
  })

  it('launches what `npx --no-install sygnal-check lsp` runs: runLspServer from the package', () => {
    // the documented start command, the CLI route it takes, and the export the launcher calls
    expect(fs.readFileSync(path.join(repo, 'sygnal-check/README.md'), 'utf8')).toContain('npx --no-install sygnal-check lsp')
    const bin = fs.readFileSync(path.join(repo, 'sygnal-check/bin/sygnal-check.js'), 'utf8')
    expect(bin).toMatch(/argv\[0\] === 'lsp'[\s\S]*runLspServer[\s\S]*'\.\.\/src\/lsp\/server\.js'/)
    expect(fs.readFileSync(path.join(repo, 'sygnal-check/src/index.js'), 'utf8')).toContain("export { createLspServer, runLspServer } from './lsp/server.js'")
    expect(fs.readFileSync(launcher, 'utf8')).toContain("resolve('sygnal-check')")
  })
})

describe('the skill', () => {
  it('is skills/sygnal-dev itself, through a symlink (no copy to keep in sync)', () => {
    const link = path.join(pluginDir, 'skills/sygnal-dev')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(link)).toBe('../../../skills/sygnal-dev')
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(path.join(repo, 'skills/sygnal-dev')))
    const skill = fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8')
    expect(skill).toMatch(/^---\nname: sygnal-dev\n/)
    expect(fs.readdirSync(path.join(pluginDir, 'skills'))).toEqual(['sygnal-dev'])
  })
})

describe('marketplace.json', () => {
  it('lists the plugin under the marketplace name sygnal', () => {
    expect(marketplace.name).toBe('sygnal')
    expect(marketplace.owner.name).toBe('Troy Presley')
    expect(marketplace.description).toBeTruthy()
    expect(marketplace.plugins).toHaveLength(1)
    const [entry] = marketplace.plugins
    expect(entry.name).toBe('sygnal')
    expect(entry.source).toBe('./editors/claude-code')
    expect(fs.existsSync(path.join(repo, entry.source, '.claude-plugin/plugin.json'))).toBe(true)
    // the version lives in plugin.json only (set in both, plugin.json wins and validate warns)
    expect(entry).not.toHaveProperty('version')
  })
})

describe('the launcher', () => {
  it('without sygnal-check: one stderr line, then an empty server until stdin closes', async () => {
    const cwd = tempDir()
    const { code, replies, stderr } = await runLauncher(cwd, [
      initialize(cwd),
      { method: 'initialized', params: {} },
      { method: 'textDocument/didOpen', params: { textDocument: { uri: `file://${cwd}/a.jsx`, languageId: 'javascriptreact', version: 1, text: 'x' } } },
      { id: 2, method: 'textDocument/hover', params: { textDocument: { uri: `file://${cwd}/a.jsx` }, position: { line: 0, character: 0 } } },
      { id: 3, method: 'shutdown' },
    ])
    expect(code).toBe(0)
    expect(stderr.trim().split('\n')).toHaveLength(1)
    expect(stderr).toMatch(/no compatible sygnal-check \(>= 0\.11\.0\)/)
    expect(stderr).toContain('npm install -D sygnal-check@^0.11.0')
    expect(replies).toEqual([
      { jsonrpc: '2.0', id: 1, result: { capabilities: {}, serverInfo: { name: 'sygnal (inactive)' } } },
      { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'sygnal (inactive): textDocument/hover is not supported' } },
      { jsonrpc: '2.0', id: 3, result: null },
    ])
  })

  it('exits on `exit` as well as on stdin end', async () => {
    const cwd = tempDir()
    const { code, replies } = await runLauncher(cwd, [initialize(cwd), { method: 'exit' }], { closeAfter: 5000 })
    expect(code).toBe(0)
    expect(replies).toHaveLength(1)
  })

  it('with a sygnal-check that has no language server (0.3.x): the empty server', async () => {
    const cwd = tempDir()
    writeFiles(cwd, {
      'node_modules/sygnal-check/package.json': JSON.stringify({ name: 'sygnal-check', version: '0.3.0', type: 'module', exports: { '.': './src/index.js' } }),
      'node_modules/sygnal-check/src/index.js': 'export function checkFiles() { return [] }\n',
    })
    const { code, replies, stderr } = await runLauncher(cwd, [initialize(cwd), { id: 2, method: 'shutdown' }])
    expect(code).toBe(0)
    expect(stderr).toMatch(/no compatible sygnal-check/)
    expect(replies[0].result.serverInfo.name).toBe('sygnal (inactive)')
  })

  it('does not import an old LSP that cannot distinguish Sygnal 6 and 7', async () => {
    const cwd=tempDir()
    writeFiles(cwd, {
      'node_modules/sygnal-check/package.json': JSON.stringify({name:'sygnal-check',version:'0.10.0',type:'module',exports:{'.':'./src/index.js'}}),
      'node_modules/sygnal-check/src/index.js': "throw new Error('old checker must not load')",
    })
    const {code,replies,stderr}=await runLauncher(cwd,[initialize(cwd),{id:2,method:'shutdown'}])
    expect(code).toBe(0)
    expect(stderr).toContain('>= 0.11.0')
    expect(stderr).not.toContain('old checker must not load')
    expect(replies[0].result.serverInfo.name).toBe('sygnal (inactive)')
  })

  it("with a capable sygnal-check: calls the package's runLspServer, found from a subdirectory too", async () => {
    const cwd = tempDir()
    writeFiles(cwd, {
      'node_modules/sygnal-check/package.json': JSON.stringify({ name: 'sygnal-check', version: '0.11.0', type: 'module', exports: { '.': './src/index.js' } }),
      'node_modules/sygnal-check/src/index.js': "export async function runLspServer({ cwd }) { process.stderr.write('fake server in ' + cwd + '\\n'); return 7 }\n",
      'packages/app/src/.keep': '',
    })
    const sub = path.join(cwd, 'packages/app')
    const { code, stderr } = await runLauncher(sub, [])
    expect(code).toBe(7)
    expect(stderr).toBe(`fake server in ${sub}\n`)
  })

  it("with this repository's sygnal-check: the real server starts and pushes the fixture's findings", async () => {
    const cwd = tempDir()
    fs.cpSync(path.join(repo, 'dev-plans/research/ide-tooling-poc/fixture'), cwd, { recursive: true })
    fs.mkdirSync(path.join(cwd, 'node_modules'))
    fs.symlinkSync(path.join(repo, 'sygnal-check'), path.join(cwd, 'node_modules/sygnal-check'), 'dir')
    const file = path.join(cwd, 'src/C.jsx')
    const { code, replies, stderr } = await runLauncher(cwd, [
      initialize(cwd),
      { method: 'initialized', params: {} },
      { method: 'textDocument/didOpen', params: { textDocument: { uri: `file://${file}`, languageId: 'javascriptreact', version: 1, text: fs.readFileSync(file, 'utf8') } } },
    ], { waitFor: replies => replies.some(r => r.method === 'textDocument/publishDiagnostics' && r.params.uri.endsWith('/C.jsx')) })
    expect(code).toBe(0)
    expect(stderr).not.toMatch(/no sygnal-check/)
    expect(replies[0].result.serverInfo.name).toBe('sygnal-check')
    const published = replies.find(r => r.method === 'textDocument/publishDiagnostics' && r.params.uri.endsWith('/C.jsx'))
    const codes = published.params.diagnostics.map(d => d.code)
    expect(codes).toContain('SYG110')
    // self-contained messages (D307): Claude Code drops codeDescription and data
    for (const d of published.params.diagnostics) expect(d.message).toMatch(/^Counter: /)
  }, 20000)
})
