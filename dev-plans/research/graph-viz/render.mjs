#!/usr/bin/env node
/**
 * Spike: `sygnal-check --graph=html` prototype.
 *
 *   node dev-plans/research/graph-viz/render.mjs <paths...> [--out file.html] [--open] [--title Name]
 *        [--strict] [--a11y=warn] [--select ComponentName] [--json graph.json]
 *
 * Builds the static app graph with sygnal-check's graph(), inlines it into template.html
 * (one self-contained file: no CDN, no server, works offline) and opens it in the default browser.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { graph } from '../../../sygnal-check/src/graph.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => { const i = args.findIndex(a => a === name || a.startsWith(name + '=')); if (i < 0) return undefined; const a = args[i]; args.splice(i, 1); if (a.includes('=')) return a.slice(a.indexOf('=') + 1); if (args[i] && !args[i].startsWith('--')) return args.splice(i, 1)[0]; return true }
const out = flag('--out'), open = flag('--open'), title = flag('--title'), strict = flag('--strict'), a11y = flag('--a11y'), select = flag('--select'), json = flag('--json')
const paths = args.length ? args : ['.']
const cwd = process.cwd()

const g = json ? JSON.parse(fs.readFileSync(json, 'utf8')) : graph(paths, { cwd, strict: !!strict, a11y: a11y === true ? 'warn' : a11y })
let pkgName
try { pkgName = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).name } catch (_) { /* no package.json */ }
const meta = {
  title: title || pkgName || path.basename(cwd),
  subtitle: `${paths.join(' ')} · ${new Date().toLocaleString()}`,
  root: cwd,
  select: typeof select === 'string' ? select : undefined,
  // titles of the codes in this graph (the real feature would read them from codes.js)
  codes: Object.fromEntries(JSON.parse(fs.readFileSync(path.join(here, '../../../sygnal-check/explanations.json'), 'utf8'))
    .filter(e => JSON.stringify(g).includes(`"${e.code}"`)).map(e => [e.code, e.title])),
}
// </script> inside the data would end the script element
const inline = (v) => JSON.stringify(v).replace(/</g, '\\u003c')
const html = fs.readFileSync(path.join(here, 'template.html'), 'utf8')
  .replace('__TITLE__', meta.title.replace(/[<&]/g, ''))
  .replace('__GRAPH__', () => inline(g))
  .replace('__META__', () => inline(meta))

const file = typeof out === 'string' ? path.resolve(out) : path.join(os.tmpdir(), `sygnal-graph-${meta.title.replace(/[^\w.-]+/g, '-')}.html`)
fs.writeFileSync(file, html)
process.stderr.write(`sygnal-check: wrote ${file} (${(html.length / 1024).toFixed(0)} KB, ${g.components.length} components)\n`)
if (open) {
  const [cmd, cmdArgs] = process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]]
  spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref()
}
