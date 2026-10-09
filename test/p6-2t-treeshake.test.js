// PLAN-6 §3 gate (2-T): each L-2 transport is absent from an app unless imported. Bundles small
// apps against dist/ (esbuild, as an app's bundler would) and looks for each transport's marker.
import { describe, it, expect, afterAll } from 'vitest'
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(repo, 'test/.tmp-2t-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
let n = 0
const bundle = async (imports, use) => {
  const entry = path.join(tmp, `e${n++}.js`)
  fs.writeFileSync(entry, `import {run} from 'sygnal'
import {makeChatDriver${imports ? ', ' + imports : ''}} from 'sygnal/ai'
function App() { return {sel: 'p', data: {}, children: [], text: ''} }
run(App, {LLM: makeChatDriver({transport: ${use}})})`)
  const r = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', write: false, absWorkingDir: repo, nodePaths: [path.join(repo, 'node_modules')], logLevel: 'silent' })
  return r.outputFiles[0].text
}
// strings only each module has
const MARK = {
  openResponses: 'openResponses:', chatCompletions: 'chatCompletions:', uiMessageStream: 'uiMessageStream:',
  chromePrompt: 'chromePrompt:', encodeOpenResponses: 'response.output_text.done', strictify: 'uniqueItems', sse: 'the response has no body',
}
const has = src => Object.keys(MARK).filter(k => src.includes(MARK[k]))

describe('L-2 transports tree-shake (dist)', () => {
  it('an app with the driver and its own transport carries no L-2 code', async () => {
    expect(has(await bundle('', '{stream: async function* () {}}'))).toEqual([])
  }, 30000)

  it('each transport brings only itself (and the strict layer only with the OpenAI-shaped ones)', async () => {
    expect(has(await bundle('openResponses', "openResponses({model: 'm'})"))).toEqual(['openResponses', 'strictify', 'sse'])
    expect(has(await bundle('chatCompletions', "chatCompletions({model: 'm'})"))).toEqual(['chatCompletions', 'strictify', 'sse'])
    expect(has(await bundle('uiMessageStream', "uiMessageStream('/api/chat')"))).toEqual(['uiMessageStream', 'sse'])
    expect(has(await bundle('chromePrompt', 'chromePrompt()'))).toEqual(['chromePrompt'])
  }, 30000)
})
