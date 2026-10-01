// G-045: the 'sygnal/config' (vike) types have a default export, so
// `import vikeSygnal from 'sygnal/config'` type-checks (the vike-ts template).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function typeErrors(code) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-vike-types-'))
  const file = path.join(tmp, '+config.ts')
  fs.writeFileSync(file, code)
  const program = ts.createProgram([file], {
    noEmit: true, strict: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true,
    // 'sygnal/config' → the package's declared types for that export
    paths: { 'sygnal/config': [path.join(REPO, pkg.exports['./config'].types)] },
  })
  return ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe("'sygnal/config' types (G-045)", () => {
  it('the three vike config exports share one types file', () => {
    const types = ['./vike', './vike/config', './config'].map(k => pkg.exports[k].types)
    expect(new Set(types).size).toBe(1)
  })

  it('has a default export usable in `extends`, and keeps the Vike.Config augmentation', () => {
    expect(typeErrors(`import vikeSygnal from 'sygnal/config'
const name: 'sygnal' = vikeSygnal.name
const settings: Vike.Config = { title: 'x', lang: 'en', ssr: false, drivers: {} }
export default { extends: [vikeSygnal], title: 'Sygnal + Vike', name, settings }
`)).toEqual([])
  })

  it('still rejects wrong setting types', () => {
    expect(typeErrors(`import 'sygnal/config'
export const bad: Vike.Config = { ssr: 'no' }
`).length).toBeGreaterThan(0)
  })
})
