// 'sygnal/three': three.js scenes as Sygnal views. Needs three (an optional peer dependency).
// Guide: https://sygnal.js.org/renderers/three
import type { Object3D, Scene as ThreeScene, Camera } from 'three'
import type { Widget, VNode } from 'sygnal'
import type { HostDocument, HostElement } from 'sygnal/host'

/**
 * Per-frame values: `animate={{ rotation: (t, dt, object) => [0, t, 0] }}` on a scene element. The
 * target calls each function every frame (seconds since the page started, and since the last
 * frame) and writes the result to the object, outside state, views and the DOM patch.
 */
export type Animate = Record<string, (t: number, dt: number, object: any) => unknown>

/** The props `<Scene>` takes (and the host props: `className`, `style`, `role`, `aria-*`, …) */
export interface SceneProps {
  /** canvas size in CSS pixels (default: the host's size, else 300 × 150) */
  width?: number;
  height?: number;
  /** the scene's background color */
  background?: string | number;
  /** `'demand'` (default): draw after a change, and every frame while anything has `animate`; `'always'`; `'never'` (tests call `sceneOf(el).tick(ms)`) */
  frameloop?: 'demand' | 'always' | 'never';
  /** no WebGLRenderer: the scene graph and raycasting only (the default when there is no WebGL: jsdom, a host document) */
  headless?: boolean;
  /** a camera controls class (`OrbitControls` from 'three/addons/controls/OrbitControls.js'); each gesture's end dispatches `camerachange` */
  Orbit?: new (camera: Camera, domElement: HTMLElement) => any;
  /** the camera, controlled: written when the app changes it, never for its own `camerachange` echoes */
  camera?: SceneCamera;
}

/** A camera's place: `camerachange`'s detail, and the `camera` prop */
export interface SceneCamera { position: [number, number, number]; target?: [number, number, number] }

/**
 * The scene, a widget with children (an island): its children (`<mesh>`, `<group>`,
 * `<boxGeometry>`, `<meshStandardMaterial>`, `<perspectiveCamera>`, lights: any three.js class,
 * lowercased) become THREE objects. Pointer input on its canvas is raycast: the topmost hit's
 * element gets `pointerover` / `pointerenter` / `pointermove` / `pointerdown` / `pointerup` /
 * `click` / `pointerout` / `pointerleave` / `dblclick` / `contextmenu`, bubbling up the scene's
 * elements, with the intersection on the event (`ThreeEventFields`). A child's own props:
 * `args` (constructor arguments; a change makes a new object), `attach` (`'map'`; geometries and
 * materials attach themselves), `animate`, `hit={false}` (raycasts pass through), `dispose={null}`
 * (not disposed when removed), `makeDefault` (a camera). Everything else is written to the object:
 * arrays → `.set(...)`, a number → `.setScalar`, a color string → `Color.set`, a method name →
 * called (`lookAt={[0, 0, 0]}`).
 */
export const Scene: Widget<SceneProps, SceneInstance, 'camerachange'>

/** What a raycast puts on the DOM event it dispatches (a keyboard click has none of them) */
export interface ThreeEventFields {
  /** the hit point, in world coordinates */
  point: [number, number, number];
  distance: number;
  uv?: [number, number];
  normal?: [number, number, number];
  faceIndex?: number;
  /** the pointer in normalized device coordinates */
  ndc: [number, number];
  /** the THREE object hit (keep it out of state) */
  object: Object3D;
}

/** The Scene widget's instance (`sceneOf(el)`: tests, devtools) */
export interface SceneInstance {
  readonly target: ThreeTarget;
  readonly canvas: HTMLCanvasElement;
  readonly headless: boolean;
  readonly stats: { renders: number };
  /** raw pointer input at canvas pixels: 'move', 'down', 'up', 'leave', or another type ('dblclick') */
  pointer(kind: string, x: number, y: number, init?: Record<string, any>): Hit | null;
  /** a real click on a scene element, through the raycaster: down + up where its object is drawn */
  click(element: Element, init?: Record<string, any>): Hit | null;
  /** where an element's object is drawn, in canvas pixels */
  pixelOf(element: Element): [number, number] | null;
  /** run one frame at `ms` (the `animate` functions, the draw) */
  tick(ms: number): void;
  /** schedule a draw */
  invalidate(): void;
}

/** The Scene instance on a host element */
export function sceneOf(el: Element | null): SceneInstance | undefined

export interface ThreeStats { syncs: number; created: number; applied: number; disposed: number; frames: number; animatedWrites: number; picks: number }

/** The three target: a patched element tree (vnodes with `.elm`) as THREE objects */
export interface ThreeTarget {
  readonly scene: ThreeScene;
  readonly stats: ThreeStats;
  /** the elements with an `animate` prop */
  readonly animated: ReadonlySet<unknown>;
  /** the default camera (the first camera element, or `makeDefault`), else a fallback */
  camera(): Camera;
  /** after a patch: the vnode whose children are the scene's elements */
  sync(container: VNode | null): void;
  setSize(width: number, height: number): void;
  /** one frame: the `animate` functions */
  frame(t: number, dt: number): void;
  /** the topmost element under (x, y), normalized device coordinates (-1..1, y up) */
  pick(x: number, y: number): Hit | null;
  /** where an element's object is, in normalized device coordinates */
  project(el: unknown): [number, number] | null;
  /** the THREE object made for an element */
  objectOf(el: unknown): any;
  /** the number of objects */
  size(): number;
  dispose(): void;
}
export function createThreeTarget(): ThreeTarget
/** more classes as tags: `extend({ OrbitControls })` makes `<orbitControls>` */
export function extend(classes: Record<string, new (...args: any[]) => any>): void
/** writes one prop to a THREE object, as the target does */
export function applyProp(object: any, key: string, value: unknown): void

/** A whole app as a three.js scene on 'sygnal/host' (no DOM): `run(App, { DOM: host.driver })` */
export interface ThreeHost {
  readonly doc: HostDocument;
  readonly driver: (vnode$: any, name?: string) => any;
  readonly target: ThreeTarget;
  readonly router: PointerRouter;
  pointer(kind: string, x: number, y: number, init?: Record<string, any>): Hit | null;
  /** down + up where the element's object is drawn */
  click(el: HostElement): Hit | null;
  pixelOf(el: HostElement): [number, number] | null;
}
export function createThreeHost(options?: { width?: number; height?: number; doc?: HostDocument }): ThreeHost

/** A picked element and the fields its events carry */
export type Hit = { el: any; [field: string]: any }
export type Pick = (x: number, y: number) => Hit | null
export interface PointerRouter {
  /** pointer input at (x, y): 'move', 'down', 'up', 'leave', or another event type */
  input(type: string, x: number, y: number, init?: Record<string, any>): Hit | null;
  hovered(): any;
}
/** the DOM's pointer sequence (over/enter, move, down, up, click on the common ancestor, out/leave) on the topmost picked element; `root` stops enter/leave */
export function pointerRouter(pick: Pick, root: unknown): PointerRouter
/** dispatches `type` on an element (a DOM or host element) with `extra` fields on the event */
export function fire(el: any, type: string, init?: Record<string, any>, extra?: Record<string, any>, bubbles?: boolean): boolean
