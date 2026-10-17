#!/usr/bin/env node
/**
 * S-1 task check: the five questions, answered by driving explore.html through its own UI in
 * Chromium (clicks and typing only, the way a person or a browser agent would), per corpus × preset.
 * Records the UI steps, the answer the page shows, whether it is right, and whether the answer is
 * also visible on the canvas afterwards (its components drawn as their own cards, inside the
 * viewport, at a zoom where card text is legible, k ≥ 0.45).
 *
 *   node task-check.mjs [--corpora syn-200,syn-2000,examples] [--presets spike,auto] [--shots dir] [--json out]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { renderPage } from './render.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const corpora = get('--corpora', 'syn-200,syn-2000,examples').split(',')
// --extra label=/path/graph.json: a corpus kept outside the repo (a private app); its page is written next to it
const extra = (() => { const i = process.argv.indexOf('--extra'); if (i < 0) return null; const [label, file] = process.argv[i + 1].split('='); return { label, file } })()
const corpusFile = (name) => extra && name === extra.label ? extra.file : path.join(here, 'corpus', name + '.json')
const pageFile = (name) => extra && name === extra.label ? path.join(path.dirname(extra.file), name + '.html') : path.join(here, 'out', name + '.html')
if (extra) corpora.push(extra.label)
const presets = get('--presets', 'spike,auto,custom&group=dir&fold=all&events=bus&focus=0').split(',')
const shots = get('--shots')

// the five questions; the examples corpus has other names (D514)
const Q = {
  syn: { event: 'NAVIGATE', comp: 'Checkout', field: 'currency', rendered: 'CartLine' },
  examples: { event: 'DELETE_LANE', comp: 'LaneComponent', field: 'draggingLaneId', rendered: 'TaskCard' },
}

/** Questions picked from the graph itself (for a corpus whose names must not be committed). */
function autoQuestions(g) {
  const ev = Object.entries(g.events).find(([, e]) => e.selectors.length)?.[0] ?? Object.keys(g.events)[0]
  const reader = g.components.find(c => (c.contextConsumes || []).some(f => g.components.some(p => p.contextProvides.includes(f))))
  const rendered = g.components.find(c => g.components.some(p => p.children.some(ch => ch.name === c.name)))
  return { event: ev, comp: reader?.name, field: reader?.contextConsumes.find(f => g.components.some(p => p.contextProvides.includes(f))), rendered: rendered?.name }
}
const browser = await chromium.launch({ headless: true })
const rows = []
for (const name of corpora) {
  const g = JSON.parse(fs.readFileSync(corpusFile(name), 'utf8'))
  const file = pageFile(name); fs.writeFileSync(file, await renderPage({ graph: g, title: name }))
  const q = Q[name.startsWith('syn') ? 'syn' : name] ?? autoQuestions(g)
  // ground truth from the graph
  const comps = g.components
  const truth = {
    q1: [...new Set(g.events[q.event]?.selectors ?? [])].sort(),
    q2: comps.find(c => c.contextProvides.includes(q.field) && (q.field !== 'currency' || c.name === 'StoreShell'))?.name,
    q3: comps.filter(c => c.agent).length,
    q4: [...new Set(comps.filter(c => c.children.some(ch => ch.name === q.rendered)).map(c => c.name))].sort(),
    q5: comps.filter(c => c.diagnostics.some(d => d.severity === 'error')).length,
  }
  for (const preset of presets) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(pathToFileURL(file).href + '?preset=' + preset)
    await page.waitForFunction(() => window.__ready === true)
    let steps = 0
    const act = async (fn) => { steps++; await fn(); await page.waitForTimeout(350) }
    const search = async (term, pickText) => {
      await page.fill('#q', ''); await act(() => page.click('#q')); await act(() => page.keyboard.type(term))
      if (pickText) await act(() => page.locator('#results .r', { hasText: pickText }).first().dispatchEvent('mousedown'))
      else await act(() => page.keyboard.press('Enter'))
    }
    // the answer's components drawn as their own cards, in the viewport, legible
    const onCanvas = (names) => page.evaluate((names) => {
      const S = window.__S, M = window.__M
      const svg = document.getElementById(S.render === 'svg' ? 'svg' : 'cv').getBoundingClientRect()
      const t = document.getElementById('vp').getAttribute('transform') || ''
      const m = /translate\(([-\d.e]+),([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(t); if (!m) return { ok: false, why: 'no transform' }
      const [x, y, k] = [+m[1], +m[2], +m[3]]
      let shown = 0
      for (const n of names) {
        const ids = M.comps.filter(c => c.name === n).map(c => c.id)
        const vis = ids.some(id => { const el = document.querySelector(`#nodes .node[data-cid="${CSS.escape(id)}"]`); if (!el) return false; const r = el.getBoundingClientRect(); return r.right > svg.left && r.left < svg.right && r.bottom > svg.top && r.top < svg.bottom })
        if (vis) shown++
      }
      return { ok: shown === names.length && k >= 0.45, shown, of: names.length, k: +k.toFixed(2) }
    }, names)
    const res = {}
    const shot = async (tag) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${name}-${preset.split('&')[0]}-${tag}.png`) }) } }
    // Q1: who handles <event>? search the type, pick the EVENTS result, read the trace bar
    steps = 0
    await search(q.event, 'EVENTS')
    const tr = await page.locator('#trace').innerText().catch(() => '')
    const sel = tr.includes('→') ? tr.split('→')[1].replace(/Clear$/, '').split(',').map(s => s.trim()).filter(s => s && s !== 'no selector').sort() : []
    res.q1 = { steps, answer: sel.join(', '), right: JSON.stringify([...new Set(sel)].sort()) === JSON.stringify(truth.q1), canvas: await onCanvas(truth.q1) }
    await shot('q1')
    await act(() => page.keyboard.press('Escape')); await page.locator('#trace-x').click().catch(() => {})
    // Q2: where does <comp> get <field>? search the component, read the context row of the detail panel
    steps = 0
    await search(q.comp)
    const ctx = (await page.locator('#dinner').innerText().catch(() => '')).replace(/\s+/g, ' ')
    const m2 = new RegExp(q.field + '\\s*←\\s*(\\w+)').exec(ctx)
    res.q2 = { steps, answer: m2?.[1] ?? '', right: m2?.[1] === truth.q2, canvas: await onCanvas([q.comp, truth.q2].filter(Boolean)) }
    await shot('q2')
    // Q3: which components can an agent change? the health list's AI agent surface group
    steps = 0
    if (await page.locator('#health summary', { hasText: 'AI agent surface' }).count()) await act(() => page.locator('#health summary', { hasText: 'AI agent surface' }).click())
    const ai = await page.locator('#health details', { hasText: 'AI agent surface' }).locator('.health-item').count()
    res.q3 = { steps, answer: String(ai), right: ai === truth.q3, canvas: { ok: false, why: 'list answer' } }
    // Q4: what renders <comp>? search it, read "rendered by"
    steps = 0
    await page.fill('#q', '')
    await search(q.rendered)
    const by = await page.evaluate(() => { const r = [...document.querySelectorAll('#dinner .rel .r')].find(r => r.querySelector('.lbl')?.textContent === 'rendered by'); return r ? [...r.querySelectorAll('[data-goto]')].map(c => c.firstChild.textContent.trim()).sort() : [] })
    res.q4 = { steps, answer: by.join(', '), right: JSON.stringify([...new Set(by)].sort()) === JSON.stringify(truth.q4), canvas: await onCanvas([q.rendered, ...truth.q4]) }
    await shot('q4')
    // Q5: which components have errors? the stat tile + the open error groups of the health list
    steps = 0
    const errItems = await page.evaluate(() => [...document.querySelectorAll('#health details')].filter(d => d.querySelector('.dot')?.style.background.includes('--err')).flatMap(d => [...d.querySelectorAll('.health-item .t')].map(t => t.firstChild.textContent)))
    res.q5 = { steps, answer: String(new Set(errItems).size), right: new Set(errItems).size === truth.q5, canvas: { ok: false, why: 'list answer' } }
    for (const [k, v] of Object.entries(res)) rows.push({ corpus: name, preset: preset.split('&')[0] === 'custom' ? preset : preset, q: k, steps: v.steps, right: v.right, answer: v.answer.slice(0, 60), onCanvas: v.canvas.ok ? 'yes' : `no (${v.canvas.shown ?? '-'}/${v.canvas.of ?? '-'}, k ${v.canvas.k ?? '-'}${v.canvas.why ? ', ' + v.canvas.why : ''})`, errors: errors.join(' | ') })
    process.stderr.write(`${name} · ${preset}: ${Object.entries(res).map(([k, v]) => `${k} ${v.right ? 'ok' : 'WRONG'} (${v.steps} steps, canvas ${v.canvas.ok ? 'yes' : 'no'})`).join(' · ')}${errors.length ? ' ERR ' + errors[0] : ''}\n`)
    await page.close()
  }
}
await browser.close()
const out = get('--json'); if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1))
const cols = ['corpus', 'preset', 'q', 'steps', 'right', 'answer', 'onCanvas']
console.log(['| ' + cols.join(' | ') + ' |', '|' + cols.map(() => '---').join('|') + '|', ...rows.map(r => '| ' + cols.map(c => r[c] ?? '').join(' | ') + ' |')].join('\n'))
