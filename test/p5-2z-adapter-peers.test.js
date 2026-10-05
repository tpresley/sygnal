// PLAN-5 2-Z (W-2, D209): SYG666. A module that imports an adapter entry (sygnal/react,
// sygnal/zag, sygnal/ui/menu, sygnal/ui/select, sygnal/ui/combobox) without its optional peer dependencies installed is reported by
// sygnal/vite when it transforms that module, naming what to install. Packaging checks for the
// adapter entries (exports, optional peers, externals) are in the same file.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import sygnal from '../dist/vite/plugin.mjs'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function plugin() {
  const p = sygnal()
  const saved = process.env.VITEST
  delete process.env.VITEST
  try {
    p.config.call({ meta: { viteVersion: '8.0.0' } }, {}, { command: 'build' })
    p.configResolved?.({ root: process.cwd(), command: 'build', plugins: [], build: {}, server: {} })
  } finally { if (saved !== undefined) process.env.VITEST = saved }
  return p
}

// a plugin context whose resolve() finds only the packages in `installed`
const ctx = (installed) => ({
  resolve: async (id) => (installed.includes(id) ? { id: `/node_modules/${id}/index.js` } : null),
  error: (m) => { throw new Error(typeof m === 'string' ? m : m.message) },
  warn: () => {},
})
const run = (p, code, installed, id = '/app/src/Rating.jsx') => Promise.resolve(p.transform.call(ctx(installed), code, id, {}))

describe('SYG666 (sygnal/vite)', () => {
  it('sygnal/react without react-dom: names the package to install', async () => {
    const p = plugin()
    await expect(run(p, "import { fromReact } from 'sygnal/react'\nexport const X = 1", ['react']))
      .rejects.toThrow(/\[Sygnal SYG666\] 'sygnal\/react' needs react-dom, which isn't installed: npm install react-dom\..*errors#syg666/)
  })

  it('D211: each ui part subpath needs only @zag-js/vanilla and its own machine', async () => {
    const p = plugin()
    await expect(run(p, "import { Menu } from 'sygnal/ui/menu'", []))
      .rejects.toThrow(/'sygnal\/ui\/menu' needs @zag-js\/vanilla, @zag-js\/menu, which aren't installed: npm install @zag-js\/vanilla@~1\.45\.0 @zag-js\/menu@~1\.45\.0\./)
    expect(await run(p, "import { Menu } from 'sygnal/ui/menu'", ['@zag-js/vanilla', '@zag-js/menu'])).toBe(null)
    await expect(run(p, "import { Select } from 'sygnal/ui/select'", ['@zag-js/vanilla', '@zag-js/menu']))
      .rejects.toThrow(/'sygnal\/ui\/select' needs @zag-js\/select, which isn't installed: npm install @zag-js\/select@~1\.45\.0\./)
    await expect(run(p, "import { Combobox } from 'sygnal/ui/combobox'", ['@zag-js/vanilla']))
      .rejects.toThrow(/'sygnal\/ui\/combobox' needs @zag-js\/combobox/)
  })

  it('sygnal/zag (also a dynamic import) without @zag-js/vanilla', async () => {
    const p = plugin()
    await expect(run(p, "const m = await import('sygnal/zag')", [])).rejects.toThrow(/'sygnal\/zag' needs @zag-js\/vanilla/)
  })

  it('nothing when the peers resolve (an alias to preact/compat resolves too), or for a commented-out import', async () => {
    const p = plugin()
    expect(await run(p, "import { fromReact } from 'sygnal/react'", ['react', 'react-dom'])).toBe(null)
    expect(await run(p, "// import { fromReact } from 'sygnal/react'\nimport { run } from 'sygnal/ui'", [])).toBe(null)
    expect(await run(p, "import { fromReact } from 'sygnal/react'", [], '/app/node_modules/lib/index.js')).toBe(null)
  })
})

describe('adapter entries packaging (D209)', () => {
  it('exports sygnal/react, sygnal/zag and the per-part ui subpaths with types (D211: no sygnal/ui/zag)', () => {
    expect(pkg.exports['./ui/zag']).toBeUndefined()
    for (const e of ['./react', './zag', './ui/menu', './ui/select', './ui/combobox']) {
      expect(pkg.exports[e], e).toBeTruthy()
      for (const f of ['types', 'import', 'require']) expect(fs.existsSync(new URL('../' + pkg.exports[e][f], import.meta.url)), `${e} ${f}`).toBe(true)
    }
  })

  it('react, react-dom and the Zag packages are optional peers (Zag pinned ~1.45.0), never dependencies', () => {
    for (const d of ['react', 'react-dom', '@zag-js/vanilla', '@zag-js/menu', '@zag-js/select', '@zag-js/combobox']) {
      expect(pkg.peerDependencies[d], d).toBeTruthy()
      expect(pkg.peerDependenciesMeta[d], d).toEqual({ optional: true })
      expect(pkg.dependencies[d], d).toBeUndefined()
    }
    for (const d of ['@zag-js/vanilla', '@zag-js/menu', '@zag-js/select', '@zag-js/combobox']) expect(pkg.peerDependencies[d]).toBe('~1.45.0')
  })

  it('the builds keep the peers and the core external (no Zag or React code inside)', () => {
    const read = (f) => fs.readFileSync(new URL('../dist/' + f, import.meta.url), 'utf8')
    const zag = read('zag.esm.js'), react = read('react.esm.js')
    expect(zag).toMatch(/^import \{ VanillaMachine \} from '@zag-js\/vanilla';$/m)
    expect(zag).toMatch(/^import \{ defineWidget \} from 'sygnal';$/m)
    expect(zag).not.toMatch(/class VanillaMachine/)
    for (const part of ['menu', 'select', 'combobox']) {
      const ui = read(`ui-${part}.esm.js`)
      expect(ui).toMatch(/^import \{ fromZag \} from 'sygnal\/zag';$/m)
      expect(ui).toMatch(new RegExp(`from '@zag-js/${part}'`))
      for (const other of ['menu', 'select', 'combobox']) if (other !== part) expect(ui, `${part}: ${other}`).not.toMatch(new RegExp(`@zag-js/${other}`))
      expect(ui).not.toMatch(/function fromZag|VanillaMachine/)
    }
    expect(react).toMatch(/^import \{ createRoot \} from 'react-dom\/client';$/m)
    expect(react).not.toMatch(/__SECRET_INTERNALS|ReactCurrentOwner/)
    // the native parts and the core don't reference them
    for (const f of ['index.esm.js', 'ui.esm.js']) expect(read(f)).not.toMatch(/@zag-js|from 'react/)
  })
})
