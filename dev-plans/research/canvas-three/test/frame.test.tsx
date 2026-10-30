// @vitest-environment jsdom
// The frame loop: what 60 fps costs through state, and through the `animate` channel.
import {describe, it, expect} from 'vitest'
import {run, Collection} from 'sygnal'
import {Scene} from '../lib/Scene'
import {islandOf} from '../lib/island'
import {makeFrameDriver, fakeFrames} from '../lib/frame'

const N = 100, FRAMES = 120
const cubes = Array.from({length: N}, (_, i) => ({id: i, x: (i % 10) - 4.5, y: Math.floor(i / 10) - 4.5}))

// A: the angle is state; every cube reads it from context
function CubeA({state, context}: any) {
  return <mesh className="cube" position={[state.x, state.y, 0]} rotation={[0, context.t + state.id, 0]}><boxGeometry args={[0.5, 0.5, 0.5]} /><meshBasicMaterial /></mesh>
}
// B: the angle is a function of time, evaluated by the target per frame
function CubeB({state}: any) {
  return <mesh className="cube" position={[state.x, state.y, 0]} animate={{rotation: (t: number) => [0, t + state.id, 0]}}><boxGeometry args={[0.5, 0.5, 0.5]} /><meshBasicMaterial /></mesh>
}
// A2: per-frame state confined to one small component (a HUD), the cubes static
function Hud({state}: any) { return <p className="hud">{state.frames} frames</p> }
Hud.isolatedState = true
Hud.initialState = {frames: 0}
Hud.intent = ({FRAME}: any) => ({TICK: FRAME.frames()})
Hud.model = {TICK: (s: any) => ({frames: s.frames + 1})}

function app(Cube: any, {tick = false, hud = false} = {}) {
  function App({state}: any) {
    return (
      <main>
        {hud ? <Hud /> : null}
        <Scene className="viewport" width={400} height={300} frameloop="never">
          <perspectiveCamera makeDefault position={[0, 0, 12]} />
          <Collection of={Cube} from="cubes" />
        </Scene>
      </main>
    )
  }
  App.initialState = {t: 0, cubes}
  App.context = {t: (s: any) => s.t}
  if (tick) {
    App.intent = ({FRAME}: any) => ({TICK: FRAME.frames()})
    App.model = {TICK: (s: any, f: any) => ({...s, t: f.t})}
  }
  return App
}

async function measure(App: any, frames: (ms: number, island: any) => void) {
  document.body.innerHTML = '<div id="root"></div>'
  const clock = fakeFrames()
  const c = {renders: 0, patches: 0}
  const a: any = run(App, {FRAME: makeFrameDriver(clock)}, {mountPoint: '#root', __hooks: {onRender: () => c.renders++, onPatch: () => c.patches++}} as any)
  await new Promise(r => setTimeout(r, 0))
  const island = islandOf(document.querySelector('.viewport'))
  const tgt = island.target, before = {...c, ...tgt.stats}
  const t0 = performance.now()
  for (let i = 0; i < FRAMES; i++) {
    clock.step(1)
    // the app's flush is a microtask, the patch another: let them run, as a browser does between frames
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    frames(clock.now(), island)
  }
  await new Promise(r => setTimeout(r, 0))
  const ms = (performance.now() - t0) / FRAMES
  const per = (k: string) => +(((({...c, ...tgt.stats}) as any)[k] - (before as any)[k]) / FRAMES).toFixed(2)
  const out = {renders: per('renders'), patches: per('patches'), syncs: per('syncs'), applied: per('applied'), animatedWrites: per('animatedWrites'), msPerFrame: +ms.toFixed(3)}
  a.dispose()
  return out
}

describe(`60 fps with ${N} cubes, ${FRAMES} frames (per-frame averages)`, () => {
  it('compares the paths', async () => {
    // the island draws a frame itself (frameloop 'never' here: the test is the clock)
    const draw = (ms: number, island: any) => island.tick(ms)
    const A = await measure(app(CubeA, {tick: true}), draw)
    const A2 = await measure(app(CubeA, {hud: true}), draw)
    const B = await measure(app(CubeB), draw)
    const rows = {'A: angle in state (every cube reads it)': A, 'A2: per-frame state in one HUD component': A2, 'B: animate prop (no state)': B}
    if (process.env.FRAME_OUT) require('node:fs').writeFileSync(process.env.FRAME_OUT, JSON.stringify(rows, null, 2))
    // A: one flush and one patch per frame, and every cube renders (+ the root) and the island syncs
    expect(A.patches).toBe(1)
    expect(A.renders).toBeGreaterThanOrEqual(N)
    expect(A.syncs).toBe(1)
    expect(A.applied).toBeGreaterThanOrEqual(N)
    // A2: still a flush and a patch per frame, but dirty-checking keeps it to the HUD: no cube renders, the island isn't patched
    expect(A2.patches).toBe(1)
    // (onRender: the HUD's view, and the root re-injecting the HUD's new vnode; the root's view doesn't run)
    expect(A2.renders).toBe(2)
    expect(A2.syncs).toBe(0)
    // B: nothing in the app runs per frame; the target writes N rotations
    expect(B.renders).toBe(0)
    expect(B.patches).toBe(0)
    expect(B.syncs).toBe(0)
    expect(B.animatedWrites).toBe(N)
  })
})
