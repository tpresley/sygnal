// R6 (Phase 2 review): the default sygnal-check `include` of the Vite plugin
// finds Vike (pages/, renderer/) and root-layout apps instead of checking 0
// files under a missing src/ and printing a false all-clear.
// Runs against the built plugin (npm run build).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sygnal from '../dist/vite/plugin.mjs'

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

function project(subdirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-include-'))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"app","type":"module"}')
  const pkg = path.join(dir, 'node_modules', 'sygnal-check')
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"sygnal-check","type":"module","main":"index.js"}')
  fs.writeFileSync(path.join(pkg, 'index.js'), 'export function check(inputs, options) { globalThis.__includeCalls.push({ cwd: options.cwd, inputs }); return [] }')
  for (const d of subdirs) fs.mkdirSync(path.join(dir, d))
  return dir
}

async function inputsFor(subdirs, options) {
  globalThis.__includeCalls = globalThis.__includeCalls || []
  const dir = project(subdirs)
  const plugin = sygnal(options)
  const saved = process.env.VITEST
  delete process.env.VITEST
  try { plugin.config({ root: dir }, { command: 'serve' }) } finally { if (saved !== undefined) process.env.VITEST = saved }
  plugin.configResolved({ root: dir })
  const logs = []
  plugin.configureServer({
    config: { logger: { info: m => logs.push(m), warn: m => logs.push(m) } },
    ws: { send() {}, on() {} },
    watcher: { on() {} },
  })
  const end = Date.now() + 3000
  let call
  while (!(call = globalThis.__includeCalls.find(c => c.cwd === dir))) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 20))
  }
  return { inputs: call.inputs, notices: logs.filter(m => m.startsWith('[sygnal] sygnal-check:')) }
}

describe('vite plugin — default sygnal-check include (R6)', () => {
  it('checks src/ when it exists', async () => {
    expect(await inputsFor(['src', 'public'])).toEqual({ inputs: ['src'], notices: [] })
  })

  it('checks pages/ and renderer/ in a Vike app', async () => {
    expect(await inputsFor(['pages'])).toEqual({ inputs: ['pages'], notices: [] })
    expect(await inputsFor(['renderer', 'pages'])).toEqual({ inputs: ['pages', 'renderer'], notices: [] })
  })

  it('falls back to the project root, with one notice, when none exists', async () => {
    const r = await inputsFor(['public'])
    expect(r.inputs).toEqual(['.'])
    expect(r.notices).toHaveLength(1)
    expect(r.notices[0]).toMatch(/no src\/, pages\/, renderer\/ directory .*checking the project root/)
  })

  it('an explicit include is used as given; a notice when none of it exists', async () => {
    expect(await inputsFor(['app'], { check: { include: ['app'] } })).toEqual({ inputs: ['app'], notices: [] })
    const r = await inputsFor([], { check: { include: ['nope'] } })
    expect(r.inputs).toEqual(['nope'])
    expect(r.notices[0]).toMatch(/none of check\.include \(nope\) exists/)
  })
})
