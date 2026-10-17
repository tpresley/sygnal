#!/usr/bin/env node
/**
 * S-1: browser measurements (Playwright 1.63 + the cached Chromium; never downloads a browser).
 * For each corpus × strategy (URL params of explore.html) × renderer: page bytes, time to first
 * paint (navigation start → the second rAF after the first draw), layout and draw time, and the
 * frame intervals while panning + zooming (window.__bench: 150 frames of wheel-like zoom and pan).
 *
 *   node measure-browser.mjs [--sizes 50,200,500,2000] [--json out.json] [--shots dir] [--only substring]
 *
 * Run `node gen.mjs --all` first; pages are rendered into out/ here.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { renderPage } from './render.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const sizes = get('--sizes', '50,200,500,2000').split(',')
const only = get('--only')
const shots = get('--shots')
// --zoom 1: pan/zoom zoomed in at that scale (cards and text drawn) instead of at the fit zoom
const zoomK = get('--zoom') ? +get('--zoom') : null
const stratFilter = get('--strategies')

// --extra label=/path/graph.json: a corpus kept outside the repo (a private app); its page is written next to it
const extra = (() => { const i = process.argv.indexOf('--extra'); if (i < 0) return null; const [label, file] = process.argv[i + 1].split('='); return { label, file } })()
const corpusFile = (name) => extra && name === extra.label ? extra.file : path.join(here, 'corpus', name + '.json')
const pageFile = (name) => extra && name === extra.label ? path.join(path.dirname(extra.file), name + '.html') : path.join(here, 'out', name + '.html')
const corpora = [...sizes.map(n => 'syn-' + n), 'examples', ...(extra ? [extra.label] : [])].filter(n => !only || only.includes(n) || n.includes(only.split(' ')[0]))
fs.mkdirSync(path.join(here, 'out'), { recursive: true })

const STRATS = {
  'spike (flat)': 'preset=spike',
  'auto defaults': 'preset=auto',
  'dir open + bus': 'preset=custom&group=dir&fold=open&events=bus',
  'dir folded + bus, wrapped': 'preset=custom&group=dir&fold=all&events=bus&layout=layered-wrap',
  'community folded': 'preset=custom&group=community&fold=all&events=bus',
  'subtrees folded d4': 'preset=custom&group=dir&fold=open&depth=4&events=bus',
}
const RENDERERS = ['svg', 'canvas']

const browser = await chromium.launch({ headless: true })
const rows = []
for (const name of corpora) {
  const g = JSON.parse(fs.readFileSync(corpusFile(name), 'utf8'))
  const html = await renderPage({ graph: g, title: name, libs: [] })
  const file = pageFile(name); fs.writeFileSync(file, html)
  const bytes = Buffer.byteLength(html), gz = (await import('node:zlib')).gzipSync(html).length
  for (const [sname, q] of Object.entries(STRATS)) {
    if (stratFilter && !stratFilter.split(',').includes(sname)) continue
    for (const render of RENDERERS) {
      const label = `${name} · ${sname} · ${render}`
      if (only && !label.includes(only)) continue
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const errors = []
      page.on('pageerror', e => errors.push(String(e.message)))
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
      await page.goto(pathToFileURL(file).href + `?${q}&render=${render}`)
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 })
      const r = await page.evaluate(async (zoomK) => {
        const nav = performance.getEntriesByType('navigation')[0]
        const p = window.__perf
        const fr = await window.__bench(150, zoomK)
        const s = fr.slice().sort((a, b) => a - b)
        const q = (x) => s[Math.min(s.length - 1, Math.floor(s.length * x))]
        return { firstPaintMs: Math.round(p.paintedAt), domContentLoaded: Math.round(nav.domContentLoadedEventEnd), layoutMs: +p.layoutMs.toFixed(1), drawMs: +p.drawMs.toFixed(1), modelMs: +p.modelMs.toFixed(1), nodes: p.nodes, edges: p.edges, svgEls: document.querySelectorAll('#vp *').length, frameP50: +q(0.5).toFixed(1), frameP95: +q(0.95).toFixed(1), frameMax: +s[s.length - 1].toFixed(1), slowFrames: s.filter(x => x > 33.4).length }
      }, zoomK)
      if (shots && render === 'svg') {
        fs.mkdirSync(shots, { recursive: true })
        await page.evaluate(() => document.getElementById('zfit').click()); await page.waitForTimeout(400)
        await page.screenshot({ path: path.join(shots, `${name}-${sname.replace(/[^\w]+/g, '-')}.png`), scale: 'css' })
      }
      rows.push({ corpus: name, strategy: sname, render, pageKB: Math.round(bytes / 1024), gzKB: Math.round(gz / 1024), ...r, errors: errors.length ? errors.slice(0, 2).join(' | ') : '' })
      process.stderr.write(`${label}: paint ${r.firstPaintMs} ms (layout ${r.layoutMs}, draw ${r.drawMs}), ${r.nodes} nodes, frames p50 ${r.frameP50} p95 ${r.frameP95} max ${r.frameMax}${errors.length ? ' ERR ' + errors[0] : ''}\n`)
      await page.close()
    }
  }
}
await browser.close()
const out = get('--json'); if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1))
const cols = ['corpus', 'strategy', 'render', 'pageKB', 'gzKB', 'nodes', 'edges', 'svgEls', 'layoutMs', 'drawMs', 'firstPaintMs', 'frameP50', 'frameP95', 'frameMax', 'slowFrames', 'errors']
console.log(['| ' + cols.join(' | ') + ' |', '|' + cols.map(() => '---').join('|') + '|', ...rows.map(r => '| ' + cols.map(c => r[c] ?? '').join(' | ') + ' |')].join('\n'))
