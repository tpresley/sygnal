/**
 * SYG691 (static, sygnal/api dev preview): an orpcClient(contract) member chain naming a
 * procedure the contract router doesn't have.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, scan = Object.keys(files)) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-691-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return checkFiles(scan.map(f => path.join(tmp, f)), { cwd: tmp }).filter(d => d.code === 'SYG691')
}

const contract = `import { oc } from '@orpc/contract'
const files = { read: oc.route({ method: 'GET' }) }
export const contract = {
  quotes: { list: oc.route({ method: 'GET', path: '/quotes' }), add: oc.route({ method: 'POST', path: '/quotes' }) },
  files,
  ping: oc.output(null),
}
`
const api = `import { orpcClient } from 'sygnal/api'
import { contract } from './contract.js'
export const api = orpcClient(contract, { prefix: '/api' })
`
const component = (body) => `import { api } from './api.js'
export function Quotes({ state }) { return <ul /> }
Quotes.initialState = { quotes: { status: 'idle' } }
${body}
`

describe('SYG691 (static)', () => {
  it('reports an unknown procedure through imports, with the closest name', () => {
    const d = check({ 'contract.js': contract, 'api.js': api, 'Quotes.jsx': component(`Quotes.resources = { quotes: () => api.quotes.lst() }`) }, ['Quotes.jsx'])
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warn')
    expect(d[0].message).toMatch(/api\.quotes\.lst: the oRPC contract has no procedure or router 'lst' under 'quotes' \(did you mean 'list'\?\)/)
    expect(d[0].fix).toBe('use api.quotes.list')
  })

  it('checks the top level and nested routers held in identifiers', () => {
    const d = check({ 'contract.js': contract, 'api.js': api, 'Quotes.jsx': component(`Quotes.model = { A: { HTTP: () => api.qoutes.list() }, B: { HTTP: () => api.files.raed() } }`) }, ['Quotes.jsx'])
    expect(d.map(x => x.data.name)).toEqual(['qoutes', 'raed'])
    expect(d[0].message).toMatch(/at the top \(did you mean 'quotes'\?\)/)
  })

  it('is silent for known procedures, their own properties, other objects and open levels', () => {
    const ok = component(`Quotes.resources = { quotes: () => api.quotes.list() }
Quotes.model = { A: { HTTP: () => api.quotes.add({}, { invalidates: [api.quotes.list] }) }, P: { HTTP: () => api.ping() } }
const id = api.quotes.add.id + api.quotes.list.match.name
const other = { quotes: {} }; other.quotes.lst`)
    expect(check({ 'contract.js': contract, 'api.js': api, 'Quotes.jsx': ok }, ['Quotes.jsx'])).toEqual([])
    const spread = contract.replace('  files,', '  ...more,')
    expect(check({ 'contract.js': spread, 'api.js': api, 'Quotes.jsx': component(`Quotes.model = { A: { HTTP: () => api.nope() } }`) }, ['Quotes.jsx'])).toEqual([])
    // an orpcClient that is not sygnal/api's
    const local = `function orpcClient(c) { return c }\nexport const api = orpcClient({ a: 1 })\n`
    expect(check({ 'api.js': local, 'Quotes.jsx': component(`api.zzz`) }, ['Quotes.jsx'])).toEqual([])
  })
})
