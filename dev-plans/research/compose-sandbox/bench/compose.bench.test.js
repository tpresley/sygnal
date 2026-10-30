// Q3: the numbers. Node + jsdom (the sandbox spike's Chromium runs put in-thread events at
// ~0.6-0.7× these Node times and the worker's first paint at about half; sandbox README §5).
// Writes results/bench.md and results/bench.json. Run: npm run bench
import {it, afterAll} from 'vitest'
import {writeFileSync, mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {compose, outputJsonSchema} from 'sygnal'
import {start, until, parts, sleep} from '../test/helpers.js'
import {custom, replyText, makeApp} from '../fixtures/app.js'
import {variants, GOOD} from '../fixtures/code.js'

const RUNS = Number(process.env.RUNS || 5)
const out = {env: {node: process.version, runs: RUNS, date: new Date().toISOString().slice(0, 10)}}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN }
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] }
const f = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–')
const gc = () => globalThis.gc?.()
/** resolves on the DOM mutation that makes pred() true (no polling: the per-event numbers are sub-ms) */
const domUntil = (root, pred) => new Promise((ok) => {
  if (pred()) return ok()
  const mo = new MutationObserver(() => { if (pred()) { mo.disconnect(); ok() } })
  mo.observe(root, {subtree: true, childList: true, characterData: true, attributes: true})
})

it('cold start: the reply → every generated part ready (1 / 3 / 10 parts, worker / thread)', async () => {
  out.cold = {}
  for (const isolation of ['worker', 'thread']) {
    for (const n of [1, 3, 10]) {
      const all = [], first = [], boot = [], rss = []
      for (let r = 0; r < RUNS; r++) {
        const vs = variants(n)
        gc()
        const rss0 = process.memoryUsage().rss
        const {t} = await start(null, {isolation})
        t.simulateAction('page.COMPOSE', 'x')
        await t.next((s) => s.page.status === 'composing')
        const t0 = performance.now()
        await t.respond('LLM', replyText(vs.map((v) => custom(v.title, v.reads, v.code))), 'page.REPLY')
        let firstAt = null
        await until(() => { const p = parts(t); if (firstAt == null && p.some((x) => x.status === 'ok')) firstAt = performance.now(); return p.length === n && p.every((x) => x.status === 'ok') }, 30000)
        all.push(performance.now() - t0)
        first.push(firstAt - t0)
        boot.push(...Object.values(t.state.page.local).map((l) => l.readyMs))
        await sleep(50)
        rss.push((process.memoryUsage().rss - rss0) / 2 ** 20)
        t.dispose()
        await sleep(100)
      }
      out.cold[`${isolation}:${n}`] = {allMs: med(all), firstMs: med(first), perPartReadyMs: med(boot), perPartReadyP95: p95(boot), rssMB: med(rss), rssPerPartMB: med(rss) / n}
    }
  }
})

it('per event: a click in the box → validated emit → the host action applied (and an in-box keystroke)', async () => {
  out.event = {}
  for (const isolation of ['worker', 'thread']) {
    const {t} = await start([custom('Top', ['orders', 'customers'], GOOD.topCustomers), custom('Pending', ['orders'], GOOD.pending)], {isolation})
    await until(() => parts(t).length === 2 && parts(t).every((p) => p.status === 'ok'), 10000)
    const host = [], box = []
    const ids = [7, 9, 12, 15]
    for (let i = 0; i < 60; i++) {
      const id = ids[i % 4]
      const t0 = performance.now()
      const picked = t.container.querySelector('.picked')
      const done = domUntil(t.container, () => picked.textContent.startsWith(`customer:${id} `))
      t.container.querySelector(`.open[data-id="${id}"]`).click()
      await done
      host.push(performance.now() - t0)
      // an event that only changes the box's own state (no host action): typing
      const q = t.container.querySelector('.q'), v = i % 2 ? '10' : '100'
      const want = i % 2 ? '10 pending' : '3 pending'
      const t1 = performance.now()
      const count = t.container.querySelector('.count')
      const typed = domUntil(t.container, () => count.textContent === want)
      q.value = v
      q.dispatchEvent(new window.Event('input', {bubbles: true}))
      await typed
      box.push(performance.now() - t1)
      // the next openCustomer must differ, so a no-op host action isn't measured
    }
    out.event[isolation] = {hostMedian: med(host.slice(10)), hostP95: p95(host.slice(10)), boxMedian: med(box.slice(10)), boxP95: p95(box.slice(10))}
    t.dispose()
    await sleep(100)
  }
})

