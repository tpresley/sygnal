// The renderer entries keep one core and one kit per app: sygnal/host imports the external
// 'sygnal'; sygnal/terminal and sygnal/agent-ui import the external 'sygnal' and 'sygnal/host'.
// sygnal/three imports the external 'sygnal', 'sygnal/host' and 'three'. Both formats load in
// plain Node (no bundler).
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

  it('sygnal/three: the external core, kit and three only (an optional peer, D209)', () => {
    for (const f of ['three.esm.js', 'three.cjs.js']) {
      expect(new Set(imports(read(f)))).toEqual(new Set(['sygnal', 'sygnal/host', 'three']))
      expect(read(f)).not.toMatch(/class HostElement|class App\b|createElementWithModules/)
    }
  })

  it('sygnal/three loads in plain Node: a host scene, a raycast click', () => {
    const cwd = path.resolve(__dirname, '..')
    const app = "const Box = ({ state }) => h('mesh', { className: 'box', position: [state.x, 0, 0] }, h('boxGeometry')); Box.intent = ({ DOM }) => ({ HIT: DOM.click('.box') }); Box.model = { HIT: (s) => ({ ...s, hits: s.hits + 1 }) }; Box.initialState = { x: 0, hits: 0 };"
    const go = "const host = createThreeHost({ width: 100, height: 100 }); const a = run(Box, { DOM: host.driver }); setTimeout(() => { host.click(host.doc.querySelector('.box')); setTimeout(() => { console.log(a.__runtime.getState().hits); a.dispose() }, 10) }, 10)"
    const esm = execFileSync(process.execPath, ['--input-type=module', '-e', `import {createThreeHost} from 'sygnal/three'; import {run, createElement as h} from 'sygnal'; ${app} ${go}`], { cwd, encoding: 'utf8' })
    expect(esm.trim()).toBe('1')
    const cjs = execFileSync(process.execPath, ['-e', `const {createThreeHost} = require('sygnal/three'); const {run, createElement: h} = require('sygnal'); ${app} ${go}`], { cwd, encoding: 'utf8' })
    expect(cjs.trim()).toBe('1')
  })

  it('load in plain Node, ESM and CommonJS', () => {
    const cwd = path.resolve(__dirname, '..')
    const esm = execFileSync(process.execPath, ['--input-type=module', '-e', "import {createTerminal} from 'sygnal/terminal'; import {createAgentUI} from 'sygnal/agent-ui'; import {run, createElement as h} from 'sygnal'; const t = createTerminal(); const a = run(() => h('p', null, 'hi'), {DOM: t.driver}); setTimeout(() => { console.log(t.frame(), typeof createAgentUI); a.dispose() }, 10)"], { cwd, encoding: 'utf8' })
    expect(esm.trim()).toBe('hi function')
    const cjs = execFileSync(process.execPath, ['-e', "const {createAgentUI} = require('sygnal/agent-ui'); const {run, createElement: h} = require('sygnal'); const ui = createAgentUI(); const a = run(() => h('button', null, 'Go'), {DOM: ui.driver}); setTimeout(() => { console.log(ui.snapshot().replace(/e\\d+/, 'e1')); a.dispose() }, 10)"], { cwd, encoding: 'utf8' })
    expect(cjs.trim()).toBe('- button "Go" [ref=e1]')
  })
})
