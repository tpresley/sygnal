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
//     median of 10 <= 500 ms (debounce included);
//   - a hover sent right after a didSave (the check starts at once) is answered from the last
//     results while the check runs: <= 50 ms, before the check's publish.
//   Measured 2026-10-10 (same machine): didChange → publish median 454 ms under vitest (446-464;
//   a standalone script: 412-433 ms, the worker's check 261-280 ms + the 150 ms debounce); hover
//   during a check 0.3 ms. The headroom is ~10 %, the same as the check gate's (G-660).
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

  it('language server: didChange → publish <= 500 ms with the debounce; hover <= 50 ms during a check (worker)', async () => {
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
      expect(publish).toBeLessThanOrEqual(500)
      expect(hover).toBeLessThanOrEqual(50)
    } finally {
      client.server.dispose()
    }
  }, 120_000)
})
