/**
 * The platformer as one Sygnal component on sygnal/canvas.
 *
 * - The whole simulation is state (`sim.ts`'s World): a `frame` timer sends FRAME every animation
 *   frame while the game runs, and its reducer advances the world by fixed steps.
 * - Held keys are state too: KEY_DOWN / KEY_UP set and clear buttons; the step reads them.
 * - The canvas has four data layers: scenery, tiles and coins keep their node objects (a cached
 *   bitmap the camera pans over), the actors are a new array each frame, all `active`.
 * - The HUD and the title / pause / game-over screens are HTML over the canvas.
 */
import {ABORT, type Component} from 'sygnal'
import {Canvas} from 'sygnal/canvas'
import {advance, menu, press, release, releaseAll, timeLeft, RUNNING, type Button, type World} from './sim'
import {KEYS} from './keys'
import {tilesOf, coinsOf, sceneryOf, actorsOf, idsOf, cameraOf, VIEW} from './nodes'

export type State = World & {camera: {x: number, y: number, zoom: number}}

// (numbers as text: a number child next to text crashes sygnal/replay's view hashing: canvas-game README, B1)
const pad = (n: number, w: number) => String(n).padStart(w, '0')

function Screen({mode, score, name}: {mode: World['mode'], score: number, name: string}) {
  if (mode == 'title') return (
    <div className="screen">
      <h1>Sprout Run</h1>
      <p className="level">{name}</p>
      <p>←/→ run · Space jump (hold for higher) · Shift sprint · P pause</p>
      <p className="blink">Press Enter to start</p>
    </div>
  )
  if (mode == 'paused') return <div className="screen dim"><h2>Paused</h2><p>Press P to resume</p></div>
  if (mode == 'over') return <div className="screen"><h2>Game over</h2><p>{`Score ${score}`}</p><p className="blink">Press Enter to try again</p></div>
  if (mode == 'won') return <div className="screen"><h2>Course clear!</h2><p>{`Score ${score}`}</p><p className="blink">Press Enter to play again</p></div>
  return null
}

export const Game: Component<State> = function Game({state}) {
  const actors = actorsOf(state)
  return (
    <div className="stage">
      <Canvas className="game" camera={state.camera} width={VIEW.width} height={VIEW.height} navigate={false} capture="explicit" background="#8fd3ff">
        <shapes className="scenery" items={sceneryOf(state.level)} a11y={0} />
        <shapes className="tiles" items={tilesOf(state.rows)} a11y={0} />
        <shapes className="coins" items={coinsOf(state.coins)} a11y={0} />
        <shapes className="actors" items={actors} active={idsOf(actors)} a11y={0} />
      </Canvas>
      <div className="hud" aria-live="off">
        <span>SCORE {pad(state.score, 6)}</span>
        <span>● ×{pad(state.coinCount, 2)}</span>
        <span>{`♥ ×${state.lives}`}</span>
        <span>TIME {pad(timeLeft(state), 3)}</span>
      </div>
      <Screen mode={state.mode} score={state.score} name={state.level.name} />
    </div>
  )
}

// the camera object changes only when the camera moves (the canvas writes a camera prop it didn't make)
Game.calculated = {camera: [['camX'], (s: State) => cameraOf(s.camX)]}

// a frame action every animation frame, only while the simulation runs
Game.timers = (state: State) => ({frame: RUNNING.includes(state.mode) && {frame: 'FRAME'}})
// a hidden page pauses the game (and drops held keys: their keyup goes elsewhere)
Game.browser = () => ({page: {visibility: true, action: 'VISIBILITY'}})

Game.intent = ({DOM}) => {
  const doc = DOM.select('document')
  return {
    // only the game's keys are prevented (no page scroll on Space / arrows); repeats are not presses
    KEY_DOWN: doc.events('keydown', {preventDefault: (e: KeyboardEvent) => e.code in KEYS})
      .filter((e: KeyboardEvent) => e.code in KEYS && !e.repeat)
      .map((e: KeyboardEvent) => KEYS[e.code]),
    KEY_UP: doc.events('keyup')
      .filter((e: KeyboardEvent) => e.code in KEYS)
      .map((e: KeyboardEvent) => KEYS[e.code]),
  }
}

Game.model = {
  FRAME: (state: State, {dt}: {dt: number}, next: any, {random}: any) => advance(state, dt, random) as State,
  KEY_DOWN: (state: State, b: Button | 'start' | 'pause') => {
    // Space / Enter on a menu screen start the game
    if (b == 'start' || (b == 'jump' && !RUNNING.includes(state.mode) && state.mode != 'paused')) {
      const w = menu(state, 'start')
      return w === state ? ABORT : (w as State)
    }
    const w = b == 'pause' ? menu(state, 'pause') : press(state, b)
    return w === state ? ABORT : (w as State)
  },
  KEY_UP: (state: State, b: Button | 'start' | 'pause') => {
    if (b == 'start' || b == 'pause') return ABORT
    const w = release(state, b)
    return w === state ? ABORT : (w as State)
  },
  VISIBILITY: (state: State, {visible}: {visible: boolean}) => {
    if (visible) return ABORT
    const w = releaseAll(state.mode == 'playing' ? menu(state, 'pause') : state)
    return w === state ? ABORT : (w as State)
  },
}
