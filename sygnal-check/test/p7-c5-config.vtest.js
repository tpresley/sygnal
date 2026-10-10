// PLAN-7 C-5: the shared config file (sygnal-check.config.json / package.json "sygnal-check")
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { check, graph, loadConfig, resolveOptions, CONFIG_FILE } from '../src/index.js'
import { main } from '../src/cli.js'
import { createMcpServer } from '../src/mcp.js'

// One component with an a11y finding (SYG703), a strict-only finding (SYG505) and a plain
// warning (SYG105), plus a test file with another SYG703.
const APP = `function App({ state }) {
  return <div><img src="a.png" /><button className="inc">+</button><span>{state.n}</span></div>
}
App.initialState = { n: 0 }
App.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
App.model = {
  INC: {
    STATE: (state) => ({ ...state, n: state.n + 1 }),
    EVENTS: (state) => ({ type: 'BUMPED', data: state.n }),
  },
}
export default App
`
const TEST_FILE = `function T() { return <div><img src="b.png" /></div> }
export default T
`

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-c5-'))
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))
let n = 0

/** A project dir with the given files; JSON values (objects) are serialized. */
function project(files = {}, { app = true } = {}) {
  const dir = path.join(tmpRoot, `p${++n}`)
  const all = app ? { 'src/App.jsx': APP, 'src/App.test.jsx': TEST_FILE, ...files } : files
  for (const [rel, content] of Object.entries(all)) {
    const file = path.join(dir, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const codes = (diags) => diags.map(d => d.code)
const configDiags = (diags) => diags.filter(d => d.code === 'SYG900')

function run(args, cwd) {
  let out = ''
  let err = ''
  const code = main(args, { cwd, stdout: { write: (s) => { out += s } }, stderr: { write: (s) => { err += s } } })
  return { code, out, err }
}

function callTool(cwd, name, args = {}) {
  const res = createMcpServer({ cwd }).handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  return res.result
}

describe('loadConfig: sources', () => {
  it('no config: empty config, no file, no diagnostics', () => {
    const dir = project({ 'package.json': { name: 'x' } })
    const r = loadConfig(dir)
    expect(r).toEqual({ config: {}, file: null, diagnostics: [] })
  })

  it('reads sygnal-check.config.json', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true, ignore: ['SYG105'] } })
    const r = loadConfig(dir)
    expect(CONFIG_FILE).toBe('sygnal-check.config.json')
    expect(r.config).toEqual({ strict: true, ignore: ['SYG105'] })
    expect(r.file).toBe(path.join(dir, CONFIG_FILE))
    expect(r.diagnostics).toEqual([])
  })

  it("reads the package.json 'sygnal-check' key", () => {
    const dir = project({ 'package.json': { name: 'x', 'sygnal-check': { a11y: 'error', includeTests: true } } })
    const r = loadConfig(dir)
    expect(r.config).toEqual({ a11y: 'error', includeTests: true })
    expect(r.file).toBe(path.join(dir, 'package.json'))
  })

  it('a package.json without the key is no config', () => {
    const dir = project({ 'package.json': { name: 'x', dependencies: {} } })
    expect(loadConfig(dir).file).toBe(null)
  })

  it('both present: the config file wins, with an info that the package.json key is ignored', () => {
    const dir = project({
      [CONFIG_FILE]: { strict: true },
      'package.json': { name: 'x', 'sygnal-check': { a11y: 'error' } },
    })
    const r = loadConfig(dir)
    expect(r.config).toEqual({ strict: true })
    expect(r.file).toBe(path.join(dir, CONFIG_FILE))
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toMatchObject({ code: 'SYG900', severity: 'info', file: 'package.json' })
    expect(r.diagnostics[0].message).toMatch(/"sygnal-check" key in package\.json is ignored.*sygnal-check\.config\.json/)
  })

  it('an explicit file is read instead of discovery', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true }, 'ci.json': { a11y: 'error' } })
    const r = loadConfig(dir, { file: 'ci.json' })
    expect(r.config).toEqual({ a11y: 'error' })
    expect(r.file).toBe(path.join(dir, 'ci.json'))
  })

  it('an explicit package.json reads its key', () => {
    const dir = project({ 'pkg/package.json': { 'sygnal-check': { strict: true } } })
    expect(loadConfig(dir, { file: 'pkg/package.json' }).config).toEqual({ strict: true })
  })

  it('a missing explicit file is one SYG900 finding, not a crash', () => {
    const dir = project({})
    const r = loadConfig(dir, { file: 'nope.json' })
    expect(r.config).toEqual({})
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0].message).toMatch(/nope\.json/)
  })
})

