/**
 * agent action `until` (sygnal/ai): SYG248, `until: 'name'` that isn't a key of the component's
 * `resources` (an object literal without spreads).
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles, CODES } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })
function check(src, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-until-'))
  fs.writeFileSync(path.join(tmp, 'Shop.jsx'), src)
  return checkFiles([path.join(tmp, 'Shop.jsx')], { cwd: tmp, ...opts })
}
const syg248 = (d) => d.filter(x => x.code === 'SYG248')

const shop = (until, resources = "Shop.resources = { search: (state) => state.query && { url: '/api/search', query: { q: state.query } } }") => `import { z } from 'zod'
export default function Shop({ state }) {
  return <p>{state.search?.status}</p>
}
Shop.initialState = { query: '' }
${resources}
Shop.model = { SEARCH: (state, query) => ({ ...state, query }) }
Shop.agent = {
  name: 'shop',
  read: (state) => ({ results: state.search?.data ?? [] }),
  actions: { SEARCH: { description: 'Search', input: z.string(), until: ${until} } },
}
`

describe('SYG248: until names no resource', () => {
  it('is quiet for a resource name or a function; clean under --strict', () => {
    expect(check(shop("'search'"), { strict: true }).map(d => `${d.code} ${d.message}`)).toEqual([])
    expect(syg248(check(shop("(state) => state.search?.status !== 'loading'")))).toEqual([])
  })
  it('reports a typo with the closest name and a fix', () => {
    const d = syg248(check(shop("'serch'")))
    expect(d.map(x => [x.severity, x.data])).toEqual([['warn', { action: 'SEARCH', until: 'serch', suggestion: 'search' }]])
    expect(d[0].message).toContain("Shop.agent.actions.SEARCH.until names 'serch', which is not one of Shop's resources (search)")
    expect(d[0].fixes[0].edits[0].text).toBe("'search'")
  })
  it('reports any name on a component without resources', () => {
    const d = syg248(check(shop("'search'", '')))
    expect(d[0].message).toContain('(it has none)')
  })
  it('is quiet when the resources are not an object literal the checker can read', () => {
    expect(syg248(check(shop("'other'", 'Shop.resources = { ...shared }\nconst shared = {}')))).toEqual([])
    expect(syg248(check(shop("'other'", 'Shop.resources = makeResources()\nfunction makeResources() { return {} }')))).toEqual([])
  })
  it('is registered', () => {
    expect(CODES.SYG248).toMatchObject({ severity: 'warn', title: 'Agent action until names no resource' })
  })
})
