// @vitest-environment jsdom
/**
 * The game as a component: the frame timer, held keys through real keyboard events, pause, the
 * hidden-page pause, the canvas layers. Fake timers make the frame loop deterministic: every frame
 * is 16 ms of the test's clock, so a second of holding → is always the same run.
 */
import {describe, it, expect, afterEach, vi} from 'vitest'
import {renderComponent} from 'sygnal'
import {canvasOf} from 'sygnal/canvas'
import {Game} from './Game'
import {newWorld, STEP, type World} from './sim'
import {fromStrings, meadow} from './level'

let t: any
afterEach(() => { t?.dispose(); t = null; vi.useRealTimers() })

const FLOOR = '#'.repeat(40)
const start = (w: World = newWorld(meadow())) => {
  vi.useFakeTimers()
  t = renderComponent(Game, {dom: 'real', initialState: w, random: 1})
  return t
}
const key = async (type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}) => {
  document.dispatchEvent(new KeyboardEvent(type, {code, bubbles: true, cancelable: true, ...init}))
  // (not t.settle(): with the frame timer running the app is never quiet, so settle() times out;
  // advancing the fake clock by 0 runs the queued action and its render, and no frame)
  await vi.advanceTimersByTimeAsync(0)
}
const tap = async (code: string) => { await key('keydown', code); await key('keyup', code) }

describe('Sprout Run', () => {
  it('starts on the title screen with no frame loop; Enter starts it', async () => {
    start()
    await t.ready()
    expect(t.state.mode).toBe('title')
    expect(t.html()).toContain('Press Enter to start')
    expect(t.timers()).toEqual([])
    await tap('Enter')
    expect(t.state.mode).toBe('playing')
    expect(t.timers()).toMatchObject([{name: 'frame', action: 'FRAME', frame: 'FRAME'}])
  })

  it('holding → runs right, frame by frame on the test clock (deterministic)', async () => {
    start(newWorld(fromStrings(['.P' + '.'.repeat(38), FLOOR, FLOOR]), 'playing'))
    await t.ready()
    const x0 = t.state.player.x
    await key('keydown', 'ArrowRight')
    await vi.advanceTimersByTimeAsync(1000)
    await key('keyup', 'ArrowRight')
    const run = t.state.player.x - x0
    expect(run).toBeGreaterThan(150)
    expect(t.state.tick).toBeGreaterThan(55)
    expect(t.state.keys.right).toBe(false)
    // a held key's repeats are not presses: no action
    const n = t.states.length
    await key('keydown', 'ArrowLeft', {repeat: true})
    expect(t.states.length).toBe(n)
    // the same input on a fresh run: exactly the same result
    const first = t.state.player
    t.dispose(); vi.useRealTimers()
    start(newWorld(fromStrings(['.P' + '.'.repeat(38), FLOOR, FLOOR]), 'playing'))
    await t.ready()
    await key('keydown', 'ArrowRight')
    await vi.advanceTimersByTimeAsync(1000)
    await key('keyup', 'ArrowRight')
    expect(t.state.player).toEqual(first)
  })

  it('the game keys are default-prevented (no page scroll), others are not', async () => {
    start()
    await t.ready()
    const space = new KeyboardEvent('keydown', {code: 'Space', bubbles: true, cancelable: true})
    const tab = new KeyboardEvent('keydown', {code: 'Tab', bubbles: true, cancelable: true})
    document.dispatchEvent(space); document.dispatchEvent(tab)
    expect(space.defaultPrevented).toBe(true)
    expect(tab.defaultPrevented).toBe(false)
  })

  it('P pauses: the frame loop stops and the world stays where it was', async () => {
    start(newWorld(meadow(), 'playing'))
    await t.ready()
    await vi.advanceTimersByTimeAsync(200)
    await tap('KeyP')
    expect(t.state.mode).toBe('paused')
    expect(t.timers()).toEqual([])
    const tick = t.state.tick
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.state.tick).toBe(tick)
    expect(t.html()).toContain('Paused')
    await tap('KeyP')
    await vi.advanceTimersByTimeAsync(100)
    expect(t.state.tick).toBeGreaterThan(tick)
  })

  it('a hidden page pauses the game and lets go of held keys', async () => {
    start(newWorld(meadow(), 'playing'))
    await t.ready()
    await key('keydown', 'ArrowRight')
    // (simulateAction isn't synchronous: on the real DOM the harness delivers it once the tree has
    // been quiet for a moment, so move the clock a little)
    t.simulateAction('VISIBILITY', {visible: false})
    await vi.advanceTimersByTimeAsync(20)
    expect(t.state.mode).toBe('paused')
    expect(t.state.keys.right).toBe(false)
  })

  it('a FRAME action is the frame time, run in fixed steps (simulateAction, no timers)', async () => {
    t = renderComponent(Game, {initialState: newWorld(meadow(), 'paused')})
    await t.ready()
    // paused: FRAME does nothing; playing: 2.5 steps of time run 2 steps
    t.simulateAction('FRAME', {t: 0, dt: STEP * 2.5})
    await t.settle()
    expect(t.state.tick).toBe(0)
    t.simulateAction('KEY_DOWN', 'pause')
    t.simulateAction('FRAME', {t: 0, dt: STEP * 2.5})
    // (the frame timer now runs on the real clock too: read the first state with a tick)
    await t.next((s: World) => s.tick > 0)
    expect(t.state.tick).toBe(2)
  })

  it('draws on four layers: the cached ones keep their nodes, the actors are live', async () => {
    start(newWorld(meadow(), 'playing'))
    await t.ready()
    const c: any = canvasOf(t.container.querySelector('.game'))
    const [scenery, tiles, coins, actors] = c.layers
    await vi.advanceTimersByTimeAsync(100)
    const after = (canvasOf(t.container.querySelector('.game')) as any).layers
    expect(after[0].items).toBe(scenery.items)
    expect(after[1].items).toBe(tiles.items)
    expect(after[2].items).toBe(coins.items)
    expect(after[3].items).not.toBe(actors.items)
    expect(after[3].active.size).toBe(after[3].items.length)
    expect(c.camera).toEqual({x: t.state.camera.x, y: 0, zoom: 1})
  })

  it('bumping a block from below: the seeded random() makes the debris the same every run', async () => {
    const room = () => newWorld(fromStrings(['......', '...B..', '......', '......', '...P..', FLOOR.slice(0, 6), FLOOR.slice(0, 6)]), 'playing')
    const debris = async () => {
      start(room())
      await t.ready()
      await key('keydown', 'Space')
      await vi.advanceTimersByTimeAsync(300)
      const d = t.state.fx.filter((f: any) => f.kind == 'debris').map((f: any) => [f.vx, f.vy])
      t.dispose(); vi.useRealTimers()
      return d
    }
    const a = await debris(), b = await debris()
    expect(a).toHaveLength(4)
    expect(a).toEqual(b)
  })
})
