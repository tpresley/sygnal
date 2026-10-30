---
title: Imperative Islands
description: A three.js scene, a canvas and a code editor inside a Sygnal app, with their parts as JSX children, raycasts and hit tests as DOM events, a frame loop outside the render, and controlled values
---

A WebGL scene, a canvas chart, a map or a code editor is an *imperative island*: a library that owns a part of the page and draws it its own way. Sygnal hosts one with [`defineWidget`](/guide/widgets/). With [`children: true`](/guide/widgets/#children-islands), the island's parts are JSX children: a cube, a bar, a marker is an element of the app's own tree, rendered by Sygnal into a container inside the widget. The widget reads those elements and draws them with the library, and it turns what happens in the library (a raycast hit, a hit test on a canvas, a click on a marker) into DOM events on them.

So a cube in a 3D scene can be a component with its own intent and model, in a `<Collection>`, and `DOM.click('.cube')` takes a click on it like a click on a button. Nothing about the island needs a second renderer, a second driver or a special API in the intent.

## A canvas scene

The shapes are `<rect>` and `<circle>` children. The widget draws them on a `<canvas>` and finds the topmost shape under a click (a hit test), then clicks that shape's element. The children sit in an `<svg>`, so they are real SVG elements: visually hidden, but focusable and announced by screen readers (try Tab, then Enter or Space).

```js live-file=./Canvas2D.js
// Canvas2D.js
import { defineWidget } from 'sygnal'

// the drawable shapes among the children, in paint order, with their props as the view wrote them
const shapesOf = (vnode) => (vnode.children || []).flatMap((v) => {
  const tag = v.sel && v.sel.split(/[.#]/)[0]
  return tag == 'rect' || tag == 'circle' ? [{ tag, el: v.elm, ...v.data.attrs }] : shapesOf(v)
})

const contains = (s, x, y) => s.tag == 'rect'
  ? x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height
  : Math.hypot(x - s.cx, y - s.cy) <= s.r

function draw({ canvas, shapes, focused }) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const s of shapes) {
    ctx.beginPath()
    if (s.tag == 'rect') ctx.rect(s.x, s.y, s.width, s.height)
    else ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2)
    ctx.fillStyle = s.fill
    ctx.fill()
    if (s.el === focused) { ctx.lineWidth = 3; ctx.strokeStyle = '#888'; ctx.stroke() }
  }
}

export const Canvas2D = defineWidget({
  name: 'Canvas2D',
  children: true,
  mount: (el, props) => {
    const canvas = document.createElement('canvas')
    canvas.width = props.width
    canvas.height = props.height
    el.append(canvas)
    const scene = { canvas, shapes: [], focused: null }
    // a click on the canvas is a click on the topmost shape under it
    canvas.addEventListener('click', (e) => {
      const hit = scene.shapes.findLast((s) => contains(s, e.offsetX, e.offsetY))
      if (hit) hit.el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    return scene
  },
  sync: (scene, children) => {
    scene.shapes = shapesOf(children)
    draw(scene)
  },
  focus: (scene, child) => {
    scene.focused = child
    draw(scene)
  },
})
```

```jsx live
// Lights.jsx
import { Collection } from 'sygnal'
import { Canvas2D } from './Canvas2D.js'

function Light({ state }) {
  return (
    <circle className="light" cx={state.x} cy={60} r={24} fill={state.on ? '#f59e0b' : '#64748b'}
      role="switch" tabindex="0" aria-checked={String(state.on)} aria-label={`Light ${state.id}`} />
  )
}

Light.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.light') })

Light.model = { TOGGLE: (state) => ({ ...state, on: !state.on }) }

export function Lights({ state }) {
  return (
    <section>
      <Canvas2D className="board" width={300} height={120}>
        <svg aria-label="Lights">
          <Collection of={Light} from="lights" />
        </svg>
      </Canvas2D>
      <p>{state.lights.filter((light) => light.on).length} of {state.lights.length} on</p>
    </section>
  )
}

Lights.initialState = {
  lights: [{ id: 1, x: 50, on: false }, { id: 2, x: 150, on: true }, { id: 3, x: 250, on: false }],
}
```

- **The children are the scene.** Each `Light` is a component with its own intent and model, kept in a `<Collection>`. `sync` gets the container's vnode after every patch that changed the children: each shape's tag, its props, and its element (`v.elm`).
- **Hit tests become clicks.** The widget dispatches a bubbling `click` on the shape's element, so `DOM.click('.light')` in that light's intent receives it, and only that light's.
- **Accessible by default.** The children container is visually hidden but in the accessibility tree. A shape with a `role`, a name and `tabindex` is a control: Tab reaches it, Enter and Space click it, and `focus` tells the widget where to draw the ring. SVG attribute names are case-sensitive, so it's `tabindex` on an SVG shape and `tabIndex` on an HTML element.
- **The vocabulary is SVG's.** The pragma gives these tags the SVG namespace and puts their props in `data.attrs`, with their values as written (numbers stay numbers).

## A three.js scene

The same pattern with WebGL: each child element becomes a THREE object, and a click on the canvas is a raycast whose topmost hit gets a DOM `click`, with the point it hit on the event.

```js
// Scene.js
import { defineWidget } from 'sygnal'
import * as THREE from 'three'

const make = {
  mesh: () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()),
  ambientLight: () => new THREE.AmbientLight(),
  directionalLight: () => new THREE.DirectionalLight(),
}

function apply(obj, props) {
  if (props.position) obj.position.set(...props.position)
  if (props.scale != null) obj.scale.setScalar(props.scale)
  if (props.color) obj.material.color.set(props.color)
  if (props.intensity != null) obj.intensity = props.intensity
}

export const Scene = defineWidget({
  name: 'Scene',
  children: true,
  mount: (el, props) => {
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(props.width, props.height)
    el.append(renderer.domElement)
    const camera = new THREE.PerspectiveCamera(50, props.width / props.height, 0.1, 100)
    camera.position.set(0, 1.5, 6)
    camera.lookAt(0, 0, 0)
    const s = { renderer, camera, scene: new THREE.Scene(), objects: new Map(), spin: [], raycaster: new THREE.Raycaster() }

    // a click is a raycast: the topmost hit's element gets a DOM click, with the point on it
    renderer.domElement.addEventListener('click', (e) => {
      s.raycaster.setFromCamera(new THREE.Vector2(e.offsetX / props.width * 2 - 1, -(e.offsetY / props.height) * 2 + 1), camera)
      const [hit] = s.raycaster.intersectObjects([...s.objects.values()])
      if (!hit) return
      const click = new MouseEvent('click', { bubbles: true })
      Object.defineProperty(click, 'point', { value: hit.point.toArray() })
      hit.object.userData.el.dispatchEvent(click)
    })

    // the frame loop: per-frame values are computed here, from the latest props (no action, no render)
    const frame = (ms) => {
      s.raf = requestAnimationFrame(frame)
      for (const [obj, speed] of s.spin) obj.rotation.y = (ms / 1000) * speed
      renderer.render(s.scene, camera)
    }
    s.raf = requestAnimationFrame(frame)
    return s
  },
  // make, update and remove objects to match the children's elements
  sync: (s, children) => {
    const seen = new Set()
    s.spin = []
    for (const v of children.children || []) {
      const tag = v.sel && v.sel.split(/[.#]/)[0]
      if (!make[tag]) continue
      let obj = s.objects.get(v.elm)
      if (!obj) {
        obj = make[tag]()
        obj.userData.el = v.elm
        s.objects.set(v.elm, obj)
        s.scene.add(obj)
      }
      apply(obj, v.data.props || {})
      if (v.data.props?.spin) s.spin.push([obj, v.data.props.spin])
      seen.add(v.elm)
    }
    for (const [el, obj] of s.objects) {
      if (seen.has(el)) continue
      s.scene.remove(obj)
      obj.geometry?.dispose()
      obj.material?.dispose()
      s.objects.delete(el)
    }
  },
  // the keyboard focus: the focused cube glows
  focus: (s, child) => {
    for (const [el, obj] of s.objects) obj.material?.emissive?.set(el === child ? '#444444' : '#000000')
  },
  unmount: (s) => {
    cancelAnimationFrame(s.raf)
    s.renderer.dispose()
  },
})
```

```jsx
// Cubes.jsx
import { Collection } from 'sygnal'
import { Scene } from './Scene.js'

function Cube({ state }) {
  return (
    <mesh className="cube" position={[state.x, 0, 0]} scale={state.on ? 1.3 : 1}
      color={state.on ? '#f59e0b' : '#3b82f6'} spin={state.on ? 2 : 0.5}
      role="button" tabIndex={0} aria-pressed={String(state.on)} aria-label={`Cube ${state.id}`} />
  )
}

Cube.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.cube') })

Cube.model = {
  // a keyboard click (Enter on the focused cube) carries no point
  TOGGLE: (state, event) => ({ ...state, on: !state.on, hitAt: event.point || null }),
}

export function Cubes({ state }) {
  return (
    <section>
      <Scene className="viewport" width={480} height={240}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={2} />
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

This sketch handles three tags, top-level children and clicks. The research prototype in the repository, [`dev-plans/research/canvas-three`](https://github.com/tpresley/sygnal/tree/main/dev-plans/research/canvas-three), is a fuller three.js target in about 230 lines: every THREE class as a tag (`<boxGeometry>` and materials as children, `args`, `attach`, disposal), nested groups, pointer over / out / move / down / up as DOM events with the intersection, `animate` props, an OrbitControls camera as a controlled value, and a headless mode that tests raycasts in jsdom with no WebGL.

Raycast events follow the DOM's rules: only the topmost hit is the event's target, and the event bubbles up the scene graph's elements, so a `DOM.click('.world')` on a group hears a click on any cube in it. An object that clicks should pass through can be left out of the raycast (`hit={false}` in the prototype), as CSS `pointer-events: none` does.

## The frame loop

A value that changes 60 times a second doesn't belong in state: every change is an action, a render and a patch. Compute such values in the widget's own frame loop from its props, as `spin` does above: the state says *how* a cube moves (its speed), and the widget works out *where* it is each frame. Measured on the research prototype with 20 spinning cubes in Chromium, over 2 seconds: 240 frames drawn, 0 actions, 0 renders, 0 patches. With the angle in state, every frame was a patch and a render of every cube.

When per-frame values really are state (a game's simulation step, a timer on screen), declare a `frame` [timer](/guide/timers/). It sends an action with `{ t, dt }` every animation frame, only while the declaration is on:

<!-- docs-check: skip -->
```jsx
Game.timers = (state) => ({ tick: state.running && { frame: 'TICK' } })
Game.model = { TICK: (state, { dt }) => step(state, dt / 1000) }
```

Sygnal re-renders only what changed, so a timer kept in a small component of its own renders that component and not the island: the island's `sync` doesn't run for a patch that didn't change its children.

## An editor with a controlled value

The editor's text is both the user's (they type) and the app's (it resets it, loads a document, clamps it). A widget [`value`](/guide/widgets/#controlled-values-experimental) (experimental) lets Sygnal decide when to write it: never for the editor's own changes coming back, always for the app's.

```js live-file=./Editor.js
// Editor.js
import { defineWidget } from 'sygnal'
import { EditorView, basicSetup } from 'codemirror'
import { Annotation } from '@codemirror/state'

// marks the app's writes, so the update listener doesn't report them back
const fromApp = Annotation.define()

export const Editor = defineWidget({
  name: 'Editor',
  events: ['change'],
  mount: (el, props, dispatch) => new EditorView({
    parent: el,
    doc: props.value,
    extensions: [
      basicSetup,
      EditorView.contentAttributes.of({ 'aria-label': props.label }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromApp))) dispatch('change', update.state.doc.toString())
      }),
    ],
  }),
  value: {
    // only the app's own changes get here: the smallest change, so the cursor stays where it was
    write: (view, text) => {
      const old = view.state.doc.toString()
      let from = 0, end = 0
      while (from < old.length && from < text.length && old[from] == text[from]) from++
      while (end < old.length - from && end < text.length - from && old[old.length - 1 - end] == text[text.length - 1 - end]) end++
      view.dispatch({ changes: { from, to: old.length - end, insert: text.slice(from, text.length - end) }, annotations: fromApp.of(true) })
    },
    read: (view) => view.state.doc.toString(),
  },
  unmount: (view) => view.destroy(),
})
```

```jsx live
// Note.jsx
import { ABORT } from 'sygnal'
import { Editor } from './Editor.js'

