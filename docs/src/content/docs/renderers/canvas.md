---
title: Canvas
description: Build canvas editors, whiteboards, diagrams and 2D games with sygnal/canvas (experimental). Shapes are data in state, painted, culled and hit-tested by one canvas element; a hit is a DOM event with the shape's id. A controlled camera with built-in pan and zoom, pointer capture, a static and a live layer, the camera cache, an accessibility projection, live and parallax layers, sprites and a follow camera for games, wrapped text, images, and an editor kit (gestures, snapping, handles, resize, undo that works with sygnal/yjs, SVG export)
---

`sygnal/canvas` is an infinite 2D canvas for apps whose content is a document of shapes: editors, whiteboards, diagrams, floor plans, and [2D games](#games). It is **experimental** (the 7.2 dev preview): the API may still change.

The shapes are plain data in your state. One element, `<shapes items={state.shapes} />`, puts all of them on the canvas: the canvas paints them, skips the ones out of view, and hit-tests them. A press on a shape is an ordinary DOM event on that element, with `event.hit` set to the shape's id, so intents stay what they are everywhere else: `DOM.select('.doc').events('pointerdown')`. There is no element or component per shape, which is what keeps a 10,000-shape document cheap.

The demo is a small editor. Add shapes, drag them, resize or rotate the selection with its handles, scroll to pan, ctrl-scroll or pinch to zoom, press Delete, and Undo (⌘Z / Ctrl+Z).

```css live
.board { height: 300px; border: 1px solid #ddd; border-radius: 6px; }
.bar { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
```

```jsx live
// Shapes.jsx
import { ABORT, xs } from 'sygnal'
import { Canvas, pointer, handles, selectionBox, gesture, resize, rotation, turn, centre, history, keymap } from 'sygnal/canvas'

const undo = history('shapes')

export default function Shapes({ state }) {
  const g = state.gesture
  const box = selectionBox(state.shapes, state.selection)
  return (
    <div>
      <div className="bar">
        <button className="add" data={{ type: 'rect' }}>Rectangle</button>
        <button className="add" data={{ type: 'ellipse' }}>Ellipse</button>
        <button className="undo" disabled={!undo.canUndo(state)}>Undo</button>
        <span>{state.shapes.length} shapes · {Math.round(state.camera.zoom * 100)}%</span>
      </div>
      <Canvas className="board" camera={state.camera} background="#fafafa">
        <shapes className="doc" items={state.shapes} active={g && g.moved ? state.selection : null} aria-label="Shapes" />
        {box ? handles(box, state.camera, { grips: !(g && g.kind == 'move' && g.moved) }) : null}
      </Canvas>
    </div>
  )
}

Shapes.initialState = {
  shapes: [
    { id: 's1', type: 'rect', name: 'Blue card', x: 40, y: 40, width: 160, height: 100, radius: 10, fill: '#0d99ff' },
    { id: 's2', type: 'ellipse', name: 'Yellow dot', x: 260, y: 60, width: 90, height: 90, fill: '#ffc700' },
  ],
  selection: [], gesture: null, camera: { x: 0, y: 0, zoom: 1 }, past: [], future: [], next: 3,
}

Shapes.intent = ({ DOM }) => {
  const board = DOM.select('.board'), keys = keymap(DOM, { 'mod+z': 'UNDO', delete: 'DELETE', backspace: 'DELETE' })
  return {
    DOWN: board.events('pointerdown').map(pointer),
    MOVE: board.events('pointermove').map(pointer),
    UP: board.events('pointerup').map(pointer),
    CAMERA: board.events('camerachange').detail(),
    ADD: DOM.click('.add').data('type'),
    UNDO: xs.merge(DOM.click('.undo'), keys.UNDO),
    DELETE: keys.DELETE,
  }
}

// the selected shape, changed by `f`
const update = (s, f) => s.shapes.map((x) => (x.id === s.selection[0] ? f(x) : x))

Shapes.model = {
  DOWN: (s, p) => {
    const one = s.shapes.find((x) => x.id === s.selection[0])
    // a handle of the selection (p.part is its data-part), else a shape, else the background
    if (p.part && one) return { ...s, gesture: gesture.start(p.part == 'rotate' ? 'rotate' : 'resize', p, { before: s.shapes, start: one, part: p.part }) }
    if (p.hit == null) return { ...s, selection: [], gesture: null }
    return { ...s, selection: [p.hit], gesture: gesture.start('move', p, { before: s.shapes, start: s.shapes.find((x) => x.id === p.hit) }) }
  },
  MOVE: (s, p) => {
    if (!s.gesture) return ABORT
    const g = gesture.move(s.gesture, p, s.camera.zoom), { dx, dy } = gesture.delta(g), o = g.start
    if (!g.moved) return { ...s, gesture: g }
    if (g.kind == 'move') return { ...s, gesture: g, shapes: update(s, () => ({ ...o, x: o.x + dx, y: o.y + dy })) }
    if (g.kind == 'resize') return { ...s, gesture: g, shapes: update(s, () => ({ ...o, ...resize(o, g.part, p, p.shift) })) }
    return { ...s, gesture: g, shapes: update(s, () => turn(o, centre(o), rotation(o, g.from, p, p.shift ? 15 : 0))) }
  },
  // one undo step for the whole gesture: back to the shapes it started from
  UP: (s) => (s.gesture ? undo.commit({ ...s, gesture: null }, s.shapes, s.gesture.before) : ABORT),
  CAMERA: (s, camera) => ({ ...s, camera }),
  ADD: (s, type) => {
    const id = 's' + s.next, c = s.camera
    const shape = { id, type, name: `${type} ${s.next}`, x: c.x + 60 + s.next * 12, y: c.y + 60, width: 120, height: 80, fill: type == 'rect' ? '#14ae5c' : '#f24822' }
    return undo.commit({ ...s, selection: [id], next: s.next + 1 }, [...s.shapes, shape])
  },
  DELETE: (s) => (s.selection.length ? undo.commit({ ...s, selection: [] }, s.shapes.filter((x) => !s.selection.includes(x.id))) : ABORT),
  UNDO: undo.undo,
}
```

The whole editor is reducers over plain data: `pointer(event)` turns a canvas event into `{ x, y, hit, part, shift, … }` (world coordinates), and the gesture is state. So the action log, `renderComponent` tests and [record/replay](/guide/record-replay/) see every step of a drag, and undo is one step per gesture.

The [figma-lite example](https://github.com/tpresley/sygnal/tree/main/examples/figma-lite) is a full editor on the same API: frames that clip their children, text editing, snapping with guides, marquee selection, multi-selection resize and rotate, a 10,000-row layers panel, a two-way properties panel, copy and paste, SVG export, and stress documents of 1k to 10k shapes.

## One vocabulary: boxes

Every node is a box: `x`, `y` (the top-left corner, in world units), `width`, `height`, and `rotation` (degrees about the centre). An `ellipse` is the ellipse inside its box, not SVG's `cx cy rx ry`; a `rect` rounds its corners with `radius`. The same names hold for data layers and for JSX nodes. Editors think in boxes: handles, snapping, alignment and resizing all work on them, and a shape can change type without changing its geometry. (An earlier research prototype used SVG's names for 2D nodes; `sygnal/canvas` doesn't accept them.)

| Field | Meaning |
|---|---|
| `id` | What `event.hit` reports, and what `active`, `parent` and the undo history refer to |
| `type` | `rect`, `ellipse`, `text`, `frame`, `image`, `line` (`x1 y1 x2 y2`, no box), `path` (`d`) |
| `x y width height rotation` | The box |
| `fill stroke strokeWidth radius opacity dash` | Paint |
| `text fontSize fontFamily fontWeight` | A `text` node: it wraps to its `width` ([below](#text)); with no width it is one line per `\n`, and its box is measured |
| `wrap maxLines ellipsis align lineHeight` | How a `text` node lays out ([below](#text)) |
| `src sx sy sw sh fit flipX flipY smoothing alt` | An `image` node: its URL, the crop, how it fits the box, mirrored, pixel art, its accessible name ([below](#images-and-sprites)) |
| `parent` | A frame's id: the frame clips the node. A `frame` is a rect with its `name` drawn above it |
| `hidden`, `locked` | Not painted and not hit; painted but not hit |
| `name`, `label`, `alt` | The node's accessible name ([below](#accessibility)) |

## Inside the canvas

`<Canvas>` fills its host element (give it a size in CSS) and takes two kinds of children.

**Data layers**: `<shapes items={nodes} />`. One element for any number of nodes, in paint order (the last is on top). A hit dispatches on the layer's element with `event.hit` (the id) and `event.node` (the data).
- `active={ids}`: the nodes that change every frame (the ones being dragged). The rest are painted once into a cached bitmap; only the active nodes repaint while they move.
- `outline="#0d99ff"`: a layer that paints its nodes' outlines, 1 screen pixel wide at any zoom, and is never hit: selection outlines, other users' selections.
- `live`: every node changes every frame (a game's actors, particles). The whole layer is painted each frame, with no ids to list; it has no accessibility projection unless `a11y` says so.
- `parallax={0.5}` (or `[fx, fy]`): the layer scrolls at that fraction of the camera, in coordinates of its own: a background far away (below 1) or a foreground near (above 1). It is hit where it is drawn, and a static parallax layer is cached like any other.

Layers paint in their order, whatever is live: a live or active layer under a static one stays under it, and over the ones below it.

**JSX nodes**: `rect`, `ellipse`, `text`, `line`, `path`, `frame`, `image` as elements, `g` to group them. One element each, so each can have intents of its own (`DOM.click('.pin')`), live in a component or a `<Collection>`. `space="screen"` puts a node in canvas pixels instead of world units, so it keeps its size at any zoom: handles, guides, a marquee. Use JSX nodes for the few things with behaviour of their own, and data layers for the document. (One component per shape works up to about a thousand shapes; measured, it costs 3.7 times the main-thread time and 5 times the memory of a data layer at 10,000.)

`handles(box, camera)` returns the standard selection box, eight resize handles (`data-part` `nw` … `w`) and a rotate handle (`rotate`) as screen-space nodes; a press on one arrives with `pointer(e).part`.

## Text

A `text` node wraps to its `width`, as text in a box does in the DOM: at spaces and after hyphens, with `\n` starting a new line. A word longer than the box overflows it (`wrap: 'char'` breaks anywhere instead; `wrap: 'none'` keeps one line per `\n`). `maxLines` cuts the text and ends the last line kept with an ellipsis (`ellipsis: false` cuts it plainly); `align` is `left`, `center` or `right` within the box, and `lineHeight` is the line box as a multiple of `fontSize` (default 1.25). Without a `width`, a text node is one line per `\n` and its box is measured. A missing `height` is the height of its lines, so the hit box, the focus ring and `exportSVG` (one `tspan` a line) follow the wrapped text. Text is single-style: one font, size and colour a node.

```css live
.notes { height: 220px; border: 1px solid #ddd; border-radius: 6px; }
```

```jsx live
// Notes.jsx
import { Canvas } from 'sygnal/canvas'

const TEXT = 'Text wraps to the width of its box, at spaces and after hyphens, like text in the DOM.\nA new paragraph starts on its own line.'

export default function Notes({ state }) {
  const w = state.width
  const note = (id, x, more) => [
    { id: id + '-box', type: 'rect', x, y: 20, width: w, height: 180, fill: '#fff8c5', stroke: '#e3c84d', radius: 4 },
    { id, type: 'text', x: x + 10, y: 30, width: w - 20, text: TEXT, fontSize: 14, fill: '#333', ...more },
  ]
  return (
    <div>
      <div className="bar">
        <button className="narrow">Narrower</button><button className="wide">Wider</button><span>width {w}</span>
      </div>
      <Canvas className="notes" background="#f5f5f5" navigate={false}>
        <shapes className="doc" aria-label="Notes" items={[
          ...note('left', 20, { name: 'Left aligned' }),
          ...note('centre', w + 40, { align: 'center', name: 'Centred' }),
          ...note('short', 2 * w + 60, { maxLines: 3, name: 'Three lines at most' }),
        ]} />
      </Canvas>
    </div>
  )
}
Notes.initialState = { width: 200 }
Notes.intent = ({ DOM }) => ({ NARROW: DOM.click('.narrow'), WIDE: DOM.click('.wide') })
Notes.model = {
  NARROW: (s) => ({ ...s, width: Math.max(100, s.width - 30) }),
  WIDE: (s) => ({ ...s, width: Math.min(280, s.width + 30) }),
}
```

`layoutText(text, { width, fontSize, … })` returns the lines and size a text node of that width paints (a fixed-width text box that grows downward with its text), and `measureText(text, font)` the natural size, one line per `\n` (an auto-width text box); both measure with the browser's text metrics.

## Images and sprites

An `image` node paints a picture in its box: `{ type: 'image', src: '/photo.jpg', x, y, width, height }`. Images are loaded once per URL (and `crossOrigin`), shared by every canvas on the page, and painted once they have arrived, as an `<img>` is: nothing before, nothing if the load fails. The canvas repaints when one arrives and dispatches `imageload` (or `imageerror`, with the error) on its element, detail `{ src }`. An image leaves the cache when no canvas shows a layer with it any more. `image: source` instead of `src` paints a source you loaded or drew yourself (an `<img>`, an `ImageBitmap`, another canvas).

- `sx sy sw sh`: the crop, in image pixels (default the whole image).
- `fit`: how the crop fills the box, as CSS `object-fit`: `fill` (the default), `contain`, `cover`, `none`, `scale-down`, centred. A missing `width` / `height` is the crop's natural size (one given: the other keeps the aspect ratio).
- `flipX`, `flipY`: mirrored in its box (a sprite facing the other way). `smoothing: false`: scaled without smoothing, for pixel art.
- `alt`: its accessible name in the [projection](#accessibility); `exportSVG` writes the image, crop and all.

**Sprite sheets.** `frameOf(sheet, index)` is frame `index` of a sheet of same-size frames, as the node's `src` and crop, so you spread it into the node; `frameAt(frames, t, every)` is the frame an animation shows at `t` (each frame for `every` steps). Both are pure, so a replay shows the same frame. Press Play, then ← → (the sheet is drawn in code, so the demo needs no files):

```css live
.yard { height: 200px; border: 1px solid #ddd; border-radius: 6px; }
```

```jsx live
// Walker.jsx
import { Canvas, frameOf, frameAt } from 'sygnal/canvas'

// a 4-frame sprite sheet (16 × 16 frames), drawn once into a data: URL
const art = document.createElement('canvas')
art.width = 64; art.height = 16
const g = art.getContext('2d')
for (let f = 0; f < 4; f++) {
  const x = f * 16, step = f % 2 ? 2 : -2
  g.fillStyle = '#e8603c'; g.fillRect(x + 4, 1, 8, 4)
  g.fillStyle = '#ffd9b0'; g.fillRect(x + 5, 5, 6, 4)
  g.fillStyle = '#1d2340'; g.fillRect(x + 9, 6, 1, 1)
  g.fillStyle = '#2d3a8c'; g.fillRect(x + 4, 9, 8, 4)
  g.fillStyle = '#1d2340'; g.fillRect(x + 5 + (f ? step : 0), 13, 2, 3); g.fillRect(x + 9 - (f ? step : 0), 13, 2, 3)
}
const SHEET = { src: art.toDataURL(), frameWidth: 16, frameHeight: 16, columns: 4 }
const RUN = [1, 2, 3, 2]

export default function Walker({ state }) {
  const moving = state.vx != 0
  return (
    <div>
      <div className="bar"><button className="play">{state.running ? 'Pause' : 'Play'}</button><span>← → walk</span></div>
      <Canvas className="yard" navigate={false} background="#c9f0ff">
        <shapes className="ground" items={[{ id: 'g', type: 'rect', x: -1000, y: 150, width: 3000, height: 60, fill: '#7ccf6a' }]} />
        <shapes className="actors" live items={[{
          id: 'hero', type: 'image', x: state.x, y: 86, width: 64, height: 64, smoothing: false, alt: 'Hero',
          ...frameOf(SHEET, moving ? frameAt(RUN, state.t, 6) : 0), flipX: state.facing < 0,
        }]} />
      </Canvas>
    </div>
  )
}
Walker.initialState = { running: false, x: 120, vx: 0, facing: 1, t: 0 }
Walker.timers = (s) => ({ loop: s.running && { frame: 'STEP', step: 1000 / 60, keys: { left: 'ArrowLeft', right: 'ArrowRight' } } })
Walker.intent = ({ DOM }) => ({ PLAY: DOM.click('.play') })
Walker.model = {
  PLAY: (s) => ({ ...s, running: !s.running }),
  STEP: (s, { held }) => {
    const vx = (held.right ? 2 : 0) - (held.left ? 2 : 0)
    return { ...s, vx, x: Math.max(0, Math.min(500, s.x + vx)), facing: vx ? Math.sign(vx) : s.facing, t: s.t + 1 }
  },
}
```

**`<Image>` and Suspense.** In a data layer an image is just data, so nothing waits for it. When the view should wait (a map's background), use the `Image` tag inside `<Canvas>`: `<Image src="/map.png" x={0} y={0} />` starts the load while the view renders, a [`<Suspense>`](/advanced/suspense/) boundary around the canvas shows its fallback until it has arrived, and a failed load throws in the view, so the component's `onError` renders. `preloadImage(src)` starts a load ahead and resolves when it has settled (a title screen); `clearImages(src)` forgets one, so a failed load is tried again.

## Events and pointer capture

Every pointer event the canvas dispatches carries `world` and `screen` (both `{ x, y }`), `hit` and `node`. A press on empty canvas goes to the canvas itself (with `hit` null), so one listener on the Canvas's class sees every press.

Pointer capture works as in [`sygnal/three`](/renderers/three/#dragging) (the two share one router): between `pointerdown` and `pointerup`, the pressed element gets every move and the up, wherever the pointer is, even off the canvas. Captured events carry `captured: true`, `delta` (the world move since the press) and the press's `hit`; `gotpointercapture` and `lostpointercapture` fire on the element; a press that moved more than 3 px sends no `click`. An editor wants every press captured, which is the default (`capture="all"`). With `capture="explicit"` only nodes with a `capture` prop, or whose `setPointerCapture()` a `pointerdown` listener calls, capture the pointer.

The canvas also stops its own native events, prevents the compatibility mouse defaults of a press (so a press doesn't take the focus from a text field your `ELEMENT` command just focused), and blurs a focused field outside the canvas (so a properties panel's input commits its `change`).

## The camera

The camera is `{ x, y, zoom }`: the world point at the canvas's top-left corner, and the scale. Pan and zoom are built in: the wheel pans, ctrl/⌘-wheel and a trackpad pinch zoom toward the cursor, a two-finger touch pinch zooms and pans, and space-drag or middle-drag pans. `navigate={false}` turns them off.

The camera is a controlled value. The canvas moves it itself and reports each change once a frame as `camerachange` (the detail is the camera); store it if your view needs it (handles, a zoom readout). A `camera` prop you change (zoom to fit, 100 %) is written to the canvas; the canvas's own changes coming back as props are recognised and not written again.

The geometry functions are plain functions for reducers and views: `toWorld(camera, sx, sy)`, `toScreen(camera, wx, wy)`, `zoomAt(camera, zoom, sx, sy)` (keeps the point under the cursor), `panBy`, `fit(union(shapes), width, height, padding)`, `follow(camera, target, options)` ([a game's camera](#a-camera-that-follows)), `viewport`, `aabb`, `union`, `selectionBox(shapes, ids)`, `positionsOf(shapes, previous)`. `canvasresize` reports the canvas's size, for `fit`.

## Painting and performance

The canvas paints on demand, at most once a frame, and does the performance work so the app doesn't have to:

- **A static and a live layer.** Data-layer nodes outside `active` are painted once into a cached bitmap; the live layer (active nodes, outline layers, screen-space nodes) repaints each frame. A drag repaints one shape, not the document.
- **Translation blits.** When 1,000 or more live nodes only moved by one offset since they were painted (a big selection being dragged), the canvas moves their bitmap instead of repainting them. Nodes that move each on their own (a game's) are painted directly after the first frame that didn't translate.
- **Layer order.** When a live layer lies under a static one, each run of static layers is a cached bitmap of its own and the live nodes are painted between them, in order, on one canvas. A pan shifts every run's bitmap.
- **Scrolling.** In a game (a `live` layer over static ones, or `parallax` layers), each run of static layers is a canvas element of its own, covering the view and a margin, and the camera moving moves the element: a CSS transform, which the browser's compositor applies without copying pixels. When the view reaches the edge of what a run has, its pixels are shifted once and only the strip newly in view is painted. A camera that scrolls every frame costs what comes into view, not a copy of the view. When the camera has been still for half a second, the runs go back onto the main canvas (a copy of their pixels): extra canvases cost the compositor on every frame something else moves.
- **The camera cache.** The cached bitmap covers a region around the view; a pan copies it at an offset, and a zoom gesture scales it, with a sharp repaint when the gesture ends. At 10,000 shapes a pan step costs about what React + Konva's page cache does.
- **Culling.** Nodes out of view aren't painted.

All of this keys on **node identity**: a node that didn't change must be the same object. Replace only the shapes that change (`shapes.map((s) => (s.id === id ? { ...s, x } : s))`), never every shape (`shapes.map((s) => ({ ...s }))`): that silently turns every frame into a full repaint. In development, the canvas reports a layer whose nodes all changed identity with equal fields as [SYG262](/reference/errors/#syg262).

The app's own work per move should grow with the shapes that moved, not with the document. With 10,000 shapes, an id lookup map rebuilt for every new array, or a derived list (a layers panel's rows) recomputed from every shape, costs more than the painting. `positionsOf(shapes, previous)` is the canvas's id → index map: a new array whose replaced shapes kept their ids shares the previous array's map after an identity check per slot, and `selectionBox` and the canvas read the same map. A derived list can do the same: when the replaced shapes show the same rows (a drag changes `x` and `y`, not names), return the previous rows array. A `<VirtualCollection>` given the same array does nothing, and given a new array whose keys stay in place it keeps its row list without a pass over the keys. `examples/figma-lite` does both (`patch` in `doc.ts`, `rows` in `model.ts`).

A [`frame` timer](/guide/timers/#a-game-loop-a-fixed-step-and-the-keyboard) whose action changes what the canvas shows makes it paint in that frame, after the frame's flush, once: the screen shows the state of the frame it is in.

`repaint="full"` repaints everything each frame (for comparison). The painter is a backend: `backend={canvas2d()}` is the default, the canvas's own Canvas 2D painter, and the backend only paints (hit testing, the camera, routing and the projection stay in the canvas), so a WebGL backend can be added later without changing apps.

### `follow`: the escape hatch for very large selections

Drags normally go through the action queue, as in the demo: every move is an action, the reducer moves the shapes, and everything that reads state (snapping, the properties panel, other users) follows the drag as it happens. At 10,000 shapes that fits a frame with the whole document selected: about 9 ms a step in Chromium, as React + Konva. On slower devices, or with more shapes, building every selected shape anew per move is what stops fitting.

For that case, `follow` hands the per-frame part to the canvas:

<!-- docs-check: skip -->
```jsx
<Canvas className="board" camera={state.camera} follow={state.following}>
```

While `follow={{ ids, from }}` is set (from the press: `{ ids: selection, from: { x: p.x, y: p.y } }`) and the pointer is captured, the canvas moves those nodes by the pointer's offset from `from` itself, sends no `pointermove` to the app, and the app commits the move once on `pointerup`. `map: (dx, dy) => [dx, dy]` adjusts the offset (a grid). It is an escape hatch, not the default: while it is on, nothing that reads state sees the drag (no live snapping or panels, and other users see the shapes jump on release). Use it for very large selections or slow devices, the way `animate` is for motion.

## Games

A game is the same canvas: the world is state, a `frame` timer steps it, and the layers say what is cached. Press Play, then ← → to run and Space to jump (hold it to jump higher):

```css live
.world { height: 260px; border: 1px solid #ddd; border-radius: 6px; }
```

```jsx live
// Runner.jsx
import { Canvas, follow } from 'sygnal/canvas'

const FLOOR = 220, SIZE = 24, STEP = 1000 / 60
// far hills (a parallax layer: its own coordinates) and the ground: built once, cached
const hills = Array.from({ length: 12 }, (_, i) => ({ id: 'h' + i, type: 'ellipse', x: i * 150 - 40, y: FLOOR - 70 - (i % 3) * 20, width: 220, height: 200, fill: i % 2 ? '#7ccf6a' : '#93db7e' }))
const ground = Array.from({ length: 40 }, (_, i) => ({ id: 'g' + i, type: 'rect', x: i * 40, y: FLOOR, width: 40, height: 40, fill: i % 2 ? '#a0612e' : '#b06a33' }))

export default function Runner({ state }) {
  const p = state.player
  return (
    <div>
      <div className="bar"><button className="play">{state.running ? 'Pause' : 'Play'}</button><span>{state.running ? '← → run, Space jump' : 'paused'}</span></div>
      <Canvas className="world" camera={state.camera} navigate={false} a11y={0} background="#8fd3ff">
        <shapes className="far" items={hills} parallax={0.4} />
        <shapes className="ground" items={ground} />
        <shapes className="actors" items={[{ id: 'p', type: 'rect', x: p.x, y: p.y, width: SIZE, height: SIZE, radius: 6, fill: '#e8603c' }]} live />
      </Canvas>
    </div>
  )
}

Runner.initialState = { running: false, player: { x: 40, y: FLOOR - SIZE, vx: 0, vy: 0 }, camera: { x: 0, y: 0, zoom: 1 } }

// while running: one STEP per 1/60 s, with the keys sampled each frame
Runner.timers = (s) => ({ loop: s.running && { frame: 'STEP', step: STEP, keys: { left: 'ArrowLeft', right: 'ArrowRight', jump: 'Space' } } })

Runner.intent = ({ DOM }) => ({ PLAY: DOM.click('.play') })

Runner.model = {
  PLAY: (s) => ({ ...s, running: !s.running }),
  STEP: (s, { held, pressed }) => {
    const p = { ...s.player }, grounded = p.y >= FLOOR - SIZE
    p.vx = (held.right ? 4 : 0) - (held.left ? 4 : 0)
    if (pressed.includes('jump') && grounded) p.vy = -9
    // lower gravity while Space is held on the way up: a higher jump
    p.vy += held.jump && p.vy < 0 ? 0.4 : 0.9
    p.x = Math.max(0, Math.min(1560, p.x + p.vx))
    p.y = Math.min(FLOOR - SIZE, p.y + p.vy)
    if (p.y >= FLOOR - SIZE) p.vy = 0
    // the camera follows: a dead zone around the player, eased, inside the level, whole pixels
    const camera = follow(s.camera, { x: p.x, y: p.y, width: SIZE, height: SIZE }, {
      width: 600, height: 260, deadzone: { width: 120, height: 260 }, lerp: 0.15, bounds: { x0: 0, y0: 0, x1: 1600, y1: 260 }, round: true,
    })
    return { ...s, player: p, camera }
  },
}
```

What makes it a game rather than an editor:

- **`navigate={false}`**: the canvas's own pan and zoom are off (Space-drag would take the jump key), and **`a11y={0}`** turns the accessibility projection off for the whole canvas: a game's shapes aren't controls to list.
- **A `live` layer** for what moves every frame, and **cached layers** for the rest (the ground, the scenery): their node objects stay the same, so the camera scrolls their canvases ([Scrolling](#painting-and-performance)). **`parallax`** for what is far away.
- **The camera is state**, moved by `follow()` in the step ([below](#a-camera-that-follows)).
- **The timer steps the world**: `step` makes it a fixed 1/60 s step, `keys` samples the buttons (`held`, and `pressed` since the last frame, so a tap shorter than a frame still jumps). Keys are released when the window loses focus. See [the timers guide](/guide/timers/#a-game-loop-a-fixed-step-and-the-keyboard).
- **Tests are deterministic**: with fake timers, dispatch real key events and run frames: `document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' })); await t.frames(60)`. A [recording](/guide/record-replay/) replays a run exactly: each STEP carries the keys it saw.

[`examples/platformer`](https://github.com/tpresley/sygnal/tree/main/examples/platformer) is a whole platformer this way (tiles, sprites from a sheet, enemies, coins, lives, a checkpoint and a goal): about 0.1 ms of Sygnal's own work a frame, the same at 10 or 2,000 moving things.

### A camera that follows

`follow(camera, target, options)` is the camera after one step of following `target` (a point, or a box: its centre), the way Phaser's `startFollow` and Godot's Camera2D follow a player. It is a pure function: the model calls it in each step with the camera in state and stores what it returns, so the camera is part of the state a test or a [recording](/guide/record-replay/) sees, and a replay reaches the same pixel. It returns the same camera object while the camera stays put, so the canvas has nothing to repaint.

| Option | |
|---|---|
| `width`, `height` | The canvas size in CSS pixels (required) |
| `deadzone: { width, height }` | A box around the anchor (screen pixels) the target moves in freely; the camera moves only when the target leaves it, just enough to keep it at the edge |
| `offset: { x, y }` | Where the target sits relative to the view's centre (screen pixels): a look-ahead, `{ x: facing > 0 ? -60 : 60 }` |
| `lerp` | The share of the way the camera moves per call, 0 to 1 (`[x, y]` per axis; default 1, at once) |
| `dt` | The time since the last call in ms: `lerp` is then per 1/60 s, so a variable frame time eases the same (with a fixed `step` you don't need it) |
| `bounds: { x0, y0, x1, y1 }` | The world the camera never shows past (a level); a world smaller than the view is centred |
| `round` | Whole screen pixels (pixel art): the camera moves at least a pixel while it has one to go, so it never stalls short of the target |

(The `follow` *prop* on `<Canvas>`, [above](#follow-the-escape-hatch-for-very-large-selections), is a different thing: nodes following the pointer during a drag.)

## The kit

Pure functions over plain data, for the parts every canvas editor writes the same way:

| | |
|---|---|
| `gesture.start(kind, p, data)`, `gesture.move(g, p, zoom)`, `gesture.delta(g)` | A press-drag-release as state; `moved` turns true past 3 screen pixels, so a click that jitters isn't a drag |
| `snapTargets(boxes)`, `snap(box, dx, dy, targets, tolerance)` | Snapping to other boxes' edges and centres, with guides to draw; targets once per gesture, each move is a binary search |
| `handles(box, camera, { grips })` | The selection box and its handles as screen-space nodes |
| `resize(box, part, p, keepAspect)`, `rotation(box, from, to, step)`, `turn(box, centre, deg)`, `scaleInto(box, group, newGroup)` | The transform math, rotated boxes included |
| `history(field)` | `commit(state, next, before)`, `undo`, `redo`, `canUndo`, `canRedo` over one state field ([below](#undo-and-multiplayer)) |
| `exportSVG(nodes, ids?)` | The nodes (or a selection and its children) as an SVG document; frames become clip paths |
| `keymap(DOM, table)` | Keyboard shortcuts as named action streams; on the main `sygnal` export too ([below](#keyboard-shortcuts)) |
| `measureText(text, font)`, `layoutText(text, options)` | A text's natural size; its lines wrapped to a width ([Text](#text)) |
| `follow(camera, target, options)` | A camera that follows a player: dead zone, look-ahead, easing, bounds ([above](#a-camera-that-follows)) |
| `frameOf(sheet, index)`, `frameAt(frames, t, every)` | A sprite sheet's frame as an image node's crop; an animation's frame at `t` ([Images](#images-and-sprites)) |

### Keyboard shortcuts

`keymap` is in the main `sygnal` export as well, since it is useful outside canvases:

<!-- docs-check: skip -->
```js
App.intent = ({ DOM }) => ({
  ...keymap(DOM, {
    'mod+z': 'UNDO', 'shift+mod+z': 'REDO', 'mod+d': 'DUPLICATE', delete: 'DELETE', backspace: 'DELETE',
    v: ['TOOL', 'select'], r: ['TOOL', 'rect'], left: ['NUDGE', { dx: -1 }], 'shift+left': ['NUDGE', { dx: -10 }],
  }),
})
```

A combo is modifiers then a key: `mod` (⌘ on macOS, Ctrl elsewhere), `ctrl`, `meta`, `shift`, `alt`, and the key as `event.key` names it (lower-cased; `left`, `right`, `up`, `down`, `del`, `esc` and `space` are aliases; digits match the key's position, so `shift+1` works on any layout). A combo matches only its own modifiers. An entry's value is an action name or `[name, data]`; several combos can name one action. Matched keys are default-prevented, and nothing fires while the focus is in a text field.

## Undo and multiplayer

`history('shapes')` keeps undo for one field. A gesture commits once, at its end, with the value from its start (`undo.commit(state, state.shapes, gesture.before)`), so a drag is one undo step. The local history keeps `past` and `future` arrays in state; structural sharing makes each step cheap.

With [`sygnal/yjs`](/guide/collaborative-state/) the same code becomes per-user undo in a shared document. Share the field (`uses: { doc: shared({ history: 'history' }) }`, with the shapes inside `state.doc`, since `shared()` syncs an object) and use `history('doc')`: `shared()` finds the history's `undo` and `redo` in the model and sends them to this user's Yjs UndoManager instead, so an undo reverts only your own changes, and each `commit` closes an undo step, so a gesture is still one step however long it took. `canUndo` and `canRedo` read `state.history`. Other users see a drag as it happens, because it goes through state.

## Accessibility

A data layer is one element, so the canvas projects its nodes into an accessibility tree: inside the layer's element, a group named by the layer's `aria-label` (default "Shapes") with a button for each node in view (topmost first, at most 100: `a11y={n}` on the layer changes that, `a11y={0}` turns it off; on `<Canvas>`, `a11y` is every layer's default, and a `live` layer has none unless it says so). A button's name is the node's `label`, `name`, `alt` or `text`, and its role description is its type. Screen readers read them and Tab reaches them (arrow keys move between them); activating one (Enter, Space, a click) is a press and release on that node, so your intents treat it as a click on the shape. The [`sygnal/agent-ui`](/renderers/agent-ui/) snapshot reads the same buttons, so an agent can select a shape. A focused node, or a focused JSX node, gets a focus ring on the canvas.

JSX nodes are elements of their own: give the interactive ones a `role`, `tabIndex` and `aria-label` as you would a `<div>`.

## Testing

In jsdom (and on a `sygnal/host` document) the canvas runs headless: nothing is painted, but hit testing, events, capture, the camera and the projection are the same. Drive it with raw input at canvas pixels through `canvasOf(element).pointer(kind, x, y)`, as a real pointer would:

<!-- docs-check: skip -->
```js
import { renderComponent } from 'sygnal'
import { canvasOf } from 'sygnal/canvas'

const t = renderComponent(Shapes, { dom: 'real' })
await t.ready()
const canvas = canvasOf(t.container.querySelector('.board'))
for (const [kind, x, y] of [['down', 60, 60], ['move', 90, 70], ['move', 120, 80], ['up', 120, 80]]) canvas.pointer(kind, x, y, { pointerId: 1 })
await t.settle()
expect(t.state.shapes[0]).toMatchObject({ x: 100, y: 60 })
```

## Status

Experimental, in the 7.2 dev preview. Not built yet: rich text (a text node is single-style), dirty-rectangle repaints for small edits in huge documents, a spatial index for hit testing past about 50,000 shapes, a WebGL backend, and running the canvas inside [`sygnal/worker`](/renderers/off-main-thread/) (its target doesn't run widgets yet).
