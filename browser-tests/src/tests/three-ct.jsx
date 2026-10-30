// sygnal/three (canvas-three): <Model> through GLTFLoader with Suspense, and dragging with real
// mouse input (window.__pwInput): a captured drag that leaves the canvas while OrbitControls sit it
// out, and the HTML drag events processDrag reads. WebGL where the engine has it (headless
// otherwise: the raycasts are the same). BROWSER=chromium|firefox|webkit.
import { run, Collection, Suspense, processDrag } from 'sygnal'
import { Scene, sceneOf, Model } from 'sygnal/three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mountOnScreen, clearStage, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'sygnal/three (canvas-three)'
const HOME = { position: [0, 6, 6], target: [0, 0, 0] }

function Piece({ state }) {
  return (
    <mesh className="piece" capture="xz" position={[state.x, 0.5, state.z]}>
      <boxGeometry />
      <meshStandardMaterial color={state.from ? '#ffb547' : '#4f8cff'} />
    </mesh>
  )
}
Piece.intent = ({ DOM }) => ({
  GRAB: DOM.select('.piece').events('gotpointercapture'),
  DRAG: DOM.select('.piece').events('pointermove').filter((e) => e.captured),
  DROP: DOM.select('.piece').events('lostpointercapture'),
  CLICK: DOM.click('.piece'),
})
Piece.model = {
  GRAB: (s) => ({ ...s, from: [s.x, s.z] }),
  DRAG: (s, e) => ({ ...s, x: s.from[0] + e.delta[0], z: s.from[1] + e.delta[2] }),
  DROP: (s) => ({ ...s, from: null }),
  CLICK: (s) => ({ ...s, clicks: s.clicks + 1 }),
}

function Board({ state }) {
  const p = state.pieces[0]
  return (
    <div>
      <Scene className="viewport" width={400} height={300} Orbit={OrbitControls} camera={state.camera}>
        <ambientLight intensity={0.8} />
        <perspectiveCamera makeDefault fov={50} />
        <mesh className="floor" rotation={[-Math.PI / 2, 0, 0]} hit={false}><planeGeometry args={[20, 20]} /><meshStandardMaterial /></mesh>
        <Collection of={Piece} from="pieces" />
      </Scene>
      <p className="out">{`${p.x.toFixed(2)},${p.z.toFixed(2)},${p.clicks},${p.from ? 'held' : 'free'},${state.camera.position.map((n) => n.toFixed(1)).join(' ')}`}</p>
    </div>
  )
}
Board.initialState = { camera: HOME, pieces: [{ id: 1, x: 0, z: 0, clicks: 0, from: null }] }
Board.intent = ({ DOM }) => ({ CAMERA: DOM.select('.viewport').events('camerachange').detail() })
Board.model = { CAMERA: (s, camera) => ({ ...s, camera }) }

function Bin({ state }) {
  return (
    <div>
      <Scene className="viewport" width={400} height={300}>
        <ambientLight />
        <perspectiveCamera makeDefault position={[0, 4, 6]} lookAt={[0, 0, 0]} />
        {state.boxes.map((b) => <mesh key={b} className="box" draggable data-id={b} position={[-1.5, 0, 0]}><boxGeometry /><meshBasicMaterial /></mesh>)}
        <mesh className="bin" position={[1.5, 0, 0]}><boxGeometry args={[1.2, 1, 1.2]} /><meshBasicMaterial color="#3ccf91" /></mesh>
      </Scene>
      <p className="out">{`${state.boxes.length},${state.events.join(' ')}`}</p>
    </div>
  )
}
Bin.initialState = { boxes: ['a'], events: [] }
Bin.intent = ({ DOM }) => {
  const { dragStart$, dragOver$, drop$, dragEnd$ } = processDrag({ draggable: DOM.select('.box'), dropZone: DOM.select('.bin') })
  return { START: dragStart$, OVER: dragOver$, DROP: drop$, END: dragEnd$ }
}
// (every dragover must reach processDrag: its preventDefault is what allows the drop; logged once)
const log = (name) => (s) => s.events.at(-1) == name ? s : ({ ...s, events: [...s.events, name] })
Bin.model = { START: log('start'), OVER: log('over'), DROP: (s) => ({ ...log('drop')(s), boxes: [] }), END: log('end') }

function Forest() {
  return (
    <Suspense fallback={<p className="loading">Loading…</p>}>
      <Scene className="viewport" width={400} height={300}>
        <ambientLight />
        <perspectiveCamera makeDefault position={[0, 2, 5]} lookAt={[0, 0.5, 0]} />
        <Model src="/models/tree.glb" className="tree" position={[-1, 0, 0]} />
        <Model src="/models/tree.glb" className="tree" position={[1, 0, 0]} />
      </Scene>
    </Suspense>
  )
}
Forest.intent = ({ DOM }) => ({ PICK: DOM.click('.tree') })
Forest.model = { PICK: (s, e) => ({ ...s, picked: e.point[0] }) }
Forest.initialState = { picked: null }

