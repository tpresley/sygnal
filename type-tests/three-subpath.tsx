/** sygnal/three: the Scene widget's props and events, sceneOf, the target, the host mode (not three.tsx: baseUrl would resolve 'three' to it) */
import { Collection, run } from 'sygnal'
import type { Component } from 'sygnal'
import { Scene, sceneOf, createThreeTarget, createThreeHost, extend } from 'sygnal/three'
import type { SceneCamera, SceneInstance, ThreeEventFields, ThreeTarget } from 'sygnal/three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Camera, Object3D } from 'three'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

type Cube = { id: number; x: number; on: boolean }
const CubeView: Component<Cube> = ({ state }) => (
  <mesh className="cube" position={[state.x, 0, 0]} animate={{ rotation: (t: number) => [0, t, 0] }} hit={state.on}>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color="orange" />
  </mesh>
)
CubeView.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.cube') })
CubeView.model = { TOGGLE: (s, e) => ({ ...s, on: !!(e as MouseEvent & Partial<ThreeEventFields>).point }) }

type S = { cubes: Cube[]; camera: SceneCamera }
const App: Component<S> = ({ state }) => (
  <Scene className="viewport" width={640} height={400} background="#10141c" frameloop="demand" Orbit={OrbitControls} camera={state.camera}>
    <ambientLight intensity={0.5} />
    <Collection of={CubeView} from="cubes" />
  </Scene>
)
App.intent = ({ DOM }) => ({ CAMERA: DOM.select('.viewport').events('camerachange').detail() })

// @ts-expect-error frameloop is 'demand' | 'always' | 'never'
const bad = <Scene frameloop="sometimes" />

const inst = sceneOf(document.querySelector('.viewport'))
expectType<Equal<typeof inst, SceneInstance | undefined>>()
inst?.click(document.body)?.el
inst?.tick(16)

const target: ThreeTarget = createThreeTarget()
expectType<Equal<ReturnType<ThreeTarget['camera']>, Camera>>()
target.pick(0, 0)?.el
class Marker {}
extend({ Marker })

const host = createThreeHost({ width: 640, height: 400 })
const app = run(App, { DOM: host.driver })
const fields: ThreeEventFields = { point: [0, 0, 0], distance: 1, ndc: [0, 0], object: null as unknown as Object3D }

export { bad, app, fields }
