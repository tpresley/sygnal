# Canvas-heavy apps: a Figma-lite on Sygnal, and what `sygnal/canvas` should be

Research spike, branch `claude/explore-canvas-apps-30158d` (on `claude/advanced-integration`).
Nothing here touches `src/`: the prototype of the proposed subpath is `sygnal/lib/canvas/`, and the
app is `sygnal/app/`. The React + react-konva baseline of the same spec is to live in
`react-konva/` (branch `claude/explore-canvas-react-baseline`, a cloud session); see §8 for its state.

```bash
cd dev-plans/research/canvas-apps/sygnal
npm install                 # konva + pixi.js, only for the backend comparison (§5)
npm run dev                 # the app (Vite, against src/: no build of the root needed)
npm test                    # 26 tests: the whole editor in jsdom, both versions (§6), capture
node perf/run.mjs           # §2–§4 in Playwright Chromium from the cache (≈ 25 min, 3 runs)
node perf/backends.mjs [--gpu]   # §5
node perf/e2e.mjs           # real input in real Chromium: pan, zoom, capture, text focus, DnD
node perf/profile.mjs       # a CPU profile of a drag (default: all 10k shapes selected)
node scripts/count-lines.mjs   # line counts, counted as the React baseline counts
npx vitest run --config perf/vitest.cost.mjs   # §7: the model's own cost per move, in Node
```

URL switches: `?shapes=10000` (the stress document), `?render=collection` (one Collection item per
shape), `?input=transient`, `?repaint=full`, `?app=proposed` (the rewrite on the proposed API).

## Summary

- **Build it on data, not on elements.** A document of shapes is `<shapes items={state.shapes} />`
  on one canvas element: painted, culled and hit-tested by the canvas, a hit is an ordinary DOM
  event with `event.hit` = the shape's id. One Collection item per shape costs 3.7× the main-thread
  time at 10k (20.4 against 5.5 ms per move, 80 against 12 ms at CPU ×4) and 5× the memory: fine
  up to ~1k, and the right tool for the few interactive things with their own behaviour.
- **Drags go through the action queue.** At 10k shapes it fits the frame budget even throttled ×4,
  and it keeps undo-per-gesture, snapping, the live panels, replay and multiplayer working from
  one state tree. A transient channel (`follow`, the drag analogue of `animate`) is the escape
  hatch for very large selections.
- **The canvas carries the performance work so the app doesn't**: a static layer plus a live layer
  (the app only says `active={ids}`), translation blits for big moving sets, culling, pointer
  capture as `sygnal/three` defines it, a controlled camera with built-in pan and zoom.
- **Backend: the own Canvas 2D painter, pluggable.** Konva is slower at the same job (2.7×) and
  duplicates the state tree; Pixi wins the raw GPU frame but loses memory, hit testing and every
  machine without a GPU. Hit testing on the data is backend-independent, so a backend only paints.
- **`sygnal/canvas` = the island + a small kit.** The Figma-lite on it is 728 lines against 1,504
  built by hand and 1,915 for the React + react-konva baseline, with the same features and tests.
- **Against React + Konva, measured with its own script**: Sygnal uses ~5× less memory, starts
  and loads faster, zooms cheaper and commits drags 5× faster; React + Konva is faster at dragging
  a whole 10k selection and at panning at 10k, through bitmap caches the Sygnal canvas doesn't
  have yet for the camera. Details in §8.

---

## The app

All of the spec is there, in both versions, and the same 12-test suite runs against each
(`test/app.test.tsx`: pointer input at canvas pixels, headless):

- infinite canvas: wheel pans, ctrl/⌘-wheel and trackpad pinch zoom toward the cursor, space-drag
  and middle-drag pan, a zoom % readout (also −/+/100 %/Fit, ⌘= ⌘- ⌘0 ⇧1);
- rectangle, ellipse, text (double-click edits it in a positioned `<textarea>`; the box follows the
  text), frame (clips its children; they move with it; a shape dropped on a frame joins it, one
  dragged out leaves it);
- tools from the toolbar and V R O T F;
- click, shift-click, marquee (touching selects);
- drag with snapping to other visible shapes' edges and centres, with guides (⌘ held: no snapping);
- 8 resize handles (shift keeps the aspect ratio; rotated shapes resize in their own frame), a
  rotate handle (shift: 15° steps), multi-selection resize and rotate as a group;