const input = (steps) => window.__pwInput(steps)

export async function threeTestsCT() {
  if (typeof window.__pwInput !== 'function') {
    await runTest(CAT, 'real input (window.__pwInput from run-headless.mjs)', async () => {
      assert(false, 'window.__pwInput is missing: run the suite with npm --prefix browser-tests test')
    })
    return
  }
  const setup = async (C, sel) => {
    const { id, el } = mountOnScreen()
    const app = run(C, {}, { mountPoint: id })
    await waitFor(() => el.querySelector(sel), 4000).catch(() => { throw new Error('not rendered: ' + el.innerHTML.slice(0, 300)) })
    await wait(30)
    const scene = sceneOf(el.querySelector('.viewport'))
    // an element's object on the page (client pixels)
    const at = (node) => { const r = scene.canvas.getBoundingClientRect(), p = scene.pixelOf(node); return [r.x + p[0], r.y + p[1]] }
    const out = () => el.querySelector('.out')?.textContent
    return { el, app, scene, at, out, done: () => { app.dispose(); clearStage() } }
  }

  await runTest(CAT, '<Model>: Suspense until the GLB has loaded (GLTFLoader imported on first use), a clone per tree, raycast clicks', async () => {
    const { id, el } = mountOnScreen()
    const app = run(Forest, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.loading') || el.querySelector('.viewport'), 2000)
      await waitFor(() => el.querySelectorAll('primitive.tree').length == 2, 5000)
      assert(!el.querySelector('.loading'), 'fallback gone')
      const scene = sceneOf(el.querySelector('.viewport'))
      const trees = [...el.querySelectorAll('primitive.tree')].map((t) => scene.target.objectOf(t))
      assert(trees[0] !== trees[1] && trees[0].isObject3D, 'one object per tree')
      const names = []
      trees[1].traverse((o) => names.push(o.name))
      assert(names.includes('leaves') && names.includes('trunk'), 'the GLB\'s meshes: ' + names)
      const r = scene.canvas.getBoundingClientRect(), p = scene.pixelOf(el.querySelectorAll('primitive.tree')[1])
      await input([['move', r.x + p[0], r.y + p[1]], ['down'], ['up'], ['wait', 50]])
      await waitFor(() => app.__runtime?.getState?.()?.picked > 0.3 || false, 2000).catch(() => { throw new Error('no pick: ' + JSON.stringify(app.__runtime?.getState?.())) })
    } finally { app.dispose(); clearStage() }
  }, 8000)

  await runTest(CAT, 'capture="xz": a real drag follows the pointer off the canvas; the orbit camera stays put; no click', async () => {
    const { el, at, out, scene, done } = await setup(Board, '.piece')
    try {
      const [x, y] = at(el.querySelector('.piece'))
      const r = scene.canvas.getBoundingClientRect()
      // to the right, past the canvas's edge, then back in a little and up
      await input([['move', x, y], ['down'], ['move', x + 30, y, 3], ['wait', 30]])
      await waitFor(() => out().includes('held'))
      await input([['move', r.right + 40, y + 20, 8], ['move', r.right - 60, y + 30, 4], ['wait', 30], ['up'], ['wait', 60]])
      await waitFor(() => out().includes('free'))
      const [px, pz, clicks, , cam] = out().split(',')
      assert(+px > 1.2, 'moved right along the floor: ' + out())
      assert(Math.abs(+pz) < 1.2, 'stayed near its row: ' + out())
      assert(clicks === '0', 'a drag clicks nothing: ' + out())
      assert(cam === '0.0 6.0 6.0', 'the camera did not orbit: ' + out())
      assert(Math.abs(scene.target.objectOf(el.querySelector('.piece')).position.x - +px) < 0.01, 'the object where the state says')
      // a press without a move is a click; a drag on empty floor orbits
      const [x2, y2] = at(el.querySelector('.piece'))
      await input([['move', x2, y2], ['down'], ['up'], ['wait', 60]])
      await waitFor(() => out().split(',')[2] === '1')
      await input([['move', r.x + 40, r.y + 40], ['down'], ['move', r.x + 140, r.y + 60, 6], ['up'], ['wait', 80]])
      await waitFor(() => out().split(',')[4] !== '0.0 6.0 6.0')
    } finally { done() }
  }, 8000)

  await runTest(CAT, 'draggable + processDrag: a real drag of a box onto the bin drops it there', async () => {
    const { el, at, out, done } = await setup(Bin, '.box')
    try {
      const [x, y] = at(el.querySelector('.box')), [bx, by] = at(el.querySelector('.bin'))
      await input([['move', x, y], ['down'], ['move', bx, by, 10], ['wait', 30], ['up'], ['wait', 60]])
      await waitFor(() => out().startsWith('0,'))
      assert(out() === '0,start over drop end', 'processDrag\'s streams in order: ' + out())
    } finally { done() }
  }, 6000)
}
