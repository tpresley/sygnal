---
title: Imperative Islands
description: A canvas, a three.js scene and a code editor inside a Sygnal app, with their parts as JSX children, raycasts and hit tests as DOM events, a frame loop outside the render, and controlled values
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

[`sygnal/three`](/renderers/three/) is this pattern for WebGL, ready-made. `<Scene>` is a widget with children: every three.js class is a tag (`<mesh>`, `<boxGeometry>`, `<meshStandardMaterial>`, lights, cameras), and a click on the canvas is a raycast whose topmost hit gets a DOM `click`, with the point it hit on the event.

<!-- docs-check: skip -->
```jsx
import { Scene } from 'sygnal/three'

<Scene className="viewport" width={640} height={400}>
  <ambientLight intensity={0.6} />
  <Collection of={Cube} from="cubes" />
</Scene>
// Cube: <mesh className="cube" position={[state.x, 0, 0]}><boxGeometry /><meshStandardMaterial color="orange" /></mesh>
// Cube.intent: TOGGLE: DOM.click('.cube')
```

Raycast events follow the DOM's rules: only the topmost hit is the event's target, and the event bubbles up the scene's elements, so a `DOM.click('.world')` on a group hears a click on any cube in it.

## The frame loop

A value that changes 60 times a second doesn't belong in state: every change is an action, a render and a patch. Compute such values in the widget's own frame loop from its props: the state says *how* something moves (its speed), and the widget works out *where* it is each frame. `sygnal/three`'s [`animate` props](/renderers/three/#the-frame-loop) do this. Measured with 20 spinning cubes in Chromium, over 2 seconds: 240 frames drawn, 0 actions, 0 renders, 0 patches. With the angle in state, every frame was a patch and a render of every cube.

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

With `renderComponent(App, { dom: 'real' })` the widget mounts in jsdom, and the test can run its real input path: a hit test, or a raycast. `sygnal/three` runs headless there (three.js computes intersections without WebGL): `sceneOf(el).click(meshElement)` clicks where the mesh is drawn.

## Where to go next

- [three.js](/renderers/three/): `sygnal/three`, the scene as JSX.
- [Widgets](/guide/widgets/): every `defineWidget` field, events, commands, errors and server rendering.
- [Timers](/guide/timers/): `frame` timers, for state that changes every frame.
- [Accessibility](/guide/accessibility/): roles, names and keyboard access for the controls an island draws.
