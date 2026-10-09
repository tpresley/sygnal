// PLAN-6 §3 gate (3-M): commandBar and answers() are absent from an app unless imported, and an
// app with only chat() carries neither (the shared link is the only common module). Bundles small
// apps against dist/ (esbuild, as an app's bundler would) and looks for each module's marker.
// BYTES=1 prints the min + gzip bytes each adds.
import { describe, it, expect, afterAll } from 'vitest'
import { build } from 'esbuild'
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(repo, 'test/.tmp-3m-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
let n = 0
const bundle = async (imports, uses) => {
  const entry = path.join(tmp, `e${n++}.js`)
  fs.writeFileSync(entry, `import {run, makeFetchDriver} from 'sygnal'
${imports ? `import {${imports}} from 'sygnal/ai'` : ''}
function App() { return {sel: 'p', data: {}, children: [], text: ''} }
App.uses = {${uses}}
run(App, {HTTP: makeFetchDriver()})`)
  const r = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', write: false, absWorkingDir: repo, nodePaths: [path.join(repo, 'node_modules')], logLevel: 'silent' })
  return r.outputFiles[0].text
}
// strings only each module has
const MARK = { commandBar: 'None of these actions', answers: 'answers(): ', chat: 'not run: the step limit', link: 'sygnal.aiBehavior', agent: 'two agent declarations are named' }
const has = (src) => Object.keys(MARK).filter((k) => src.includes(MARK[k]))
const gz = (s) => zlib.gzipSync(s, { level: 9 }).length

describe('M-2 / M-3 tree-shake (dist)', () => {
  it('each brings only itself (and the agent layer + the shared link for the behaviors)', async () => {
    const base = await bundle('', '')
    const cases = {
      chat: ['chat', 'a: chat()'],
      commandBar: ['commandBar', "c: commandBar({input: '.c', decide: {model: 'm'}})"],
      'chat + commandBar': ['chat, commandBar', "a: chat(), c: commandBar({input: '.c', decide: {model: 'm'}})"],
      answers: ['answers', "x: answers({q: {type: 'noul'}})"],
    }
    const out = {}
    for (const [name, [imports, uses]] of Object.entries(cases)) out[name] = await bundle(imports, uses)
    expect(has(base)).toEqual([])
    expect(has(out.chat)).toEqual(['chat', 'link', 'agent'])
    expect(has(out.commandBar)).toEqual(['commandBar', 'link', 'agent'])
    expect(has(out['chat + commandBar'])).toEqual(['commandBar', 'chat', 'link', 'agent'])
    expect(has(out.answers)).toEqual(['answers'])
    if (process.env.BYTES) {
      console.table(Object.fromEntries([['app + makeFetchDriver (base)', { min: base.length, gzip: gz(base) }],
        ...Object.entries(out).map(([k, v]) => [`+ ${k}`, { min: v.length - base.length, gzip: gz(v) - gz(base) }])]))
    }
  }, 60000)
})
