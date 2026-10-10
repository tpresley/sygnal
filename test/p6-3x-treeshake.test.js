// PLAN-6 §3 gate (3-X): makeMcpAppDriver is absent from an app unless imported, and brings the
// agent layer only with `tools: agentTools` (the module is side-effect free). Bundles small apps
// against dist/ (esbuild, as an app's bundler would). Prints the bytes it adds with BYTES=1.
import { describe, it, expect, afterAll } from 'vitest'
import { build } from 'esbuild'
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(repo, 'test/.tmp-3x-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
let n = 0
const bundle = async (imports, drivers) => {
  const entry = path.join(tmp, `e${n++}.js`)
  fs.writeFileSync(entry, `import {run} from 'sygnal'
${imports ? `import {${imports}} from 'sygnal/ai'` : ''}
function App() { return {sel: 'p', data: {}, children: [], text: ''} }
App.initialState = {}
run(App, {${drivers}})`)
  const r = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', write: false, absWorkingDir: repo, nodePaths: [path.join(repo, 'node_modules')], logLevel: 'silent' })
  return r.outputFiles[0].text
}
const MARK = { mcp: 'not running in an MCP Apps host', agent: 'two agent declarations are named' }
const has = (src) => Object.keys(MARK).filter((k) => src.includes(MARK[k]))
const gz = (s) => zlib.gzipSync(s, { level: 9 }).length

describe('X-1 tree-shake (dist)', () => {
  it('makeMcpAppDriver costs nothing unless imported', async () => {
    const base = await bundle('', '')
    const mcp = await bundle('makeMcpAppDriver', 'MCP: makeMcpAppDriver()')
    const unused = await bundle('makeMcpAppDriver', '')
    expect(has(base)).toEqual([])
    expect(has(unused)).toEqual([])
    const withTools = await bundle('makeMcpAppDriver, agentTools', 'MCP: makeMcpAppDriver({tools: agentTools})')
    expect(has(mcp)).toEqual(['mcp'])
    expect(has(withTools)).toEqual(['mcp', 'agent'])
    if (process.env.BYTES) {
      console.table({ base: { min: base.length, gzip: gz(base) }, '+ makeMcpAppDriver': { min: mcp.length - base.length, gzip: gz(mcp) - gz(base) }, '+ makeMcpAppDriver({ tools: agentTools })': { min: withTools.length - base.length, gzip: gz(withTools) - gz(base) } })
    }
  }, 60000)
})
