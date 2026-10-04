// @vitest-environment jsdom
// PLAN-4 4-G1 (D143, REPORT-v4 rec 3a): undo() / undoable() can group only the listed actions.
//   undo({ key, coalesce: ['HEADLINE'], coalesceMs: 1000 })
// Only the listed actions join a step within `coalesceMs` (default 500 when `coalesce` is given);
// every other action is always its own step. Without `coalesce`, `coalesceMs` keeps joining any
// repeat of the same action (backward compatible).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { undo, undoable } from '../src/index.js'
import { setupChecks } from './diagnostics/helpers.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
beforeEach(() => { setupChecks(); vi.useFakeTimers() })
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; _resetDiagnostics(); vi.useRealTimers() })

// REPORT-v4 task 27 (27-t3): a poster editor; typing in Headline is one step per burst, each
// Larger click its own step, even two quick ones
function Poster({ state }) {
  return h('div', null,
    h('label', null, 'Headline ', h('input', { className: 'headline', value: state.poster.headline })),
    h('button', { className: 'larger' }, 'Larger'),
    h('button', { className: 'undo', disabled: !state.history.canUndo }, 'Undo'),
    h('button', { className: 'redo', disabled: !state.history.canRedo }, 'Redo'),
    h('h1', { style: { fontSize: state.poster.size + 'px' } }, state.poster.headline))
}
Poster.initialState = { poster: { headline: '', size: 24 } }
Poster.intent = ({ DOM }) => ({ HEADLINE: DOM.input('.headline').value(), LARGER: DOM.click('.larger') })
Poster.model = {
  HEADLINE: (state, headline) => ({ ...state, poster: { ...state.poster, headline } }),
  LARGER: (state) => ({ ...state, poster: { ...state.poster, size: state.poster.size + 4 } }),
}
const withHistory = (opts) => Object.assign(function P(p) { return Poster(p) }, Poster, {
  uses: { history: undo({ key: 'poster', undo: '.undo', redo: '.redo', ...opts }) },
})

const type = async (text) => {
  t.simulateEvent('.headline', 'input', { value: text })
  await t.next(s => s.poster.headline === text)
  await vi.advanceTimersByTimeAsync(50)
}
const larger = async () => {
  const size = t.state.poster.size
  t.simulateEvent('.larger', 'click')
  await t.next(s => s.poster.size === size + 4)
  await vi.advanceTimersByTimeAsync(50)
}
const undoOnce = async () => {
  const n = t.state.history.past.length
  t.simulateEvent('.undo', 'click')
  await t.next(s => s.history.past.length === n - 1)
}

describe('undo({ coalesce })', () => {
  it('27-t3: two quick Larger clicks are two steps; a burst of Headline typing is one', async () => {
    t = renderComponent(withHistory({ coalesce: ['HEADLINE'], coalesceMs: 1000 }))
    await t.ready()
    for (const s of ['S', 'Sa', 'Sal', 'Sale']) await type(s)
    await larger()
    await larger()
    expect(t.state.history.past).toEqual([
      { headline: '', size: 24 },
      { headline: 'Sale', size: 24 },
      { headline: 'Sale', size: 28 },
    ])
    await undoOnce(); expect(t.state.poster).toEqual({ headline: 'Sale', size: 28 })
    await undoOnce(); expect(t.state.poster).toEqual({ headline: 'Sale', size: 24 })
    await undoOnce(); expect(t.state.poster).toEqual({ headline: '', size: 24 })
    t.expectNoDiagnostics()
  })

  it('without coalesce, coalesceMs still joins any quick repeat (the old behaviour)', async () => {
    t = renderComponent(withHistory({ coalesceMs: 1000 }))
    await t.ready()
    await larger()
    await larger()
    expect(t.state.history.past).toEqual([{ headline: '', size: 24 }])
  })

  it('a listed action joins only its own previous change: another action in between starts a new step', async () => {
    t = renderComponent(withHistory({ coalesce: ['HEADLINE'], coalesceMs: 1000 }))
    await t.ready()
    await type('A')
    await larger()
    await type('AB')
    await type('ABC')
    expect(t.state.history.past.map(p => p.headline + '/' + p.size)).toEqual(['/24', 'A/24', 'A/28'])
  })

  it('the window still applies: typing after a pause longer than coalesceMs is a new step', async () => {
    t = renderComponent(withHistory({ coalesce: ['HEADLINE'], coalesceMs: 1000 }))
    await t.ready()
    await type('A')
    await vi.advanceTimersByTimeAsync(1200)
    await type('AB')
    expect(t.state.history.past.map(p => p.headline)).toEqual(['', 'A'])
  })

  it('coalesce without coalesceMs uses a 500 ms window', async () => {
    t = renderComponent(withHistory({ coalesce: ['HEADLINE'] }))
    await t.ready()
    await type('A')
    await vi.advanceTimersByTimeAsync(300)
    await type('AB')                       // 350 ms after A: joined
    expect(t.state.history.past).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(600)
    await type('ABC')                      // 650 ms after AB: a new step
    expect(t.state.history.past).toHaveLength(2)
  })

  it('undoable() takes the same option', async () => {
    function E({ state }) { return h('div', null, state.doc.text) }
    E.initialState = { doc: { text: '', bold: false } }
    E.model = undoable({
      TYPE: (s, text) => ({ ...s, doc: { ...s.doc, text } }),
      BOLD: (s) => ({ ...s, doc: { ...s.doc, bold: !s.doc.bold } }),
    }, { key: 'doc', coalesce: ['TYPE'], coalesceMs: 500 })
    t = renderComponent(E)
    await t.ready()
    t.simulateAction('TYPE', 'a'); await t.next(s => s.doc.text === 'a')
    t.simulateAction('TYPE', 'ab'); await t.next(s => s.doc.text === 'ab')
    t.simulateAction('BOLD'); await t.next(s => s.doc.bold)
    t.simulateAction('BOLD'); await t.next(s => !s.doc.bold)
    expect(t.state.history.past).toEqual([
      { text: '', bold: false }, { text: 'ab', bold: false }, { text: 'ab', bold: true },
    ])
  })
})
