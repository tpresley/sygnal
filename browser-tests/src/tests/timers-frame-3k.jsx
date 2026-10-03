// PLAN-4 3-K (G-215): `frame` timers (GS-7) in a real browser. makeTimerDriver() under run()
// drives a { frame: 'FRAME' } timer with requestAnimationFrame: the action arrives once per
// animation frame with { t, dt } (dt: ms since the previous frame from rAF's timestamps, 0 on the
// first), and stops (no more frames requested) when the declaration goes falsy.
import { run, controls, makeTimerDriver } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Timers: frame (PLAN-4 3-K, G-215)'

const { Stop } = controls({ Stop: 'button' })
const seen = []   // every FRAME action's data, in order

function Animator({ state }) {
  return <div><p className="frames">{state.frames.length}</p><Stop>Stop</Stop></div>
}
Animator.initialState = { animating: true, frames: [] }
Animator.timers = (state) => ({ anim: state.animating && { frame: 'FRAME' } })
Animator.intent = ({ DOM }) => ({ STOP: DOM.click(Stop) })
Animator.model = {
  FRAME: { STATE: (s, f) => ({ ...s, frames: [...s.frames, f] }), EFFECT: (s, f) => { seen.push(f) } },
  STOP: (s) => ({ ...s, animating: false }),
}

export async function timerFrameTests3K() {
  await runTest(CAT, 'a frame timer runs on requestAnimationFrame with { t, dt }, and stops', async () => {
    const raf = window.requestAnimationFrame
    let rafCalls = 0
    window.requestAnimationFrame = (cb) => { rafCalls++; return raf.call(window, cb) }
    const { id, el } = mount()
    const before = Date.now()
    const app = run(Animator, { TIMER: makeTimerDriver() }, { mountPoint: id })
    try {
      await waitFor(() => Number(el.querySelector('.frames')?.textContent) >= 6, 2500)
      const frames = () => Number(el.querySelector('.frames').textContent)
      assert(rafCalls >= 6, `requestAnimationFrame drives it (${rafCalls} calls)`)
      assert(seen.length >= 6, `the FRAME actions arrived (${seen.length})`)
      assert(seen[0].dt === 0, `the first frame's dt is 0 (${seen[0].dt})`)
      assert(seen.slice(1).every(f => f.dt > 0 && f.dt < 1000), `later frames have 0 < dt < 1 s: ${seen.map(f => Math.round(f.dt)).join(',')}`)
      assert(seen.every(f => f.t >= before && f.t <= Date.now()), 't is the clock time (Date.now())')
      el.querySelector('[data-control="Stop"]').click()
      await wait(50)
      const stopped = frames()
      const calls = rafCalls
      await wait(200)
      assert(frames() === stopped, `no frames after the declaration goes falsy (${stopped} → ${frames()})`)
      assert(rafCalls <= calls + 1, `no more animation frames are requested (${calls} → ${rafCalls})`)
    } finally {
      app.dispose()
      window.requestAnimationFrame = raf
    }
  })
}
