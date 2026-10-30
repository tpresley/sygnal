// CV-0 / CV-2: compiled views (sygnal/vite `compile: true`) make the same vnodes as the JSX
// runtime. Bundles test/fixtures/cv/views.jsx twice with examples/kanban's Vite 8 and the built
// plugin, compile off and on ('sygnal' external: both bundles use the same dist), calls every
// fixture view and compares the trees: sel, key, text, data (deep; functions by name), children,
// and whether each vnode is the pragma's plain kind (`$p`).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kanban = path.join(repo, 'examples', 'kanban')
const fixture = path.join(repo, 'test', 'fixtures', 'cv', 'views.jsx')
// inside the repo, so the bundles' `import 'sygnal'` resolves to this package (dist)
const tmp = fs.mkdtempSync(path.join(repo, 'test', '.tmp-cv-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

async function bundle(compile) {
  const req = createRequire(path.join(kanban, 'package.json'))
  const vite = await import(pathToFileURL(req.resolve('vite')).href)
  const sygnal = (await import(pathToFileURL(path.join(repo, 'dist', 'vite', 'plugin.mjs')).href)).default
  const r = await vite.build({
    root: path.dirname(fixture), configFile: false, logLevel: 'silent',
    plugins: [sygnal({ compile, devtools: false, check: false, diagnostics: 'off' })],
    build: { write: false, minify: false, lib: { entry: fixture, formats: ['es'], fileName: 'v' }, rollupOptions: { external: (id) => /^(sygnal|snabbdom|xstream)(\/|$)/.test(id) } },
  })
  const code = (Array.isArray(r) ? r[0] : r).output[0].code
  const file = path.join(tmp, `views-${compile ? 'on' : 'off'}.mjs`)
  fs.writeFileSync(file, code)
  return { code, mod: await import(pathToFileURL(file).href) }
}

// a comparable copy of a vnode tree
const fn = (f) => `fn:${f.name || '?'}`
function norm(v, seen = new Set()) {
  if (v === null || typeof v != 'object') return typeof v == 'function' ? fn(v) : v
  if (seen.has(v)) return '[cycle]'
  seen.add(v)
  if (Array.isArray(v)) return v.map(x => norm(x, seen))
  const out = {}
  if ('sel' in v && 'data' in v) out.$p = !!v.$p
  for (const k of Object.keys(v).sort()) if (k != 'elm') out[k] = norm(v[k], seen)
  seen.delete(v)
  return out
}

let off, on
beforeAll(async () => {
  off = await bundle(false)
  on = await bundle(true)
}, 120000)

describe('CV-2: compiled views make the JSX runtime\'s vnodes', () => {
  it('the compiled bundle calls __cv (and the other does not)', () => {
    expect(on.code).toMatch(/__cv\.e\(/)
    expect(off.code).not.toMatch(/__cv/)
  })
  const names = Object.keys((() => { const src = fs.readFileSync(fixture, 'utf8'); const m = {}; for (const x of src.matchAll(/^  (\w+): \[/gm)) m[x[1]] = 1; return m })())
  for (const name of names) {
    it(name, () => {
      const [a, pa] = off.mod.cases[name], [b, pb] = on.mod.cases[name]
      expect(norm(b(pb))).toEqual(norm(a(pa)))
    })
  }
  it('a static element\'s data is one object across renders (hoisted)', () => {
    const [v] = on.mod.cases.staticAttrs
    expect(v({}).data).toBe(v({}).data)
    const [t, p] = on.mod.cases.table
    const a = t(p).children[0].children[0], b = t(p).children[0].children[0]
    expect(a.data).toBe(b.data)
  })
})

// the option (plan Q-1, Q-3) and the transform's output (Q-2: a source map)
describe('sygnal/vite compile option', () => {
  const load = async () => {
    const vite = await import(pathToFileURL(createRequire(path.join(kanban, 'package.json')).resolve('vite')).href)
    const sygnal = (await import(pathToFileURL(path.join(repo, 'dist', 'vite', 'plugin.mjs')).href)).default
    // a Vite 8 plugin context: its parser, and the meta viteMajor reads
    const ctx = (warn = () => {}, viteVersion = '8.3.5') => ({ parse: (c, o) => vite.parseAst(c, o), meta: { viteVersion }, warn })
    return { sygnal, ctx }
  }
  const SRC = 'export const V = ({ n }) => <div className="a">{n}</div>\n'
  it('off by default: one plugin, no compile step', async () => {
    const { sygnal } = await load()
    expect(Array.isArray(sygnal())).toBe(false)
    expect(Array.isArray(sygnal({ compile: false }))).toBe(false)
  })
  it('compile: true adds a pre plugin that compiles client and server code, with a source map', async () => {
    const { sygnal, ctx } = await load()
    const [c, main] = sygnal({ compile: true })
    expect(c.enforce).toBe('pre')
    expect(main.name).toBe('vite-plugin-sygnal')
    const client = c.transform.call(ctx(), SRC, '/app/V.jsx')
    expect(client.code).toMatch(/__cv\.e\("div"/)
    expect(client.map.sources).toEqual(['/app/V.jsx'])
    expect(client.map.mappings.length).toBeGreaterThan(0)
    const server = c.transform.call(ctx(), SRC, '/app/V.jsx', { ssr: true })
    expect(server.code).toMatch(/__cvs\.r\("div"/)
  })
  it('the CommonJS build compiles too (its magic-string import)', async () => {
    const { ctx } = await load()
    const cjs = createRequire(import.meta.url)(path.join(repo, 'dist', 'vite', 'plugin.cjs.js'))
    const [c] = (cjs.default || cjs)({ compile: true })
    expect(c.transform.call(ctx(), SRC, '/app/V.jsx').code).toMatch(/__cv\.e\("div"/)
  })
  it('{ ssr: false } / { views: false } turn one part off', async () => {
    const { sygnal, ctx } = await load()
    const [noSsr] = sygnal({ compile: { ssr: false } })
    expect(noSsr.transform.call(ctx(), SRC, '/app/V.jsx', { ssr: true }).code).toMatch(/__cv\.e\(/)
    const [noViews] = sygnal({ compile: { views: false } })
    expect(noViews.transform.call(ctx(), SRC, '/app/V.jsx')).toBeNull()
    expect(noViews.transform.call(ctx(), SRC, '/app/V.jsx', { ssr: true }).code).toMatch(/__cvs\.r\(/)
  })
  it('skips node_modules, non-JSX files and virtual modules', async () => {
    const { sygnal, ctx } = await load()
    const [c] = sygnal({ compile: true })
    expect(c.transform.call(ctx(), SRC, '/app/node_modules/x/V.jsx')).toBeNull()
    expect(c.transform.call(ctx(), SRC, '/app/V.js')).toBeNull()
    expect(c.transform.call(ctx(), SRC, '\0virtual.jsx')).toBeNull()
  })
  it('warns once and compiles nothing below Vite 8', async () => {
    const { sygnal, ctx } = await load()
    const [c] = sygnal({ compile: true })
    const warn = vi.fn()
    expect(c.transform.call(ctx(warn, '7.3.6'), SRC, '/app/V.jsx')).toBeNull()
    expect(c.transform.call(ctx(warn, '7.3.6'), SRC, '/app/W.jsx')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/needs Vite 8/)
  })
})
