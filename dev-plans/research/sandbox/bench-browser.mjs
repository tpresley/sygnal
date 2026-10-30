// The browser numbers: bundles browser/page-entry.js and the worker entry, serves them, runs them
// in Playwright's Chromium (preinstalled; BROWSER=firefox|webkit when those are installed).
//   node bench-browser.mjs
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {resolve, extname} from 'node:path'
import {compile} from './src/compile.js'

const here = import.meta.dirname, repo = resolve(here, '../../..')
const require = createRequire(import.meta.url)
const esbuild = createRequire(resolve(repo, 'package.json'))('esbuild')
const dist = resolve(here, 'dist')
mkdirSync(dist, {recursive: true})
const common = {bundle: true, minify: true, format: 'esm', platform: 'browser', logLevel: 'error', external: ['node:*'], absWorkingDir: here}
await esbuild.build({...common, entryPoints: [resolve(here, 'browser/page-entry.js')], outfile: resolve(dist, 'page.js')})
await esbuild.build({...common, entryPoints: [resolve(here, 'src/worker-entry.js')], outfile: resolve(dist, 'worker.js')})
writeFileSync(resolve(dist, 'components.json'), JSON.stringify({
  counter: compile(`export default function C({ state }) { return <div><button className="inc">+</button><span className="n">{state.n}</span></div> }
C.initialState = { n: 0 }
C.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
C.model = { INC: (s) => ({ n: s.n + 1 }) }`),
  rows: compile(`import { Collection } from 'sygnal'
function Row({ state }) { return <li className={state.done ? 'row done' : 'row'}><input type="checkbox" className="t" checked={state.done} /> {state.text}</li> }
Row.intent = ({ DOM }) => ({ T: DOM.select('.t').events('click') })
Row.model = { T: (s) => ({ ...s, done: !s.done }) }
export default function List({ state }) { return <div><p className="n">{state.items.filter(i => i.done).length} done</p><ul><Collection of={Row} from="items" /></ul></div> }
List.initialState = { items: Array.from({ length: 100 }, (_, i) => ({ id: i, text: 'item ' + i, done: false })) }`),
  looper: compile(`export default function L() { return <button className="spin">spin</button> }
L.intent = ({ DOM }) => ({ GO: DOM.select('.spin').events('click') })
L.model = { GO: (s) => { for (;;) {} } }`),
}))
const files = {'/quickjs.wasm': require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'), '/': null}
const types = {'.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.html': 'text/html'}
const server = createServer((req, res) => {
  const path = req.url.split('?')[0]
  if (path === '/') { res.writeHead(200, {'content-type': 'text/html'}); return res.end('<!doctype html><meta charset="utf-8"><body><script type="module" src="page.js"></script>') }
  const file = files[path] || resolve(dist, '.' + path)
  try { const b = readFileSync(file); res.writeHead(200, {'content-type': types[extname(file)] || 'application/octet-stream'}); res.end(b) } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const {chromium, firefox, webkit} = require('playwright')
const engine = {chromium, firefox, webkit}[process.env.BROWSER || 'chromium']
const browser = await engine.launch()
const page = await browser.newPage()
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()))
if (process.env.DEBUG_PAGE) {
  await page.goto(`http://127.0.0.1:${server.address().port}/#debug`)
  await page.waitForFunction(() => window.__api)
  console.log(await page.evaluate(process.env.DEBUG_PAGE))
  await browser.close(); server.close(); process.exit(0)
}
await page.goto(`http://127.0.0.1:${server.address().port}/`)
await page.waitForFunction(() => window.__results, null, {timeout: 120000})
const r = await page.evaluate(() => window.__results)
console.log(JSON.stringify(r, (k, v) => typeof v == 'number' ? +v.toFixed(3) : v, 2))
await browser.close()
server.close()