- a layers panel (a tree, top of the stack first; rename on double-click; drag to reorder, onto a
  frame's middle to nest; hide; lock) on `<VirtualCollection>` (10k rows render ~30 elements);
- a properties panel (x, y, w, h, rotation, corner radius, fill, stroke, stroke width, opacity,
  font size; "Mixed" for differing values), both two-way;
- undo/redo (one step per gesture), copy, paste, duplicate (a frame with its children), delete,
  arrow nudge (shift: 10);
- export the selection or the page to SVG (frames as clip paths);
- stress documents of 1k, 5k, 10k shapes (toolbar or `?shapes=`).

Files (non-blank, non-comment lines, counted as the React baseline counts them; §6 has the totals):

| | lines | |
|---|---:|---|
| `sygnal/app/doc.ts` | 110 | the document: shapes in one array in tree order; pure tree ops |
| `sygnal/app/model.ts` | 325 | every reducer: the tool state machine, snapping, history, layers, props |
| `sygnal/app/App.tsx` | 216 | view, overlay (handles, guides, marquee), intents, the model table |
| `sygnal/app/LayerRow.tsx` | 49 | a layers-panel row (VirtualCollection item) |
| `sygnal/lib/canvas/*` | 679 + 80 | the canvas island, painter, hit test, router, camera, geometry, snap, SVG export; + the kit |
| `sygnal/app-proposed/` | 271 + 171 | the rewrite on the proposed API (model, App) |
| `sygnal/app/bench.ts` | 51 | the React baseline's benchmark contract (§8) |
| `sygnal/app/ShapeNode.tsx` | 8 | research only: the per-shape component of `?render=collection` |

---

## 1. Friction log

Written while building; each entry says where it is in the code.

### Where Sygnal made it easier

- **Undo from one state tree** is 15 lines (`app/model.ts` `commit`/`undo`/`redo`): the history is
  a list of earlier `shapes` arrays. Structural sharing makes each entry cheap (a drag at 10k
  shapes replaces one object; the arrays share the other 9,999). A gesture records its `before`
  at the press and commits it once at the release, so a whole drag, resize or text edit is one
  undo step, with no "transaction" API.
- **Actions as data.** The whole tool state machine is reducers over `{ x, y, hit, part, shift }`
  (`down`/`move`/`up`). The editor's test suite drives raw pointer input headlessly and checks
  state (12 tests, under 3 s in jsdom, no canvas context needed). Replay, the devtools action log
  and a worker get the same plain data. Snapping is a pure function of the gesture's state.
- **Hits are DOM events.** The canvas turns hit tests into ordinary events on elements, so the
  intents are the usual ones: `DOM.select('.board').events('pointerdown').map(pointer)` and the
  handles are found by `data-part` like any element. `pointer(e)` makes it plain data.
- **Element commands** focus the text editor and the rename field with no refs
  (`ELEMENT: { focus: '.text-edit' }`); `props.previousState` tells a new edit from an ongoing one.
- **`<VirtualCollection from="rows">` from a calculated field** worked as is: the 10k-row layers
  panel is one line, and rows are cached per shape object so only changed rows re-render.
- **The controlled camera** (`src/extra/controlled.ts`, from canvas-three) is exactly right for a
  canvas: the canvas pans and zooms itself, reports `camerachange` once a frame, and the app's own
  changes (Fit, 100 %) are written without echo loops. Pan and zoom need no app code at all.
- **Two-way panels for free.** The properties panel is a function of the selection; the inputs'
  `change` events are actions. Canvas → panel and panel → canvas are the same state.

### Where it needed boilerplate, a workaround or an escape hatch

1. **`defineWidget({ tags })` is app-wide.** It clears the SVG bit in the pragma's tag table for
   the whole app, so a canvas that lists `rect`/`text`/`g` would turn the toolbar's SVG icons into
   HTML elements. I left them SVG and read values from `attrs` and `props` alike
   (`Canvas.ts`, `readChildren`). Per-island vocabularies would need the pragma to know its parent.
2. **Native events of the island's own `<canvas>` bubble to its host.** An intent on the canvas's
   class sees each press twice: the native one (no `world`, no `hit`) and the routed one. The
   island has to `stopPropagation()` its natives (`Canvas.ts`, `native()`). `sygnal/three`'s
   `<Scene>` has the same leak (`src/three/scene.ts` `on()`), harmless there only because its
   intents select meshes, not the scene.
3. **The press steals focus.** With the T tool, the press creates a text and focuses its editor
   (ELEMENT), then the compatibility `mousedown` moves the focus to the body: blur, empty text,
   deleted. The canvas must `preventDefault()` its `pointerdown` and blur the active field itself
   (so a properties field still commits on a press on the canvas). Every canvas island needs this.
4. **No pointer capture, and misses had no target.** `sygnal/three`'s `pointerRouter` sends moves
   to whatever is under the pointer, so a drag that leaves its shape loses it, and a press on empty
   canvas fires nothing. `lib/canvas/router.ts` adds implicit capture (DOM touch semantics: down →
   every move and the up go to the pressed element, no hit test while captured,
   `got`/`lostpointercapture`) and sends misses to the background element. See §3.
5. **A capitalized helper is a component.** `<PropsPanel s={s} />` rendered fine, but its inputs
   were in an isolated child scope, so the App's `DOM.select('.prop')` heard nothing, silently.
   Fixed by calling `propsPanel(s)`. A diagnostic would have saved the time: "`.prop` matches only
   elements inside child component PropsPanel" (sygnal-check knows both sides).
6. **Every row interaction is a `PARENT` one-liner.** `LayerRow` has 11 actions, each
   `{ PARENT: (s, e) => ({ kind, id: s.id, … }) }` (`app/LayerRow.tsx`), because the App can't
   select inside an isolated item. A "forward to the parent with my id" shorthand, or
   `CHILD.select(LayerRow)` exposing the item's DOM events, would remove most of the file.
7. **Fifteen shortcuts from one `keydown`.** A `shortcut(e)` table (25 lines) plus one `filter`
   per action (15 lines), plus the typing guard and `preventDefault`, all hand-written
   (`app/App.tsx`). The kit's `keymap()` is the fix (§6).
8. **Text measurement in a reducer.** A text box follows its text, so `fitText` calls
   `measureText` (an OffscreenCanvas) inside reducers. Deterministic only once fonts are loaded,
   and a replay on another machine can measure differently. Better: the canvas owns auto-sized
   text (`width="auto"`), and state holds only the text and font.
9. **Firefox's drag and drop needs `dataTransfer.setData()`** at `dragstart`: an imperative call
   inside an intent's `map` (`app/LayerRow.tsx`).
10. **`ABORT` in typed reducers.** Reducers typed `(s: State, …) => State` need `ABORT as any` (17
    places in `app/model.ts`); `State | typeof ABORT` works but nobody writes it. A `Reducer<S, D>` type export would help.
11. **The island's `sync` runs after every App render.** The children's vnode array is new each
    render, so `readChildren` walks them every time: O(1) for a data layer, O(n) for one element per
    shape (§2). Unchanged child vnodes keep their node objects (a WeakMap), so the static layer cache
    survives, but the walk itself is per render.
12. **`controlled()` and the router aren't public.** The camera imports
    `src/extra/controlled`, the router imports `src/three/events`: both belong in a shared module.
13. **`sygnal/worker` doesn't run widgets yet**, so the editor can't move into a worker unchanged (§7).
14. **Dragging a whole 10k selection through the queue** was the one case far over budget (42.5 ms
    per step in §8's first rounds). A CPU profile (`perf/profile.mjs`) showed no framework cost at
    the top: it was the canvas copying a bitmap four times the canvas's area, the GC behind 10k new
    shape objects per move (and an outline copy of each), and an AABB `WeakMap` cache churning on
    objects that live one frame. Fixed in the canvas (copy only the visible part, uncached AABBs
    for unrotated boxes) and the app (no per-shape outlines while moving, as the React build does,
    and layer rows kept by id). Lesson for the subpath: identity caches pay only when identity
    survives; per-frame paths need allocation budgets.
15. **Per-shape selection outlines** as JSX nodes were one element per selected shape (10k for
    select-all). They needed a new layer kind: `<shapes items={selected} outline={color} />`.

---

## 2. Per-shape cost: one Collection item per shape vs shapes as data

Two ways to put shapes on the canvas, both in the same app (`?render=collection` switches):

- **as data**: `<shapes className="doc" items={state.shapes} />`, one element for the whole
  document. The canvas paints and hit-tests the array; a hit is an event on that element with
  `event.hit` = the shape's id.
- **one Collection item per shape**: `<Collection of={ShapeNode} from="shapes" />` inside the
  Canvas. Each shape is a component instance with its own intent (`pointerover` → PARENT) and an
  SVG element in the island's hidden children; the canvas reads the patched vnodes, and a hit is an
  event on the shape's own element (canvas-three's model, as `sygnal/three` does for meshes).

Method (`perf/run.mjs`): Playwright Chromium 153 (headless shell, from the cache), 1440 × 900 at
dpr 1, the stress document zoomed to fit (every shape on screen), real CDP mouse input: a press on
shape 0, 60 moves of 3 px, one per frame, the release. **main ms/move** is the renderer main
thread's busy time per move (Δ CDP `TaskDuration` / 60): events, the action, reducers, the render,
the patch, the canvas commands, GC. It includes the harness's own cost per step (two
`page.evaluate`s), about 2.5 ms: the transient rows below are close to that floor. **paint** is the
canvas's own draw (JS side; rasterization happens off the main thread). Medians of 3 runs (every run is in
`sygnal/perf/results/*.json`; run-to-run spread under 20 %). Load average 7.4–10.8 throughout (this
machine idles near 9: a Docker VM and media analysis) and no other gate ran: the harness waits for
none (`ps`) before each run and records it.