describe('loadConfig: discovery walks up to the first package.json', () => {
  it('finds the config from a subdirectory without a package.json', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true }, 'package.json': { name: 'x' }, 'src/deep/a.js': '' })
    const r = loadConfig(path.join(dir, 'src/deep'))
    expect(r.file).toBe(path.join(dir, CONFIG_FILE))
    expect(r.config).toEqual({ strict: true })
  })

  it('stops at the nearest package.json: a config above it is not used', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true }, 'inner/package.json': { name: 'inner' } }, { app: false })
    const r = loadConfig(path.join(dir, 'inner'))
    expect(r.file).toBe(null)
    expect(r.config).toEqual({})
  })

  it('stops at the nearest package.json: its key is used, not a config further up', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true }, 'inner/package.json': { 'sygnal-check': { a11y: 'error' } } }, { app: false })
    expect(loadConfig(path.join(dir, 'inner')).config).toEqual({ a11y: 'error' })
  })

  it('paths in the config are relative to the config file, not the cwd', () => {
    const dir = project({ [CONFIG_FILE]: { paths: ['lib'] }, 'lib/App.jsx': APP, 'sub/x.txt': '' }, { app: false })
    expect(loadConfig(path.join(dir, 'sub')).config.paths).toEqual([path.join(dir, 'lib')])
    const diags = check(undefined, { cwd: path.join(dir, 'sub') })
    expect(codes(diags)).toContain('SYG703')
    expect(diags.find(d => d.code === 'SYG703').file).toBe(path.join('..', 'lib', 'App.jsx'))
  })
})

describe('loadConfig: validation', () => {
  it('an unknown key is a warning with "did you mean", on the key', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true, includeTest: true } })
    const r = loadConfig(dir)
    expect(r.config).toEqual({ strict: true })
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toMatchObject({ code: 'SYG900', severity: 'warn', file: CONFIG_FILE, line: 3, column: 3 })
    expect(r.diagnostics[0].message).toMatch(/unknown key 'includeTest'.*did you mean 'includeTests'/)
  })

  it('an unknown key in the package.json key is located inside it', () => {
    const dir = project({ 'package.json': { name: 'x', strict: 1, 'sygnal-check': { strict: true, a11yy: 'error' } } })
    const r = loadConfig(dir)
    expect(r.diagnostics[0]).toMatchObject({ file: 'package.json', line: 6 })
    expect(r.diagnostics[0].message).toMatch(/did you mean 'a11y'/)
  })

  it('$schema is allowed', () => {
    const dir = project({ [CONFIG_FILE]: { $schema: 'https://example.invalid/s.json', strict: true } })
    expect(loadConfig(dir)).toMatchObject({ config: { strict: true }, diagnostics: [] })
  })

  it('a wrong type is a warning and the value is dropped', () => {
    const dir = project({ [CONFIG_FILE]: { strict: 'yes', a11y: 'errors', ignore: 'SYG105', paths: [1], includeTests: 0 } })
    const r = loadConfig(dir)
    expect(r.config).toEqual({})
    const msgs = r.diagnostics.map(d => d.message)
    expect(r.diagnostics.every(d => d.code === 'SYG900' && d.severity === 'warn')).toBe(true)
    expect(msgs).toHaveLength(5)
    expect(msgs[0]).toMatch(/'strict' must be a boolean/)
    expect(msgs[1]).toMatch(/'a11y' must be 'warn' or 'error'.*did you mean 'error'/)
    expect(msgs[2]).toMatch(/'ignore' must be an array of codes/)
    expect(msgs[3]).toMatch(/'paths' must be a non-empty array of strings/)
    expect(msgs[4]).toMatch(/'includeTests' must be a boolean/)
  })

  it('a non-object config is a warning', () => {
    const dir = project({ [CONFIG_FILE]: '[1, 2]' })
    const r = loadConfig(dir)
    expect(r.config).toEqual({})
    expect(r.diagnostics[0].message).toMatch(/must be a JSON object/)
  })

  it('malformed JSON is one SYG900 finding on the file, with the position', () => {
    const dir = project({ [CONFIG_FILE]: '{\n  "strict": true,\n}\n' })
    const r = loadConfig(dir)
    expect(r.config).toEqual({})
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toMatchObject({ code: 'SYG900', severity: 'warn', file: CONFIG_FILE, line: 3, column: 1 })
    expect(r.diagnostics[0].message).toMatch(/sygnal-check\.config\.json is not valid JSON/)
  })

  it('an empty file is malformed JSON too', () => {
    const dir = project({ [CONFIG_FILE]: '' })
    const r = loadConfig(dir)
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toMatchObject({ code: 'SYG900', line: 1, column: 1 })
  })

  it('malformed package.json is one SYG900 finding on it', () => {
    const dir = project({ 'package.json': '{ "name": "x", }' })
    const r = loadConfig(dir)
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toMatchObject({ code: 'SYG900', file: 'package.json', line: 1 })
  })

  it('check() never throws on a malformed config: defaults apply and the finding is included', () => {
    const dir = project({ [CONFIG_FILE]: '{ "strict": tru }' })
    const diags = check(undefined, { cwd: dir })
    expect(codes(diags).sort()).toEqual(['SYG105', 'SYG703', 'SYG900'])
  })
})

