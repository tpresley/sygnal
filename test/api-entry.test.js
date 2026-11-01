// sygnal/api (dev preview): the subpath re-exports the main bundle's src/extra/api/ from the
// external 'sygnal' (as sygnal/ai does, G-581), and nothing of it loads with the core's own code.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as sygnal from '../dist/index.esm.js'
import * as api from '../dist/api.esm.js'

const dist = path.resolve(__dirname, '../dist')

describe('sygnal/api entry', () => {
  it('re-exports from the external sygnal (no code of its own)', () => {
    for (const f of ['api.esm.js', 'api.cjs.js']) {
      const src = fs.readFileSync(path.join(dist, f), 'utf8')
      expect(src).toMatch(/['"]sygnal['"]/)
      expect(src.replace(/\/\/# sourceMappingURL.*/, '').length).toBeLessThan(300 + 150 * Object.keys(api).length)
    }
    expect(Object.keys(api).sort()).toEqual(['__serverFunction', 'contractFetch', 'contractHash', 'contractSkew', 'errorFixture', 'fixture', 'honoClient', 'isContractSkew', 'mutation', 'openApiClient', 'orpcClient', 'query', 'serverFunctions', 'stream'])
    // query / mutation / stream are serverQuery / ... in the main bundle (no generic names there)
    const main = { query: 'serverQuery', mutation: 'serverMutation', stream: 'serverStream' }
    for (const name of Object.keys(api)) expect(api[name]).toBe(sygnal[main[name] || name])
  })
})
