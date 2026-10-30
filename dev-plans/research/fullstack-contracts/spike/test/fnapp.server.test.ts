// @vitest-environment node
// Function-first: the Vite plugin stubs *.server.ts for the client and serves /rpc/* in dev.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { serverFunctions, stubModule } from '../lib/vite-server-functions.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
let vite: ViteDevServer, base = ''
beforeAll(async () => {
  vite = await createServer({ root, configFile: false, logLevel: 'silent', plugins: [serverFunctions()], server: { port: 0, host: '127.0.0.1' } })
  await vite.listen()
  const a: any = vite.httpServer!.address()
  base = `http://127.0.0.1:${a.port}`
})
afterAll(() => vite.close())


describe('server functions', () => {
  it('the client module is stubs only: no implementation, no server imports', async () => {
    const r = await vite.transformRequest('/fnapp/quotes.server.ts')
    expect(r!.code).toMatch(/rpcStub\("fnapp\/quotes\/listQuotes", "query"\)/)
    expect(r!.code).not.toMatch(/quotes\.push|zod|ApiError/)
  })

  it('any other export fails the build (fail closed)', () => {
    expect(() => stubModule('export const secret = 1\nexport const q = query(s, f)', 'm', 'm.server.ts')).toThrow(/may only export/)
    expect(() => stubModule('export { db }', 'm', 'm.server.ts')).toThrow(/may only export/)
  })

  it('the dev server answers /rpc/* from the real module', async () => {
    const res = await fetch(`${base}/rpc/fnapp/quotes/listQuotes?input=${encodeURIComponent('{"tag":"calm"}')}`, { headers: { 'x-sygnal-rpc': '1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 1, text: 'Start where you are.', tag: 'calm' }])
  })
})
