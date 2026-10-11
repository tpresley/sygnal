// PLAN-7 §3 latency gate (C-3). Opt-in, best run alone (the full suite's parallel test files
// compete for the CPU):
//   SYGNAL_CHECK_LATENCY=1 npx --prefix sygnal-check vitest run --root sygnal-check test/lsp-latency.vtest.js
//
// Generates the 20k-line project of PLAN-7 0-A (dev-plans/research/p7-spikes/0-A/gen-large.mjs:
// the kanban, plan5-showcase and ai-panel-spa src/ trees, tests excluded, copied round-robin until
// 20,000 lines; 14 copies, 327 files, 20.8k lines) into a temp dir and checks it with --strict:
//   - a cold first check (the process and module already loaded, a fresh ParseCache) <= 1 s
//     (was 2 s);
//   - a re-check after a one-file edit through `sources`, with the warm cache (3 untimed edits
//     first): median of 15 <= 150 ms (was 300 ms; lowered after G-660, about 2x the measured
//     time, for slower and noisier machines).
// The limits only go down.
//
// The language server (PLAN-7 L-1), on the same project, checks in its worker thread with the
// default 150 ms debounce and --strict:
//   - an unsaved edit (didChange, no save) that adds a finding → its publishDiagnostics:
//     median of 10 <= 400 ms (debounce included; was 500 ms, lowered after G-660: D313);
//   - a hover sent right after a didSave (the check starts at once) is answered from the last
//     results while the check runs: <= 50 ms, before the check's publish.
//   - definition / references (PLAN-7 N-2): from the last check's index <= 50 ms (max of 10);
//     right after an unsaved change (the worker builds the model, no rules) median <= 150 ms;
//     right after a save (waits for the check it started) median <= 150 ms; a change while that
//     check runs (the index is built after it) median <= 300 ms.
//   Measured 2026-10-10 (same machine, alone under vitest): 0.0 ms (max 0.5); 45-52 ms (43-56);
//   122 ms (113-140); 168 ms (157-202). On the examples (kanban, ai-panel-spa, plan5-showcase,
//   worker on): 0.02-0.05 ms from the index, 3.6-6.6 ms after a change.
//   - completions (PLAN-7 N-2, P4-1) are answered on the main thread from the last check's index:
//     mid-edit (an unterminated selector string, so a repair parse) <= 150 ms (max of 10), also
//     right after a didSave while the worker checks; the index itself (built in the worker with
//     each check) is reported, not gated.
//   Measured 2026-10-10 (same machine): didChange → publish median 454 ms under vitest (446-464;
//   a standalone script: 412-433 ms, the worker's check 261-280 ms + the 150 ms debounce); hover
//   during a check 0.3 ms. The headroom was ~10 %, the same as the check gate's (G-660).
//   After G-660 (merged): didChange → publish median 263-264 ms (253-276) under vitest, hover 0.3 ms.
//   After P4-1..P4-4 (completion index, code lens flow, the rest of N-1 built and posted with every
//   check): didChange → publish 323-340 ms, definition right after a save 153-180 ms (over its
//   limit), right after a change 84-87 ms, during a check 211-233 ms. P4 perf (p7-p4-perf): the
//   index goes early (before the rules) only when a request waits on the check, else after the
//   diagnostics with the completion index (core.js "Parts"); the flow reuses the check's SYG101 /
//   SYG102 reports and caches its reference walk per AST; buildIndex dedupes on short keys; the
//   lens signature groups by file once. 4 runs alone: didChange → publish 266-268 ms, after a
//   save 66-68 ms, after a change 68-75 ms, during a check 183-188 ms, hover 0.2-0.3 ms.
//
// Measured 2026-10-10 (Apple M3 Max, Node 24.14.0), bench-edit.mjs beside gen-large.mjs:
//   cold 438 ms, warm without a cache 351 ms, warm with the cache after a one-file edit 272 ms
//   (1 parse per edit; ~66 ms model build + ~190 ms rules). This test, run alone under vitest
//   (--reporter=verbose --silent=false prints its log line), 5 runs: cold 399-465 ms, warm
//   one-file edit 257-279 ms. The headroom was ~10 %; the rules' AST walks (ast.js walk/childNodes)
//   were ~70 % of a warm check's self time.
// After G-660 (ast.js: a flat pre-order node list per Program, built once per AST), same machine:
//   cold 229 ms, warm without a cache 150 ms, warm one-file edit 79 ms (bench medians); this test
//   alone, 5 runs: cold 236-245 ms, warm one-file edit 80-97 ms. Next hot spots: walkTree (~13 %)
//   and scope.js (findBinding / declInScope, ~23 %).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, createParseCache } from '../src/index.js'
import { expandInputs } from '../src/files.js'
import { buildProject } from '../src/model/project.js'
import { completionIndex } from '../src/lsp/completionIndex.js'
import { startServer, uriOf } from './lsp-helpers.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const enabled = process.env.SYGNAL_CHECK_LATENCY === '1'

