/**
 * A three.js scene inside an ordinary Sygnal app, with sygnal/three. Each cube is a Collection
 * item with its own intent and model: a click on a cube in the canvas is a raycast, dispatched as
 * `click` on the cube's <mesh> element, and `DOM.click('.cube')` takes it, as for a button.
 * A cube drags along the floor (`capture="xz"`: the pointer stays the cube's until it goes up),
 * and the trees are a loaded GLTF model (`<Model>`), with a Suspense fallback in the scene.
 */
import { Collection, Suspense, xs } from 'sygnal'
import { Scene, Model } from 'sygnal/three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const HOME = { position: [0, 3, 6.5], target: [0, 0, 0] }
const TREES = [[-3.2, -1.6], [3.4, -1.2], [-2.6, 1.8]]
const COLORS = ['#4f8cff', '#ffb547', '#3ccf91', '#ef5b5b', '#b07cff']

export function Cube({ state, context }) {
  // per-frame motion is a function of time the scene evaluates each frame: no action, no render
  const spin = context.spin ? (t) => [t * 0.3, t * (state.selected ? 2 : 0.8) + state.id, 0] : undefined
  return (
    <mesh className="cube" role="button" tabIndex={0} aria-pressed={String(state.selected)} aria-label={`Cube ${state.id}`}
      capture="xz" position={[state.x, 0, state.z]} scale={state.selected ? 1.3 : 1} rotation={[0.4, 0.6 + state.id, 0]} animate={spin && { rotation: spin }}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={state.hover ? '#ffffff' : state.color} emissive={state.selected ? state.color : '#000000'} emissiveIntensity={0.35} />
    </mesh>
  )
}

Cube.intent = ({ DOM }) => ({
  SELECT: DOM.click('.cube'),
  // the pointer over it, or the keyboard focus on it
  OVER: xs.merge(DOM.select('.cube').events('pointerover'), DOM.select('.cube').events('focusin')),
  OUT: xs.merge(DOM.select('.cube').events('pointerout'), DOM.select('.cube').events('focusout')),
  REMOVE: DOM.select('.cube').events('dblclick'),
  // a drag: the pointer is captured from the press to the release; each move is on the floor's plane
  GRAB: DOM.select('.cube').events('gotpointercapture'),
  DRAG: DOM.select('.cube').events('pointermove').filter((e) => e.captured),
  DROP: DOM.select('.cube').events('lostpointercapture'),
})

Cube.model = {
  // a raycast click carries the point it hit; a keyboard click (Enter on the focused cube) doesn't
  SELECT: (state, event) => ({ ...state, selected: !state.selected, hitAt: event.point ? event.point.map((n) => +n.toFixed(2)) : null }),
  OVER: (state) => ({ ...state, hover: true }),
  OUT: (state) => ({ ...state, hover: false }),
  REMOVE: () => undefined,
  GRAB: (state) => ({ ...state, from: [state.x, state.z] }),
  // `delta`: how far the pointer has moved on the plane since the press (a drag clicks nothing)
  DRAG: (state, event) => ({ ...state, x: round(state.from[0] + event.delta[0]), z: round(state.from[1] + event.delta[2]) }),
  DROP: (state) => ({ ...state, from: null }),
}

const round = (n) => Math.round(n * 100) / 100

export default function Cubes({ state }) {
  const selected = state.cubes.filter((cube) => cube.selected)
  const last = selected.find((cube) => cube.hitAt)
  return (
    <main className="cubes-app">
      <aside className="panel">
        <h1>Cubes</h1>
        <p className="status">{selected.length} of {state.cubes.length} selected</p>
        <p className="hit">{last ? `hit at ${last.hitAt.join(', ')}` : 'click a cube, drag it (double-click removes it)'}</p>
        <button type="button" className="add">Add cube</button>
        <button type="button" className="spin">{state.spin ? 'Stop spinning' : 'Spin'}</button>
        <button type="button" className="reset-view">Reset view</button>
        <p className="camera">camera {state.camera.position.map((n) => n.toFixed(1)).join(', ')}</p>
        <ul className="list">
          {state.cubes.map((cube) => <li key={cube.id} className={cube.selected ? 'on' : ''} style={{ color: cube.color }}>cube {cube.id} at {cube.x}, {cube.z}{cube.hover ? ' (hover)' : ''}</li>)}
        </ul>
      </aside>
      <Scene className="viewport" width={640} height={400} background="#10141c" Orbit={OrbitControls} camera={state.camera}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={2} />
        <perspectiveCamera makeDefault fov={50} />
        <mesh className="floor" rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} hit={false}>
          <planeGeometry args={[12, 8]} />
          <meshStandardMaterial color="#1b2330" />
        </mesh>
        {/* until the model has loaded: wireframe cones where the trees go (the scene itself is there at once) */}
        <Suspense fallback={<group>{TREES.map(([x, z]) => <mesh key={`${x}`} position={[x, 0.1, z]}><coneGeometry args={[0.5, 1.2, 7]} /><meshBasicMaterial color="#3ccf91" wireframe /></mesh>)}</group>}>
          {TREES.map(([x, z], i) => <Model key={`${x}`} src="/models/tree.glb" className="tree" position={[x, -0.5, z]} rotation={[0, i, 0]} scale={1.3} />)}
        </Suspense>
        <group className="cubes">
          <Collection of={Cube} from="cubes" />
        </group>
      </Scene>
    </main>
  )
}

Cubes.initialState = {
  cubes: [0, 1, 2].map((i) => ({ id: i, x: (i - 1) * 1.8, z: 0, color: COLORS[i], selected: false, hover: false, hitAt: null })),
  spin: false,
  camera: HOME,
}

Cubes.context = { spin: (state) => state.spin }

Cubes.intent = ({ DOM }) => ({
  ADD: DOM.click('.add'),
  SPIN: DOM.click('.spin'),
  // one event per orbit gesture; the scene doesn't write it back when it returns as the camera prop
  CAMERA: DOM.select('.viewport').events('camerachange').detail(),
  RESET_VIEW: DOM.click('.reset-view'),
})

Cubes.model = {
  ADD: (state) => {
    const id = state.cubes.reduce((max, cube) => Math.max(max, cube.id), -1) + 1
    // in the front row; the cubes already placed stay where they were dragged
    const cube = { id, x: ((id % 5) - 2) * 1.2, z: 2, color: COLORS[id % COLORS.length], selected: false, hover: false, hitAt: null }
    return { ...state, cubes: [...state.cubes, cube] }
  },
  SPIN: (state) => ({ ...state, spin: !state.spin }),
  CAMERA: (state, camera) => ({ ...state, camera }),
  RESET_VIEW: (state) => ({ ...state, camera: HOME }),
}
