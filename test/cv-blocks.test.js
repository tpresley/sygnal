// @vitest-environment jsdom
// CV-3: compiled blocks. test/fixtures/cv/app.jsx built as a production client bundle (blocks on)
// and without compiling, mounted on a real DOM (jsdom) and driven by the same actions: the DOM
// is the same after each one. The mock DOM (renderComponent) gets the blocks' plain vnodes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderComponent, renderToString, __cvb } from '../dist/index.esm.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kanban = path.join(repo, 'examples', 'kanban')
const fixture = path.join(repo, 'test', 'fixtures', 'cv', 'app.jsx')
const tmp = fs.mkdtempSync(path.join(repo, 'test', '.tmp-cvb-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

async function bundle(compile) {
  const vite = await import(pathToFileURL(createRequire(path.join(kanban, 'package.json')).resolve('vite')).href)
  const sygnal = (await import(pathToFileURL(path.join(repo, 'dist', 'vite', 'plugin.mjs')).href)).default
  // blocks are for production client builds, not Vitest: this build stands for `vite build`
  const vitest = process.env.VITEST
  delete process.env.VITEST
  try {
    const r = await vite.build({
      root: path.dirname(fixture), configFile: false, logLevel: 'silent', mode: 'production',
      plugins: [sygnal({ compile, devtools: false, check: false, diagnostics: 'off' })],
      build: { write: false, minify: false, lib: { entry: fixture, formats: ['es'], fileName: 'a' }, rollupOptions: { external: (id) => /^(sygnal|snabbdom|xstream)(\/|$)/.test(id) } },
    })
    const code = (Array.isArray(r) ? r[0] : r).output[0].code
    const file = path.join(tmp, `app-${compile ? 'on' : 'off'}.mjs`)
    fs.writeFileSync(file, code)
    return { code, mod: await import(pathToFileURL(file).href) }
  } finally { process.env.VITEST = vitest }
}

let off, on
beforeAll(async () => { off = await bundle(false); on = await bundle(true) }, 120000)
const settle = () => new Promise(r => setTimeout(r, 0))
const STEPS = [['RUN'], ['SELECT', 3], ['UPDATE'], ['SELECT', 5], ['SWAP'], ['REMOVE', 4], ['ADD'], ['RICH'], ['SELECT', 3], ['PLAIN'], ['RICH'], ['CLEAR'], ['RUN'], ['SELECT', 20]]

describe('CV-3: blocks on a real DOM', () => {
  it('the production client bundle has blocks (rows and the Collection item view)', () => {
    expect((on.code.match(/__cvb\.b\(/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(off.code).not.toMatch(/__cv/)
  })
  for (const name of ['Table', 'Coll']) {
    it(`${name}: the same DOM after every action`, async () => {
      const a = document.createElement('div'), b = document.createElement('div')
      document.body.append(a, b)
      const made = __cvb.n
      const x = off.mod.mount(off.mod[name], a), y = on.mod.mount(on.mod[name], b)
      await settle()
      for (const [t, d] of STEPS) {
        x.send(t, d); y.send(t, d)
        await settle(); await settle()
        expect(b.innerHTML, `${name} after ${t}`).toBe(a.innerHTML)
        expect(b.textContent).toBe(a.textContent)
      }
      // the rows were blocks (not the fallback): RUN twice, ADD
      expect(__cvb.n - made).toBeGreaterThanOrEqual(45)
      x.dispose(); y.dispose(); a.remove(); b.remove()
    })
  }
  it('a select patches only the rows that changed (blocks keep the same-output check)', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const y = on.mod.mount(on.mod.Coll, el)
    await settle()
    y.send('RUN'); await settle(); await settle()
    const records = []
    const mo = new MutationObserver(r => records.push(...r))
    mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true })
    y.send('SELECT', 7); await settle(); await settle()
    await new Promise(r => setTimeout(r, 0))
    mo.disconnect()
    expect(records.filter(r => r.type == 'attributes').length).toBe(1)
    expect(records.filter(r => r.type != 'attributes')).toEqual([])
    y.dispose(); el.remove()
  })
})

describe('CV-3: the mock DOM gets plain vnodes', () => {
  for (const name of ['Table', 'Coll']) {
    it(`${name}: renderComponent renders the same HTML`, async () => {
      const ta = renderComponent(off.mod[name]), tb = renderComponent(on.mod[name])
      for (const [t, d] of STEPS.slice(0, 8)) {
        ta.simulateAction(t, d); tb.simulateAction(t, d)
        await ta.settle(); await tb.settle()
        expect(tb.html()).toBe(ta.html())
      }
      ta.dispose(); tb.dispose()
    })
  }
})

describe('CV-4: blocks hydrate server markup', () => {
  for (const name of ['HydrTable', 'HydrColl']) {
    it(`${name}: keeps the server's row elements and text nodes, and then patches like a fresh render`, async () => {
      const html = renderToString(off.mod[name])
      const el = document.createElement('div'), fresh = document.createElement('div')
      el.innerHTML = html
      document.body.append(el, fresh)
      const lbls = [...el.querySelectorAll('.lbl')], texts = lbls.map(l => l.firstChild)
      expect(lbls.length).toBe(12)
      const made = __cvb.n
      const y = on.mod.mount(on.mod[name], el), z = on.mod.mount(on.mod[name], fresh)
      await settle(); await settle()
      // adopted, not made again: the same element and text node objects, no block made on `el`
      expect([...el.querySelectorAll('.lbl')].every((l, i) => l === lbls[i] && (l.firstChild === texts[i] || texts[i] == null))).toBe(true)
      expect(__cvb.n - made).toBe(12)  // the fresh mount's 12 only
      expect(el.innerHTML).toBe(fresh.innerHTML)
      for (const [t, d] of [['SELECT', 5], ['UPDATE'], ['RICH'], ['SWAP'], ['REMOVE', 7]]) {
        y.send(t, d); z.send(t, d)
        await settle(); await settle()
        expect(el.innerHTML, `after ${t}`).toBe(fresh.innerHTML)
      }
      y.dispose(); z.dispose(); el.remove(); fresh.remove()
    })
  }
})
