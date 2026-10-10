// PLAN-7 §3 gates for the language server (L-2):
//   - parity: with no overlays, the published diagnostics equal check()'s (codes, ranges,
//     messages) on every example app and the checker's fixture sets, default config and strict;
//   - robustness: example files truncated at random points (seeded) as didChange never crash the
//     server, never change another file's findings while the text doesn't parse, keep the file's
//     last good findings, and come back to the original findings when the text is whole again;
//   - no new runtime dependencies: `dependencies` is exactly @babel/parser.
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check } from '../src/index.js'
import { parseSource } from '../src/ast.js'
import { messageOf } from '../src/lsp/convert.js'
import { expandInputs } from '../src/files.js'
import { startServer, pkgRoot, repo, pocFixture, uriOf } from './lsp-helpers.js'

const servers = []
afterAll(() => { for (const s of servers) s.server.dispose() })

const examples = fs.readdirSync(path.join(repo, 'examples'), { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => path.join(repo, 'examples', d.name))
  .map(dir => ({ name: `examples/${path.basename(dir)}`, dir, paths: [fs.existsSync(path.join(dir, 'src')) ? 'src' : '.'] }))
const fixtureSets = ['bad', 'good', 'strict/bad', 'strict/good', 'p7-c4/fix-input', 'p7-c4/controls-input', 'sources']
  .map(rel => ({ name: `fixtures/${rel}`, dir: path.join(pkgRoot, 'test/fixtures', rel), paths: ['.'] }))
  .concat([{ name: 'ide-tooling-poc/fixture', dir: pocFixture, paths: ['src'] }])
const sets = [...examples, ...fixtureSets]

async function serve(set, settings = {}, server = {}) {
  const client = startServer({ server })
  servers.push(client)
  await client.initialize({ workspaceFolders: [{ uri: uriOf(set.dir), name: set.name }], initializationOptions: { paths: set.paths, verbose: true, ...settings } })
  return client
}

const tuple = (file, r, code, severity, message) => `${file} ${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character} ${code} ${severity} ${message}`
const SEV = { error: 1, warn: 2, info: 3 }

function expected(set, strict) {
  return check(set.paths, { cwd: set.dir, ...(strict ? { strict: true } : {}) })
    .filter(d => d.file)
    .map(d => tuple(path.resolve(set.dir, d.file), {
      start: { line: d.line - 1, character: d.column - 1 },
      end: d.endLine !== undefined ? { line: d.endLine - 1, character: d.endColumn - 1 } : { line: d.line - 1, character: -1 },
    }, d.code, SEV[d.severity], messageOf(d)))
    .sort()
}

function published(client) {
  const out = []
  for (const [uri, list] of client.diagnostics) {
    const file = fileURLToPath(uri)
    for (const d of list) out.push(tuple(file, d.range, d.code, d.severity, d.message))
  }
  return out.sort()
}

describe('parity with check() (PLAN-7 §3)', () => {
  let total = 0
  for (const set of sets) {
    for (const strict of [false, true]) {
      it(`${set.name}${strict ? ' --strict' : ''}`, async () => {
        const want = expected(set, strict)
        const client = await serve(set, strict ? { strict: true } : {})
        let got = published(client)
        // a finding without an end (a config file's SYG900) gets a token-length range: compare its start
        got = got.map((g, i) => want[i]?.includes(':-1 ') ? g.replace(/-(\d+):(\d+) /, (m, l) => `-${l}:-1 `) : g)
        expect(got).toEqual(want)
        total += want.length
        client.server.dispose()
      }, 30_000)
    }
  }
  afterAll(() => {
    // the sets must exercise something: the fixtures alone have dozens of findings
    expect(total).toBeGreaterThan(50)
  })
})

/** mulberry32: a small seeded PRNG. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const unparseable = (text, file) => {
  try { return parseSource(text, file).errors?.length > 0 } catch { return true }
}

const snapshot = (client) => new Map([...client.diagnostics].filter(([, l]) => l.length).map(([u, l]) => [u, JSON.stringify(l)]))
const withoutParseErrors = (list) => JSON.stringify(list.filter(d => !(d.code === 'SYG900' && /^could not parse file/.test(d.message))))

describe('fuzz: truncated files mid-edit (PLAN-7 §3 robustness)', () => {
  const stats = []
  afterAll(() => { if (process.env.SYGNAL_LSP_FUZZ_LOG) process.stderr.write(stats.join('\n') + '\n') })
  const FILES_PER_APP = 4
  const CUTS_PER_FILE = 3
  // the examples are clean (they check that nothing appears); the fixture sets have findings in
  // many files (that nothing disappears)
  for (const [i, set] of sets.entries()) {
    for (const worker of i === 0 ? [false, true] : [false]) {
      it(`${set.name}${worker ? ' (worker)' : ''}`, async () => {
        const random = rng(0x5eed + i)
        const client = await serve(set, { strict: true }, { worker })
        const baseline = snapshot(client)
        const files = expandInputs(set.paths, { cwd: set.dir }).files
        expect(files.length).toBeGreaterThan(0)
        const picked = [...files].sort(() => random() - 0.5).slice(0, FILES_PER_APP)
        let broken = 0
        for (const file of picked) {
          const uri = uriOf(file)
          const text = fs.readFileSync(file, 'utf8')
          client.open(file, text)
          await client.settle()
          expect(snapshot(client)).toEqual(baseline)
          let version = 2
          for (let c = 0; c < CUTS_PER_FILE; c++) {
            const cut = Math.floor(random() * text.length)
            const truncated = text.slice(0, cut)
            const prev = snapshot(client) // the last good state (a cut that parses cleanly is a real text)
            client.change(file, truncated, version++)
            await client.settle()
            if (unparseable(truncated, file)) {
              broken++
              const now = snapshot(client)
              const at = `after cutting ${path.basename(file)} at ${cut}`
              for (const [u, l] of prev) if (u !== uri) expect(now.get(u), `${path.basename(new URL(u).pathname)} ${at}`).toBe(l)
              for (const [u] of now) if (u !== uri) expect(prev.has(u), at).toBe(true)
              const before = prev.has(uri) ? withoutParseErrors(JSON.parse(prev.get(uri))) : '[]'
              expect(withoutParseErrors(client.diags(file)), at).toBe(before)
            }
            // the server still answers
            expect(await client.request('textDocument/hover', { textDocument: { uri }, position: { line: 0, character: 0 } })).toBeDefined()
          }
          client.change(file, text, version++)
          await client.settle()
          expect(snapshot(client)).toEqual(baseline)
          client.close(file)
          await client.settle()
        }
        expect(broken).toBeGreaterThan(0)
        stats.push(`${set.name}: ${picked.length} files, ${broken} unparseable cuts, ${[...baseline.values()].reduce((n, l) => n + JSON.parse(l).length, 0)} findings kept`)
        expect(client.messages.filter(m => 'error' in m)).toEqual([])
        expect(client.messages.filter(m => m.method === 'window/logMessage' && m.params.type === 1)).toEqual([])
        client.server.dispose()
      }, 60_000)
    }
  }
})

describe('dependencies (PLAN-7 §3)', () => {
  it('sygnal-check has no runtime dependency but @babel/parser', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
    expect(Object.keys(pkg.dependencies)).toEqual(['@babel/parser'])
    expect(pkg.peerDependencies).toBeUndefined()
    expect(pkg.optionalDependencies).toBeUndefined()
    // the conformance test's client library is an exact-pinned dev dependency
    expect(pkg.devDependencies['vscode-languageserver-protocol']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
