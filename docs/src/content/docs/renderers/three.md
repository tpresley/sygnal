---
title: three.js
description: Build three.js scenes as Sygnal views with sygnal/three. Meshes, lights and cameras as JSX, raycast clicks and hovers as DOM events for intents, per-frame animation outside state, a controlled camera, keyboard access, and tests without WebGL
---

`sygnal/three` renders a three.js scene from JSX. A `<Scene>` sits in an ordinary component tree, and its children (`<mesh>`, `<group>`, `<boxGeometry>`, `<meshStandardMaterial>`, lights, cameras) become THREE objects. The children are elements of your app, so a cube can be a component with its own intent and model, kept in a `<Collection>`. A click on the canvas is a raycast, and the cube it hits gets a DOM `click`, so `DOM.click('.cube')` works as it does for a button.

```sh
npm install three
```

`three` is an optional peer dependency of `sygnal`: install it in the app (0.170 or later).

```jsx
// Cubes.jsx
import { Collection } from 'sygnal'
import { Scene } from 'sygnal/three'

function Cube({ state }) {
  return (
    <mesh className="cube" position={[state.x, 0, 0]} scale={state.on ? 1.3 : 1}
      role="button" tabIndex={0} aria-pressed={String(state.on)} aria-label={`Cube ${state.id}`}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={state.on ? '#f59e0b' : '#3b82f6'} />
    </mesh>
  )
}

Cube.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.cube') })

Cube.model = {
  // the point the raycast hit is on the event (a keyboard click has none)
  TOGGLE: (state, event) => ({ ...state, on: !state.on, hitAt: event.point || null }),
}

export function Cubes({ state }) {
  return (
    <section>
      <Scene className="viewport" width={640} height={400} background="#10141c">
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={2} />
        <perspectiveCamera makeDefault position={[0, 1.5, 6]} lookAt={[0, 0, 0]} />
        <Collection of={Cube} from="cubes" />
      </Scene>
      <p>{state.cubes.filter((cube) => cube.on).length} selected</p>
    </section>
  )
}

Cubes.initialState = {
  cubes: [{ id: 1, x: -1.8, on: false, hitAt: null }, { id: 2, x: 0, on: false, hitAt: null }, { id: 3, x: 1.8, on: false, hitAt: null }],
}
```

