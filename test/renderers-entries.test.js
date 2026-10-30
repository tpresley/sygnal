// The renderer entries keep one core and one kit per app: sygnal/host imports the external
// 'sygnal'; sygnal/terminal and sygnal/agent-ui import the external 'sygnal' and 'sygnal/host'.
// Both formats load in plain Node (no bundler).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const dist = path.resolve(__dirname, '../dist')
const read = (f) => fs.readFileSync(path.join(dist, f), 'utf8')
const imports = (src) => [...src.matchAll(/(?:from |require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((s) => !s.startsWith('.'))

describe('renderer entries', () => {
  it('sygnal/host: snabbdom and the external core, nothing else', () => {
    for (const f of ['host.esm.js', 'host.cjs.js']) {
      const deps = new Set(imports(read(f)))
      expect([...deps].filter((d) => !d.startsWith('snabbdom/'))).toEqual(['sygnal'])
      // no second core: the runtime's queue and the pragma stay in 'sygnal'
      expect(read(f)).not.toMatch(/class App\b|createElementWithModules/)
    }
  })

  it('sygnal/terminal and sygnal/agent-ui: the external core and kit only', () => {
    for (const e of ['terminal', 'agent-ui']) for (const f of [`${e}.esm.js`, `${e}.cjs.js`]) {
      expect(new Set(imports(read(f)))).toEqual(new Set(['sygnal', 'sygnal/host']))
      expect(read(f)).not.toMatch(/class HostElement/)
    }
  })

  it('load in plain Node, ESM and CommonJS', () => {
    const cwd = path.resolve(__dirname, '..')
    const esm = execFileSync(process.execPath, ['--input-type=module', '-e', "import {createTerminal} from 'sygnal/terminal'; import {createAgentUI} from 'sygnal/agent-ui'; import {run, createElement as h} from 'sygnal'; const t = createTerminal(); const a = run(() => h('p', null, 'hi'), {DOM: t.driver}); setTimeout(() => { console.log(t.frame(), typeof createAgentUI); a.dispose() }, 10)"], { cwd, encoding: 'utf8' })
    expect(esm.trim()).toBe('hi function')
    const cjs = execFileSync(process.execPath, ['-e', "const {createAgentUI} = require('sygnal/agent-ui'); const {run, createElement: h} = require('sygnal'); const ui = createAgentUI(); const a = run(() => h('button', null, 'Go'), {DOM: ui.driver}); setTimeout(() => { console.log(ui.snapshot().replace(/e\\d+/, 'e1')); a.dispose() }, 10)"], { cwd, encoding: 'utf8' })
    expect(cjs.trim()).toBe('- button "Go" [ref=e1]')
  })
})
