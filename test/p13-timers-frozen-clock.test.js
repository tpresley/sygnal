// PLAN-13 follow-up (Temper): an `every` timer under a frozen Date.now() (Playwright's
// clock.setFixedTime: Date is fixed, timers keep running). The drift-free schedule computed each
// delay from Date.now(), so tick n waited n intervals (1, 3, 6, 10 s). A delay never exceeds
// `every` now; on a running clock the schedule is unchanged.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function Clock({ state }) { return h('p', null, String(state.ticks.length)) }
Clock.initialState = { ticks: [] }
Clock.timers = () => ({ tick: { every: 1000, action: 'TICK' } })
Clock.model = { TICK: (s, { n }) => ({ ...s, ticks: [...s.ticks, n] }) }

describe('every under a frozen Date.now()', () => {
  it('ticks once per interval', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const t = renderComponent(Clock)
    await t.ready()
    for (let s = 1; s <= 4; s++) {
      await vi.advanceTimersByTimeAsync(1000)
      expect(t.state.ticks, `after ${s} s`).toEqual([1, 2, 3, 4].slice(0, s))
    }
    t.dispose()
  })

  it('a running clock keeps the drift-free schedule (late ticks coalesce)', async () => {
    vi.useFakeTimers()
    const t = renderComponent(Clock)
    await t.ready()
    await vi.advanceTimersByTimeAsync(3000)
    expect(t.state.ticks).toEqual([1, 2, 3])
    t.dispose()
  })
})
