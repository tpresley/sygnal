// Smoke test of the extension in the *installed* VS Code (@vscode/test-electron with
// vscodeExecutablePath: nothing is downloaded). Not part of the root `npm test` (PLAN-7 §3).
//
//   node test/smoke/run.mjs            both scenarios (run `node scripts/build.mjs` first)
//   VSCODE_PATH=/path/to/Code node test/smoke/run.mjs
//
// Scenario "bundled": a three-folder workspace with no usable sygnal-check of its own:
//   a/  the PoC fixture + package.json depending on sygnal + S.jsx; folder setting sygnal.strict: true
//   b/  the PoC fixture + sygnal-check.config.json + S.jsx (not strict)
//   c/  a package.json + node_modules/sygnal-check 0.3.0 without the language server (too old)
// Scenario "workspace": the fixture with node_modules/sygnal-check linked to the repository's checker.
// Scenario "features" (0.2.0): the kanban example (its tests included) + the PoC fixture's C.jsx +
//   Flow.jsx / Listener.jsx (an action triggered by next(), an EVENTS type across files), for
//   completions, definition / references, code lens and rename (bundled sygnal-check).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTests } from '@vscode/test-electron'
import { check } from '../../../../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const ext = path.resolve(here, '../..')
const repo = path.resolve(ext, '../..')
const fixture = path.join(repo, 'dev-plans/research/ide-tooling-poc/fixture')
const work = path.join(here, '.work')
const vscodeExecutablePath = process.env.VSCODE_PATH || '/Applications/Visual Studio Code.app/Contents/MacOS/Code'

if (!fs.existsSync(vscodeExecutablePath)) {
  console.error(`VS Code not found at ${vscodeExecutablePath}. Set VSCODE_PATH; this test never downloads VS Code.`)
  process.exit(1)
}
if (!fs.existsSync(path.join(ext, 'dist/extension.js')) || !fs.existsSync(path.join(ext, 'server/sygnal-check/bin/sygnal-check.js'))) {
  console.error('Build the extension first: node scripts/build.mjs')
  process.exit(1)
}

// S.jsx: clean, except SYG505 under strict (a hand-built EVENTS object), which --fix rewrites
// (adding `event` to the existing sygnal import).
const S_JSX = `import { ABORT } from 'sygnal'
function Saver({ state }) {
  return <div><button className="save">Save</button><span>{state.n}</span></div>
}
Saver.initialState = { n: 0 }
Saver.intent = ({ DOM, EVENTS }) => ({ SAVE: DOM.click('.save'), SAVED: EVENTS.select('SAVED') })
Saver.model = {
  SAVE: { EVENTS: (state) => ({ type: 'SAVED', data: state.n }) },
  SAVED: (state, n) => (n == null ? ABORT : { ...state, n: n + 1 }),
}
export default Saver
`
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }
const json = (v) => JSON.stringify(v, null, 2)

/** The CLI's findings for the fixture's C.jsx, as LSP ranges: what the editor must show. */
function expectedC() {
  return check([path.join(fixture, 'src/C.jsx')], { cwd: fixture, config: false }).map(d => ({
    code: d.code,
    range: [d.line - 1, d.column - 1, d.endLine - 1, d.endColumn - 1],
  }))
}

function setupBundled() {
  const ws = path.join(work, 'bundled')
  fs.rmSync(ws, { recursive: true, force: true })
  for (const f of ['a', 'b']) {
    fs.cpSync(fixture, path.join(ws, f), { recursive: true })
    write(path.join(ws, f, 'src/S.jsx'), S_JSX)
  }
  write(path.join(ws, 'a/package.json'), json({ name: 'a', private: true, dependencies: { sygnal: '^6.1.0' } }))
  write(path.join(ws, 'a/.vscode/settings.json'), json({ 'sygnal.strict': true }))
  write(path.join(ws, 'b/sygnal-check.config.json'), json({}))
  write(path.join(ws, 'c/package.json'), json({ name: 'c', private: true, devDependencies: { 'sygnal-check': '^0.3.0' } }))
  write(path.join(ws, 'c/node_modules/sygnal-check/package.json'), json({ name: 'sygnal-check', version: '0.3.0', bin: { 'sygnal-check': 'bin/sygnal-check.js' } }))
  write(path.join(ws, 'c/node_modules/sygnal-check/bin/sygnal-check.js'), "console.error('sygnal-check 0.3.0 has no lsp'); process.exit(2)\n")
  const file = path.join(ws, 'bundled.code-workspace')
  write(file, json({ folders: [{ path: 'a' }, { path: 'b' }, { path: 'c' }], settings: {} }))
  return file
}

