// Strict mode (2A) through the BUILT packages: the strict checks ship in
// 'sygnal/diagnostics' only (D29: nothing in the main bundle), and
// renderComponent({ strict: true }) from 'sygnal' turns them on.
// (Runs against dist/: `npm run build` first.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dist = (file) => fileURLToPath(new URL(`../../dist/${file}`, import.meta.url))

if (typeof globalThis.window === 'undefined') globalThis.window = undefined

describe("strict mode in the built entries", () => {
  it('keeps the strict checks and SYG5xx severities out of the main bundle', () => {
    const main = readFileSync(dist('index.esm.js'), 'utf8')
    const entry = readFileSync(dist('diagnostics.esm.js'), 'utf8')
    for (const marker of ["uses the 'ACTION | SINK' shorthand", 'positional arguments', 'and returned the same object', 'SYG501']) {
      expect(entry).toContain(marker)
      expect(main).not.toContain(marker)
    }
  })

})