![The three-cubes example: a cube selected by a raycast click, one hovered](https://raw.githubusercontent.com/tpresley/sygnal/main/examples/three-cubes/screenshot.png)

The [three-cubes example](https://github.com/tpresley/sygnal/tree/main/examples/three-cubes) adds hover, removal, spinning, an orbit camera and tests.

## Tags and props

Every three.js class is a tag, lowercased: `<mesh>`, `<group>`, `<points>`, `<boxGeometry>`, `<meshStandardMaterial>`, `<perspectiveCamera>`, `<directionalLight>`. Classes from three's add-ons or your own code become tags with `extend`:

<!-- docs-check: skip -->
```js
import { extend } from 'sygnal/three'
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js'

extend({ TextGeometry })   // <textGeometry args={[...]} />
```

| Prop | What it does |
|---|---|
| `position={[x, y, z]}`, `rotation`, `scale`, `color`, … | Written to the object. A value with `.set` (a vector, an Euler angle, a color) is set from an array, a number (`scale={2}`) or a string (`color="orange"`); anything else is assigned (`intensity={2}`, `visible={false}`). A prop that goes away returns to the class's default |
| `lookAt={[0, 0, 0]}` | A prop named after a method calls it with the array as its arguments |
| `args={[1, 1, 1]}` | The constructor's arguments. New `args` make a new object; its children move over |
| `attach="map"` | Where a child goes on its parent. Geometries attach as `geometry` and materials as `material` by themselves; on removal the parent gets its previous value back |
| `animate={{ rotation: (t, dt, object) => [0, t, 0] }}` | Per-frame values ([below](#the-frame-loop)) |
| `hit={false}` | Raycasts pass through the object, as CSS `pointer-events: none` |
| `dispose={null}` | Don't dispose the object when its element goes |
| `makeDefault` | This camera renders the scene (else the first camera, else a default one) |
| `className`, `role`, `tabIndex`, `aria-*` | The element's: for intents and for accessibility |

**Disposal.** An object the scene made from a tag is disposed when its element leaves the view (its geometry, its material: their GPU memory is freed). An object you pass as a prop (`geometry={shared}`) is yours and is never disposed.

**Unknown tags pass through.** A tag that isn't a three.js class (a component's wrapper `<div>`, a `<Collection>`) adds nothing to the scene: its children attach to the nearest object above it.

**SVG names.** `<line>` and `<text>` are SVG tags to the JSX pragma. `Scene` declares `line` as its own (a widget's `tags`), so `<line>` works in a scene, and the objects get their props as written.

## Events

The scene raycasts pointer input on its canvas and dispatches the DOM's events on the element of the topmost object hit:

| Event | When |
|---|---|
| `pointerover`, `pointerenter` | The pointer moves onto an object (`enter` doesn't bubble) |
| `pointermove` | It moves over an object |
| `pointerdown`, `pointerup` | A button goes down or up over an object |
| `click` | Down and up on the same object (or on two in one group: the click goes to the group, as the DOM does) |
| `pointerout`, `pointerleave` | The pointer leaves an object, or the canvas |
| `dblclick`, `contextmenu` | On an object |

The events bubble up the scene's elements, so `DOM.click('.world')` on a `<group className="world">` hears a click on any mesh in it. Each one carries the intersection as plain data: `point` (world coordinates), `distance`, `uv`, `normal`, `faceIndex`, `ndc` (the pointer in normalized device coordinates), and `object` (the THREE object hit, for reading; keep it out of state). A click on empty space hits nothing; the canvas still gets the browser's own event.

Only the topmost hit is a target, as in the DOM. (react-three-fiber instead calls handlers on every object along the ray until one stops it.)

## Keyboard and screen readers

The scene's elements are in the accessibility tree: a mesh with a `role`, a name (`aria-label`) and `tabIndex={0}` is a control a screen reader announces and Tab reaches, though it is drawn in WebGL. Enter or Space on a focused mesh clicks it (with no `point`), and the scene draws a focus ring where the object is. Merge `focusin` into a hover intent so keyboard users get the highlight too:

<!-- docs-check: skip -->
```jsx
OVER: xs.merge(DOM.select('.cube').events('pointerover'), DOM.select('.cube').events('focusin')),
```

## The frame loop

`frameloop="demand"` (the default) draws a frame after the scene changes, and every frame while some element has an `animate` prop. `'always'` draws every frame; `'never'` draws only when a test calls `tick`.

A value that changes every frame doesn't belong in state: each change would be an action, a render and a patch. Give it as a function of time instead:

<!-- docs-check: skip -->
```jsx
const spin = context.spin ? (t) => [0, t * (state.selected ? 2 : 0.8), 0] : undefined
<mesh className="cube" rotation={[0, 0, 0]} animate={spin && { rotation: spin }}>…</mesh>
```

The scene calls `animate`'s functions each frame (`t` and `dt` in seconds, and the object) and writes the result to the object. State decides how the cube moves (whether it spins, how fast); the scene works out where it is. Measured with 20 spinning cubes in Chromium over 2 seconds: 240 frames drawn, no action, render or patch. When `animate` goes away, the static prop (`rotation` here) applies again. For state that does change every frame, such as a game's step, use a [`frame` timer](/guide/timers/).

## The camera

<!-- docs-check: skip -->
```jsx
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

<Scene className="viewport" width={640} height={400} Orbit={OrbitControls} camera={state.camera}>…</Scene>
// CAMERA: DOM.select('.viewport').events('camerachange').detail()     RESET_VIEW: (state) => ({ ...state, camera: HOME })
```

`Orbit` takes a camera-controls class (OrbitControls, MapControls, TrackballControls). At the end of each drag, the scene dispatches `camerachange` with `{ position, target }`. The `camera` prop is a [controlled value](/guide/widgets/#controlled-values-experimental): the scene writes it only when the app changes it (Reset view), never when it comes back from the scene's own `camerachange`, so the camera doesn't jump while the user drags.

## Scene props

| Prop | |
|---|---|
| `width`, `height` | The canvas size in CSS pixels (default: the host's size, else 300 × 150) |
| `background` | The scene's background color |
| `frameloop` | `'demand'`, `'always'` or `'never'` |
| `Orbit`, `camera` | Camera controls and the controlled camera |
| `headless` | No WebGL renderer: the scene graph and the raycaster only. The default where there is no WebGL (jsdom, a host document) |
| `className`, `style`, `role`, `aria-*` | On the host element |

## Testing

jsdom has no WebGL, so there the scene runs headless. three.js computes raycasts without a GPU, so tests can click through the real input path: `sceneOf(el).click(meshEl)` sends a pointer down and up where the object is drawn.

```js
// Cubes.test.js
// @vitest-environment jsdom
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { sceneOf } from 'sygnal/three'
import { Cubes } from './Cubes.jsx'

test('a click in the canvas selects the cube under it', async () => {
  const t = renderComponent(Cubes, { dom: 'real' })
  await t.ready()
  const scene = sceneOf(t.container.querySelector('.viewport'))
  const cube = t.container.querySelectorAll('mesh.cube')[2]
  scene.click(cube)
  await t.waitForState((state) => state.cubes[2].on)
  expect(t.state.cubes[2].hitAt).toHaveLength(3)
  expect(scene.target.objectOf(cube).scale.x).toBeCloseTo(1.3)
  t.dispose()
})
```

| `sceneOf(el)` | |
|---|---|
| `click(element)` | Pointer down and up where the element's object is drawn, through the raycaster |
| `pointer(kind, x, y)` | Raw input at canvas pixels: `'move'`, `'down'`, `'up'`, `'leave'`, or another event type |
| `pixelOf(element)` | Where the object is drawn |
| `tick(ms)` | One frame at `ms`: the `animate` functions, then the draw |
| `target` | The three target: `objectOf(element)`, `scene`, `camera()`, `pick(x, y)`, `stats` |

Without `dom: 'real'`, `renderComponent`'s mock DOM tests the components inside the scene without a scene at all: `t.simulateEvent('.cube', 'click', { point: [0, 0.5, 0.5] })`.

## A whole app as a scene

`createThreeHost()` renders an app into a three.js scene on [`sygnal/host`](/renderers/custom-targets/), with no DOM: for a game, a worker, or a test in plain Node. The app's root is the scene.

<!-- docs-check: skip -->
```js
import { run } from 'sygnal'
import { createThreeHost } from 'sygnal/three'

const host = createThreeHost({ width: 640, height: 400 })
const app = run(Game, { DOM: host.driver })
host.click(host.doc.querySelector('.cube'))   // a raycast; DOM.click('.cube') hears it
```

The [agent UI](/renderers/agent-ui/) reads the same tree: a scene whose meshes have roles and names is a list of buttons an agent can click by reference.

## Size and limits

`sygnal/three` is about 5 KB gzip on top of three.js, and adds nothing to an app that doesn't import it. It is a dev preview in 7.2: the API may change. Not yet supported: pointer capture for dragging objects, instanced meshes with an event per instance, and loaders as tags (load models in an EFFECT and pass them as props).
