// PLAN-5 2-Z gate (D202/D209): the adapters add nothing to an app that doesn't import them; the
// native 'sygnal/ui' parts bundle with no Zag or React installed; each Zag part tree-shakes on
// its own. Bundles small apps against the build (dist/*.esm.js).
import { describe, it, expect } from 'vitest'
import { rollup } from 'rollup'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = (f) => path.join(root, 'dist', f)
const ENTRIES = { sygnal: dist('index.esm.js'), 'sygnal/ui': dist('ui.esm.js'), 'sygnal/zag': dist('zag.esm.js'), 'sygnal/ui/menu': dist('ui-menu.esm.js'), 'sygnal/ui/select': dist('ui-select.esm.js'), 'sygnal/ui/combobox': dist('ui-combobox.esm.js'), 'sygnal/react': dist('react.esm.js') }

// Rollup: the entries resolve to the build, everything else (xstream, snabbdom, @zag-js/*, react) is external
const bundle = async (contents) => {
  const own = new Set(['app', ...Object.values(ENTRIES)])
  const b = await rollup({
    input: 'app',
    external: (id) => !own.has(id) && !(id in ENTRIES),
    plugins: [{
      name: 'app',
      resolveId: (id) => (id === 'app' ? id : ENTRIES[id] || null),
      load: (id) => (id === 'app' ? contents : null),
    }],
    onwarn: () => {},
  })
  const { output } = await b.generate({ format: 'esm' })
  await b.close()
  return output[0].code
}

const APP = `
  function App({ state }) { return h('div', null, h('button', { className: 'x' }, String(state.n))) }
  App.initialState = { n: 0 }
  App.intent = ({ DOM }) => ({ X: DOM.click('.x') })
  App.model = { X: (s) => ({ ...s, n: s.n + 1 }) }
  run(App)
`
// a string only that module has
const MARKS = { fromZag: 'sygnal-zag-', fromReact: 'createRoot', Menu: "name: 'Menu'", Select: "name: 'Select'", Combobox: "name: 'Combobox'" }

describe('adapter tree-shaking', () => {
  it('an app without the adapters contains none of them, and imports no Zag or React package', async () => {
    const code = await bundle(`import { run, createElement as h } from 'sygnal'\nimport { dialog } from 'sygnal/ui'\nApp.uses = { d: dialog({ dialog: '.d' }) }\n${APP}`)
    for (const [k, m] of Object.entries(MARKS)) expect(code.includes(m), k).toBe(false)
    expect(code).not.toMatch(/@zag-js|from 'react/)
  }, 30000)

  it('esbuild: the native parts bundle when no Zag or React package can be resolved', async () => {
    const { build } = await import('esbuild')
    const blocked = []
    const r = await build({
      stdin: { contents: `import { dialog, popover, tabs, Toaster } from 'sygnal/ui'\nglobalThis.k = [dialog, popover, tabs, Toaster]`, resolveDir: root, loader: 'js' },
      bundle: true, minify: true, write: false, format: 'esm', logLevel: 'silent',
      alias: { 'sygnal/ui': ENTRIES['sygnal/ui'] }, external: ['sygnal', 'xstream', 'snabbdom'],
      plugins: [{ name: 'no-peers', setup(b) { b.onResolve({ filter: /^(@zag-js\/|react(-dom)?(\/|$))/ }, (a) => { blocked.push(a.path); return { errors: [{ text: a.path }] } }) } }],
    })
    expect(blocked).toEqual([])
    expect(r.outputFiles[0].text.length).toBeGreaterThan(100)
  }, 30000)

  it('Rollup: an app using one Zag part keeps only that part (fromZag once)', async () => {
    for (const part of ['Menu', 'Select', 'Combobox']) {
      const code = await bundle(`import { run, createElement as h } from 'sygnal'\nimport { ${part} } from 'sygnal/ui/${part.toLowerCase()}'\nglobalThis.k = ${part}\n${APP}`)
      for (const other of ['Menu', 'Select', 'Combobox']) expect(code.includes(MARKS[other]), `${part}: ${other}`).toBe(other === part)
      expect(code.split(MARKS.fromZag).length - 1, part).toBe(1)
    }
  }, 30000)

  // esbuild with the real packages (Zag's are "sideEffects": false): the packages each app bundles
  const inputs = async (contents) => {
    const { build } = await import('esbuild')
    const r = await build({
      stdin: { contents, resolveDir: root, loader: 'js' },
      bundle: true, minify: true, write: false, format: 'esm', logLevel: 'silent', metafile: true,
      alias: ENTRIES, define: { 'process.env.NODE_ENV': '"production"' },
    })
    // the modules with bytes in the output (metafile.inputs also lists the tree-shaken ones)
    const used = Object.entries(Object.values(r.metafile.outputs)[0].inputs).filter(([, i]) => i.bytesInOutput > 0).map(([f]) => f)
    const pkgs = used.map((f) => f.match(/node_modules\/(@zag-js\/[a-z-]+|react-dom|react|preact)\//)?.[1])
    return [...new Set(pkgs.filter(Boolean))].sort()
  }

  for (const part of ['Menu', 'Select', 'Combobox']) {
    it(`esbuild: an app using only ${part} bundles only its own Zag machine`, async () => {
      const pkgs = await inputs(`import { run, createElement as h } from 'sygnal'\nimport { ${part} } from 'sygnal/ui/${part.toLowerCase()}'\nglobalThis.k = ${part}\n${APP}`)
      expect(pkgs).toContain('@zag-js/' + part.toLowerCase())
      expect(pkgs).toContain('@zag-js/vanilla')
      for (const other of ['menu', 'select', 'combobox']) if (other !== part.toLowerCase()) expect(pkgs, other).not.toContain('@zag-js/' + other)
      expect(pkgs.some((p) => /react|preact/.test(p))).toBe(false)
    }, 30000)
  }

  it('esbuild: sygnal/react bundles react and react-dom and no Zag; an app without it has neither', async () => {
    expect(await inputs(`import { fromReact } from 'sygnal/react'\nglobalThis.k = fromReact(() => null)`)).toEqual(['react', 'react-dom'])
    expect(await inputs(`import { run, createElement as h } from 'sygnal'\n${APP}`)).toEqual([])
  }, 30000)
})