/** gen-large.mjs's approach: copy the example src/ trees round-robin until `target` lines. */
function generate(out, target) {
  const sources = ['kanban', 'plan5-showcase', 'ai-panel-spa'].map(e => path.join(repo, 'examples', e, 'src'))
  const isSrc = f => /\.(jsx?|tsx?)$/.test(f) && !/\.(test|spec)\./.test(f)
  const list = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name)
    return d.isDirectory() ? list(p) : isSrc(d.name) ? [p] : []
  })
  let lines = 0, copies = 0
  while (lines < target) {
    const src = sources[copies % sources.length]
    for (const f of list(src)) {
      const dest = path.join(out, 'src', `app${copies}`, path.relative(src, f))
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      const text = fs.readFileSync(f, 'utf8')
      fs.writeFileSync(dest, text)
      lines += text.split('\n').length
    }
    copies++
  }
  return lines
}

const median = a => [...a].sort((x, y) => x - y)[a.length >> 1]
const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t }

describe.skipIf(!enabled)('latency gate (PLAN-7 §3)', () => {
  let dir, files, lines
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-latency-'))
    lines = generate(dir, 20000)
    files = expandInputs([dir], { cwd: dir }).files
  })
  afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

  it('20k lines: cold <= 1 s, a one-file edit re-checks in <= 150 ms warm with the parse cache', () => {
    expect(lines).toBeGreaterThanOrEqual(20000)
    const cache = createParseCache()
    const opts = { cwd: dir, strict: true, cache }
    const cold = time(() => checkFiles(files, opts))
    const edited = files[files.length >> 1]
    const original = fs.readFileSync(edited, 'utf8')
    const edit = (i) => time(() => checkFiles(files, { ...opts, sources: new Map([[edited, original + `\n// edit ${i}\n`]]) }))
    for (let i = 0; i < 3; i++) edit(-1 - i) // warm-up (an editor session is past its first edits)
    const parses = cache.stats.parses
    const edits = []
    for (let i = 0; i < 15; i++) edits.push(edit(i))
    const warmEdit = median(edits)
    console.log(`latency gate: ${files.length} files, ${lines} lines: cold ${Math.round(cold)} ms, warm one-file edit ${Math.round(warmEdit)} ms (median of ${edits.length})`)
    expect(cache.stats.parses - parses).toBe(edits.length) // one parse per edit
    expect(cold).toBeLessThanOrEqual(1000)
    expect(warmEdit).toBeLessThanOrEqual(150)
  }, 60_000)

  it('language server: didChange → publish <= 400 ms with the debounce; hover <= 50 ms during a check (worker)', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "latency", "private": true }')
    const client = startServer({ server: { worker: true, debounce: 150 } })
    try {
      const t0 = performance.now()
      await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'latency' }], initializationOptions: { strict: true } })
      const cold = performance.now() - t0
      expect(client.server.usingWorker).toBe(true)
      const file = files.find(f => f.endsWith('.jsx') && /\.intent\s*=/.test(fs.readFileSync(f, 'utf8')))
      const uri = uriOf(file)
      const original = fs.readFileSync(file, 'utf8')
      const planted = (i) => original + `\nfunction Zq${i}() { return <div className="a" /> }\nZq${i}.intent = ({ DOM }) => ({ GO: DOM.click('.nope${i}') })\nZq${i}.model = { GO: (s) => s }\n`
      const has = (i) => () => client.diags(file).some(d => d.message.includes(`.nope${i}'`))
      client.open(file, original)
      await client.settle()
      let version = 2
      const edit = async (i) => {
        const t = performance.now()
        client.change(file, planted(i), version++)
        await client.waitFor(has(i), 10_000)
        return performance.now() - t
      }
      for (let i = 0; i < 3; i++) await edit(1000 + i) // warm-up
      const times = []
      for (let i = 0; i < 10; i++) times.push(await edit(i))
      const publish = median(times)

      // hover while the check after a save runs in the worker
      await client.settle()
      const target = client.diags(file).find(d => d.message.includes(".nope9'"))
      const hovers = []
      for (let i = 0; i < 5; i++) {
        client.change(file, planted(2000 + i), version++)
        client.save(file)
        const t = performance.now()
        const h = await client.request('textDocument/hover', { textDocument: { uri }, position: target.range.start })
        hovers.push(performance.now() - t)
        expect(h).not.toBeNull()
        expect(has(2000 + i)()).toBe(false) // answered before the check's publish
        await client.waitFor(has(2000 + i), 10_000)
        await client.settle()
        const again = client.diags(file).find(d => d.message.includes(`.nope${2000 + i}'`))
        target.range = again.range
      }
      const hover = Math.max(...hovers)
      console.log(`lsp latency: ${files.length} files, ${lines} lines: initialize + first publish ${Math.round(cold)} ms; didChange → publish ${Math.round(publish)} ms (median of ${times.length}, ${Math.round(Math.min(...times))}-${Math.round(Math.max(...times))}, 150 ms debounce included); hover during a check ${hover.toFixed(1)} ms (max of ${hovers.length})`)
      expect(publish).toBeLessThanOrEqual(400)
      expect(hover).toBeLessThanOrEqual(50)
    } finally {
      client.server.dispose()
    }
  }, 120_000)

  it('language server: definition / references <= 50 ms from the last check, <= 150 ms right after a change (worker)', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "latency", "private": true }')
    const client = startServer({ server: { worker: true, debounce: 150 } })
    try {
      await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'latency' }], initializationOptions: { strict: true } })
      const read = (f) => fs.readFileSync(f, 'utf8')
      const file = files.find(f => f.endsWith('.jsx') && /\.intent\s*=/.test(read(f)) && /\.model\s*=/.test(read(f)))
      const uri = uriOf(file)
      const original = read(file)
      client.open(file, original)
      await client.settle()
      // the first key after `.intent =`
      const intentKey = (text) => {
        const i = text.search(/\.intent\s*=/)
        const m = /\b([A-Z][A-Z0-9_]*)\s*:/.exec(text.slice(i))
        const before = text.slice(0, i + m.index)
        return { line: before.split('\n').length - 1, character: before.length - before.lastIndexOf('\n') - 1 }
      }
      const ask = async (text, i) => {
        const t = performance.now()
        const method = i % 2 ? 'textDocument/references' : 'textDocument/definition'
        const r = await client.request(method, { textDocument: { uri }, position: intentKey(text), context: { includeDeclaration: true } })
        const ms = performance.now() - t
        expect(r?.length).toBeGreaterThan(0)
        return ms
      }
      const fresh = []
      for (let i = 0; i < 10; i++) fresh.push(await ask(original, i))
      const changed = []
      let version = 2
      for (let i = 0; i < 10; i++) {
        // a change, then a request at once: the debounce hasn't run the check yet, the index is stale
        const text = `// edit ${i}\n` + original
        client.change(file, text, version++)
        changed.push(await ask(text, i))
        await client.settle()
      }
      // a save starts a check at once: a request right after it waits for that check; a further
      // unsaved change makes the worker build an index after the check
      const saved = [], behind = []
      for (let i = 0; i < 10; i++) {
        const text = `// saved ${i}\n` + original
        client.change(file, text, version++)
        client.save(file)
        saved.push(await ask(text, i))
        await client.settle()
        const again = `// saved ${i}\n` + original
        client.change(file, again + ' ', version++)
        client.save(file)
        const more = `// more ${i}\n` + again + ' '
        client.change(file, more, version++)
        behind.push(await ask(more, i))
        await client.settle()
      }
      const stat = (a) => `${Math.round(median(a))} ms (median of ${a.length}, ${Math.round(Math.min(...a))}-${Math.round(Math.max(...a))})`
      console.log(`lsp navigation: ${files.length} files, ${lines} lines: from the last check's index ${median(fresh).toFixed(1)} ms (median of ${fresh.length}, max ${Math.max(...fresh).toFixed(1)}); right after a change (index from the worker) ${stat(changed)}; right after a save (waits for its check) ${stat(saved)}; a change during a check (index after the check) ${stat(behind)}`)
      expect(Math.max(...fresh)).toBeLessThanOrEqual(50)
      expect(median(changed)).toBeLessThanOrEqual(150)
      expect(median(saved)).toBeLessThanOrEqual(150)
      expect(median(behind)).toBeLessThanOrEqual(300)
    } finally {
      client.server.dispose()
    }
  }, 120_000)

  it('language server: a mid-edit completion <= 150 ms, also during a check (main thread, last index)', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "latency", "private": true }')
    const project = buildProject(files, { cwd: dir })
    const indexMs = median(Array.from({ length: 5 }, () => time(() => completionIndex(project))))
    const client = startServer({ server: { worker: true, debounce: 150 } })
    try {
      await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'latency' }], initializationOptions: { strict: true } })
      const file = files.find(f => f.endsWith('.jsx') && /DOM\.click\('\./.test(fs.readFileSync(f, 'utf8')))
      const uri = uriOf(file)
      const original = fs.readFileSync(file, 'utf8')
      const at = original.indexOf("DOM.click('.") + "DOM.click('.".length
      // the selector string cut at the cursor: unterminated, the rest of the file intact
      const lineEnd = original.indexOf('\n', at)
      const broken = original.slice(0, at) + original.slice(lineEnd)
      const before = original.slice(0, at).split('\n')
      const position = { line: before.length - 1, character: before[before.length - 1].length }
      client.open(file, original)
      await client.settle()
      let version = 2
      const ask = async () => {
        const t = performance.now()
        const list = await client.request('textDocument/completion', { textDocument: { uri }, position })
        const ms = performance.now() - t
        expect(list.items.length).toBeGreaterThan(0)
        expect(list.items.every(i => i.label.startsWith('.'))).toBe(true)
        return ms
      }
      const idle = []
      for (let i = 0; i < 10; i++) { client.change(file, broken + `\n// ${i}\n`, version++); idle.push(await ask()) }
      await client.settle()
      const during = []
      for (let i = 0; i < 10; i++) {
        client.change(file, broken + `\n// during ${i}\n`, version++)
        client.save(file) // the check starts at once in the worker
        during.push(await ask())
        await client.settle()
      }
      console.log(`completion latency: ${files.length} files, ${lines} lines: index ${indexMs.toFixed(1)} ms (median of 5, in the worker with each check); mid-edit completion median ${median(idle).toFixed(1)} ms, max ${Math.max(...idle).toFixed(1)} ms; during a check median ${median(during).toFixed(1)} ms, max ${Math.max(...during).toFixed(1)} ms`)
      expect(Math.max(...idle)).toBeLessThanOrEqual(150)
      expect(Math.max(...during)).toBeLessThanOrEqual(150)
    } finally {
      client.server.dispose()
    }
  }, 120_000)
})
