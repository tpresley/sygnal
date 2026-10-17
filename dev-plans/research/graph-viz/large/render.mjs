#!/usr/bin/env node
/**
 * S-1: build the experimental page: explore.html + model.mjs + a graph (+ optional layout libraries),
 * one self-contained file (no CDN, works from file://).
 *
 *   node render.mjs <corpus name | graph.json | src dirs...> [--out out/x.html] [--libs d3,dagre,elk] [--title T]
 *     corpus names: syn-50, syn-200, syn-500, syn-2000, examples (corpus/*.json; run gen.mjs --all first)
 *     paths: scanned with sygnal-check's graph()
 *
 * The libraries are inlined only for the layout comparison; the page works without them
 * (layered layout only). Never a sygnal-check dependency (D506).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const args = process.argv.slice(2)
const flag = (name) => { const i = args.findIndex(a => a === name || a.startsWith(name + '=')); if (i < 0) return undefined; const a = args[i]; args.splice(i, 1); if (a.includes('=')) return a.slice(a.indexOf('=') + 1); if (args[i] && !args[i].startsWith('--')) return args.splice(i, 1)[0]; return true }
const out = flag('--out'), libsArg = flag('--libs'), title = flag('--title')

export async function renderPage({ graph: g, title, libs = [] }) {
  const LIB_FILES = { d3: 'd3-hierarchy/dist/d3-hierarchy.min.js', dagre: '@dagrejs/dagre/dist/dagre.min.js', elk: 'elkjs/lib/elk.bundled.js' }
  const libTags = libs.map(l => `<script>/* ${l} (S-1 measurement only) */\n${fs.readFileSync(path.join(here, 'node_modules', LIB_FILES[l]), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n')
  const model = fs.readFileSync(path.join(here, 'model.mjs'), 'utf8').replace(/^export /gm, '')
  const codes = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(repo, 'sygnal-check/explanations.json'), 'utf8')).map(e => [e.code, e.title]))
  const used = new Set(g.components.flatMap(c => c.diagnostics.map(d => d.code)))
  const meta = { title, subtitle: `${g.components.length} components`, codes: Object.fromEntries([...used].map(c => [c, codes[c]])) }
  const inline = (v) => JSON.stringify(v).replace(/</g, '\\u003c')
  return fs.readFileSync(path.join(here, 'explore.html'), 'utf8')
    .replace('__TITLE__', () => title.replace(/[<&]/g, ''))
    .replace('__LIBS__', () => libTags)
    .replace('__MODEL__', () => model)
    .replace('__GRAPH__', () => inline(g))
    .replace('__META__', () => inline(meta))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const src = args.length ? args : ['syn-200']
  let g, name
  if (src.length === 1 && fs.existsSync(path.join(here, 'corpus', src[0] + '.json'))) { name = src[0]; g = JSON.parse(fs.readFileSync(path.join(here, 'corpus', src[0] + '.json'), 'utf8')) } else if (src.length === 1 && src[0].endsWith('.json')) { name = path.basename(src[0], '.json'); g = JSON.parse(fs.readFileSync(src[0], 'utf8')) } else {
    const { graph } = await import(path.join(repo, 'sygnal-check/src/graph.js'))
    name = path.basename(path.resolve(src[0])); g = graph(src, { cwd: process.cwd() })
  }
  const libs = typeof libsArg === 'string' ? libsArg.split(',').filter(Boolean) : []
  const html = await renderPage({ graph: g, title: title ?? name, libs })
  const file = path.resolve(typeof out === 'string' ? out : path.join(here, 'out', `${name}${libs.length ? '-' + libs.join('-') : ''}.html`))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, html)
  process.stderr.write(`wrote ${path.relative(process.cwd(), file)} (${(html.length / 1024).toFixed(0)} KB, ${g.components.length} components)\n`)
}
