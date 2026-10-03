import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountApp, advance, click, setChecked, textOf } from './dom.js'

// The whole suite runs on fake timers (Date, performance, intervals, timeouts and
// animation frames): every interaction helper advances the clock by 50 ms, and
// advance(ms) moves it further.

beforeEach(async () => {
  vi.useFakeTimers()
  await mountApp()
})

afterEach(() => {
  vi.useRealTimers()
})

const pad = (n) => String(n).padStart(2, '0')
function format(ms) {
  const tenths = Math.floor(ms / 100)
  return `${pad(Math.floor(tenths / 600))}:${pad(Math.floor(tenths / 10) % 60)}.${tenths % 10}`
}

const q = (sel) => document.querySelector(sel)
const time = () => textOf(q('.stopwatch .time'))
const toggle = () => q('.stopwatch button.toggle')
const lapButton = () => q('.stopwatch button.lap')
const resetButton = () => q('.stopwatch button.reset')
const laps = () => [...document.querySelectorAll('.stopwatch ol.laps li')].map(textOf)
const show = () => q('input[name="show"]')

/** While running, the display may lag the running time by up to 100 ms. */
function expectRunningTime(ms) {
  expect([format(ms), format(ms - 100)]).toContain(time())
}

/** Nothing is scheduled: no interval, timeout or animation frame left behind. */
async function expectNoTimers() {
  await advance(100)
  expect(vi.getTimerCount()).toBe(0)
}

describe('28 stopwatch: start, pause, resume, laps and reset on the clock, no stray timers', () => {
  it('starts at 00:00.0 with only Start enabled, and nothing runs before Start', async () => {
    expect(time()).toBe('00:00.0')
    expect(textOf(toggle())).toBe('Start')
    expect(lapButton().disabled).toBe(true)
    expect(resetButton().disabled).toBe(true)
    expect(laps()).toEqual([])
    await advance(3000)
    expect(time()).toBe('00:00.0')
    await expectNoTimers()
  })

  it('Start runs the display at least every 100 ms, with minutes and seconds', async () => {
    await click(toggle()) // t = 0, then 50 ms pass
    expect(textOf(toggle())).toBe('Pause')
    expect(lapButton().disabled).toBe(false)
    expect(resetButton().disabled).toBe(true)
    for (let t = 150; t <= 1050; t += 100) {
      await advance(100)
      expectRunningTime(t)
    }
    await advance(60000) // t = 61050
    expectRunningTime(61050)
    await advance(600000) // t = 661050
    expectRunningTime(661050)
  })

  it('Pause shows the exact running time and stops every timer', async () => {
    await click(toggle()) // start at t = 0; t = 50
    await advance(1240) // t = 1290
    await click(toggle()) // pause at 1290
    expect(time()).toBe('00:01.2')
    expect(textOf(toggle())).toBe('Resume')
    expect(lapButton().disabled).toBe(true)
    expect(resetButton().disabled).toBe(false)
    await expectNoTimers()
    await advance(5000)
    expect(time()).toBe('00:01.2')
  })

  it('pausing and resuming never loses time', async () => {
    await click(toggle()) // start at t = 0
    await advance(1240) // t = 1290
    await click(toggle()) // pause at 1290: 1290 ms run
    await click(toggle()) // resume at 1340
    await click(toggle()) // pause at 1390: 1340 ms run
    expect(time()).toBe('00:01.3')
    await advance(2000) // t = 3440
    await click(toggle()) // resume at 3440
    await advance(910) // t = 4400
    await click(toggle()) // pause at 4400: 1340 + 960 = 2300 ms run
    expect(time()).toBe('00:02.3')
    await expectNoTimers()
  })

  it('laps record the running time of each lap, not counting pauses', async () => {
    await click(toggle()) // start at t = 0
    await advance(1150) // t = 1200
    await click(lapButton()) // lap 1 at 1200 ms run
    expect(laps()).toEqual(['Lap 1: 00:01.2'])
    await advance(500) // t = 1750
    await click(toggle()) // pause at 1750
    await click(lapButton()) // disabled: nothing
    expect(laps()).toEqual(['Lap 1: 00:01.2'])
    await advance(5000) // t = 6800
    await click(toggle()) // resume at 6800
    await advance(400) // t = 7250
    await click(lapButton()) // 1750 + 450 = 2200 ms run: lap 2 is 1000 ms
    await advance(3055) // t = 10355
    await click(lapButton()) // 2200 + 3105 = 5305 ms run: lap 3 is 3105 ms
    expect(laps()).toEqual(['Lap 1: 00:01.2', 'Lap 2: 00:01.0', 'Lap 3: 00:03.1'])
    expectRunningTime(5355)
  })

  it('Reset is only for a paused stopwatch and brings back the initial state', async () => {
    await click(toggle()) // start at t = 0
    await advance(950) // t = 1000
    await click(lapButton())
    await click(resetButton()) // disabled while running: nothing
    expect(laps()).toEqual(['Lap 1: 00:01.0'])
    await click(toggle()) // pause at 1100
    expect(time()).toBe('00:01.1')
    await click(resetButton())
    expect(time()).toBe('00:00.0')
    expect(textOf(toggle())).toBe('Start')
    expect(laps()).toEqual([])
    expect(lapButton().disabled).toBe(true)
    expect(resetButton().disabled).toBe(true)
    await expectNoTimers()
    await advance(2000)
    expect(time()).toBe('00:00.0')

    await click(toggle()) // a new run from zero
    await advance(700)
    expectRunningTime(750)
    await click(lapButton()) // lap 1 at 750 ms run
    expect(laps()).toEqual(['Lap 1: 00:00.7'])
  })

  it('removing the stopwatch stops its timer, and showing it again gives a fresh one', async () => {
    await click(toggle()) // start
    await advance(1000)
    await click(lapButton())
    await setChecked(show(), false)
    expect(q('.stopwatch')).toBeNull()
    await expectNoTimers()
    await advance(5000)
    expect(vi.getTimerCount()).toBe(0)

    await setChecked(show(), true)
    expect(time()).toBe('00:00.0')
    expect(textOf(toggle())).toBe('Start')
    expect(laps()).toEqual([])
    await expectNoTimers()
    await click(toggle())
    await advance(1000)
    expectRunningTime(1050)
  })
})
