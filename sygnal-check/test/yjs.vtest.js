/**
 * sygnal/yjs in sygnal-check (research: dev-plans/research/crdt-state, Q4 and Q6):
 *
 *   shared()     a first-party behavior from 'sygnal/yjs' only; its actions are known (no SYG101
 *                for 'board.REMOTE' entries in the host); `ownsState: false`: its key in the
 *                host's initialState is not SYG127. A hand-written factory returning
 *                `{ ownsState: false, merge }` is accepted the same way
 *   SYG260       undo({ key }) in uses / undoable(model, { key }) on a shared() key
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

const A11Y = ['SYG701', 'SYG702', 'SYG703', 'SYG704', 'SYG705', 'SYG706', 'SYG707', 'SYG708']
function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-yjs-'))
  for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp, ignore: A11Y, ...opts })
}
const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()

const BOARD = (uses, extra = '', model = '') => `import { ABORT, undo, undoable } from 'sygnal'
import { shared } from 'sygnal/yjs'

export function Board({ state }) {
  return <div><h2>{state.board.title}</h2><button className="add">Add</button><button className="undo">Undo</button></div>
}
Board.uses = ${uses}
Board.initialState = { board: { title: 'Todo', items: [] }, peers: [], history: { canUndo: false, canRedo: false } }
Board.intent = ({ DOM }) => ({ ADD: DOM.click('.add'), UNDO: DOM.click('.undo') })
Board.model = ${model || `{
  ADD: (state) => ({ ...state, board: { ...state.board, items: [...state.board.items, { id: 'x' }] } }),
  UNDO: { SHARED: { undo: 'board' } },
  'board.REMOTE': (state) => state,
}`}
${extra}
`

describe('sygnal/yjs shared()', () => {
  it("keeps the host's initialState (ownsState: false): no SYG127; its actions are known", () => {
    const d = check({ 'Board.jsx': BOARD("{ board: shared({ presence: 'peers', history: 'history' }) }") })
    expect(codes(d)).toEqual([])
  })
  it('--strict is clean too', () => {
    const d = check({ 'Board.jsx': BOARD("{ board: shared({ presence: 'peers', history: 'history' }) }") }, { strict: true })
    expect(codes(d)).toEqual([])
  })
  it('an option it does not read is SYG127 (a typo)', () => {
    const d = check({ 'Board.jsx': BOARD("{ board: shared({ presense: 'peers' }) }") })
    expect(codes(d)).toEqual(['SYG127 error'])
    expect(d[0].message).toContain("did you mean 'presence'?")
  })
  it("a `shared` from another module is not sygnal/yjs's (the collision is reported)", () => {
    const src = BOARD("{ board: shared() }").replace("import { shared } from 'sygnal/yjs'", "import { shared } from 'sygnal/ui'")
    expect(codes(check({ 'Board.jsx': src }))).toContain('SYG127 error')
  })
  it('a hand-written factory returning { ownsState: false, merge } is accepted the same way', () => {
    const src = BOARD('{ board: mirror() }').replace("import { shared } from 'sygnal/yjs'", "const mirror = (options = {}) => ({ options, ownsState: false, merge(c, k) {} })")
    expect(codes(check({ 'Board.jsx': src }))).toEqual([])
    const owns = BOARD('{ board: mirror() }').replace("import { shared } from 'sygnal/yjs'", 'const mirror = (options = {}) => ({ options, merge(c, k) {} })')
    expect(codes(check({ 'Board.jsx': owns }))).toEqual(['SYG127 error'])
  })
})

describe('SYG260', () => {
  it("undo({ key }) on a shared() key, with the driver's command as the fix", () => {
    const d = check({ 'Board.jsx': BOARD("{ board: shared(), history: undo({ key: 'board' }) }").replace('history: { canUndo: false, canRedo: false } }', '}') })
    const e = d.filter(x => x.code === 'SYG260')
    expect(e).toHaveLength(1)
    expect(e[0].severity).toBe('warn')
    expect(e[0].message).toContain("undo() (uses key 'history') records 'board', which shared() syncs")
    expect(e[0].fix).toContain("UNDO: { SHARED: { undo: 'board' } }")
    expect(e[0].data).toEqual({ key: 'board', uses: 'history' })
  })
  it("undo({ key: [...] }) naming it, and undoable(model, { key })", () => {
    const d1 = check({ 'Board.jsx': BOARD("{ board: shared(), h: undo({ key: ['board', 'other'] }) }") })
    expect(d1.filter(x => x.code === 'SYG260').map(x => x.data.key)).toEqual(['board'])
    const d2 = check({ 'Board.jsx': BOARD("{ board: shared() }", '', "undoable({ ADD: (state) => state }, { key: 'board' })") })
    expect(d2.filter(x => x.code === 'SYG260').map(x => x.message)).toEqual([expect.stringContaining("undoable() records 'board'")])
  })
  it('undo() on a key that is not shared is fine', () => {
    const d = check({ 'Board.jsx': BOARD("{ board: shared(), h: undo({ key: 'draft' }) }") })
    expect(d.filter(x => x.code === 'SYG260')).toEqual([])
  })
})
