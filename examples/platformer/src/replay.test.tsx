// @vitest-environment jsdom
/**
 * Record and replay (sygnal/replay) at 60 actions a second: a few seconds of play are recorded
 * (every STEP is an input, with the keys the frame timer sampled), then replayed into a fresh
 * component, on the same fake clock, which must reach the same world with no divergence.
 */
import {it, expect, afterEach, vi} from 'vitest'
import {renderComponent} from 'sygnal'
import {startRecording, replay} from 'sygnal/replay'
import {Game} from './Game'
import {newWorld} from './sim'
import {meadow} from './level'

afterEach(() => vi.useRealTimers())

const key = (type: 'keydown' | 'keyup', code: string) =>
  document.dispatchEvent(new KeyboardEvent(type, {code, key: code == 'Enter' ? 'Enter' : code, bubbles: true, cancelable: true}))

it('a recorded run replays to the same world', async () => {
  vi.useFakeTimers()
  const rec = startRecording()
  const t: any = renderComponent(Game, {dom: 'real', initialState: newWorld(meadow())})
  await t.ready()
  key('keydown', 'Enter'); key('keyup', 'Enter')
  await t.settle()
  key('keydown', 'ArrowRight')
  for (let i = 0; i < 6; i++) {
    key('keydown', 'Space')
    await t.frames(i % 2 ? 10 : 25)
    key('keyup', 'Space')
    await t.frames(18)
  }
  key('keyup', 'ArrowRight')
  await t.frames(2)
  const log = rec.stop()
  const recorded = t.state
  t.dispose()

  const steps = log.a.filter((a: any) => a.y == 'STEP').length
  expect(steps).toBeGreaterThan(150)
  const bytes = JSON.stringify(log).length
  // (what a recording of a game costs: reported, not asserted tightly)
  process.env.REPLAY_REPORT && process.stderr.write(`recording: ${log.a.length} actions (${steps} STEP), ${log.k.length} checkpoints, ${bytes} bytes, ${Math.round(bytes / steps)} B per step; actions ${JSON.stringify(log.a).length} B, checkpoints ${JSON.stringify(log.k).length} B\n`)

  const r: any = await replay(Game, log, {warn: false})
  try {
    expect(r.divergence).toBeNull()
    expect(r.unhandled).toEqual([])
    expect(r.final.player).toEqual(recorded.player)
    expect(r.final.score).toBe(recorded.score)
  } finally {
    r.t.dispose()
  }
}, 20000)