describe('check() / graph(): precedence', () => {
  it('defaults: no strict, no tests, a11y warn, paths src', () => {
    const dir = project({})
    const diags = check(undefined, { cwd: dir })
    expect(codes(diags).sort()).toEqual(['SYG105', 'SYG703'])
    expect(diags.find(d => d.code === 'SYG703').severity).toBe('warn')
  })

  it('the package.json key applies', () => {
    const dir = project({ 'package.json': { 'sygnal-check': { strict: true, includeTests: true, a11y: 'error', ignore: ['SYG105'] } } })
    const diags = check(undefined, { cwd: dir })
    expect(codes(diags).sort()).toEqual(['SYG505', 'SYG703', 'SYG703'])
    expect(diags.filter(d => d.code === 'SYG703').every(d => d.severity === 'error')).toBe(true)
  })

  it('the config file applies, over the package.json key', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true }, 'package.json': { 'sygnal-check': { ignore: ['SYG703'] } } })
    const diags = check(undefined, { cwd: dir })
    expect(codes(diags).sort()).toEqual(['SYG105', 'SYG505', 'SYG703', 'SYG900'])
    expect(configDiags(diags)[0].severity).toBe('info')
  })

  it('explicit options win over the file; undefined options do not', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true, a11y: 'error', ignore: ['SYG105'] } })
    expect(codes(check(undefined, { cwd: dir, strict: false, a11y: undefined, ignore: [] })).sort()).toEqual(['SYG105', 'SYG703'])
    expect(check(undefined, { cwd: dir, strict: false }).find(d => d.code === 'SYG703').severity).toBe('error')
  })

  it('explicit inputs win over config paths', () => {
    const dir = project({ [CONFIG_FILE]: { paths: ['nowhere'] } })
    expect(codes(check(['src'], { cwd: dir }))).toContain('SYG703')
  })

  it('`defaults` sit below the file', () => {
    const plain = project({})
    expect(codes(check(undefined, { cwd: plain, defaults: { strict: true } }))).toContain('SYG505')
    const dir = project({ [CONFIG_FILE]: { strict: false } })
    expect(codes(check(undefined, { cwd: dir, defaults: { strict: true } }))).not.toContain('SYG505')
    expect(codes(check(undefined, { cwd: dir, strict: true, defaults: { strict: false } }))).toContain('SYG505')
  })

  it('config: false skips the file', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true, ignore: ['SYG105'] } })
    expect(codes(check(undefined, { cwd: dir, config: false })).sort()).toEqual(['SYG105', 'SYG703'])
    expect(codes(check(undefined, { cwd: dir, config: false, defaults: { strict: true } }))).toContain('SYG505')
  })

  it('config: <file> reads that file', () => {
    const dir = project({ 'other.json': { strict: true } })
    expect(codes(check(undefined, { cwd: dir, config: 'other.json' }))).toContain('SYG505')
  })

  it('resolveOptions returns the merged options and the loaded config', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true, paths: ['src'] } })
    const r = resolveOptions({ cwd: dir, a11y: 'error', fix: true })
    expect(r.options).toMatchObject({ cwd: dir, strict: true, a11y: 'error', paths: [path.join(dir, 'src')], includeTests: false, ignore: [], fix: true })
    expect(r.config.file).toBe(path.join(dir, CONFIG_FILE))
  })

  it('graph() applies the config, and puts config findings in the app-wide diagnostics', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true, bogus: 1 } })
    const g = graph(undefined, { cwd: dir })
    const all = [...g.diagnostics, ...g.components.flatMap(c => c.diagnostics)]
    expect(codes(all)).toContain('SYG505')
    expect(codes(g.diagnostics)).toContain('SYG900')
    expect(codes(graph(undefined, { cwd: dir, config: false }).components.flatMap(c => c.diagnostics))).not.toContain('SYG505')
  })
})

