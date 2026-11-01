// @vitest-environment jsdom
/**
 * The game as a component: the frame loop, keys sampled by the frame timer, the menu keys, pause,
 * the canvas layers. Fake timers make the frame loop deterministic: `t.frames(n)` runs n frames
 * (16 ms apart) on the test's clock, so a second of holding → is always the same run.
 */
import {describe, it, expect, afterEach, vi} from 'vitest'
import {renderComponent} from 'sygnal'
import {canvasOf} from 'sygnal/canvas'
import {Game} from './Game'
import {newWorld, type World} from './sim'
import {fromStrings, meadow} from './level'

let t: any
afterEach(() => { t?.dispose(); t = null; vi.useRealTimers() })

const FLOOR = '#'.repeat(40)
const start = async (w: World = newWorld(meadow())) => {
  vi.useFakeTimers()
  t = renderComponent(Game, {dom: 'real', initialState: w, random: 1})
  await t.ready()
  return t
}
const KEY: Record<string, string> = {Enter: 'Enter', KeyP: 'p', Space: ' '}
/** a real key event on the document (the frame timer's sampler and keymap both listen there) */
const key = (type: 'keydown' | 'keyup', code: string) => {
  const e = new KeyboardEvent(type, {code, key: KEY[code] ?? code, bubbles: true, cancelable: true})
  document.dispatchEvent(e)
  return e
}
const tap = async (code: string) => { key('keydown', code); key('keyup', code); await t.settle() }
const room = () => newWorld(fromStrings(['.P' + '.'.repeat(38), FLOOR, FLOOR]), 'playing')

describe('Sprout Run', () => {
  it('starts on the title screen with no frame loop; Enter starts it', async () => {
    await start()
    expect(t.state.mode).toBe('title')
    expect(t.html()).toContain('Press Enter to start')
    expect(t.timers()).toEqual([])
    await tap('Enter')
    expect(t.state.mode).toBe('playing')
    expect(t.timers()).toMatchObject([{name: 'loop', action: 'STEP', frame: 'STEP'}])
  })

  it('holding → runs right, frame by frame on the test clock (deterministic)', async () => {
    const run = async () => {
      await start(room())
      const x0 = t.state.player.x
      key('keydown', 'ArrowRight')
      await t.frames(60)
      key('keyup', 'ArrowRight')
      await t.frames(1)
      const r = {moved: t.state.player.x - x0, player: t.state.player, tick: t.state.tick}
      t.dispose(); vi.useRealTimers()
      return r
    }
    const a = await run(), b = await run()
    expect(a.moved).toBeGreaterThan(150)
    expect(a.tick).toBeGreaterThan(50)
    expect(b).toEqual(a)
  })

  it('the game keys are default-prevented while it runs (no page scroll), others are not', async () => {
    await start(room())
    const space = key('keydown', 'Space'), tab = key('keydown', 'Tab')
    expect(space.defaultPrevented).toBe(true)
    expect(tab.defaultPrevented).toBe(false)
  })

  it('P pauses: the frame loop stops and the world stays where it was', async () => {
    await start(newWorld(meadow(), 'playing'))
    await t.frames(10)
    await tap('KeyP')
    expect(t.state.mode).toBe('paused')
    expect(t.timers()).toEqual([])
    const tick = t.state.tick
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.state.tick).toBe(tick)
    expect(t.html()).toContain('Paused')
    await tap('KeyP')
    await t.frames(5)
    expect(t.state.tick).toBeGreaterThan(tick)
  })

  it('the window losing focus lets go of held keys', async () => {
    await start(room())
    key('keydown', 'ArrowRight')
    await t.frames(10)
    window.dispatchEvent(new Event('blur'))
    await t.frames(30)
    expect(t.state.player.vx).toBe(0)
  })

  it('a STEP action is one fixed step (simulateAction, no timers)', async () => {
    t = renderComponent(Game, {initialState: newWorld(meadow(), 'playing')})
    await t.ready()
    await t.simulateAction('STEP', {t: 0, dt: 1000 / 60, held: {left: false, right: true, jump: false, run: false}, pressed: ['right'], released: []})
    expect(t.state.tick).toBe(1)
    expect(t.state.player.vx).toBeGreaterThan(0)
  })

  it('draws five layers: far scenery in parallax, the cached ones keep their nodes, the actors are live', async () => {
    await start(newWorld(meadow(), 'playing'))
    const c: any = canvasOf(t.container.querySelector('.game'))
    const [far, scenery, tiles, coins, actors] = c.layers
    key('keydown', 'ArrowRight')
    await t.frames(20)
    const after = (canvasOf(t.container.querySelector('.game')) as any).layers
    expect(after[0].items).toBe(far.items)
    expect(after[0].parallax).toEqual([0.5, 0.5])
    expect(after[1].items).toBe(scenery.items)
    expect(after[2].items).toBe(tiles.items)
    expect(after[3].items).toBe(coins.items)
    expect(after[4].items).not.toBe(actors.items)
    expect(after[4].live).toBe(true)
    expect(c.camera).toEqual({x: t.state.camera.x, y: 0, zoom: 1})
    // no accessibility projection: a game's shapes aren't controls
    expect(t.container.querySelectorAll('[data-node]')).toHaveLength(0)
  })

  it('bumping a block from below: the seeded random() makes the debris the same every run', async () => {
    const debris = async () => {
      await start(newWorld(fromStrings(['......', '...B..', '......', '......', '...P..', FLOOR.slice(0, 6), FLOOR.slice(0, 6)]), 'playing'))
      key('keydown', 'Space')
      await t.frames(20)
      const d = t.state.fx.filter((f: any) => f.kind == 'debris').map((f: any) => [f.vx, f.vy])
      t.dispose(); vi.useRealTimers()
      return d
    }
    const a = await debris(), b = await debris()
    expect(a).toHaveLength(4)
    expect(a).toEqual(b)
  })
})
