// PLAN-5 2-T, G-415: SYG666 looks at real imports (the module's AST through the plugin context's
// parse(), as Vite and Rollup provide it), so a string or template literal that mentions an
// adapter entry (docs, code samples) never fails the build. Without parse() (or when the code
// doesn't parse), a scan that skips comments, strings and template literals stands in.
import { describe, it, expect } from 'vitest'
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
// nothing installed: any real adapter import is SYG666
const ctx = (parse) => ({
  resolve: async () => null,
  error: (m) => { throw new Error(typeof m === 'string' ? m : m.message) },
  warn: () => {},
  ...(parse ? { parse: (code) => parseAst(code) } : {}),
})
const run = (p, code, parse) => Promise.resolve(p.transform.call(ctx(parse), code, '/app/src/Docs.jsx', {}))

const MENTIONS = [
  "export const SNIPPET = \"import { fromReact } from 'sygnal/react'\"",
  "export const S = `import { Menu } from 'sygnal/ui/menu'`",
  "export const T = `x ${1} import('sygnal/zag')`",
  "const s = 'from \"sygnal/ui/select\"'; export default s",
]

for (const [how, parse] of [['parse()', true], ['the fallback scan', false]]) {
  describe(`SYG666 with ${how}`, () => {
    it('a string or template literal mentioning an adapter entry is not an import', async () => {
      const p = plugin()
      for (const code of MENTIONS) expect(await run(p, code, parse), code).toBe(null)
    })

    it('real imports still report: static, dynamic, re-export', async () => {
      const p = plugin()
      await expect(run(p, "import { Menu } from 'sygnal/ui/menu'\nexport const s = 'sygnal/react'", parse)).rejects.toThrow(/'sygnal\/ui\/menu' needs/)
      await expect(run(p, "export async function f() { return import('sygnal/zag') }", parse)).rejects.toThrow(/'sygnal\/zag' needs/)
      await expect(run(p, "export { Combobox } from 'sygnal/ui/combobox'", parse)).rejects.toThrow(/'sygnal\/ui\/combobox' needs/)
    })
  })
}

it('code that parse() rejects falls back to the scan', async () => {
  const p = plugin()
  await expect(run(p, "import { fromReact } from 'sygnal/react'\nconst x = <div />", true)).rejects.toThrow(/'sygnal\/react' needs/)
  expect(await run(p, "const s = 'import x from \"sygnal/react\"'\nconst x = <div />", true)).toBe(null)
})
