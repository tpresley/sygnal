// sygnal/vite `api` (sygnal/api dev preview): a real client build of test/fixtures/api-app with
// the root's Vite (the typed-api example covers Vite 8), run in a child process so the plugin
// sees a plain `vite build`. The bundle must have the stubs and manifest, and nothing of the
// server files: their imports, secrets, function bodies, other exports, the schema library.
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { contractHash, fnFiles } from '../src/extra/api/index.js'

const root = path.resolve(__dirname, 'fixtures/api-app')
let js = ''

beforeAll(() => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-api-app-'))
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('VITEST') || k === 'NODE_ENV') delete env[k]
  execFileSync(process.execPath, [path.resolve(__dirname, '../node_modules/vite/bin/vite.js'), 'build', root, '--outDir', out], { env, stdio: 'pipe' })
  const assets = path.join(out, 'assets')
  js = fs.readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n')
  fs.rmSync(out, { recursive: true, force: true })
}, 60_000)

describe('sygnal/vite api: the client bundle', () => {
  it('has none of the server files: secrets, server-only imports, bodies, non-function exports', () => {
    for (const s of ['db-password-server-only-1234', 'token-in-a-server-file-5678', 'SERVER_ROW_MARKER', 'DB_PASSWORD', 'node:fs', 'existsSync', 'HELPER_EXPORT_MARKER'])
      expect(js, s).not.toContain(s)
  })

  it('has no schema library: the contract is its routes and its build-time hash', async () => {
    expect(js).not.toContain('SCHEMA_ONLY_MARKER')
    expect(js).not.toMatch(/ZodError|\$ZodType|zod/i)
    const { contract } = await import('./fixtures/api-app/src/contract.js')
    expect(js).toContain(JSON.stringify(contractHash(contract)).slice(1, -1))
  })

  it('has the stubs: ids, kinds, error statuses and the file hash the server computes', async () => {
    const mod = await import('./fixtures/api-app/src/notes.server.js')
    const [f] = fnFiles({ 'src/notes.server.js': mod })
    expect(f.ns).toBe('notes')
    expect(js).toContain(`notes:${f.hash}`)
    expect(js).toMatch(/__serverFunction\("notes\.search", \{\s*"?kind"?: "query"/)
    expect(js).toMatch(/"notes\.save", \{\s*"?kind"?: "mutation",\s*"?errors"?: \{\s*"?FULL"?: \{\s*"?status"?: 507/)
  })
})
