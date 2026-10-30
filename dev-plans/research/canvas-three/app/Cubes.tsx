/**
 * A three.js scene inside an ordinary DOM app. The cubes are Collection items with their own
 * intent and model: a click on a cube in the canvas is a raycast, dispatched as `click` on the
 * cube's <mesh> element, and `DOM.click('.cube')` takes it, isolated per item, as for a button.
 */
import {Collection} from 'sygnal'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {Scene} from '../lib/Scene'

const HOME = {position: [0, 1.5, 6], target: [0, 0, 0]}
const COLORS = ['#4f8cff', '#ffb547', '#3ccf91', '#ef5b5b', '#b07cff']

export type CubeState = {id: number, x: number, color: string, selected: boolean, hover: boolean, hitAt: number[] | null}

export function Cube({state, context}: any) {
  // per-frame values go through `animate` (lib/three.ts), never through state
  const spin = context.spin ? (t: number) => [t * 0.3, t * (state.selected ? 2 : 0.8) + state.id, 0] : undefined
  return (
    <mesh className="cube" role="button" aria-label={`cube ${state.id}${state.selected ? " (selected)" : ""}`} position={[state.x, 0, 0]} scale={state.selected ? 1.3 : 1} rotation={[0.4, 0.6 + state.id, 0]} animate={spin && {rotation: spin}}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={state.hover ? '#ffffff' : state.color} emissive={state.selected ? state.color : '#000000'} emissiveIntensity={0.35} />
    </mesh>
  )
}
Cube.intent = ({DOM}: any) => ({
  SELECT: DOM.click('.cube'),
  OVER: DOM.select('.cube').events('pointerover'),
  OUT: DOM.select('.cube').events('pointerout'),
  REMOVE: DOM.select('.cube').events('dblclick'),
})
Cube.model = {
  SELECT: (state: CubeState, e: any) => ({...state, selected: !state.selected, hitAt: e.point.map((n: number) => +n.toFixed(2))}),
  OVER: (state: CubeState) => ({...state, hover: true}),
  OUT: (state: CubeState) => ({...state, hover: false}),
  REMOVE: () => undefined,
}

export function CubesApp({state}: any) {
  const selected = state.cubes.filter((c: CubeState) => c.selected)
  const last = state.cubes.find((c: CubeState) => c.hitAt && c.selected)
  return (
    <main className="cubes-app">
      <aside className="panel">
        <h1>Cubes</h1>
        <p className="status">{selected.length} of {state.cubes.length} selected</p>
        <p className="hit">{last ? `hit at ${last.hitAt.join(', ')}` : 'click a cube'}</p>
        <button className="add">Add cube</button>
        <button className="spin">{state.spin ? 'Stop spinning' : 'Spin'}</button>
        <button className="reset-view">Reset view</button>
        <p className="camera">camera {state.camera.position.map((n: number) => n.toFixed(1)).join(', ')}</p>
        <ul className="list">
          {state.cubes.map((c: CubeState) => <li key={c.id} className={c.selected ? 'on' : ''} style={{color: c.color}}>cube {c.id}{c.hover ? ' (hover)' : ''}</li>)}
        </ul>
      </aside>
      <Scene className="viewport" width={state.width} height={state.height} background="#10141c" frameloop={state.frameloop} Orbit={OrbitControls} camera={state.camera}>
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
CubesApp.initialState = {
  cubes: [0, 1, 2].map(i => ({id: i, x: (i - 1) * 1.8, color: COLORS[i], selected: false, hover: false, hitAt: null})),
  spin: false,
  width: 640,
  height: 400,
  frameloop: 'demand',
  camera: HOME,
}
CubesApp.context = {spin: (state: any) => state.spin}
CubesApp.intent = ({DOM}: any) => ({
  ADD: DOM.click('.add'),
  SPIN: DOM.click('.spin'),
  // the user orbited (one event per gesture); the island skips this value when it comes back as a prop
  CAMERA: DOM.select('.viewport').events('camerachange').map((e: any) => e.detail),
  RESET_VIEW: DOM.click('.reset-view'),
})
CubesApp.model = {
  ADD: (state: any) => {
    const id = state.cubes.reduce((m: number, c: CubeState) => Math.max(m, c.id), -1) + 1
    const cubes = [...state.cubes, {id, x: 0, color: COLORS[id % COLORS.length], selected: false, hover: false, hitAt: null}]
    return {...state, cubes: cubes.map((c, i) => ({...c, x: (i - (cubes.length - 1) / 2) * 1.8}))}
  },
  SPIN: (state: any) => ({...state, spin: !state.spin}),
  CAMERA: (state: any, camera: any) => ({...state, camera}),
  RESET_VIEW: (state: any) => ({...state, camera: HOME}),
}
