// Unit tests for the server resolution (D301) and the Sygnal detection: plain Node (node --test),
// no VS Code. Node strips the TypeScript types.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  compareVersions, readCheckCopy, findWorkspaceCheck, chooseServer, usesSygnal, packageFileUsesSygnal, describeChoice,
  lacksEditorFeatures,
} from '../../src/resolve.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygvsc-unit-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

function fakeCheck(dir: string, version: string, { lsp = false, bin = true } = {}) {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sygnal-check', version, bin: { 'sygnal-check': 'bin/sygnal-check.js' } }))
  if (bin) fs.writeFileSync(path.join(dir, 'bin/sygnal-check.js'), '')
  if (lsp) { fs.mkdirSync(path.join(dir, 'src/lsp'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src/lsp/server.js'), '') }
  return dir
}
function folder(name: string) { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d }

const bundled = fakeCheck(path.join(tmp, 'ext/server/sygnal-check'), '0.4.0', { lsp: true })

test('compareVersions', () => {
  assert.equal(compareVersions('0.4.0', '0.4.0'), 0)
  assert.ok(compareVersions('0.4.1', '0.4.0') > 0)
  assert.ok(compareVersions('0.3.9', '0.4.0') < 0)
  assert.ok(compareVersions('1.0.0', '0.4.0') > 0)
  assert.ok(compareVersions('0.10.0', '0.4.0') > 0)
  assert.ok(compareVersions('0.4.0-beta.1', '0.4.0') < 0)
  assert.ok(compareVersions('v0.5.0', '0.4.0') > 0)
})

test('readCheckCopy: version or capability decides', () => {
  assert.equal(readCheckCopy(fakeCheck(path.join(tmp, 'c/new'), '0.4.0'))?.capable, true)
  assert.equal(readCheckCopy(fakeCheck(path.join(tmp, 'c/old'), '0.3.0'))?.capable, false)
  // the repository's checker: 0.3.0 in package.json, but it has the server
  assert.equal(readCheckCopy(fakeCheck(path.join(tmp, 'c/repo'), '0.3.0', { lsp: true }))?.capable, true)
  assert.equal(readCheckCopy(fakeCheck(path.join(tmp, 'c/nobin'), '0.4.0', { bin: false })), undefined)
  assert.equal(readCheckCopy(path.join(tmp, 'c/missing')), undefined)
  const other = folder('c/other'); fs.writeFileSync(path.join(other, 'package.json'), '{"name":"not-it","version":"9.0.0"}')
  assert.equal(readCheckCopy(other), undefined)
})

test('findWorkspaceCheck walks up node_modules like Node', () => {
  const mono = folder('mono')
  fakeCheck(path.join(mono, 'node_modules/sygnal-check'), '0.4.2')
  const pkg = folder('mono/packages/app')
  assert.equal(findWorkspaceCheck(pkg)?.version, '0.4.2')
  fakeCheck(path.join(pkg, 'node_modules/sygnal-check'), '0.5.0')
  assert.equal(findWorkspaceCheck(pkg)?.version, '0.5.0', 'the nearest copy wins')
  assert.equal(findWorkspaceCheck(folder('lonely/x')), undefined)
})

test('chooseServer: workspace copy first', () => {
  const ws = folder('ws1'); fakeCheck(path.join(ws, 'node_modules/sygnal-check'), '0.4.1')
  const c = chooseServer([ws], bundled)
  assert.equal(c.source, 'workspace'); assert.equal(c.version, '0.4.1'); assert.equal(c.folder, ws)
  assert.match(describeChoice(c), /0\.4\.1 from the workspace/)
})

test('chooseServer: bundled when there is none', () => {
  const c = chooseServer([folder('ws2')], bundled)
  assert.equal(c.source, 'bundled'); assert.equal(c.reason, 'none'); assert.equal(c.dir, bundled)
  assert.match(describeChoice(c), /bundled with the extension \(no sygnal-check in the workspace\)/)
  assert.equal(chooseServer([], bundled).reason, 'none')
})

test('chooseServer: bundled, with the reason, when the workspace copy is too old', () => {
  const ws = folder('ws3'); fakeCheck(path.join(ws, 'node_modules/sygnal-check'), '0.3.0')
  const c = chooseServer([ws], bundled)
  assert.equal(c.source, 'bundled'); assert.equal(c.reason, 'too-old'); assert.equal(c.old?.version, '0.3.0')
  assert.match(describeChoice(c), /workspace's sygnal-check 0\.3\.0 has no language server \(needs 0\.4\.0\+\)/)
})

test('chooseServer: a later folder with a capable copy beats an earlier old one', () => {
  const old = folder('ws4a'); fakeCheck(path.join(old, 'node_modules/sygnal-check'), '0.2.0')
  const good = folder('ws4b'); fakeCheck(path.join(good, 'node_modules/sygnal-check'), '0.4.0')
  const c = chooseServer([old, good], bundled)
  assert.equal(c.source, 'workspace'); assert.equal(c.folder, good)
})

test('chooseServer: an untrusted workspace never runs its own copy', () => {
  const ws = folder('ws5'); fakeCheck(path.join(ws, 'node_modules/sygnal-check'), '0.4.0')
  const c = chooseServer([ws], bundled, { trusted: false })
  assert.equal(c.source, 'bundled'); assert.equal(c.reason, 'untrusted')
})

test('chooseServer throws when the bundled copy is missing', () => {
  assert.throws(() => chooseServer([], path.join(tmp, 'nope')), /bundled sygnal-check is missing/)
})

test('usesSygnal', () => {
  assert.equal(usesSygnal({ dependencies: { sygnal: '^6.1.0' } }), true)
  assert.equal(usesSygnal({ devDependencies: { 'sygnal-check': '^0.4.0' } }), true)
  assert.equal(usesSygnal({ peerDependencies: { sygnal: '*' } }), true)
  assert.equal(usesSygnal({ 'sygnal-check': { strict: true } }), true)
  assert.equal(usesSygnal({ name: 'sygnal' }), true)
  assert.equal(usesSygnal({ dependencies: { react: '^19' } }), false)
  assert.equal(usesSygnal({ dependencies: { 'sygnal-ish': '1' } }), false)
  assert.equal(usesSygnal(null), false)
  const f = path.join(folder('pkgs'), 'package.json')
  fs.writeFileSync(f, '{ not json'); assert.equal(packageFileUsesSygnal(f), false)
  fs.writeFileSync(f, '{"dependencies":{"sygnal":"6"}}'); assert.equal(packageFileUsesSygnal(f), true)
  assert.equal(packageFileUsesSygnal(path.join(tmp, 'none/package.json')), false)
})

test('lacksEditorFeatures: a workspace copy before 0.5.0 without the completion module', () => {
  const old = folder('feat-old'); fakeCheck(path.join(old, 'node_modules/sygnal-check'), '0.4.0', { lsp: true })
  assert.equal(lacksEditorFeatures(chooseServer([old], bundled)), true)
  const cur = folder('feat-new'); fakeCheck(path.join(cur, 'node_modules/sygnal-check'), '0.5.0', { lsp: true })
  assert.equal(lacksEditorFeatures(chooseServer([cur], bundled)), false)
  // the repository's checker: an older version string, but it has the features
  const repo = folder('feat-repo'); const d = fakeCheck(path.join(repo, 'node_modules/sygnal-check'), '0.4.0', { lsp: true })
  fs.writeFileSync(path.join(d, 'src/lsp/completion.js'), '')
  assert.equal(lacksEditorFeatures(chooseServer([repo], bundled)), false)
  // the bundled copy never triggers it
  assert.equal(lacksEditorFeatures(chooseServer([folder('feat-none')], bundled)), false)
})