| shapes | as data: main/move | paint | one Collection item per shape: main/move | paint | DOM nodes (data / items) | JS heap (data / items) | startup (data / items) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 3.9 ms | 0.1 | 5.7 ms | 1.9 | 462 / 1,481 | 3.1 / 6.1 MB | 50 / 62 ms |
| 5,000 | 4.6 ms | 0.2 | 11.4 ms | 5.0 | 462 / 5,561 | 4.5 / 18.6 MB | 62 / 112 ms |
| 10,000 | 5.5 ms | 0.3 | **20.4 ms** (frames drop: max 33 ms) | 9.7 | 462 / 10,661 | 6.3 / 34 MB | 69 / 182 ms |

Same, with CDP CPU throttling ×4 (a mid-range laptop's main thread, roughly):

| shapes | as data | one item per shape | frame p95 / max (data) | frame p95 / max (items) |
|---:|---:|---:|---:|---:|
| 5,000 | 9.6 ms | 43.6 ms | 16.8 / 33 ms | 33 / 83 ms |
| 10,000 | 12.0 ms | 80.0 ms | 16.8 / 67 ms | 67 / 167 ms |

At 100 % zoom (most of the 10k shapes off screen and culled) the data path costs 3.6 ms and the
per-item path 10.9 ms: culling cuts the paint, not the per-element cost (`perf/results/sygnal-zoom100.json`).

What a Collection item costs here: ~2.8 KB of JS heap and one DOM element per shape, a vnode per
shape per render, and on every App render the island's `sync` walking every child (finding 11).
A drag changes one shape, so only one item re-renders, but the Collection still reconciles 10k
keyed children, and the hidden SVG elements are patched. Per move that is linear in n with a big
constant; the data path is linear only in the array `patch` (0.12 ms at 10k in Node,
`perf/model-cost.cost.ts`) and the paint, which the layered strategy makes ~O(1) (§4).

**Conclusion.** Shapes are data, not components, for anything document-sized. Per-shape
components are fine up to ~1k shapes, and they're the right tool for the few interactive things
with their own behaviour (a handle, a pin, a comment marker): that is what the Canvas's JSX nodes
are for, and they mix with data layers in the same canvas. The hit test returning ids into
ordinary DOM events keeps "intents on shapes" with no element per shape:
`DOM.select('.doc').events('pointerdown').map(e => e.hit)`.

---

## 3. High-frequency input: drags through the action queue vs a transient channel

The same drag of one shape, two ways (`?input=`):

- **through the action queue** (the default): every `pointermove` is a `MOVE` action; the reducer
  applies the gesture (snapping included) to `state.shapes`; one flush renders the App and patches;
  the canvas repaints the live layer. Chromium already aligns `pointermove` with frames, so this is
  at most one action per frame.
- **transient** (`follow`): the press puts `follow: { ids, from }` into state (the gesture's
  start); while it is set, the canvas moves those nodes by (pointer − from) itself and sends the app
  no `pointermove` at all; the release commits once. The declarative shape of `animate`: state
  says *what* follows the pointer, once per gesture; the canvas does the per-frame part.

| shapes | queue: main/move | transient | queue, CPU ×4 | transient, CPU ×4 |
|---:|---:|---:|---:|---:|
| 1,000 | 3.9 ms | 2.7 ms | – | – |
| 5,000 | 4.6 ms | 2.7 ms | 9.6 ms | 3.5 ms |
| 10,000 | 5.5 ms | 2.9 ms | 12.0 ms | 3.7 ms |

The transient numbers are at the harness's floor (~2.5 ms per step): the app's own work per move
drops from ~3 ms to ~0.4 ms at 10k. But the queue path is inside the frame budget at 10k even
throttled ×4, and it is the one where everything else keeps working: snapping and its guides (a
pure function of the gesture state), the properties panel's live X/Y, the layers panel, the
action log, replay, and multiplayer peers seeing the drag as it happens (§7). The transient path
gives all of that up, or needs it re-done inside the canvas (a `map` function for snapping, guides
the canvas draws). The React baseline went transient by necessity (its workaround 1: "two sources
of truth during a drag, kept apart by hand"); here it is an option, declared in state.

**Recommendation.** Drags, resizes, rotations and marquees go through the action queue. Keep
`follow` as the documented escape hatch for heavy cases (a 10k-shape selection, a slow device),
the way `animate` is for per-frame motion. The model's own cost is small: 0.12 ms per move at 10k
in Node, and 11.6 ms once at the press, to sort 30k snap targets (a visible hitch at 10k; a lazy or
grid-indexed target set would fix it).

**Pointer capture.** Capture is the router's job, not the app's. `lib/canvas/router.ts` follows
the definition the parallel `sygnal/three` drag work chose (side-session note `three-assets-drag`):
between `pointerdown` and `pointerup` the captured element gets every move and the up, with no hit
test, carrying `captured: true` and `delta`; `gotpointercapture` / `lostpointercapture` fire on
it; there is no hover while captured; a drag over 3 px sends no click; the canvas element captures
the native pointer, so a drag that leaves the canvas continues. A canvas editor wants every press
captured (`capture="all"`, the default); `capture="explicit"` captures only elements with a
`capture` prop or whose `setPointerCapture()` a listener calls during the pointerdown, as in
`sygnal/three`. One router in a shared module (`src/extra/pointer.ts`) for both subpaths is the
obvious next step.

---

## 4. Viewport and painting

**Coordinates.** The camera is `{ x, y, zoom }` (the world point at the top-left corner, and the
scale); `toWorld`, `toScreen`, `zoomAt` (zoom keeping the point under the cursor), `panBy`, `fit`,
`viewport` are plain functions on plain data, used by reducers and views alike. Every routed event
carries `world` and `screen`, and `pointer(e)` turns it into plain data for an intent. Handles are
JSX nodes with `space="screen"`, so they keep their size at any zoom; outlines draw 1 screen px
whatever the zoom (stroke widths of world nodes are divided by the zoom only for overlays and
outline layers).

**Culling.** Each node's world AABB is cached per node object (a `WeakMap`: nodes are immutable,
so identity is the key) and nodes outside the viewport are skipped. At 100 % zoom with 10k shapes
(~240 on screen) a full repaint costs 5.5 ms per move against 13.0 ms fitted.

**Repaint strategies**, measured (`?repaint=`), 10k shapes fitted:

| | main/move | paint | CPU ×4 |
|---|---:|---:|---:|
| full repaint every frame | 13.0 ms | 5.9 ms | 50.2 ms (frames drop) |
| layers: static bitmap + live layer (default) | 5.5 ms | 0.3 ms | 12.0 ms |

- **Layers** (`repaint="layers"`): the data layers minus their `active` nodes are painted once
  into a static bitmap. It stays valid while the camera is unchanged and every node outside
  `active` keeps its identity (an O(n) identity check, ~0.05 ms at 10k). The live layer (active
  nodes, outline layers, JSX nodes) repaints every frame. The app's only part is
  `active={ids being dragged}`.
- **Translation blits**: when the live layer holds 64 or more nodes that only moved by one
  (dx, dy) since they were painted (a drag of a big selection), the canvas blits their bitmap at
  the offset instead of repainting them (a bitmap with a half-canvas margin, of which only the
  visible part is copied). The React baseline does the same by hand (its
  `bitmapCache.ts`, ≥ 300 nodes); here the canvas detects it (an O(k) shallow compare).
- **Dirty regions**: not built. Layers already make a drag O(1) in paint; dirty rectangles would
  help small edits (a colour change) in a huge document, where today the static bitmap repaints
  whole, at the cost of a spatial index and clip bookkeeping. Measure before building.
- **Pan and zoom repaint everything**, because the camera is part of the static bitmap's key: at
  10k shapes fitted that is a full repaint per wheel event (§8 has the numbers). The next step is
  the blit trick for the camera: shift (pan) or scale (zoom) the static bitmap during the gesture
  and repaint crisp at rest, as tiled editors and the React baseline's pan cache do.

**Text measurement.** `measureText(text, font)` uses an OffscreenCanvas (an estimate in Node and
jsdom). The text shape's box follows its text, which today means measuring inside reducers
(finding 8). The canvas should own auto-sized text (`width="auto"` on a node, measured when
painted) and re-measure when `document.fonts` finishes loading.

**Hit testing** is linear over the data layer, topmost first, rotation- and ellipse-exact, clipped
by frames: 0.5 ms per test at 10k in Node, and not run at all while a pointer is captured. A
spatial index (a uniform grid, or rbush as a dependency) would matter from ~50k shapes.

---

## 5. Backend: the own Canvas 2D painter vs Konva vs PixiJS

The same stress document (`perf/backends.ts`, no framework at all) painted and hit-tested by each
backend: the `lib/canvas` painter on Canvas 2D; Konva 10.9 (one `Konva.Rect`/`Ellipse`/`Text` per
shape on a Layer, its hit canvas for picking); PixiJS 8.22 (one `Graphics`/`Text` per shape in a
`Container`, WebGL, its `EventBoundary` for picking). Each timed frame ends with a 1-pixel
read-back, so the GPU's work is inside the number. Medians of 30 frames, 1200 × 800, dpr 1.
`node perf/backends.mjs` (the headless default: WebGL on SwiftShader, Canvas 2D in software) and
`--gpu` (ANGLE on Metal, the M3 Max's GPU).

| backend | shapes | create | frame: move 1 shape | move, layered | pan | hit test / point | JS heap |
|---|---:|---:|---:|---:|---:|---:|---:|
| own Canvas 2D | 1k | 9 ms | 1.0 ms | 0.3 ms | 0.9 ms | 0.004 ms | 0.5 MB |
| Konva | 1k | 21 ms | 2.3 ms | 0.1 ms | 2.7 ms | 0.002 ms | 1.1 MB |
| Pixi, GPU | 1k | 62 ms | 0.8 ms | – | 0.7 ms | 0.088 ms | 5.7 MB |
| own Canvas 2D | 10k | 24 ms | 7.9 ms | 0.3 ms | 7.7 ms | 0.035 ms | 2.9 MB |
| Konva | 10k | 69 ms | 21.5 ms | 0.1 ms | 22.4 ms | 0.002 ms ¹ | 5.4 MB |
| Pixi, GPU | 10k | 220 ms | **1.0 ms** | – | **2.7 ms** | 0.92 ms | 40 MB |
| Pixi, SwiftShader | 10k | 402 ms | 82 ms | – | 85 ms | 0.94 ms | 40 MB |

¹ after a change, Konva redraws its hit canvas on the next hit test: 20.4 ms at 10k.
The own painter on the GPU path (`--gpu`) is the same speed (7.9 ms at 10k, raster-bound); its
"layered" column rises to 2.3 ms there, the read-back from a GPU canvas.

What this says:
- **Konva paints the same Canvas 2D 2.7× slower than the own painter** (per-node transforms,
  attribute lookups, caching checks), with twice the memory, and its retained node graph
  duplicates the state tree: one Konva node per shape, kept in sync by hand. Its strengths
  (Transformer, drag, caching, filters, text) are the things the kit and the canvas already do
  for data nodes, and the React baseline spent a third of its workarounds on the Transformer.
- **Pixi on a GPU wins the raw frame** at 10k (1 ms against 7.9 ms: the GPU rasterizes in
  parallel), and loses everything else: 9× slower to build the scene, 14× the memory, a hit test
  25× slower (a walk of its display objects), WebGL context loss to handle, text as textures
  (blurry until re-rendered at a new zoom), clipping by masks. Without a GPU (VMs, CI, locked-down
  machines, some laptops on battery) it falls to 82 ms a frame.
- **Hit testing on the data is backend-independent** and the fastest of the three. So a backend
  only has to paint: the router, the camera, the layers and the hit test stay in `sygnal/canvas`.

**Recommendation: ship the own Canvas 2D painter as the default backend and make the painter
pluggable.** A backend is `{ mount(canvas), paint(layers, camera, view), dispose }`; hit testing,
routing, culling and the layer cache stay in the subpath. A `sygnal/canvas/pixi` backend (pixi.js
an optional peer, D209) is worth it when documents pass ~20k visible shapes or need filters and
sprites; build it when an app needs it. Don't back the canvas with Konva: it would be a second
scene graph in the way of the data layers, slower at the one job a backend has.

---

## 6. The `sygnal/canvas` API proposal

`lib/canvas/` is the prototype, written as the subpath would be (`index.ts` is its export list).
It needs nothing new from the core: `defineWidget({ children: true })`, `controlled()` and the
`sygnal/three` router's `fire()`. 9.7 KB min+gzip with those two inlined (esbuild), external to the
core, so 0 B for an app that doesn't import it.

### Level 1: the island

```ts
import { Canvas, pointer, toScreen, toWorld, zoomAt, fit, toSVG, measureText } from 'sygnal/canvas'
```

- `<Canvas className camera grid background repaint navigate capture follow>`, filling its host.
  Pan and zoom are built in (wheel, ctrl/⌘-wheel and pinch toward the cursor, space-drag,
  middle-drag); the camera is a controlled value reported by `camerachange`.
- Children, one node vocabulary (box-based: `x y width height rotation`, then `fill stroke
  strokeWidth radius opacity dash`, `text fontSize`, `hidden locked parent`):
  - `<shapes items={nodes} active={ids} outline={color} />`: a data layer. One element; the
    canvas paints, culls and hit-tests the array; `event.hit` is the node's id.
  - `rect ellipse text line path frame g` as JSX: one element per node (components and
    `<Collection>` work), in world space or `space="screen"`; for the few interactive things.
- Events: every pointer event is routed to an element with `world`, `screen`, `hit`, `node`;
  capture as in `sygnal/three` (§3); a miss targets the background.
- Painting: on demand, culled, layered (static bitmap + live layer), translation blits.
- `toSVG(nodes, ids?)`: the same vocabulary as an SVG document, frames as clip paths.

### Level 2: the kit (pure functions and intent helpers, no new concepts)

```ts
import { gesture, snap, snapTargets, history, keymap, handles, resize, rotation, turn, scaleInto } from 'sygnal/canvas'
```

`gesture.start/move/delta` (a press-drag-release as state, with a click-jitter threshold),
`snap`/`snapTargets` (edges and centres, sorted targets per gesture, O(log n) per move),
`history('shapes')` (commit / undo / redo on one field), `keymap(DOM, table)` (named action
streams from a shortcut table, default prevented, never while typing), `handles(box, camera)`
(the selection box, 8 resize handles and the rotate handle as screen-space nodes with `data-part`),
`resize`/`rotation`/`turn`/`scaleInto` (the transform math, rotated boxes included).

### What a developer writes

**A shape** is data in the state tree; nothing per shape in the view:

```tsx
App.initialState = { shapes: [{ id: 'r1', type: 'rect', x: 40, y: 40, width: 120, height: 80, radius: 8, fill: '#0d99ff' }], … }

<Canvas className="board" camera={state.camera}>
  <shapes className="doc" items={state.shapes} active={draggedIds} />
</Canvas>
```

A thing with behaviour of its own (a comment pin) is a JSX node, or a component with an intent:
`<ellipse className="pin" x={p.x} y={p.y} width={12} height={12} fill="#f24822" />`, heard as
`DOM.click('.pin')`.

**A tool** is a branch of the pointer reducers. The rectangle tool, whole:

```ts
App.intent = ({ DOM }) => ({
  DOWN: DOM.select('.board').events('pointerdown').map(pointer),
  MOVE: DOM.select('.board').events('pointermove').map(pointer),
  UP:   DOM.select('.board').events('pointerup').map(pointer),
})
// down: a zero-size shape at the press, and the gesture that sizes it
const shape = make('rect', id, n, { x: p.x, y: p.y, width: 0, height: 0 }, parent)
return { ...s, shapes: insert(s.shapes, shape), selection: [id], gesture: gesture.start('create', p, { before: s.shapes, id }) }
// move: the box from the press to the pointer (shift: a square)
let w = Math.abs(dx), h = Math.abs(dy)
if (p.shift) w = h = Math.max(w, h)
return { ...s, gesture: g, shapes: patch(s.shapes, x => x.id === g.id ? { ...x, x: dx < 0 ? g.from.x - w : g.from.x, y: dy < 0 ? g.from.y - h : g.from.y, width: w, height: h } : x) }
// up: one undo step for the whole gesture, back to the Move tool
return commit({ ...s, gesture: null, tool: 'select' }, shapes, g.before)
```

**A handle** is a node with a `data-part`; a press on it arrives as `p.part`:

```tsx
<rect className="handle" data={{ part: 'se' }} space="screen" x={p.x - 4} y={p.y - 4} width={8} height={8} fill="#fff" stroke="#0d99ff" />
// or the standard set: {handles(selectionBox(state), state.camera)}
DOWN: (s, p) => p.part ? { ...s, gesture: gesture.start('resize', p, { before: s.shapes, box: selectionBox(s), part: p.part, starts }) } : …
MOVE: (s, p) => … patch(s.shapes, x => ({ ...starts[x.id], ...resize(g.box, g.part, p, p.shift) }), ids)
```

### Before and after

`app/` is the version built (on Sygnal as it is, with the canvas written by the app:
`lib/canvas` minus the kit); `app-proposed/` is the same editor on the proposed subpath and its
kit. Both pass the same 12-test suite and `perf/e2e.mjs`. Lines counted as the React baseline
counts them (`node scripts/count-lines.mjs`):

| | built | proposed |
|---|---:|---:|
| document (tree ops, stress, sample page) | 121 | 121 |
| model (tools, snapping, undo, commands, layers, props) | 324 | 271 |
| view, intents, panels | 265 | 221 |
| canvas machinery (island, painter, hit test, router, camera, geometry, snapping, SVG) | 679 | – (the subpath) |
| shell + bench hook + CSS | 115 | 115 |
| **total** | **1,504** | **728** |

The built version's count is high on both sides of fair: `lib/canvas` is written as a library
(it has the Collection-per-shape layer, the transient channel and explicit capture this app's
spec doesn't need, so an app-only canvas would be nearer 450 lines), and `app/` carries ~20
lines of research switches. The app itself is 97 lines shorter, ~75 of them the kit's work:

Shortcuts, before (`app/App.tsx`, 40 lines: a `shortcut(e)` function plus one filter per action):

```ts
export function shortcut(e: any): [string, any?] | null {
  if (TYPING(e.target)) return null
  const mod = e.metaKey || e.ctrlKey, k = (e.key || '').toLowerCase()
  if (mod) {
    if (k == 'z') return [e.shiftKey ? 'REDO' : 'UNDO']
    …                                                    // 20 more lines
}
const keys = DOM.select('document').events('keydown', { preventDefault: e => !!shortcut(e) }).map(shortcut).filter(Boolean)
const key = (a: string) => keys.filter(k => k[0] == a).map(k => k[1])
COPY: key('COPY'), PASTE: key('PASTE'), DUPLICATE: key('DUPLICATE'), …   // one per action
```

after (`app-proposed/App.tsx`):

```ts
const KEYS = {
  'mod+z': 'UNDO', 'shift+mod+z': 'REDO', 'mod+c': 'COPY', 'mod+v': 'PASTE', 'mod+d': 'DUPLICATE', …,
  v: ['TOOL', 'select'], r: ['TOOL', 'rect'], …, delete: 'DELETE', backspace: 'DELETE',
  left: ['NUDGE', { dx: -1, dy: 0 }], 'shift+left': ['NUDGE', { dx: -10, dy: 0 }], …,
}
App.intent = ({ DOM }) => ({ ...keymap(DOM, KEYS), … })
```

Rotation, before (`app/model.ts`, 12 lines of angle math and `norm()`); after:

```ts
const d = rotation(g.box, g.from, p, p.shift ? 15 : 0), c = centre(g.box)
return { ...s, gesture: g, shapes: patch(s.shapes, x => turn(g.starts[x.id], c, d), new Set(g.ids)) }
```

Handles, before: 10 lines placing 8 rects and an ellipse around a rotated box; after:
`out.push(...handles(box, cam, { grips: !moving }))`. History, before: 15 lines; after:
`const h = history('shapes', { after: s => ({ ...s, selection: live(s) }) })`. Resize, before:
the 25-line `resizeBox`; after: `resize(b, part, p, keep)` and `scaleInto(o, b, nb)`.

### Level 3, sketched (not built): an editor behavior

What is left in `app-proposed/model.ts` is mostly the select/move/marquee/resize/rotate machine
(~180 lines) that every box editor has. A behavior could own it:
`App.uses = { editor: canvasEditor({ shapes: 'shapes', selection: 'selection', snap: true, history: 'history' }) }`,
leaving the app its document policy (frames and reparenting, text, the panels). I would wait for
a second app (a diagram editor or a whiteboard) before fixing that policy line: the Figma-lite
alone can't tell what is shared.

### Considered and not proposed

- **Shapes as JSX children per shape** as the main path: measured out above 1k (§2).
- **A Transformer component owning the transform** (Konva's): the transform is the model's
  state (undo, replay, multiplayer), so the kit gives the math and the handles, and the reducer
  owns the gesture.
- **Konva or Pixi node graphs as the scene**: §5.

### Changes to `src/` this suggests (separate proposals; none made here)

1. One pointer router for `sygnal/three` and `sygnal/canvas` (`src/extra/pointer.ts`): capture,
   a background target, the `captured`/`delta` fields (§3).
2. `controlled()` public (or a multi-value form of `defineWidget`'s `value`): the canvas camera
   and the three camera both need it.
3. `defineWidget({ tags })` scoped to the widget's own children (finding 1).
4. A sygnal-check diagnostic when a selector in an intent only matches elements inside a child
   component (finding 5), and a "forward to the parent" shorthand for item actions (finding 6).
5. Widgets in `sygnal/worker` (finding 13).
6. A `Reducer<S, D>` type that accepts `ABORT` (finding 10).
7. In `sygnal/three`'s `<Scene>`: stop the native canvas events at the canvas (finding 2).

---

## 7. Worker and multiplayer

**`sygnal/worker` (optional item).** The editor can't run in it yet: the worker target doesn't run
widgets (its own "not yet" list), and the Canvas is one. It also wouldn't help at 10k: the
model's work per move is ~0.4 ms (`move` 0.12 ms + the layers panel's `rows` 0.26 ms, Node,
`perf/model-cost.cost.ts`); the rest of the main thread's 3 ms is the App render and patch and
the canvas paint, which a worker app would still send back to the page as patch ops, plus a
round trip per `pointermove`. When it matters (50k+ shapes, heavy paints), move the **painter**
instead: it is pure (nodes + camera → pixels), so an OffscreenCanvas in a worker
(`transferControlToOffscreen`) can run the layers and blits, while hit testing stays on the page
over the same data, so input stays synchronous.

**Multiplayer through `sygnal/yjs`** (read on `claude/build-yjs` at 3f061b89, not merged or run
here). It fits this app's shape well:
- `App.uses = { doc: shared({ presence: 'peers', history: 'history' }) }` with the shapes under
  the shared key. The driver diffs each new array by identity and keys, so with structural
  sharing a drag sends only the moved shape, once per flush. Z-order and layer reordering become
  fractional indexes, so concurrent reorders merge.
- The queue path (§3) is what makes peers see a drag as it happens; with `follow` they would see
  the shape jump on release.
- Undo has to move to the shared `history` (Yjs's UndoManager, per client): `undo()` on a shared
  key is SYG260, so the app's own `history('shapes')` goes. The one-step-per-gesture rule then
  needs a capture boundary per gesture (`captureTimeout`, or an explicit one at `UP`): an open
  question for the yjs API.
- Presence carries each peer's selection and cursor; they draw as an outline layer
  (`<shapes items={peerSelection} outline={peer.color} />`) and a JSX node per cursor.
- Two edits to one shape resolve per property, last writer wins (Figma's rule too). The frame
  tree is a `parent` property, so two peers nesting two frames into each other at once can make a
  cycle: a REMOTE repair (break the cycle) is needed.

---

## 8. Against the React + react-konva baseline

The baseline (branch `claude/explore-canvas-react-baseline`, 2e4e0c5e; React 19.3 with the React
Compiler, react-konva 19.3 on Konva 10.9, Zustand, @tanstack/react-virtual) defines a benchmark
contract, `window.__canvasBench`, and a `perf/run.mjs` that drives any app exposing it. The
Sygnal app implements the contract in `sygnal/app/bench.ts`, including its stress grid (40 px
cells, 30 × 30 shapes, rect/ellipse alternating, Mulberry32 fills, zoomed to fit), so **both apps
were measured by the baseline's own script on this machine**, from `git archive` of its branch
into the scratchpad (nothing of it is on this branch). Its method: real CDP input, 120 measured
steps after 10 warm-up steps, **busy** = the renderer main thread's task time per step (two frames
and the tasks between them, so about twice my harness's per-move figure), drag scenarios with 1,
100 or all shapes selected on a wandering path that engages snapping, wheel pan, ctrl-wheel zoom.
Loop overhead (a hover step) was 1.0–1.4 ms in both apps.

{{CONTRACT_TABLE}}

Raw reports: `sygnal/perf/results/contract/*.json` and `*.md` (one per run and app).

**Where React + Konva is better**
- **Big-selection drags and pan at 10k.** It caches the dragged selection as one bitmap and
  translates a Konva group imperatively, outside its store (its workaround 1), and caches the page
  as a bitmap during a camera gesture. Sygnal's queue path still builds 10k new shape objects per
  move for a select-all drag; `follow` (the transient channel) closes most of that gap (the
  transient row), and the camera blit (§4) is the missing piece for pan.
- **Konva's Transformer** gives handles, rotation and multi-node transforms for free (with quirks:
  its workaround 5), and Konva has text layout, filters and caching APIs ready.
- **Types end to end.** The baseline type-checks with `tsc --noEmit`; the Sygnal app leans on `any`
  in intents and `ABORT as any` in reducers (finding 10).
- **Ecosystem and familiarity**: react-virtual, React DevTools, and the fact that most teams can
  read the code already. Its 43 unit tests cover the model functions directly.
- It implements a few things this build doesn't: cut, ⌘[ / ⌘] reorder, ⇧2 zoom to selection,
  collapsible frames in the layers panel, frame-relative coordinates.

**Where Sygnal is better**
- **Memory**: about 5× less JS heap at 10k (9.1 vs 50.1 MB): no node object per shape outside the
  state tree.
- **Startup and generate**: faster to first frame (87 vs 106 ms) and to load a 10k document
  (62 vs 164 ms), and the drop at the end of a drag commits in 33–39 ms against 200 ms (the
  baseline remounts and re-attaches its Transformer to 10k nodes).
- **Zoom**: cheaper per step at 10k.
- **One source of truth during gestures.** The baseline lists nine workarounds (re-render storms,
  an id → Konva node registry, `flushSync` not reaching the Konva reconciler, O(n²) remounts,
  Transformer quirks, the hit graph, ellipse origins, a passive wheel). Sygnal's friction list
  (§1) is about as long but mostly small and local; none of it needed two copies of the document.
- **Tests drive the whole editor.** The Sygnal suite presses, drags and types through the real
  canvas headlessly (jsdom, 26 tests in ~4 s), not only the pure model.

**Lines** (both counted with the baseline's rule: non-blank, non-comment, CSS included):

| | React + Konva | Sygnal, built | Sygnal on the proposed `sygnal/canvas` |
|---|---:|---:|---:|
| document, model, undo, commands | 598 | 445 | 392 |
| interactions, canvas, rendering | 805 | 679 (lib/canvas) + in the model | – (the subpath) |
| panels and view | 266 | 265 | 221 |
| export, shell, bench, CSS | 246 | 115 | 115 |
| **total app** | **1,915** | **1,504** | **728** |

The categories don't line up exactly (Sygnal's interactions live in `model.ts`, React's in hooks),
so compare totals. Like for like, the built Sygnal app writes its own canvas (679 lines, written
as a library; an app-only version would be about 450), where the React app gets Konva and its
Transformer and still writes 303 lines of rendering and 502 of interactions around them. On the
proposed subpath the Sygnal app is 38 % of the React app's size.

---

## Risks

- **A second scene vocabulary.** The node vocabulary (box-based, `radius`, `parent` clipping) is
  close to SVG's names but not SVG: `ellipse` takes `x y width height`, not `cx cy rx ry`. The
  canvas-three spike's `<Canvas2D>` used SVG's. One of the two has to win before anything ships;
  I'd keep this one (editors think in boxes) and say so in the docs.
- **The hidden children are SVG elements with editor props as attributes** (`<rect space="screen"
  data-part …>`): harmless, but the accessibility story (canvas-three Q4) only holds for JSX nodes.
  A data layer is one element: its 10k shapes are invisible to assistive tech and to the agent UI
  snapshot unless the canvas grows a virtual accessibility tree (an `aria` projection of the data
  layer, like the layers panel already is).
- **Throughput depends on structural sharing.** The layer cache, the translation blits and the
  yjs diff all key on node identity. A reducer that rebuilds every shape (`shapes.map(s => ({...s}))`)
  silently turns every frame into a full repaint. A dev-mode check (more than k nodes changed
  identity with equal fields) would catch it.
- **Pan and zoom at 10k** repaint everything per wheel event today (§8); fine on this machine,
  not on a slow one. The camera blit (§4) is needed before shipping.
- **Measurements are from one machine** (M3 Max, headless Chromium, dpr 1) under a background
  load of ~9. CPU throttling ×4 approximates a slower main thread but not a slower GPU; dpr 2
  quadruples the raster work and isn't measured here.
- **Text** is the weakest part of both versions: single-style text, measured with canvas
  metrics, no wrapping. Rich text on a canvas is a project of its own.
- **Konva/Pixi parity** was measured on the backends alone (§5). A Pixi backend inside the app
  would still pay the vnode/state side that §2 measures; only the paint column would change.

## Open questions for the maintainer

1. **The vocabulary**: box-based nodes (this spike) or SVG's (canvas-three's `<Canvas2D>`) for
   `sygnal/canvas`? Or both, with SVG names in JSX and boxes for data layers?
2. **Which level ships first**: the island alone (level 1), or with the kit (level 2)? The kit is
   80 lines of pure functions plus `keymap`, which is useful outside canvases too (should
   `keymap` live in the core's `extra/`?).
3. **One pointer router** for `sygnal/three` and `sygnal/canvas` (`src/extra/pointer.ts`), with
   capture as the three drag work defined it: OK to merge the two now, while both are in the
   dev preview?
4. **The transient channel** (`follow`): ship it as the documented escape hatch, or leave drags to
   the action queue only until an app needs more?
5. **Backends**: is "own Canvas 2D painter, pluggable, a Pixi backend later as an optional peer"
   the direction, or should a WebGL path be in from the start?
6. **An editor behavior** (level 3): worth a second app (a diagram editor or a whiteboard) to find
   the shared policy, or out of scope for Sygnal?
7. **Undo with `sygnal/yjs`**: should `history('shapes')` route to the shared UndoManager when its
   field is shared (one API for both), and how should a gesture mark its undo boundary?
