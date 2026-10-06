// @vitest-environment jsdom
// PLAN-5 3-U: undo({ key: [...] }) (D221) fix pass: every comparison is key by key (G-529), no
// value cache that grows (G-530), a missing key stays out on UNDO and `key: []` throws (G-531), and
// lists made again on each step "stay" on Escape (G-532, documented).
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { renderComponent, Collection, sortable, undo, undoable } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks } from './diagnostics/helpers.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const press = (k, o = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
const ids = (a) => a.map(x => x.id).join('')
const grip = (id) => document.querySelector(`.task[data-id="${id}"] .grip`)
const refocus = (s) => { if (document.activeElement === document.body) grip(s.sort.dragging).focus() }
const act = async (a, d) => { t.simulateAction(a, d); await t.settle() }

function Card({ state }) { return h('li', { className: 'task', 'data-id': state.id }, h('button', { type: 'button', className: 'grip' }, state.id)) }
function BoardView() {
  return h('div', null,
    h('ul', { 'data-list': 'todo' }, h(Collection, { of: Card, from: 'todo' })),
    h('ul', { 'data-list': 'done' }, h(Collection, { of: Card, from: 'done' })))
}
const board = (first = 'sort') => {
  function B(p) { return BoardView(p) }
  B.initialState = { todo: [{ id: 1 }, { id: 2 }, { id: 3 }], done: [{ id: 4 }] }
  const s = sortable({ from: ['todo', 'done'], item: '.task', handle: '.grip' }), u = undo({ key: ['todo', 'done'] })
  B.uses = first === 'sort' ? { sort: s, history: u } : { history: u, sort: s }
  B.model = { ADD: (st) => ({ ...st, done: [...st.done, { id: 5 }] }) }
  return B
}
const both = (s) => ids(s.todo) + '|' + ids(s.done)
const lift = async (id) => { grip(id).focus(); press(' '); await t.next(s => s.sort?.dragging === String(id)) }
const step = async (k) => { const b = both(t.state); refocus(t.state); press(k); await t.next(s => both(s) !== b) }
const drop = async () => { refocus(t.state); press('Enter'); await t.next(s => s.sort.dragging === null); await t.settle() }

describe('3-U G-529: array keys compare key by key', () => {
  for (const first of ['sort', 'history']) {
    it(`a move down and back up, dropped where it started: nothing pending, nothing recorded (uses: ${first} first)`, async () => {
      t = renderComponent(board(first), { dom: 'real' }); await t.ready()
      await lift(2); await step('ArrowDown'); await step('ArrowUp')
      expect(both(t.state)).toBe('123|4')
      expect(t.state.history.base).toBe(undefined)
      await drop()
      expect(t.state.history).toMatchObject({ past: [], future: [], canUndo: false, canRedo: false })
      expect(t.state.history.base).toBe(undefined)
      await act('history.UNDO')
      expect(both(t.state)).toBe('123|4')
      expect(t.state.history).toMatchObject({ canUndo: false, canRedo: false })
    })

    it(`across to the other list and back, dropped: nothing pending (uses: ${first} first)`, async () => {
      t = renderComponent(board(first), { dom: 'real' }); await t.ready()
      await lift(2); await step('ArrowRight'); await step('ArrowLeft')
      expect(both(t.state)).toBe('123|4')
      await drop()
      expect(t.state.history.base).toBe(undefined)
      expect(t.state.history).toMatchObject({ past: [], canUndo: false, canRedo: false })
    })

    it(`a real move after a move back: one step; UNDO / REDO availability follows (uses: ${first} first)`, async () => {
      t = renderComponent(board(first), { dom: 'real' }); await t.ready()
      await lift(2); await step('ArrowRight'); await step('ArrowLeft'); await drop()
      await lift(1); await step('ArrowRight'); await drop()
      expect(both(t.state)).toBe('23|14')
      expect(t.state.history).toMatchObject({ canUndo: true, canRedo: false })
      expect(t.state.history.past).toHaveLength(1)
      await act('history.UNDO')
      expect(both(t.state)).toBe('123|4')
      expect(t.state.history).toMatchObject({ canUndo: false, canRedo: true })
      await act('history.REDO')
      expect(both(t.state)).toBe('23|14')
      expect(t.state.history).toMatchObject({ canUndo: true, canRedo: false })
    })
  }

  it('undoable(): a reducer that rebuilds an array key with the same entries records nothing per key', async () => {
    const m = undoable({
      T: (s, v) => ({ ...s, title: v }),
      SAME: (s) => ({ ...s, tags: s.tags }),
      X: (s) => ({ ...s, other: (s.other || 0) + 1 }),
    }, { key: ['title', 'tags'] })
    function E({ state }) { return h('p', null, state.title) }
    E.initialState = { title: 'a', tags: ['x'] }
    E.model = m
    t = renderComponent(E); await t.ready()
    await act('T', 'b'); await act('SAME'); await act('X')
    expect(t.state.history.past).toEqual([{ title: 'a', tags: ['x'] }])
    await act('UNDO')
    expect(t.state.title).toBe('a')
    await act('REDO')
    expect(t.state.title).toBe('b')
  })
})

