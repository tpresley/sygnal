/**
 * A three.js scene inside an ordinary Sygnal app, with sygnal/three. Each cube is a Collection
 * item with its own intent and model: a click on a cube in the canvas is a raycast, dispatched as
 * `click` on the cube's <mesh> element, and `DOM.click('.cube')` takes it, as for a button.
 */
import { Collection, xs } from 'sygnal'
import { Scene } from 'sygnal/three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const HOME = { position: [0, 1.5, 6], target: [0, 0, 0] }
const COLORS = ['#4f8cff', '#ffb547', '#3ccf91', '#ef5b5b', '#b07cff']

export function Cube({ state, context }) {
  // per-frame motion is a function of time the scene evaluates each frame: no action, no render
  const spin = context.spin ? (t) => [t * 0.3, t * (state.selected ? 2 : 0.8) + state.id, 0] : undefined
  return (
    <mesh className="cube" role="button" tabIndex={0} aria-pressed={String(state.selected)} aria-label={`Cube ${state.id}`}
      position={[state.x, 0, 0]} scale={state.selected ? 1.3 : 1} rotation={[0.4, 0.6 + state.id, 0]} animate={spin && { rotation: spin }}>
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
})

Cube.model = {
  // a raycast click carries the point it hit; a keyboard click (Enter on the focused cube) doesn't
  SELECT: (state, event) => ({ ...state, selected: !state.selected, hitAt: event.point ? event.point.map((n) => +n.toFixed(2)) : null }),
  OVER: (state) => ({ ...state, hover: true }),
  OUT: (state) => ({ ...state, hover: false }),
  REMOVE: () => undefined,
}

export default function Cubes({ state }) {
  const selected = state.cubes.filter((cube) => cube.selected)
  const last = selected.find((cube) => cube.hitAt)
  return (
    <main className="cubes-app">
      <aside className="panel">
        <h1>Cubes</h1>
        <p className="status">{selected.length} of {state.cubes.length} selected</p>
        <p className="hit">{last ? `hit at ${last.hitAt.join(', ')}` : 'click a cube (double-click removes it)'}</p>
        <button type="button" className="add">Add cube</button>
        <button type="button" className="spin">{state.spin ? 'Stop spinning' : 'Spin'}</button>
        <button type="button" className="reset-view">Reset view</button>
        <p className="camera">camera {state.camera.position.map((n) => n.toFixed(1)).join(', ')}</p>
        <ul className="list">
          {state.cubes.map((cube) => <li key={cube.id} className={cube.selected ? 'on' : ''} style={{ color: cube.color }}>cube {cube.id}{cube.hover ? ' (hover)' : ''}</li>)}
        </ul>
      </aside>
      <Scene className="viewport" width={640} height={400} background="#10141c" Orbit={OrbitControls} camera={state.camera}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={2} />
        <perspectiveCamera makeDefault fov={50} />
        <group className="cubes">
          <Collection of={Cube} from="cubes" />
        </group>
      </Scene>
    </main>
  )
}

Cubes.initialState = {
  cubes: [0, 1, 2].map((i) => ({ id: i, x: (i - 1) * 1.8, color: COLORS[i], selected: false, hover: false, hitAt: null })),
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
    const cubes = [...state.cubes, { id, x: 0, color: COLORS[id % COLORS.length], selected: false, hover: false, hitAt: null }]
    return { ...state, cubes: cubes.map((cube, i) => ({ ...cube, x: (i - (cubes.length - 1) / 2) * 1.8 })) }
  },
  SPIN: (state) => ({ ...state, spin: !state.spin }),
  CAMERA: (state, camera) => ({ ...state, camera }),
  RESET_VIEW: (state) => ({ ...state, camera: HOME }),
}
