// @vitest-environment jsdom
// VirtualCollection's key list for a new array that changed in k places (a drag, a resize, a rename
// in a 10k-row layers panel): the core's index keeps its key map when every key stays in place, and
// the host then keeps its list with no pass over the keys. What changes still shows: an edited row,
// a moved key, a replaced id, a filter that reads the edited field.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { VirtualCollection } from '../src/index.js'
import { VirtualHost } from '../src/extra/virtual.ts'

const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))
const N = 2000
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, label: 'row ' + i, x: 0 }))

const Row = ({ state }) => h('div', { className: 'row' }, state.label)
function Page({ state }) {
  return h('div', null, h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: 20, filter: state.only }))
}
Page.initialState = { rows: rows(N), only: undefined }
Page.model = {
  EDIT: (s, { i, f }) => ({ ...s, rows: s.rows.map((r, j) => j === i ? { ...r, ...f } : r) }),
  SWAP: (s) => { const a = s.rows.slice(); [a[0], a[1]] = [a[1], a[0]]; return { ...s, rows: a } },
  REPLACE: (s) => ({ ...s, rows: s.rows.map((r, j) => j === 1 ? { id: 'new', label: 'new row', x: 0 } : r) }),
  ONLY: (s, f) => ({ ...s, only: f }),
}

let app, host
beforeEach(() => {
  host = null
  const r = VirtualHost.prototype.render
  vi.spyOn(VirtualHost.prototype, 'render').mockImplementation(function () { host = this; return r.call(this) })
  document.body.innerHTML = '<div id="root"></div>'
  app = run(Page, {}, { mountPoint: '#root' })
})
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; vi.restoreAllMocks() })

const shown = () => [...document.querySelectorAll('.row')].map(e => e.textContent)
const dispatch = async (type, data) => { app.__runtime.dispatch('root', type, data); await settle() }
// passes over a map of every key (the list rebuilt) during `f`
async function keyPasses(f) {
  const keys = Map.prototype.keys
  let n = 0
  const spy = vi.spyOn(Map.prototype, 'keys').mockImplementation(function () { if (this.size >= N) n++; return keys.call(this) })
  await f()
  spy.mockRestore()
  return n
}

describe('VirtualCollection: a new array with its keys in place', () => {
  it('an edited row shows its new value; the key list is kept, with no pass over the keys', async () => {
    await settle(60)
    expect(shown()[0]).toBe('row 0')
    const all = host.all
    expect(await keyPasses(() => dispatch('EDIT', { i: 0, f: { label: 'moved', x: 5 } }))).toBe(0)
    expect(shown()[0]).toBe('moved')
    expect(host.all).toBe(all)
    expect(app.__runtime.getState().rows[0].x).toBe(5)
  })

  it('a moved key, then a replaced id: the list follows', async () => {
    await settle(60)
    await dispatch('SWAP')
    expect(shown().slice(0, 3)).toEqual(['row 1', 'row 0', 'row 2'])
    await dispatch('REPLACE')
    expect(shown().slice(0, 3)).toEqual(['row 1', 'new row', 'row 2'])
    expect(host.all.slice(0, 3)).toEqual(['r1', 'new', 'r2'])
    expect(host.all.length).toBe(N)
  })

  it('a filter reads the items: an edit it sees still changes the list', async () => {
    await settle(60)
    await dispatch('ONLY', (r) => r.x === 0)
    expect(host.all.length).toBe(N)
    await dispatch('EDIT', { i: 0, f: { x: 1 } })
    expect(host.all.length).toBe(N - 1)
    expect(shown()[0]).toBe('row 1')
  })
})
