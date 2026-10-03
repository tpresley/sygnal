/**
 * PLAN-3 5-3 (G-175): SYG624, a request with latest: true and a computed key (info).
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { check } from '../src/index.js'

let dir
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null })

function checkSource(source) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-latest-'))
  const file = path.join(dir, 'App.jsx')
  fs.writeFileSync(file, source)
  return check([file], { cwd: dir })
}
const search = (request) => `
function Search({ state }) { return <input className="q" value={state.q} /> }
Search.initialState = { q: '', results: [] }
Search.intent = ({ DOM }) => ({ TYPE: DOM.input('.q').value() })
Search.model = {
  TYPE: {
    STATE: (state, q) => ({ ...state, q }),
    HTTP: ${request},
  },
  RESULTS: (state, results) => ({ ...state, results }),
}
`
const codes = (diags) => diags.filter(d => d.code === 'SYG624')

describe('SYG624: latest: true with a computed key', () => {
  it('reports a template-literal or expression key (info)', () => {
    for (const key of ['`search-${q}`', "'search-' + q", 'q']) {
      const found = codes(checkSource(search(`(state, q) => ({ url: '/api/search', query: { q }, ok: 'RESULTS', key: ${key}, latest: true })`)))
      expect(found).toHaveLength(1)
      expect(found[0].severity).toBe('info')
      expect(found[0].data).toEqual({ action: 'TYPE', sink: 'HTTP' })
      expect(found[0].fix).toContain("key: 'search'")
    }
  })

  it('a literal key, no key, or no latest: nothing', () => {
    for (const req of [
      "({ url: '/api/search', ok: 'RESULTS', key: 'search', latest: true })",
      "({ url: '/api/search', ok: 'RESULTS', latest: true })",
      "(state, q) => ({ url: '/api/search', ok: 'RESULTS', key: `search-${q}` })",
      "(state, q) => ({ url: '/api/search', ok: 'RESULTS', key: `search-${q}`, latest: false })",
    ]) expect(codes(checkSource(search(req)))).toEqual([])
  })
})
