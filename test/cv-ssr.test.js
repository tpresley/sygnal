// CV-1: compiled SSR (sygnal/vite `compile`, server builds) renders the same HTML as
// renderToString of the same views uncompiled: test/fixtures/cv/views.jsx bundled as server code
// with examples/kanban's Vite 8, compile off and on ('sygnal' external: one dist).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderToString, __cvs } from '../dist/index.esm.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kanban = path.join(repo, 'examples', 'kanban')
const fixture = path.join(repo, 'test', 'fixtures', 'cv', 'views.jsx')
const tmp = fs.mkdtempSync(path.join(repo, 'test', '.tmp-cvs-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

async function bundle(compile) {
  const req = createRequire(path.join(kanban, 'package.json'))
  const vite = await import(pathToFileURL(req.resolve('vite')).href)
  const sygnal = (await import(pathToFileURL(path.join(repo, 'dist', 'vite', 'plugin.mjs')).href)).default
  // the plugin never compiles SSR under Vitest (renderComponent's mock DOM needs vnodes): this
  // build stands for a real server build
  const vitest = process.env.VITEST
  delete process.env.VITEST
  try {
    const r = await vite.build({
      root: path.dirname(fixture), configFile: false, logLevel: 'silent',
      plugins: [sygnal({ compile, devtools: false, check: false, diagnostics: 'off' })],
      build: { write: false, minify: false, ssr: fixture, rollupOptions: { external: (id) => /^(sygnal|snabbdom|xstream)(\/|$)/.test(id), output: { format: 'es' } } },
    })
    const code = (Array.isArray(r) ? r[0] : r).output[0].code
    const file = path.join(tmp, `ssr-${compile ? 'on' : 'off'}.mjs`)
    fs.writeFileSync(file, code)
    return { code, mod: await import(pathToFileURL(file).href) }
  } finally { process.env.VITEST = vitest }
}

let off, on
beforeAll(async () => { off = await bundle(false); on = await bundle(true) }, 120000)

describe('CV-1: compiled SSR renders renderToString\'s HTML', () => {
  it('the server bundle is compiled to HTML parts', () => {
    expect(on.code).toMatch(/__cvs\.r\(/)
    expect(on.code).toMatch(/__cvs\.(f|s)\(/)
    expect(off.code).not.toMatch(/__cvs/)
  })
  const names = [...fs.readFileSync(fixture, 'utf8').matchAll(/^  (\w+): \[/gm)].map(m => m[1])
  for (const name of names) {
    it(name, () => {
      const [a, pa] = off.mod.cases[name], [b, pb] = on.mod.cases[name]
      const render = (v, props) => renderToString(v, { props, state: { items: [{ id: 1 }, { id: 2 }], tab: 'a' } })
      expect(render(b, pb)).toBe(render(a, pa))
    })
  }
})

// the fast open-tag writer agrees with the general one (vnodeToHtml) on every data shape it takes,
// and hands the rest to it
describe('CV-1: fast open tags', () => {
  const [fast, slow] = __cvs.$t
  const vals = ['', 'a', 'a b', 'a  a', '<"&\'>', 0, 1, -1.5, true, false, null, undefined, NaN, {}, [1], 'x"y']
  let s = 1
  const pick = (a) => { s = (s * 16807) % 2147483647; return a[s % a.length] }
  const PROPS = ['className', 'id', 'title', 'htmlFor', 'href', 'tabIndex', 'hidden', 'value', 'textContent', 'innerHTML']
  const DS = ['id', 'taskId', 'x', 'WebkitThing']
  it('2,000 random data shapes on div, a, img, br', () => {
    for (let n = 0; n < 2000; n++) {
      const data = {}
      if (pick([0, 1, 1])) { data.props = {}; for (let i = pick([0, 1, 2, 3]); i > 0; i--) data.props[pick(PROPS)] = pick(vals) }
      if (pick([0, 1])) { data.dataset = {}; for (let i = pick([1, 2]); i > 0; i--) data.dataset[pick(DS)] = pick(vals) }
      if (!pick([0, 0, 0, 0, 1]) === false) data.attrs = { role: 'x' }
      const sel = pick(['div', 'a', 'img', 'br', 'div.c', 'h1'])
      expect(fast(sel, data)).toEqual(slow(sel, data))
    }
  })
})
