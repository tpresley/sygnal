// @vitest-environment jsdom
// What one DOM element per scene object costs: 1,000 cubes (3,000 elements + objects) in jsdom.
import {describe, it, expect} from 'vitest'
import {run, Collection} from 'sygnal'
import {Scene} from '../lib/Scene'
import {islandOf} from '../lib/island'

const N = 1000
function Cube({state}: any) {
  return <mesh className="cube" position={[state.x, state.y, 0]} scale={state.on ? 1.3 : 1}><boxGeometry args={[0.3, 0.3, 0.3]} /><meshBasicMaterial color={state.on ? '#ffb547' : '#4f8cff'} /></mesh>
}
Cube.intent = ({DOM}: any) => ({TOGGLE: DOM.click('.cube')})
Cube.model = {TOGGLE: (s: any) => ({...s, on: !s.on})}
function App() {
  return <Scene className="viewport" width={800} height={600} frameloop="never"><perspectiveCamera makeDefault position={[0, 0, 30]} /><Collection of={Cube} from="cubes" /></Scene>
}
App.initialState = {cubes: Array.from({length: N}, (_, i) => ({id: i, x: (i % 40) - 20, y: Math.floor(i / 40) - 12, on: false}))}

const tick = () => new Promise(r => setTimeout(r, 0))

describe(`${N} cubes`, () => {
  it('mount, then one cube changes', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const c = {patches: 0, renders: 0}
    let t0 = performance.now()
    const a: any = run(App, {}, {mountPoint: '#root', __hooks: {onPatch: () => c.patches++, onRender: () => c.renders++}} as any)
    await tick()
    const mount = performance.now() - t0
    const s = islandOf(document.querySelector('.viewport')), tgt = s.target
    expect(tgt.size()).toBe(1 + N * 3)
    // time the target's sync alone
    let syncMs = 0
    const sync = tgt.sync
    tgt.sync = (v: any) => { const t = performance.now(); sync(v); syncMs += performance.now() - t }
    const before = {...tgt.stats, ...c}
    const el = document.querySelectorAll('mesh.cube')[517]
    t0 = performance.now()
    const hit = s.click(el)
    await tick()
    const update = performance.now() - t0
    expect(hit.el).toBe(el)
    expect(tgt.objectOf(el).scale.x).toBeCloseTo(1.3)
    const out = {
      mountMs: +mount.toFixed(1),
      clickToPatchedMs: +update.toFixed(2),
      syncMs: +syncMs.toFixed(2),
      patches: c.patches - before.patches,
      renders: c.renders - before.renders,
      propsApplied: tgt.stats.applied - before.applied,
      picks: tgt.stats.picks - before.picks,
    }
    if (process.env.SCALE_OUT) require('node:fs').writeFileSync(process.env.SCALE_OUT, JSON.stringify(out, null, 2))
    // one item rendered (+ the Collection and root re-injecting it), two props written (scale, color)
    expect(out.patches).toBe(1)
    expect(out.propsApplied).toBe(2)
    a.dispose()
  })
})