describe('3-U G-530: no cache of value combinations', () => {
  it('memory kept with an array key is about that of a single key (20,000 primitive changes)', () => {
    const dist = resolve(process.cwd(), 'dist/index.esm.js')
    const src = `
      const { undoable } = await import(${JSON.stringify(dist)})
      const run = (key) => {
        let m = undoable({ T: (s, v) => ({ ...s, body: v }) }, { key, limit: 10 })
        let s = { title: 't', body: '' }
        global.gc(); const h0 = process.memoryUsage().heapUsed
        for (let i = 0; i < 20000; i++) s = m.T(s, 'x'.repeat(1000) + i)
        s = null; global.gc()
        const d = process.memoryUsage().heapUsed - h0
        m = null
        return d
      }
      const one = run('body'), two = run(['title', 'body'])
      process.stdout.write(JSON.stringify({ one, two }))`
    const out = JSON.parse(execFileSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', src], { encoding: 'utf8', timeout: 60000 }))
    // the old cache kept every body (~20 MB); limit 10 keeps ~10 of them either way
    expect(out.two).toBeLessThan(out.one + 2e6)
  })
})

describe('3-U G-531: missing keys and key: []', () => {
  it('UNDO to a step where a key was missing removes it (no own undefined property)', async () => {
    const m = undoable({ A: (s) => ({ ...s, a: (s.a || 0) + 1, b: 1 }) }, { key: ['a', 'b'] })
    function E() { return h('p', null, 'x') }
    E.initialState = { a: 0 }
    E.model = m
    t = renderComponent(E); await t.ready()
    await act('A')
    expect(t.state.b).toBe(1)
    await act('UNDO')
    expect(t.state.a).toBe(0)
    expect('b' in t.state).toBe(false)
    await act('REDO')
    expect(t.state).toMatchObject({ a: 1, b: 1 })
  })

  it('UNDO with a key missing in the current state and in the step: not added', async () => {
    const m = undoable({ A: (s) => ({ ...s, a: (s.a || 0) + 1 }) }, { key: ['a', 'b'] })
    function E() { return h('p', null, 'x') }
    E.initialState = { a: 0 }
    E.model = m
    t = renderComponent(E); await t.ready()
    await act('A'); await act('UNDO')
    expect(t.state.a).toBe(0)
    expect(Object.keys(t.state)).not.toContain('b')
  })

  it('key: [] throws at definition, for undo() and undoable()', () => {
    expect(() => undo({ key: [] })).toThrow(/key: \[\]/)
    expect(() => undoable({}, { key: [] })).toThrow(/key: \[\]/)
  })
})