function setupWorkspace() {
  const ws = path.join(work, 'workspace')
  fs.rmSync(ws, { recursive: true, force: true })
  fs.cpSync(fixture, ws, { recursive: true })
  write(path.join(ws, 'package.json'), json({ name: 'ws', private: true, devDependencies: { 'sygnal-check': '*' } }))
  fs.mkdirSync(path.join(ws, 'node_modules'), { recursive: true })
  fs.symlinkSync(path.join(repo, 'sygnal-check'), path.join(ws, 'node_modules/sygnal-check'), 'dir')
  return ws
}

// Flow: SAVE is triggered by the intent and by next('SAVE'); FLOW_SAVED is selected in Listener.
const FLOW_JSX = `import { event } from 'sygnal'

function Flow({ state }) {
  return (
    <div id="flow-root" title="plain string">
      <button className="save primary">Save</button>
      <span className="count">{state.n}</span>
      <input id="name" aria-label="Name" />
    </div>
  )
}

Flow.initialState = { n: 0 }

Flow.intent = ({ DOM, EVENTS }) => ({
  SAVE: DOM.click('.save'),
  RESET: EVENTS.select('FLOW_RESET'),
})

Flow.model = {
  SAVE: { STATE: (state) => ({ ...state, n: state.n + 1 }), EVENTS: event('FLOW_SAVED', (state) => state.n) },
  RESET: (state, _data, next) => { next('SAVE'); return { ...state, n: 0 } },
}

export default Flow
`
const LISTENER_JSX = `import { event } from 'sygnal'

function Listener({ state }) {
  return <div><button className="clear">Clear</button><span>{state.saves}</span></div>
}

Listener.initialState = { saves: 0 }

Listener.intent = ({ DOM, EVENTS }) => ({
  ON_SAVED: EVENTS.select('FLOW_SAVED'),
  CLEAR: DOM.click('.clear'),
})

Listener.model = {
  ON_SAVED: (state) => ({ ...state, saves: state.saves + 1 }),
  CLEAR: { EVENTS: event('FLOW_RESET') },
}

export default Listener
`

function setupFeatures() {
  const ws = path.join(work, 'features')
  fs.rmSync(ws, { recursive: true, force: true })
  const kanban = path.join(repo, 'examples/kanban')
  for (const entry of ['src', 'index.html', 'package.json', 'vite.config.js']) fs.cpSync(path.join(kanban, entry), path.join(ws, entry), { recursive: true })
  fs.cpSync(path.join(fixture, 'src/C.jsx'), path.join(ws, 'src/C.jsx'))
  write(path.join(ws, 'src/Flow.jsx'), FLOW_JSX)
  write(path.join(ws, 'src/Listener.jsx'), LISTENER_JSX)
  return ws
}

const scenarios = { bundled: setupBundled, workspace: setupWorkspace, features: setupFeatures }
const only = process.argv[2]
let failed = 0
for (const [name, setup] of Object.entries(scenarios)) {
  if (only && only !== name) continue
  const target = setup()
  const results = path.join(work, `${name}.results.json`)
  fs.rmSync(results, { force: true })
  // macOS: a long --user-data-dir makes VS Code's IPC socket path too long (0-S2), so use os.tmpdir()
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sygvsc-'))
  console.log(`\n== scenario ${name}`)
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: ext,
      extensionTestsPath: path.join(here, 'suite.cjs'),
      extensionTestsEnv: { SCENARIO: name, RESULTS: results, EXPECTED_C: JSON.stringify(expectedC()) },
      launchArgs: [target, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
        '--user-data-dir', userData, '--extensions-dir', path.join(ext, '.vscode-test/extensions')],
    })
  } catch (err) {
    failed++
    console.error(`scenario ${name} failed: ${err?.message ?? err}`)
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
  if (fs.existsSync(results)) console.log(fs.readFileSync(results, 'utf8'))
}
process.exit(failed ? 1 : 0)
