#!/usr/bin/env node
// PLAN-6 1-L: min + gzip bytes of the chat driver (esbuild, minified ESM; gzip level 9). Needs
// `npm run build` (the app rows bundle dist/). Run from the repo root:
//   node dev-plans/research/p6-spikes/1L-bytes.mjs
import { build } from 'esbuild'
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const repo = process.cwd()
// inside the package, so 'sygnal' and 'sygnal/ai' resolve as a self-reference (its exports)
const tmp = fs.mkdtempSync(path.join(repo, 'dev-plans/research/p6-spikes/.tmp-'))
const gz = (s) => zlib.gzipSync(s, { level: 9 }).length
let n = 0
const bundle = async (name, code, external = []) => {
  const entry = path.join(tmp, `e${n++}.js`)
  fs.writeFileSync(entry, code)
  const r = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', write: false, external, absWorkingDir: repo, nodePaths: [path.join(repo, 'node_modules')], logLevel: 'silent' })
  const out = r.outputFiles[0].text
  return { name, min: out.length, gzip: gz(out) }
}
const src = (p) => JSON.stringify(path.join(repo, p))
const rows = []
try {
  // what the driver adds to an app that already has the core (replies, diagnostics, standardSchema, xstream)
  rows.push(await bundle('makeChatDriver + output + messageText (core modules external)', `export {makeChatDriver, messageText} from ${src('src/extra/ai/index.ts')}`,
    ['xstream', '*/replies', '*/diagnostics/legacy', '*/diagnostics/index', '*/standardSchema']))
  rows.push(await bundle('memoryTransport (the L-4 fake\'s)', `export {memoryTransport} from ${src('src/extra/ai/chat/memoryTransport.ts')}`))
  const app = (withAi) => `import {run} from 'sygnal'
${withAi ? "import {makeChatDriver} from 'sygnal/ai'" : ''}
function App({state}) { return {sel: 'p', data: {}, children: [], text: state.t} }
App.initialState = {t: ''}
run(App, {${withAi ? 'LLM: makeChatDriver({transport: {stream: async function* () {}}})' : ''}})`
  const base = await bundle('app without sygnal/ai', app(false))
  const withAi = await bundle('app with makeChatDriver', app(true))
  rows.push(base, withAi, { name: 'app marginal (with - without)', min: withAi.min - base.min, gzip: withAi.gzip - base.gzip })
  console.table(rows)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
