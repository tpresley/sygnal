#!/usr/bin/env node
// Streaming preview: node evals/stream.mjs --models qwen3:8b --enc tree,tree+plan [--set base|ext]
// Streams /api/chat with the schema, runs previewFromPartial on every chunk, and reports per case:
// time to first part on screen, time the preview first equals the final layout, total time, and
// "regressions" (a part once shown that later disappears or changes container).
import { BASE, EXT, BASE_CASES, EXT_CASES } from './cases.mjs'
import { composeRequest, readComposition } from './requests.mjs'
import { previewFromPartial, layoutToString, normalizeCatalog } from '../llm-composer.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]); return acc }, []))
const models = (args.models || 'qwen3:8b').split(',')
const encs = (args.enc || 'tree,tree+plan').split(',')
const set = args.set || 'base'
const catalog = set === 'base' ? BASE : EXT
const cases = set === 'base' ? BASE_CASES : EXT_CASES
const OLLAMA = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')

const placed = (layout) => {
  // part → its container part ('page' or 'row'), the order on the page
  const out = {}
  for (const [k, n] of Object.entries(layout.nodes)) for (const ks of Object.values(n.slots || {})) for (const c of ks) out[layout.nodes[c].part] = n.part
  return out
}

for (const model of models) for (const enc of encs) {
  const stats = []
  for (const k of cases) {
    const req = composeRequest(catalog, enc, k.prompt)
    const t0 = performance.now()
    const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify({ model, stream: true, think: false, format: req.schema, options: { temperature: 0, num_ctx: 8192 }, messages: [{ role: 'system', content: req.system }, ...req.messages] }) })
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = '', text = '', firstToken = null, firstPart = null, previews = [], regressions = 0, prevPlaced = {}
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        const j = JSON.parse(line)
        if (j.message?.content) {
          text += j.message.content
          const t = performance.now() - t0
          if (firstToken === null) firstToken = t
          const p = previewFromPartial(catalog, enc, text)
          if (!p) continue
          const s = layoutToString(p)
          if (s && firstPart === null) firstPart = t
          if (previews.at(-1)?.s !== s) {
            const now = placed(p)
            for (const [part, where] of Object.entries(prevPlaced)) if (now[part] !== where) regressions++
            prevPlaced = now
            previews.push({ t: Math.round(t), s })
          }
        }
      }
    }
    const total = performance.now() - t0
    const final = layoutToString(readComposition(catalog, enc, text).layout)
    const firstFinal = previews.find((p) => p.s === final)?.t ?? Math.round(total)
    stats.push({ id: k.id, firstToken: Math.round(firstToken), firstPart: firstPart && Math.round(firstPart), firstFinal, total: Math.round(total), regressions, steps: previews.length, final })
    console.error(`${model} ${enc} ${k.id}: first token ${Math.round(firstToken)} ms, first part ${firstPart ? Math.round(firstPart) : '-'} ms, final shown ${firstFinal} ms, done ${Math.round(total)} ms, regressions ${regressions}\n   ${previews.map((p) => `${p.t}:${p.s || '∅'}`).join('  →  ')}`)
  }
  const med = (f) => { const v = stats.map(f).filter((x) => x != null).sort((a, b) => a - b); return v[v.length >> 1] }
  const withParts = stats.filter((s) => s.firstPart)
  const frac = withParts.map((s) => s.firstPart / s.total).sort((a, b) => a - b)
  console.log(`| ${model} ${enc} | ${med((s) => s.firstToken)} | ${med((s) => s.firstPart)} | ${med((s) => s.firstFinal)} | ${med((s) => s.total)} | ${frac.length ? Math.round(frac[frac.length >> 1] * 100) + '%' : '-'} | ${stats.reduce((a, s) => a + s.regressions, 0)} |`)
}
