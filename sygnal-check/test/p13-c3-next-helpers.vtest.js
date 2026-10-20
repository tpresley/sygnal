// PLAN-13 C-3 (#26): next() passed into a helper, imported or not: the helper's next('X') calls
// count as the component's (SYG102 triggers, SYG117 targets), reported in the helper's file
import { describe, expect, it } from 'vitest'
import { checkFiles } from '../src/index.js'

const DIR = '/virtual/app'
function run(files) {
  const sources = Object.fromEntries(Object.entries(files).map(([k, v]) => [`${DIR}/${k}`, v]))
  return checkFiles(Object.keys(sources), { cwd: DIR, sources }).filter(d => ['SYG102', 'SYG117', 'SYG900'].includes(d.code))
}
const app = (head, model) => `import { run } from 'sygnal'
${head}
function App() { return <button className="go">go</button> }
App.initialState = { step: 0 }
App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
App.model = ${model}
run(App)
`

describe('C-3: next() inside a helper', () => {
  it('an imported helper (another parameter name): its targets trigger the entries', () => {
    const d = run({
      'App.jsx': app(`import { advance } from './flow.js'`, `{ GO: { EFFECT: (s, d, next) => advance(s, next) }, NEXT_STEP: (s) => s, DONE: (s) => s }`),
      'flow.js': `export function advance(state, go) { if (state.step > 2) go('DONE'); else go('NEXT_STEP') }\n`,
    })
    expect(d).toEqual([])
  })

  it('a misspelled target in the helper is SYG117, at the helper\'s line', () => {
    const d = run({
      'App.jsx': app(`import { advance } from './flow.js'`, `{ GO: { EFFECT: (s, d, next) => advance(s, next) }, NEXT_STEP: (s) => s }`),
      'flow.js': `export const advance = (state, go) => {\n  go('NEXT_STPE')\n}\n`,
    })
    const s117 = d.find(x => x.code === 'SYG117')
    expect(s117).toMatchObject({ data: { action: 'NEXT_STPE', suggestion: 'NEXT_STEP' } })
    expect(s117.file).toMatch(/flow\.js$/)
    expect(s117.line).toBe(2)
    expect(d.filter(x => x.code === 'SYG102').map(x => x.data.action)).toEqual(['NEXT_STEP'])
  })

  it('through a chain of helpers, and a same-file helper with a renamed parameter', () => {
    const d = run({
      'App.jsx': app(`import { outer } from './flow.js'\nconst local = (n) => n('LOCAL')`, `{ GO: { EFFECT: (s, d, next) => { outer(next); local(next) } }, DEEP: (s) => s, LOCAL: (s) => s }`),
      'flow.js': `import { inner } from './inner.js'\nexport const outer = (fn) => inner(fn)\n`,
      'inner.js': `export const inner = (f) => f('DEEP')\n`,
    })
    expect(d).toEqual([])
  })

  it('a helper the checker cannot read makes the targets unknown: SYG102 becomes info', () => {
    const d = run({ 'App.jsx': app(`import { advance } from 'some-flow-lib'`, `{ GO: { EFFECT: (s, d, next) => advance(next) }, LATER: (s) => s }`) })
    expect(d.map(x => [x.code, x.severity, x.data.action])).toEqual([['SYG102', 'info', 'LATER']])
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { afterEach } from 'vitest'
import { startServer, tempDir, uriOf } from './lsp-helpers.js'

let cleanup = []
afterEach(() => { for (const f of cleanup.splice(0)) f() })

describe('C-3 in the language server', () => {
  it("editing the helper re-checks the component that passes it next", async () => {
    const dir = tempDir({
      'package.json': '{ "name": "p", "private": true }',
      'src/App.jsx': app(`import { advance } from './flow.js'`, `{ GO: { EFFECT: (s, d, next) => advance(s, next) }, NEXT_STEP: (s) => s }`),
      'src/flow.js': `export const advance = (state, go) => go('NEXT_STPE')\n`,
    })
    const client = startServer()
    cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
    await client.initialize({ rootUri: uriOf(dir) })
    const A = path.join(dir, 'src/App.jsx'), F = path.join(dir, 'src/flow.js')
    client.open(A, fs.readFileSync(A, 'utf8'))
    client.open(F, fs.readFileSync(F, 'utf8'))
    await client.settle()
    expect(client.diags(A).map(d => d.code)).toContain('SYG102')
    expect(client.diags(F).map(d => d.code)).toContain('SYG117')
    client.change(F, `export const advance = (state, go) => go('NEXT_STEP')\n`)
    await client.settle()
    expect(client.diags(F)).toEqual([])
    expect(client.diags(A).map(d => d.code)).not.toContain('SYG102')
  })
})
