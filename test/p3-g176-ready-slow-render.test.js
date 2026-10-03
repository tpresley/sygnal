// @vitest-environment jsdom
// PLAN-3 G-176: renderComponent's ready() fell back to "ready" 30ms after the start for a
// component that never renders on its own (1H-4). On a loaded machine a component WITH a state
// could take longer than that to render first, so ready() resolved before the first render and
// t.query() returned null (the p3-g152 / g047 / diagnostics flakes). Now the early fallback
// only applies when there is no state to render; otherwise ready() waits for the first render.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => { t?.dispose(); t = null })

// A slow first render, like a starved event loop: the views busy-wait. Which split of the time
// between the root and the child view lost the race used to depend on the machine, so a small
// grid is tried (before the fix, several cells failed on every run).
const busy = (ms) => { const end = Date.now() + ms; while (Date.now() < end); }
let rootMs = 0, childMs = 0
function Child() { busy(childMs); return h('span', { className: 'child' }, 'c') }
function Board({ state }) { busy(rootMs); return h('div', null, h('button', { className: 'card' }, String(state.n)), h(Child)) }
Board.initialState = { n: 1 }
Board.model = {}

describe('G-176: ready() waits for a slow first render', () => {
  for (const dom of ['mock', 'real']) {
    it(`${dom} DOM: query() finds the first render right after ready()`, async () => {
      const missed = []
      for (const r of [35, 40, 45]) for (const c of [10, 15, 20]) {
        rootMs = r; childMs = c
        t = renderComponent(Board, dom === 'real' ? { dom: 'real' } : {})
        await t.ready()
        if (!t.query('.card') || !t.query('.child')) missed.push(`root ${r}ms, child ${c}ms`)
        t.dispose(); t = null
      }
      rootMs = childMs = 0
      expect(missed).toEqual([])
    }, 20000)
  }

  it('a component with no state still becomes ready without rendering (1H-4)', async () => {
    function Idle() { return h('p', null, 'idle') }
    Idle.model = { GO: (s) => s }
    t = renderComponent(Idle)
    const start = Date.now()
    await t.ready()
    expect(Date.now() - start).toBeLessThan(1000)
  })
})