export function Note({ state }) {
  return (
    <section>
      <Editor className="note" label="Note" value={state.text} strict />
      <p className="count">{state.text.length} / 40 · no digits</p>
      <button type="button" className="clear">Clear</button>
    </section>
  )
}

Note.initialState = { text: 'Type here, or try a digit' }

Note.intent = ({ DOM }) => ({
  EDIT: DOM.select('.note').events('change').value(),
  CLEAR: DOM.click('.clear'),
})

Note.model = {
  // a digit is refused (strict puts the text back); a long text is cut to 40 characters
  EDIT: (state, text) => /\d/.test(text) ? ABORT : { ...state, text: text.slice(0, 40) },
  CLEAR: (state) => ({ ...state, text: '' }),
}
```

```css live
.note .cm-editor { background: white; color: black; border: 1px solid #8888; }
```

- Typing sends `change` with the text, and the state follows. The text comes back as the `value` prop, and Sygnal knows it is the editor's own, so nothing is written: the cursor and the undo history stay as they are.
- **Clear** and the 40-character cut are the app's values: `write` puts them in, once, and its annotation keeps the listener quiet.
- `strict` handles the digit: the model returns `ABORT`, the `value` prop never moves, and Sygnal writes the state's text back after the app's turn.
- `read` makes the host's `value` the editor's text, so the intent reads it with `.value()`, as for a `<textarea>`.

The [CodeMirror recipe](/recipes/code-editor/) has the same editor without `value`, with a focus command, tests and its bundle size.

## Testing

`renderComponent`'s default mock DOM doesn't mount widgets, but the island's children are in the vnode tree, so the components inside are tested by selector, with the event the widget would send:

<!-- docs-check: skip -->
```jsx
const t = renderComponent(Cubes)
await t.ready()
t.simulateEvent('.cube', 'click', { point: [0, 0.5, 0.5] })
await t.waitForState((state) => state.cubes[0].on)
```

With `renderComponent(App, { dom: 'real' })` the widget mounts in jsdom, and the test can run its real input path: a hit test, or a raycast (three.js computes intersections without WebGL, if the widget skips the renderer when there is no WebGL context).

## Where to go next

- [Widgets](/guide/widgets/): every `defineWidget` field, events, commands, errors and server rendering.
- [Timers](/guide/timers/): `frame` timers, for state that changes every frame.
- [Accessibility](/guide/accessibility/): roles, names and keyboard access for the controls an island draws.
