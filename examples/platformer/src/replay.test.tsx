// @vitest-environment jsdom
/**
 * Record and replay (sygnal/replay) at 60 actions a second: a few seconds of play are recorded
 * (every FRAME is an input, with its dt), then replayed into a fresh component, which must reach
 * the same world with no divergence.
 */
import {it, expect, afterEach, vi} from 'vitest'
import {renderComponent} from 'sygnal'
import {startRecording, replay} from 'sygnal/replay'
import {Game} from './Game'
import {newWorld} from './sim'
import {meadow} from './level'

afterEach(() => vi.useRealTimers())

const key = async (type: 'keydown' | 'keyup', code: string) => {
  document.dispatchEvent(new KeyboardEvent(type, {code, bubbles: true, cancelable: true}))
  await vi.advanceTimersByTimeAsync(0)
}

it('a recorded run replays to the same world', async () => {
  vi.useFakeTimers()
  const rec = startRecording()
  const t: any = renderComponent(Game, {dom: 'real', initialState: newWorld(meadow())})
  await t.ready()
  await key('keydown', 'Enter'); await key('keyup', 'Enter')
  await key('keydown', 'ArrowRight')
  for (let i = 0; i < 6; i++) {
    await key('keydown', 'Space')
    await vi.advanceTimersByTimeAsync(i % 2 ? 150 : 400)
    await key('keyup', 'Space')
    await vi.advanceTimersByTimeAsync(300)
  }
  await key('keyup', 'ArrowRight')
  const log = rec.stop()
  const recorded = t.state
  t.dispose()

  const inputs = log.a.filter((a: any) => 'd' in a || /[irnaBgS]/.test(a.c))
  const frames = log.a.filter((a: any) => a.y == 'FRAME').length
  expect(frames).toBeGreaterThan(150)
  const bytes = JSON.stringify(log).length
  // (what a recording of a game costs: reported, not asserted tightly)
  process.env.REPLAY_REPORT && process.stderr.write(`recording: ${log.a.length} actions, ${inputs.length} inputs (${frames} FRAME), ${log.k.length} checkpoints, ${bytes} bytes, ${Math.round(bytes / frames)} B per frame\n`)

  process.env.REPLAY_REPORT && process.stderr.write(`bytes: actions ${JSON.stringify(log.a).length}, checkpoints ${JSON.stringify(log.k).length}, init ${JSON.stringify(log.init).length}\n`)
  // (replay() on the real clock: under fake timers it never finishes)
  vi.useRealTimers()
  const t0 = performance.now()
  const r: any = await replay(Game, log, {warn: false})
  process.env.REPLAY_REPORT && process.stderr.write(`replay: ${Math.round(performance.now() - t0)} ms, divergence ${JSON.stringify(r.divergence)?.slice(0, 300)}\n`)
  try {
    expect(r.divergence).toBeNull()
    expect(r.unhandled).toEqual([])
    expect(r.final.player).toEqual(recorded.player)
    expect(r.final.score).toBe(recorded.score)
  } finally {
    r.t.dispose()
  }
}, 20000)
