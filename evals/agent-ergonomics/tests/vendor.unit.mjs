// G-179: verify.mjs reuses its --work dir. `npm pack` always names the tarball
// <name>-<version>.tgz and npm does not re-extract a `file:` tarball whose path
// is unchanged, so a rebuilt package used to stay stale. vendorTarball()
// vendors it under a content-hashed name; a real npm install shows the new
// build replaces the old one on reuse, and an unchanged build keeps its spec.
// Run: node --test evals/agent-ergonomics/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { npm, vendorTarball } from '../lib/common.mjs'

function packVersion(src, packDir, body) {
  fs.writeFileSync(path.join(src, 'index.js'), `module.exports = ${JSON.stringify(body)}\n`)
  const r = npm(['pack', src, '--json', '--pack-destination', packDir], packDir)
  return path.join(packDir, JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0].filename)
}

function install(work, tarball) {
  const spec = vendorTarball(tarball, work, 'g179-fixture')
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'g179-work', private: true, dependencies: { 'g179-fixture': spec } }, null, 2))
  npm(['install', '--no-audit', '--no-fund', '--offline', '--loglevel=error'], work)
  return { spec, installed: fs.readFileSync(path.join(work, 'node_modules', 'g179-fixture', 'index.js'), 'utf8') }
}

test('vendorTarball: a rebuilt tarball with the same file name is installed into a reused dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g179-'))
  try {
    const src = path.join(root, 'src')
    const packDir = path.join(root, 'pack')
    const work = path.join(root, 'work')
    for (const d of [src, packDir, work]) fs.mkdirSync(d)
    fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'g179-fixture', version: '1.0.0', main: 'index.js' }))

    const t1 = packVersion(src, packDir, 'build-1')
    const first = install(work, t1)
    assert.equal(first.installed, 'module.exports = "build-1"\n')

    // Unchanged build: same spec, so the reused install is left as is.
    const again = install(work, packVersion(src, packDir, 'build-1'))
    assert.equal(again.spec, first.spec)

    // Rebuild: same tarball file name and version, different content.
    const t2 = packVersion(src, packDir, 'build-2')
    assert.equal(t2, t1, 'npm pack reuses the file name, which is what made the install stale')
    const second = install(work, t2)
    assert.notEqual(second.spec, first.spec)
    assert.equal(second.installed, 'module.exports = "build-2"\n')
    // The superseded vendored copy is removed.
    assert.deepEqual(fs.readdirSync(path.join(work, 'vendor')), [second.spec.slice('file:vendor/'.length)])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
