/*
 * 'sygnal/three' (research: dev-plans/research/canvas-three): three.js scenes as Sygnal views.
 *
 *   import { Scene } from 'sygnal/three'
 *   <Scene className="viewport" width={640} height={400}>
 *     <ambientLight intensity={0.5} />
 *     <Collection of={Cube} from="cubes" />        // each cube a component: its own intent and model
 *   </Scene>
 *   Cube: <mesh className="cube" position={[x, 0, 0]}><boxGeometry /><meshStandardMaterial color="orange" /></mesh>
 *   intent: PICK: DOM.click('.cube')              // a raycast hit, dispatched on the cube's element
 *
 * - `Scene` is a defineWidget island (`children: true`): the scene's elements are rendered by the
 *   app's DOM driver into the widget's accessible children container; the three target
 *   (three/target.ts) maps them to THREE objects; pointer input on the canvas is raycast and
 *   dispatched as DOM events on the elements (three/events.ts).
 * - `<Model src>` / `<Texture src>` (three/assets.ts): loaded assets as tags, with Suspense; a
 *   cache per URL, freed with its last user; a failed load is the view's error (onError).
 * - `capture` / `draggable` on scene elements (three/events.ts): pointer capture for dragging,
 *   and the HTML drag events processDrag reads.
 * - `createThreeHost()`: a whole app as a scene on 'sygnal/host' (no DOM: Node tests, a game).
 * - `three` is an optional peer dependency (D209), external in the builds, as 'sygnal' and
 *   'sygnal/host' are (one core per app).
 */
export {Scene, sceneOf} from './three/scene'
export {createThreeTarget, extend, applyProp} from './three/target'
export {createThreeHost} from './three/host'
export {pointerRouter, fire} from './three/events'
export {Model, Texture, preload, clear} from './three/assets'
export type {ThreeTarget, ThreeStats} from './three/target'
export type {Hit, Pick, PointerRouter, RouterOptions, Ray} from './three/events'
