// PLAN-7 0-A: generate a large Sygnal project for the latency gate by copying the
// example apps' src/ trees (tests excluded) round-robin until the target line count.
//   node gen-large.mjs <outDir> [targetLines=20000]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const [out, target = '20000'] = process.argv.slice(2)
if (!out) { console.error('usage: node gen-large.mjs <outDir> [targetLines]'); process.exit(2) }
const SOURCES = ['kanban', 'plan5-showcase', 'ai-panel-spa'].map(e => path.join(repo, 'examples', e, 'src'))
const isSrc = f => /\.(jsx?|tsx?)$/.test(f) && !/\.(test|spec)\./.test(f)

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name)
    return d.isDirectory() ? files(p) : isSrc(d.name) ? [p] : []
  })
}

fs.rmSync(out, { recursive: true, force: true })
let lines = 0, copies = 0, nfiles = 0
while (lines < +target) {
  const src = SOURCES[copies % SOURCES.length]
  for (const f of files(src)) {
    const dest = path.join(out, 'src', `app${copies}`, path.relative(src, f))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const text = fs.readFileSync(f, 'utf8')
    fs.writeFileSync(dest, text)
    lines += text.split('\n').length; nfiles++
  }
  copies++
}
console.log(`${out}: ${copies} app copies, ${nfiles} files, ${lines} lines`)
