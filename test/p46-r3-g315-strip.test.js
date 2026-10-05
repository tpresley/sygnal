// PLAN-4.6 R3, G-315 (D175): a production build that strips the next core keeps none of its
// top-level statements (teardown.ts's prototype probe ran at import time and survived the strip).
// Built with Vite as sygnal/vite's production builds are (define __SYGNAL_NEXT_CORE__: false),
// from dist with examples/kanban's Vite, as the size gate (run `npm run build` and install kanban first).
import { it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

it('G-315: with __SYGNAL_NEXT_CORE__ false, no next-core top-level code is left (teardown prototype probe)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p46-g315-'))
  try {
    const entry = path.join(dir, 'main.js')
    fs.writeFileSync(entry, `import { run } from ${JSON.stringify(path.join(repo, 'dist/index.esm.js'))}\nrun(() => null)\n`)
    const { build } = await import(pathToFileURL(createRequire(path.join(repo, 'examples/kanban/package.json')).resolve('vite')).href)
    const out = await build({
      root: dir, logLevel: 'silent', configFile: false,
      define: { __SYGNAL_NEXT_CORE__: 'false' },
      build: { write: false, minify: false, rollupOptions: { input: entry, treeshake: true } },
    })
    const code = [].concat(out).flatMap((o) => o.output).filter((c) => c.type == 'chunk').map((c) => c.code).join('\n')
    expect(code).toMatch(/until the import resolves|renderComponent|data-sygnal/)
    expect(code).not.toMatch(/getPrototypeOf\([\w$]+\.create\(\)\)/)
    expect(code).not.toMatch(/sygnal\.inst/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}, 120000)
