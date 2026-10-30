// CV-0 / CV-2: compiled views (sygnal/vite `compile: true`) make the same vnodes as the JSX
// runtime. Bundles test/fixtures/cv/views.jsx twice with examples/kanban's Vite 8 and the built
// plugin, compile off and on ('sygnal' external: both bundles use the same dist), calls every
// fixture view and compares the trees: sel, key, text, data (deep; functions by name), children,
// and whether each vnode is the pragma's plain kind (`$p`).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