it('streaming: compose.llm delta cost on a growing reply, and when the first part can show', async () => {
  const {catalog} = makeApp()
  const backend = compose.llm()
  const state = {orders: [], customers: []}
  out.stream = {}
  for (const n of [1, 3, 10]) {
    const vs = variants(n)
    const text = replyText(vs.map((v) => custom(v.title, v.reads, v.code)))
    // per-delta cost at the end of the reply (each delta re-parses the whole text so far)
    const at = (len) => { const ts = []; for (let i = 0; i < 20; i++) { const t0 = performance.now(); backend.delta({catalog, state, pending: {step: 'llm'}, delta: {text: text.slice(0, len)}}); ts.push(performance.now() - t0) } return med(ts) }
    const endMs = at(text.length - 1)
    // frames at 100 tokens/s (~3.5 chars a token; a delta per frame of ~16 ms, coalesce 'frame')
    const chars = text.length, tokens = chars / 3.5
    const frames = Math.ceil((tokens / 100) * 60)
    const firstNodeEnd = text.indexOf(JSON.stringify(vs[0].code)) + JSON.stringify(vs[0].code).length + 2
    out.stream[n] = {replyChars: chars, tokens: Math.round(tokens), model100tps: tokens / 100, model50tps: tokens / 50,
      firstPartAt: firstNodeEnd / chars, deltaEndMs: endMs, deltaTotalMs: (endMs / 2) * frames, frames}
  }
})

it('request sizes: the compose prompt, an edit with generated parts on the page, a repair', async () => {
  const sizes = {}
  for (const n of [0, 1, 3, 10]) {
    const {t} = await start(null)
    t.simulateAction('page.COMPOSE', 'a page')
    await t.next((s) => s.page.status === 'composing')
    const req = t.requests('LLM').at(-1)
    if (n === 0) sizes.compose = {instructions: req.instructions.length, schema: JSON.stringify(outputJsonSchema(req.output).schema).length}
    if (n) {
      const vs = variants(n)
      await t.respond('LLM', replyText(vs.map((v) => custom(v.title, v.reads, v.code))), 'page.REPLY')
      await t.waitForState((s) => s.page.status === 'done')
      t.simulateAction('page.COMPOSE', 'move the first one down')
      await t.next((s) => s.page.status === 'composing' && s.page.pending?.step === 'edit')
      const e = t.requests('LLM').at(-1)
      sizes[`edit${n}`] = {instructions: e.instructions.length, message: e.messages[0].content.length}
    }
    t.dispose()
  }
  const plain = makeApp()
  sizes.withoutGenerated = {instructions: plain.gen.instructions.length}
  out.sizes = sizes
})

afterAll(() => {
  const dir = resolve(import.meta.dirname, '../results')
  mkdirSync(dir, {recursive: true})
  writeFileSync(resolve(dir, 'bench.json'), JSON.stringify(out, null, 2) + '\n')
  const c = out.cold || {}, e = out.event || {}, s = out.stream || {}, z = out.sizes || {}
  const md = [
    `Node ${out.env.node}, jsdom, median of ${out.env.runs} runs (${out.env.date}). \`npm run bench\`.`, '',
    '### Cold start (ms): the layout reply → parts ready on the page', '',
    '| parts | tier | first part ready | all ready | one part: create → ready (median / p95) | RSS growth (MB) | per part |', '|---:|---|---:|---:|---:|---:|---:|',
    ...Object.entries(c).map(([k, v]) => { const [tier, n] = k.split(':'); return `| ${n} | ${tier} | ${f(v.firstMs, 0)} | ${f(v.allMs, 0)} | ${f(v.perPartReadyMs, 0)} / ${f(v.perPartReadyP95, 0)} | ${f(v.rssMB)} | ${f(v.rssPerPartMB)} |` }),
    '', '### Per event (ms)', '',
    '| tier | click → validated emit → host action → host view patched (median / p95) | keystroke → the box re-rendered (median / p95) |', '|---|---:|---:|',
    ...Object.entries(e).map(([k, v]) => `| ${k} | ${f(v.hostMedian, 2)} / ${f(v.hostP95, 2)} | ${f(v.boxMedian, 2)} / ${f(v.boxP95, 2)} |`),
    '', '### Streaming', '',
    '| generated parts | reply (chars) | ≈ tokens | model time at 100 / 50 tok/s (s) | first part complete at | compose delta at the end (ms) | all deltas, 1 per frame (ms CPU) |', '|---:|---:|---:|---:|---:|---:|---:|',
    ...Object.entries(s).map(([n, v]) => `| ${n} | ${v.replyChars} | ${v.tokens} | ${f(v.model100tps)} / ${f(v.model50tps)} | ${f(v.firstPartAt * 100, 0)} % of the reply | ${f(v.deltaEndMs, 2)} | ${f(v.deltaTotalMs, 0)} over ${v.frames} frames |`),
    '', '### Request sizes (chars)', '',
    `- compose request: instructions ${z.compose?.instructions} (of which the generated-part rules ${z.withoutGenerated?.instructions}), reply schema ${z.compose?.schema}`,
    ...[1, 3, 10].map((n) => z[`edit${n}`] && `- an edit with ${n} generated part(s) on the page: instructions ${z[`edit${n}`].instructions}, current page ${z[`edit${n}`].message} (the parts' code is in it)`).filter(Boolean),
  ]
  writeFileSync(resolve(dir, 'bench.md'), md.join('\n') + '\n')
})