describe('CLI', () => {
  it('reads the config', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true } })
    const r = run(['--json'], dir)
    expect(codes(JSON.parse(r.out))).toContain('SYG505')
  })

  it('flags override the config', () => {
    const dir = project({ [CONFIG_FILE]: { a11y: 'error', includeTests: false } })
    const r = run(['--json', '--a11y=warn', '--include-tests'], dir)
    const diags = JSON.parse(r.out)
    expect(diags.filter(d => d.code === 'SYG703').map(d => d.severity)).toEqual(['warn', 'warn'])
  })

  it('--no-config skips it', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true } })
    expect(codes(JSON.parse(run(['--json', '--no-config'], dir).out))).not.toContain('SYG505')
  })

  it('--config <file> and --config=<file> read that file', () => {
    const dir = project({ [CONFIG_FILE]: { ignore: ['SYG703'] }, 'ci/strict.json': { strict: true } })
    for (const args of [['--config', 'ci/strict.json'], ['--config=ci/strict.json']]) {
      const diags = JSON.parse(run(['--json', ...args], dir).out)
      expect(codes(diags)).toContain('SYG505')
      expect(codes(diags)).toContain('SYG703')
    }
  })

  it('--config with a missing file exits 2', () => {
    const dir = project({})
    const r = run(['--config', 'missing.json'], dir)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/config file not found: missing\.json/)
    expect(run(['--config'], dir).code).toBe(2)
    expect(run(['--config', 'x.json', '--no-config'], dir).code).toBe(2)
  })

  it('paths from the config apply when none are given', () => {
    const dir = project({ [CONFIG_FILE]: { paths: ['lib'] }, 'lib/App.jsx': APP }, { app: false })
    const r = run(['--json'], dir)
    expect(JSON.parse(r.out).map(d => d.file)).toContain(path.join('lib', 'App.jsx'))
    // command-line paths win
    expect(run(['src'], dir).code).toBe(2)
  })

  it('a malformed config is reported, the run continues', () => {
    const dir = project({ [CONFIG_FILE]: '{ nope' })
    const r = run([], dir)
    expect(r.out).toMatch(/sygnal-check\.config\.json:1:3 SYG900/)
    expect(r.out).toContain('SYG703')
  })

  it('--graph applies the config', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true } })
    const g = JSON.parse(run(['--graph', '--json'], dir).out)
    expect(codes(g.components.flatMap(c => c.diagnostics))).toContain('SYG505')
  })

  it('the help names --config and --no-config', () => {
    const r = run(['--help'], tmpRoot)
    expect(r.out).toContain('--config <file>')
    expect(r.out).toContain('--no-config')
    expect(r.out).toContain('sygnal-check.config.json')
  })
})

describe('MCP tools honour the config', () => {
  it('check applies the config from the server cwd; explicit arguments win', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true, ignore: ['SYG105'] } })
    expect(codes(callTool(dir, 'check').structuredContent.diagnostics).sort()).toEqual(['SYG505', 'SYG703'])
    expect(codes(callTool(dir, 'check', { strict: false }).structuredContent.diagnostics)).toEqual(['SYG703'])
  })

  it('check takes paths from the config when none are given', () => {
    const dir = project({ [CONFIG_FILE]: { paths: ['lib'] }, 'lib/App.jsx': APP }, { app: false })
    const r = callTool(dir, 'check')
    expect(r.isError).toBe(false)
    expect(r.structuredContent.diagnostics.map(d => d.file)).toContain(path.join('lib', 'App.jsx'))
    expect(callTool(dir, 'check', { paths: ['src'] }).isError).toBe(true)
  })

  it('graph applies the config', () => {
    const dir = project({ [CONFIG_FILE]: { strict: true } })
    const g = callTool(dir, 'graph').structuredContent
    expect(codes(g.components.flatMap(c => c.diagnostics))).toContain('SYG505')
    const off = callTool(dir, 'graph', { strict: false }).structuredContent
    expect(codes(off.components.flatMap(c => c.diagnostics))).not.toContain('SYG505')
  })

  it('a malformed config is a finding, not a tool error', () => {
    const dir = project({ [CONFIG_FILE]: '{' })
    const r = callTool(dir, 'check')
    expect(r.isError).toBe(false)
    expect(codes(r.structuredContent.diagnostics)).toContain('SYG900')
  })
})
