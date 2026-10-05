// PLAN-5 3-G, G-440: SYG666 missed a dynamic import whose specifier is a template literal
// (import(`sygnal/zag`)), both through parse() and through the fallback scan.
import { it, expect } from 'vitest'
import { parseAst } from 'vite'
import sygnal from '../dist/vite/plugin.mjs'

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
const ctx = (parse) => ({
  resolve: async () => null,
  error: (m) => { throw new Error(typeof m === 'string' ? m : m.message) },
  warn: () => {},
  ...(parse ? { parse: (code) => parseAst(code) } : {}),
})
const run = (p, code, parse) => Promise.resolve(p.transform.call(ctx(parse), code, '/app/src/Lazy.jsx', {}))

for (const [how, parse] of [['parse()', true], ['the fallback scan', false]]) {
  it(`SYG666 (${how}): import(\`sygnal/…\`) is an import; a template with a substitution, or a template mention, is not`, async () => {
    const p = plugin()
    await expect(run(p, 'export const load = () => import(`sygnal/zag`)', parse)).rejects.toThrow(/'sygnal\/zag' needs/)
    await expect(run(p, 'export const load = () => import( `sygnal/ui/menu` )', parse)).rejects.toThrow(/'sygnal\/ui\/menu' needs/)
    expect(await run(p, 'const n = "zag"; export const load = () => import(`sygnal/${n}`)', parse)).toBe(null)
    expect(await run(p, 'export const s = `import(\\`sygnal/react\\`)`', parse)).toBe(null)
  })
}

