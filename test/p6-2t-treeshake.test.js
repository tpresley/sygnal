// PLAN-6 §3 gate (2-T, 3-W2): each L-2 transport is absent from an app unless imported, and the
// strict layer is absent unless `strictSchemas` is (D285). Bundles small apps against dist/
// (esbuild, as an app's bundler would) and looks for each module's marker; the gzip sizes over the
// driver alone are printed (TREESHAKE_REPORT=1) and the strict layer's is checked.
import { describe, it, expect, afterAll } from 'vitest'
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

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
const gz = s => zlib.gzipSync(s, { level: 9 }).length
// strings only each module has
const MARK = {
  openResponses: 'openResponses:', chatCompletions: 'chatCompletions:', uiMessageStream: 'uiMessageStream:',
  chromePrompt: 'chromePrompt:', encodeOpenResponses: 'response.output_text.done', strictify: 'uniqueItems', sse: 'the response has no body',
  anthropicMessages: 'anthropic-version', agui: 'TOOL_CALL_START', fromAISDK: 'fromAISDK:',
}
const has = src => Object.keys(MARK).filter(k => src.includes(MARK[k]))

describe('L-2 transports tree-shake (dist)', () => {
  it('an app with the driver and its own transport carries no L-2 code', async () => {
    expect(has(await bundle('', '{stream: async function* () {}}'))).toEqual([])
  }, 30000)

  it('each transport brings only itself; the strict layer only with strictSchemas (D285)', async () => {
    const base = gz(await bundle('', '{stream: async function* () {}}'))
    const cases = [
      ['openResponses', "openResponses({model: 'm'})", ['openResponses', 'sse']],
      ['openResponses, strictSchemas', "openResponses({model: 'm', strict: strictSchemas})", ['openResponses', 'strictify', 'sse']],
      ['chatCompletions', "chatCompletions({model: 'm'})", ['chatCompletions', 'sse']],
      ['chatCompletions, strictSchemas', "chatCompletions({model: 'm', strict: strictSchemas})", ['chatCompletions', 'strictify', 'sse']],
      ['uiMessageStream', "uiMessageStream('/api/chat')", ['uiMessageStream', 'sse']],
      ['chromePrompt', 'chromePrompt()', ['chromePrompt']],
      ['anthropicMessages', "anthropicMessages({model: 'm'})", ['sse', 'anthropicMessages']],
      ['anthropicMessages, strictSchemas', "anthropicMessages({model: 'm', strict: strictSchemas})", ['strictify', 'sse', 'anthropicMessages']],
      ['agui', "agui('/api/agent')", ['sse', 'agui']],
      ['fromAISDK', 'fromAISDK({streamText: () => ({}), model: {}})', ['fromAISDK']],
    ]
    const size = {}
    for (const [imports, use, want] of cases) {
      const src = await bundle(imports, use)
      expect(has(src), imports).toEqual(want)
      size[imports] = gz(src) - base
    }
    if (process.env.TREESHAKE_REPORT) for (const k in size) process.stderr.write(`[L-2 bytes over the driver, gzip] ${k}: ${size[k]} B\n`)
    // D285: what an app that doesn't import the strict layer saves
    for (const t of ['openResponses', 'chatCompletions', 'anthropicMessages']) {
      const saved = size[t + ', strictSchemas'] - size[t]
      expect(saved, t).toBeGreaterThan(700)
      expect(saved, t).toBeLessThan(1600)
    }
  }, 60000)
})
