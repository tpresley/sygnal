/**
 * The platformer as one Sygnal component on sygnal/canvas.
 *
 * - The whole simulation is state (`sim.ts`'s World). While the game runs, a `frame` timer sends
 *   STEP once per fixed 1/60 s step the frame time owes, with the keys it sampled that frame
 *   (`held`, and `pressed` since the last frame): the reducer is one call to `step()`.
 * - The menu keys (Enter, P) are presses, through `keymap`: they work while the loop is off.
 * - The canvas: the far scenery scrolls at half the camera (`parallax`), the tiles, coins and
 *   near scenery keep their node objects (cached canvases the camera scrolls), the actors are a
 *   new array each frame (`live`), sprites from one sheet. `a11y={0}`: a game has no shapes to
 *   list for a screen reader. The camera is state, moved by `follow()` after each step (camera.ts).
 * - The HUD and the title / pause / game-over screens are HTML over the canvas.
 */
import {ABORT, keymap, type Component, type TimerFrame} from 'sygnal'
import {Canvas} from 'sygnal/canvas'
import {step, menu, timeLeft, RUNNING, STEP, MAX_STEPS, type Button, type World} from './sim'
import {BUTTONS, MENU} from './keys'
import {tilesOf, coinsOf, farOf, sceneryOf, actorsOf, VIEW, FAR} from './nodes'
import {track} from './camera'

export type State = World

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
  if (mode == 'over') return <div className="screen"><h2>Game over</h2><p>Score {score}</p><p className="blink">Press Enter to try again</p></div>
  if (mode == 'won') return <div className="screen"><h2>Course clear!</h2><p>Score {score}</p><p className="blink">Press Enter to play again</p></div>
  return null
}

export const Game: Component<State> = function Game({state}) {
  return (
    <div className="stage">
      <Canvas className="game" camera={state.camera} width={VIEW.width} height={VIEW.height} navigate={false} capture="explicit" a11y={0} background="#8fd3ff">
        <shapes className="far" items={farOf(state.level)} parallax={FAR} />
        <shapes className="scenery" items={sceneryOf(state.level)} />
        <shapes className="tiles" items={tilesOf(state.rows)} />
        <shapes className="coins" items={coinsOf(state.coins)} />
        <shapes className="actors" items={actorsOf(state)} live />
      </Canvas>
      <div className="hud">
        <span>SCORE {pad(state.score, 6)}</span>
        <span>● ×{pad(state.coinCount, 2)}</span>
        <span>♥ ×{state.lives}</span>
        <span>TIME {pad(timeLeft(state), 3)}</span>
      </div>
      <Screen mode={state.mode} score={state.score} name={state.level.name} />
    </div>
  )
}

// while the world runs: one STEP per fixed step, with the keys sampled for the frame
Game.timers = (state: State) => ({loop: RUNNING.includes(state.mode) && {frame: 'STEP', step: STEP, max: MAX_STEPS, keys: BUTTONS}})

Game.intent = ({DOM}) => keymap(DOM, MENU)

Game.model = {
  // the world one step on, then the camera after the player (follow(): the same camera object while it stays put)
  STEP: (state: State, {held, pressed}: TimerFrame<Button>, next: any, {random}: any) => track(step(state, {held: held!, pressed: pressed!}, random)),
  START: (state: State) => {
    const w = menu(state, 'start')
    return w === state ? ABORT : (w as State)
  },
  PAUSE: (state: State) => {
    const w = menu(state, 'pause')
    return w === state ? ABORT : (w as State)
  },
}
