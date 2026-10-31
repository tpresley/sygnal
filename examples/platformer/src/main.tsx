import {run, makeTimerDriver, makeBrowserDriver} from 'sygnal'
import {canvasOf} from 'sygnal/canvas'
import {Game} from './Game'
import {newWorld} from './sim'
import {meadow, arena} from './level'
import {installBench} from './bench'

// ?stress=N: the one-screen arena with N enemies, already running
const q = new URLSearchParams(location.search)
const n = Number(q.get('stress') || 0)
Game.initialState = newWorld(n ? arena(n) : meadow(), n ? 'playing' : 'title') as any
const app: any = run(Game, {TIMER: makeTimerDriver(), BROWSER: makeBrowserDriver()}, {mountPoint: '#root'})
if (q.get('paint') != 'lazy') paintEveryFrame(app)
if (q.has('bench')) installBench(app)

/**
 * Workaround (dev-plans/research/canvas-game README, B2): the frame timer's FRAME action runs in a
 * requestAnimationFrame callback, and the canvas asks for its paint frame from the render that
 * follows, so the paint lands in the next frame, and the frame after that only invalidates again:
 * the canvas paints every other frame (30 fps) while the world steps at 60. This loop runs after
 * the timer's callback in each frame (the flush has run by then) and paints at once when the
 * state changed since the last paint. `?paint=lazy` leaves it out.
 */
function paintEveryFrame(app: any) {
  let painted: any = null
  const loop = () => {
    requestAnimationFrame(loop)
    const s = app.__runtime.getState(), c = canvasOf(document.querySelector('.game'))
    if (s !== painted && c) { painted = s; c.paintNow() }
  }
  requestAnimationFrame(loop)
}
