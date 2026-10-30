// A whole app as a scene on sygnal/host: Node, no jsdom, no WebGL.
import {describe, it, expect} from 'vitest'
import {run, Collection} from 'sygnal'
import {snapshotTree, formatSnapshot} from 'sygnal/agent-ui'
import {createThreeHost} from '../lib/threeHost'
import {Cube} from '../app/Cubes'

function Game({state}: any) {
  return (
    <group className="world" role="group" aria-label="world">
      <ambientLight intensity={0.5} />
      <perspectiveCamera makeDefault position={[0, 1.5, 6]} lookAt={[0, 0, 0]} />
      <p className="score">score {state.score}</p>
      <Collection of={Cube} from="cubes" />
    </group>
  )
}
Game.initialState = {score: 0, cubes: [0, 1].map(i => ({id: i, x: i * 2 - 1, color: '#4f8cff', selected: false, hover: false, hitAt: null}))}
Game.context = {spin: () => false}
// a click on any cube bubbles to the world group: the parent hears it too (DOM bubbling)
Game.intent = ({DOM}: any) => ({HIT: DOM.click('.world')})
Game.model = {HIT: (state: any) => ({...state, score: state.score + 1})}

const flush = () => new Promise(r => setTimeout(r, 0))

describe('three.js on sygnal/host', () => {
  it('raycast clicks drive intents; the agent snapshot lists the scene', async () => {
    const host = createThreeHost({width: 640, height: 400})
    const app: any = run(Game, {DOM: host.driver})
    await flush()
    const cubes = host.doc.querySelectorAll('mesh.cube')
    expect(cubes).toHaveLength(2)
    // the <p> isn't a THREE tag: transparent to the target, still in the host tree (a HUD for a painter of your own)
    expect(host.target.size()).toBe(2 + 2 * 3 + 1)
    const hit = host.click(cubes[1])
    expect(hit!.el).toBe(cubes[1])
    await flush()
    expect(app.__runtime.getState().score).toBe(1)
    expect(app.__runtime.getState().cubes[1].selected).toBe(true)
    expect(host.target.objectOf(cubes[1]).scale.x).toBeCloseTo(1.3)
    // the agent UI's snapshot of the same tree: the cubes are interactive (intents listen to them)
    const snap = formatSnapshot(snapshotTree(host.doc))
    if (process.env.SNAP_OUT) require("node:fs").writeFileSync(process.env.SNAP_OUT, snap)
    expect(snap).toContain('score 1')
    expect(snap).toContain('cube 1 (selected)')
    app.dispose()
  })
})
