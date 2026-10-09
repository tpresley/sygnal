#!/usr/bin/env node
// PLAN-6 2-T: min + gzip bytes each L-2 transport adds to an app that already uses
// makeChatDriver (esbuild, minified ESM, gzip -9), and a tree-shaking check: an app importing one
// transport carries none of the others. Needs `npm run build`. Run from the repo root:
//   node dev-plans/research/p6-spikes/2T-bytes.mjs
import { build } from 'esbuild'
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const repo = process.cwd()
const tmp = fs.mkdtempSync(path.join(repo, 'dev-plans/research/p6-spikes/.tmp-'))
const gz = (s) => zlib.gzipSync(s, { level: 9 }).length
let n = 0
const bundle = async (code) => {
  const entry = path.join(tmp, `e${n++}.js`)
  fs.writeFileSync(entry, code)
  const r = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', write: false, absWorkingDir: repo, nodePaths: [path.join(repo, 'node_modules')], logLevel: 'silent' })
  return r.outputFiles[0].text
}
const app = (imports, use) => `import {run} from 'sygnal'
import {makeChatDriver${imports ? ', ' + imports : ''}} from 'sygnal/ai'
function App({state}) { return {sel: 'p', data: {}, children: [], text: state.t} }
App.initialState = {t: ''}
run(App, {LLM: makeChatDriver({transport: ${use || '{stream: async function* () {}}'}})})`
const MARK = { openResponses: 'openResponses:', chatCompletions: 'chatCompletions:', uiMessageStream: 'uiMessageStream:', chromePrompt: 'chromePrompt:', strict: 'uniqueItems', encodeOpenResponses: 'response.output_text.done' }
const rows = []
try {
  const base = await bundle(app('', ''))
  rows.push({ name: 'app + makeChatDriver (base)', min: base.length, gzip: gz(base) })
  const cases = {
    openResponses: ["openResponses({model: 'm'})", 'openResponses'],
    chatCompletions: ["chatCompletions({model: 'm'})", 'chatCompletions'],
    'openResponses + chatCompletions': ["openResponses({model: 'm'}) || chatCompletions({model: 'm'})", 'openResponses, chatCompletions'],
    uiMessageStream: ["uiMessageStream('/api/chat')", 'uiMessageStream'],
    chromePrompt: ['chromePrompt()', 'chromePrompt'],
    encodeOpenResponses: ["{stream: async function* () {}, e: encodeOpenResponses(['x'])}", 'encodeOpenResponses'],
  }
  for (const [name, [use, imports]] of Object.entries(cases)) {
    const out = await bundle(app(imports, use))
    const present = Object.entries(MARK).filter(([, m]) => out.includes(m)).map(([k]) => k)
    rows.push({ name: `+ ${name}`, min: out.length - base.length, gzip: gz(out) - gz(base), carries: present.join(' ') })
  }
  console.table(rows)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
