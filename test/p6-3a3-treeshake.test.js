// PLAN-6 A-3 / D291 (as D285): the form tool is pay per use. An app bundle with `form` but
// without `formTool` carries none of the tool code; `formTool` from 'sygnal/ai' brings it. Bundles
// small apps against dist/ with esbuild, as an app's bundler would (node environment: esbuild
// doesn't run under jsdom). The byte delta against plan6-integration's form is measured by hand
// (0 B, PLAN-6 status).
import { describe, it, expect, afterAll } from 'vitest'
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import * as ai from '../dist/ai.esm.js'
import * as main from '../dist/index.esm.js'

const repo = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(repo, 'test/.tmp-3a3-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
let n = 0
const bundle = async (src) => {
  const entry = path.join(tmp, `e${n++}.js`)
  fs.writeFileSync(entry, src)
  const r = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', write: false, absWorkingDir: repo, nodePaths: [path.join(repo, 'node_modules')], logLevel: 'silent' })
  return r.outputFiles[0].text
}
// strings only formTool.ts has
const MARKS = ['toolparamdescription', 'tooldescription', 'A submit is already running', 'The form was removed']
const has = (src) => MARKS.filter((m) => src.includes(m))

describe('A-3 form tool tree-shake (dist, D291)', () => {
  it('formTool is the same function in sygnal and sygnal/ai', () => {
    expect(typeof ai.formTool).toBe('function')
    expect(ai.formTool).toBe(main.formTool)
  })

  it('an app bundle with form but without formTool carries none of the tool code (dist, esbuild)', async () => {
    const plain = await bundle(`import {run, form} from 'sygnal'; window.x = [run, form]`)
    const withTool = await bundle(`import {run, form} from 'sygnal'; import {formTool} from 'sygnal/ai'; window.x = [run, form, formTool]`)
    expect(has(plain)).toEqual([])
    expect(has(withTool)).toEqual(MARKS)
  }, 30000)
})
