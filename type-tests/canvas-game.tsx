// canvas-game (dev-plans/research/canvas-game): a frame timer that samples keys and steps at a
// fixed rate, the sampled input's types, <shapes live parallax>, <Canvas a11y>, t.frames() and an
// awaitable t.simulateAction()
import { renderComponent } from 'sygnal'
import type { RootComponent, TimerFrame, TimerFrameInput } from 'sygnal'
import { Canvas } from 'sygnal/canvas'

type Button = 'left' | 'right' | 'jump'
type S = { x: number, jumps: number, running: boolean }
type A = { STEP: TimerFrame<Button>; PAUSE: null }

export const Game: RootComponent<S, {}, A> = ({ state }) => (
  <Canvas className="game" width={768} height={480} navigate={false} a11y={0}>
    <shapes className="far" items={[]} parallax={0.5} />
    <shapes className="farther" items={[]} parallax={[0.25, 1]} />
    <shapes className="actors" items={[{ id: 'p', type: 'rect', x: state.x, y: 0, width: 10, height: 10 }]} live />
  </Canvas>
)
Game.initialState = { x: 0, jumps: 0, running: true }
Game.timers = (s) => ({
  loop: s.running && { frame: 'STEP', step: 1000 / 60, max: 5, keys: { left: ['ArrowLeft', 'KeyA'], right: 'ArrowRight', jump: ['Space'] } },
})
Game.model = {
  STEP: (s, { dt, held, pressed, steps, i }) => ({
    ...s,
    x: s.x + ((held?.right ? 1 : 0) - (held?.left ? 1 : 0)) * dt + (steps ?? 0) * 0 + (i ?? 0) * 0,
    jumps: s.jumps + (pressed?.includes('jump') ? 1 : 0),
  }),
  PAUSE: (s) => ({ ...s, running: false }),
}

const input: TimerFrameInput<Button> = { held: { left: false, right: true, jump: false }, pressed: ['right'], released: [] }
// @ts-expect-error not a button
const bad: TimerFrameInput<Button> = { held: { left: false, right: true, jump: false }, pressed: ['up'], released: [] }

// @ts-expect-error a step is a number of ms
Game.timers = () => ({ loop: { frame: 'STEP', step: '16' } })

export async function test() {
  const t = renderComponent(Game)
  await t.ready()
  await t.frames(10)
  await t.frames()
  const p: Promise<void> = t.simulateAction('PAUSE')
  await p
  return [input, bad]
}
