// Builds small apps the way scripts/size-gate.mjs builds kanban (examples/kanban's Vite and the
// built sygnal/vite plugin, nativeGlobalThis: false, a production build) against <repo>/dist and
// prints `gzip -c` sizes. Usage: node measure.mjs <repo> <workdir>
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = path.resolve(process.argv[2])
const work = path.resolve(process.argv[3])
const req = createRequire(path.join(repo, 'examples', 'kanban', 'package.json'))
const vite = await import(pathToFileURL(req.resolve('vite')).href)
const sygnal = (await import(pathToFileURL(req.resolve('sygnal/vite')).href)).default
const dist = path.join(repo, 'dist', 'index.esm.js')

const apps = {
  'marker-free': `import { run, createElement as h } from 'sygnal'
function App({ state }) { return h('div', null, h('button', { className: 'inc' }, 'n=' + state.n)) }
App.initialState = { n: 0 }
App.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
App.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
run(App)`,
  'collection-only': `import { run, createElement as h, Collection } from 'sygnal'
function Item({ state }) { return h('li', null, state.t) }
function App() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
App.initialState = { items: [{ id: 1, t: 'a' }] }
run(App)`,
  'switchable-only': `import { run, createElement as h, Switchable } from 'sygnal'
function A() { return h('p', null, 'a') }
function App() { return h('div', null, h(Switchable, { of: { a: A }, current: 'a' })) }
App.initialState = {}
run(App)`,
}
for (const [name, contents] of Object.entries(apps)) {
  const root = path.join(work, 'app-' + name)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><div id="root"></div><script type="module" src="./main.js"></script>')
  fs.writeFileSync(path.join(root, 'main.js'), contents)
  const outDir = path.join(root, 'dist')
  await vite.build({
    root, configFile: false, logLevel: 'warn',
    plugins: [sygnal({ nativeGlobalThis: false })],
    resolve: { alias: [{ find: /^sygnal$/, replacement: dist }] },
    build: { outDir, emptyOutDir: true },
  })
  const assets = path.join(outDir, 'assets')
  const file = path.join(assets, fs.readdirSync(assets).find(f => /^index-.*\.js$/.test(f)))
  const gz = spawnSync('gzip', ['-c', file]).stdout.length
  console.log(`${name}: ${fs.statSync(file).size} B min, ${gz} B gzip`)
}
