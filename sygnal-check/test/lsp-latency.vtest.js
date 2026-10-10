// PLAN-7 §3 latency gate (C-3). Opt-in, best run alone (the full suite's parallel test files
// compete for the CPU):
//   SYGNAL_CHECK_LATENCY=1 npx --prefix sygnal-check vitest run --root sygnal-check test/lsp-latency.vtest.js
//
// Generates the 20k-line project of PLAN-7 0-A (dev-plans/research/p7-spikes/0-A/gen-large.mjs:
// the kanban, plan5-showcase and ai-panel-spa src/ trees, tests excluded, copied round-robin until
// 20,000 lines; 14 copies, 327 files, 20.8k lines) into a temp dir and checks it with --strict:
//   - a cold first check (the process and module already loaded, a fresh ParseCache) <= 2 s;
//   - a re-check after a one-file edit through `sources`, with the warm cache (3 untimed edits
//     first): median of 15 <= 300 ms.
// The limits only go down.
//
// Measured 2026-10-10 (Apple M3 Max, Node 24.14.0), bench-edit.mjs beside gen-large.mjs:
//   cold 438 ms, warm without a cache 351 ms, warm with the cache after a one-file edit 272 ms
//   (1 parse per edit; ~66 ms model build + ~190 ms rules). This test, run alone under vitest
//   (--reporter=verbose --silent=false prints its log line), 5 runs: cold 399-465 ms, warm
//   one-file edit 257-279 ms. The headroom is ~10 %: the rules' AST walks (ast.js walk/childNodes,
//   ~70 % of a warm check's self time) are the next thing to make faster, not more caching.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, createParseCache } from '../src/index.js'
import { expandInputs } from '../src/files.js'

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

  it('20k lines: cold <= 2 s, a one-file edit re-checks in <= 300 ms warm with the parse cache', () => {
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
    expect(cold).toBeLessThanOrEqual(2000)
    expect(warmEdit).toBeLessThanOrEqual(300)
  }, 60_000)
})
