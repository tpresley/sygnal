// @vitest-environment jsdom
// JSX children false / null / undefined render nothing on every path a Vite build takes: the
// JSX runtime (compile off), compiled blocks (a production client build, `compile: true`) and
// compiled SSR (a server build), and a view returning false renders only its placeholder comment.
// test/fixtures/cv/falsy.jsx built with examples/kanban's Vite and the built plugin.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderToString } from '../dist/index.esm.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kanban = path.join(repo, 'examples', 'kanban')
const fixture = path.join(repo, 'test', 'fixtures', 'cv', 'falsy.jsx')
const tmp = fs.mkdtempSync(path.join(repo, 'test', '.tmp-cvf-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

async function bundle(compile, ssr) {
  const vite = await import(pathToFileURL(createRequire(path.join(kanban, 'package.json')).resolve('vite')).href)
  const sygnal = (await import(pathToFileURL(path.join(repo, 'dist', 'vite', 'plugin.mjs')).href)).default
  // (blocks and compiled SSR are for real builds, not Vitest: this build stands for `vite build`)
  const vitest = process.env.VITEST
  delete process.env.VITEST
  try {
    const external = (id) => /^(sygnal|snabbdom|xstream)(\/|$)/.test(id)
    const r = await vite.build({
      root: path.dirname(fixture), configFile: false, logLevel: 'silent', mode: 'production',
      plugins: [sygnal({ compile, devtools: false, check: false, diagnostics: 'off' })],
      build: ssr
        ? { write: false, minify: false, ssr: fixture, rollupOptions: { external, output: { format: 'es' } } }
        : { write: false, minify: false, lib: { entry: fixture, formats: ['es'], fileName: 'f' }, rollupOptions: { external } },
    })
    const code = (Array.isArray(r) ? r[0] : r).output[0].code
    const file = path.join(tmp, `falsy-${compile ? 'on' : 'off'}-${ssr ? 'ssr' : 'client'}.mjs`)
    fs.writeFileSync(file, code)
    return { code, mod: await import(pathToFileURL(file).href) }
  } finally { process.env.VITEST = vitest }
}

let off, on, ssrOff, ssrOn
beforeAll(async () => {
  [off, on, ssrOff, ssrOn] = await Promise.all([bundle(false), bundle(true), bundle(false, true), bundle(true, true)])
}, 120000)
const settle = () => new Promise(r => setTimeout(r, 0))
const STRAY = /false|true|null|undefined/

// the falsy children render nothing; `{0}` and the components' placeholder comments are expected
const EXPECTED_OFF = '<div class="falsy"><p class="a"></p><p class="b">xyz</p><p class="c"></p><p class="d"></p>' +
  '<p class="e">0</p><p class="f"></p><!----><ul><li>a</li><!----></ul>' +
  '<div class="row"><span>r1</span><i>0</i></div><div class="row" title="tip"><span>r2</span>on<i>1</i></div></div>'

describe('falsy JSX children in a Vite build', () => {
  it('the client build has blocks and the server build compiled HTML', () => {
    expect(on.code).toMatch(/__cvb\.b\(/)
    expect(ssrOn.code).toMatch(/__cvs\./)
  })

  it('the client DOM: nothing for false / null / undefined, compiled or not, before and after toggling', async () => {
    const a = document.createElement('div'), b = document.createElement('div')
    document.body.append(a, b)
    const x = off.mod.mount(off.mod.Falsy, a), y = on.mod.mount(on.mod.Falsy, b)
    await settle(); await settle()
    expect(a.innerHTML).toBe(EXPECTED_OFF)
    expect(b.innerHTML).toBe(a.innerHTML)
    for (const t of ['FLIP', 'SOME', 'FLIP', 'ZERO', 'FLIP', 'FLIP']) {
      x.send(t); y.send(t)
      await settle(); await settle()
      expect(b.innerHTML, `after ${t}`).toBe(a.innerHTML)
      expect(a.textContent, `after ${t}`).not.toMatch(STRAY)
    }
    x.dispose(); y.dispose(); a.remove(); b.remove()
  })

  it('the server HTML: the same, compiled or not', () => {
    const html = renderToString(ssrOff.mod.Falsy), compiled = renderToString(ssrOn.mod.Falsy)
    expect(compiled).toBe(html)
    expect(html.replace(' data-sygnal-ssr=""', '')).toBe(EXPECTED_OFF)
    const on = { ...ssrOff.mod.Falsy.initialState, on: true }
    expect(renderToString(ssrOn.mod.Falsy, { state: on })).toBe(renderToString(ssrOff.mod.Falsy, { state: on }))
    expect(renderToString(ssrOn.mod.Falsy, { state: on }).replace(/<[^>]*>/g, '')).not.toMatch(STRAY)
  })
})
