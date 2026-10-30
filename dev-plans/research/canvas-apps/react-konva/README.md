# Figma-lite in React 19 + react-konva (baseline)

The React side of the `sygnal/canvas` research comparison: the shared Figma-lite
spec built the way an experienced React developer would in 2026. It uses
React 19 with the React Compiler, react-konva on Konva 10, plain hooks, and
Zustand for the document store. Nothing here imports Sygnal.

The goal is an honest baseline, not a strawman. It uses every performance
technique a competent React + Konva developer would reach for at 10k shapes
(see [Performance techniques](#performance-techniques)), and it lists the
places where the stack fought back (see [Workarounds](#where-react--konva-needed-workarounds)).

| | Version (exact) |
|---|---|
| react, react-dom | 19.3.1 |
| react-konva / konva | 19.3.2 / 10.9.0 |
| zustand | 5.0.16 |
| @tanstack/react-virtual (layers panel) | 3.14.24 |
| vite / @vitejs/plugin-react / babel-plugin-react-compiler | 8.3.5 / 6.1.2 / 1.0.0 |
| vitest / typescript / playwright | 5.0.5 / 6.0.3 / 1.63.0 |

## Run it

```bash
npm install
```

```bash
npm run dev          # http://localhost:5180
```

```bash
npm test             # vitest: selection, snapping, undo, frame hierarchy, export (43 tests)
```

```bash
npm run typecheck    # tsc --noEmit
```

```bash
npm run perf         # vite build, then perf/run.mjs against `vite preview` (see Benchmarks)
```

`?empty` opens a blank page instead of the demo card, and `?nocache` turns off
bitmap caching (see below).

## What is implemented

- **Infinite canvas.** Pan with the wheel or trackpad, space-drag, or the middle
  mouse button. Zoom toward the cursor with ctrl/⌘-wheel or a trackpad pinch.
  The zoom % readout is in the top right; click it or press ⇧1 to zoom to fit,
  and ⇧2 zooms to the selection.
- **Shapes.**
  - Rectangle (with corner radius) and ellipse.
  - Text: double-click to edit; Esc or ⌘↵ commits; an empty text is deleted.
  - Frame: a clipped group. Its children move, rotate and hide with it. A shape
    drawn inside a frame becomes its child, and dragging a shape into or out of
    a frame reparents it (Figma's rule: the frame under the pointer on drop).
- **Tools.** Toolbar buttons and the keys V, R, O, T and F. Click to place a
  default size, or drag to size (shift for a square). The tool returns to Move
  after one shape.
- **Selection.**
  - Click selects; shift-click toggles.
  - Marquee from empty canvas; shift adds to the selection.
  - A click goes to the deepest node, so frame children are directly clickable.
  - A plain click on a member of a multi-selection narrows to it on pointerup if
    you did not drag.
- **Move.** Drag, with smart guides that snap the selection's edges and centre to
  every other visible shape's edges and centres (6 screen px). Hold ctrl/⌘ to
  move without snapping.
- **Resize and rotate.** Konva Transformer handles; shift keeps the aspect
  ratio; rotation snaps at 45° steps. Resizing changes w/h rather than scale, so
  text reflows and a frame's children keep their size.
- **Layers panel (DOM).**
  - A virtualized tree, topmost first, with frames collapsible.
  - Click and shift-click select.
  - Double-click renames.
  - Drag to reorder: the top or bottom of a row places above or below it, and
    the middle of a frame row drops inside the frame.
  - Hide and lock per row. Locked and hidden nodes cannot be picked on the canvas.
- **Properties panel (DOM).**
  - X, Y, W, H, rotation, corner radius, opacity, fill, stroke and stroke width,
    plus font size for text.
  - Mixed values show "Mixed".
  - Fields commit on Enter or blur, as one undo step; ↑/↓ steps by 1, or 10 with shift.
  - X and Y follow a drag live.
- **Editing.**
  - Undo: ⌘Z / ctrl+Z. Redo: ⇧⌘Z or ctrl+Y.
  - Copy / cut / paste (⌘C/X/V; pastes cascade by 10 px), duplicate (⌘D),
    delete (⌫ / Del), select all (⌘A).
  - Arrow keys nudge by 1, or 10 with shift. ⌘] and ⌘[ raise and lower.
- **Export to SVG.** "Export selection" and "Export page" download an SVG built
  from the model (not from Konva). It is cropped to the content, frames become
  `<clipPath>` groups, and a frame child exported alone keeps its frame's transform.
- **Stress mode.** The toolbar's 1k / 5k / 10k buttons replace the page with a
  deterministic grid and zoom to fit.

## Line count per concern

Non-blank, non-comment lines (`npm run lines`):

| Concern | Files | Lines |
|---|---|---:|
| State (model + stores) | `model/types.ts`, `model/geometry.ts`, `model/doc.ts`, `store/view.ts`, `model/stress.ts` | 432 |
| Undo + editing commands (store) | `store/editor.ts` | 166 |
| Canvas rendering (Konva) | `canvas/CanvasStage.tsx`, `canvas/Layers.tsx`, `canvas/NodeView.tsx`, `canvas/registry.ts`, `canvas/bitmapCache.ts` | 303 |
| Interactions (pointer, snapping, hit testing, text editing, shortcuts) | `canvas/useCanvasGestures.ts`, `model/selection.ts`, `model/snapping.ts`, `canvas/TextEditor.tsx`, `useShortcuts.ts` | 502 |
| Panels (toolbar, layers, properties) | `panels/Toolbar.tsx`, `panels/LayersPanel.tsx`, `panels/PropertiesPanel.tsx` | 266 |
| Export (SVG) | `model/svg.ts` | 67 |
| App shell + bench hook | `App.tsx`, `main.tsx`, `bench.ts`, `styles.css` | 179 |
| **Total app** | | **1915** |
| Tests | `test/*.ts` | 398 |
| Perf script | `perf/run.mjs` | 256 |

About 540 of those lines are framework-independent: the geometry, tree
operations, hit testing, snapping and SVG export in `src/model/` hold no React
or Konva code. The Sygnal version could reuse them unchanged, which keeps the
comparison about the framework parts.

## Architecture

- **Document model** (`src/model/`). An immutable tree:
  `{ nodes: Record<id, SceneNode>, root: id[] }`. Each frame has `children`
  (z-order, bottom first), and each node has `parentId`. A child's x/y/rotation
  are in its frame's space, so a frame moves its subtree for free. All edits are
  pure functions with structural sharing.
- **Stores.**
  - `useEditor` (Zustand) holds what undo covers, `{ doc, selection }`, plus the
    tool, the history stacks and the clipboard. Undo is snapshot based: a
    snapshot is the previous `{ doc, selection }` pair, which costs one object
    spread thanks to structural sharing. 200 steps are kept.
  - Transient UI state lives in three more tiny Zustand stores, split by how
    often they change: `useCamera` changes per wheel event, `useOverlay` per
    drag frame (guides, marquee, draft, drag delta), and `useSession` a few
    times per gesture (`dragging`, `editingTextId`, space held).
  - The split matters: the 10k per-node subscriptions sit on `useEditor` and
    `useSession` only, so they are not re-run on every mouse move.
- **Canvas** (`src/canvas/`). One `<Stage>` with three layers, each its own `<canvas>`:
  1. the static layer, with every node as a memoized `<NodeView id>` that subscribes to its own node;
  2. the drag layer, holding copies of the dragged nodes while a drag runs;
  3. the overlay, holding the Transformer, guides, marquee and drag box.
- **Interactions** (`useCanvasGestures.ts`). One pointer state machine on the
  canvas container: pan, press, drag, marquee and create. Hit testing is pure
  geometry (`model/selection.ts`), not Konva's hit graph.

## Where React + Konva needed workarounds

Each item below is something an experienced developer would hit. The fixes are
the standard ones, and each costs code you would not write for a plain DOM app.

1. **Re-render storm during drag.** The obvious version (store positions in
   state, `setState` on every `pointermove`) re-renders the dragged nodes and
   everything subscribed to them on every frame. That means the panels, plus
   10k selector runs per frame. So the drag is imperative instead:
   - the dragged nodes are copied into the drag layer once;
   - each frame sets `group.position(delta)` on a Konva ref and calls `batchDraw()`;
   - the store sees one commit on drop.

   The properties panel still shows X/Y live by reading the transient
   `dragDelta` from `useOverlay`. The cost is two sources of truth during a drag
   (the Konva node and the store), kept apart by hand.
2. **Imperative Konva refs.** The Transformer needs live `Konva.Node`s, which
   react-konva only exposes through refs. An id → node registry (`registry.ts`)
   is filled by React 19 ref callbacks with cleanup. While a drag runs, a node
   exists twice (the hidden original and the drag copy), so only the static
   instance registers. Otherwise the copy's unmount would leave the registry
   empty.
3. **`flushSync` does not reach the canvas.** react-konva renders the Stage's
   children with its own reconciler root, so react-dom's `flushSync` does
   nothing to them. Drag start must commit the drag-layer copies before it
   caches and moves the group, which needs
   `KonvaRenderer.flushSyncFromReconciler(...)` (`useCanvasGestures.ts`). This
   one cost real debugging time: the group was silently empty.
4. **O(n²) when thousands of nodes change parent.** The first version unmounted
   the dragged nodes from the static layer and remounted them after the drop.
   Dropping a 10k selection took **4.1 s**. Two quadratic costs caused it:
   - React's `getHostSibling` walks thousands of null-rendering siblings for each insertion;
   - Konva's `Container._remove` re-indexes all remaining children on each removal.

   The fix: the originals stay mounted with `visible={false}`, and the drag
   copies sit under a `<Group key={dragSession}>`, so React mounts and removes
   them as one subtree. The drop now takes 0.9 s; most of what is left is the
   Transformer attaching listeners to 10k nodes.
5. **Transformer quirks.**
   - It resizes by setting `scaleX/scaleY`. Text would stretch, and a frame
     would scale its children. `bakeScale` converts scale back into
     width/height (or radii, or the clip rect) on every `transform` event,
     per node type.
   - `Group.getClientRect()` ignores `clip`, so the box around a frame would
     wrap overflowing children. Frame groups override `getClientRect` to report
     their own rect.
   - On a small selection (a 30 px shape at 19 % zoom is 6 px) the anchors cover
     the shape, and pressing it resizes instead of moving. Below 24 screen px
     the anchors and the rotater are disabled, as Figma does.
   - It only follows its nodes through their own `absoluteTransformChange`.
     Moving an ancestor (the drag group) does not update it, and
     `forceUpdate()` per frame is O(selection). It is detached during a drag;
     the overlay draws a plain box instead.
   - `tr.nodes(10k nodes)` attaches several listeners per node, about 150 ms for
     a select-all at 10k.
   - Its anchors are Konva shapes, so the overlay layer must listen. Before our
     own gesture starts, `getIntersection` tells whether the press was on a handle.
6. **Konva's hit graph.** Every listening layer draws a second, hit canvas,
   which roughly doubles draw cost. All shape layers use `listening={false}` and
   picking is done in geometry (rotation-aware, ellipse-exact, clip-aware). That
   is more code, but the code is portable and testable.
7. **Ellipse origin.** Konva centres ellipses on x/y. `offsetX/offsetY = -r`
   gives every shape the same top-left origin, so x/y/rotation, snapping and
   export mean the same thing for every type.
8. **Text editing.** Konva has no editable text. A DOM `<textarea>` is laid over
   the node with the same CSS `matrix()`, and its height is measured with an
   offscreen `Konva.Text` on commit. This is the approach the Konva docs show.
9. **Passive wheel.** React's `onWheel` is passive, so `preventDefault()`
   (needed to stop page zoom on pinch) requires a native listener with
   `{ passive: false }`.

## Performance techniques

Used:

- **React Compiler** (babel-plugin-react-compiler 1.0) on everything, plus
  explicit `memo` on `NodeView`, the layers and the rows.
- **Per-node subscriptions.** Each `NodeView` selects `s.doc.nodes[id]`. With
  structural sharing, an edit re-renders only the changed nodes. Layer
  components take no props, so a camera change re-renders `<Stage>` and nothing below it.
- **Stores split by update frequency** (see Architecture), so per-frame state
  never wakes the 10k node subscribers.
- **Layer separation.** Static, drag and overlay are separate canvases. During
  a drag the static canvas is not redrawn at all.
- **Imperative per-frame updates** through Konva refs: drag-group translation
  and `batchDraw()`. Konva coalesces draws to one per frame.
- **Bitmap caching** (`bitmapCache.ts`), on by default and off with `?nocache`:
  - **Drag.** A selection of 300 or more nodes is cached once at screen
    resolution (`group.cache({ pixelRatio: zoom × dpr })`). Each frame then
    blits one bitmap.
  - **Pan and zoom.** With 300 or more nodes, the page content group is cached
    on the first camera change and released 150 ms after the last. Zoom frames
    show the bitmap scaled, slightly soft, until the crisp redraw. That is the
    same trade tiled editors make.
  - Caching is skipped when the bitmap would exceed 8192 px a side or 24 MP
    (a large selection zoomed in), falling back to plain redraws.
- **`listening: false`** on every shape layer (no hit canvas), plus
  `perfectDrawEnabled: false` (no offscreen buffer for fill + stroke + opacity)
  and `shadowForStrokeEnabled: false` on every shape.
- **Snapping in O(log n) per frame.** Targets are built once per drag as sorted
  `Float64Array`s and binary-searched each frame. A test checks it stays under
  0.5 ms against 10k shapes.
- **Virtualized layers panel** (@tanstack/react-virtual). With 10k rows, only
  about 40 are in the DOM. Rows test selection through a memoized `Set`.

Considered, not used:

- **Viewport culling** (render only on-screen nodes). At the benchmark's
  zoom-to-fit, every shape is on screen, so culling would not change the
  measured numbers. It would help a zoomed-in pan over a large page.
- **WebGL renderers** (Pixi and others) and **OffscreenCanvas in a worker.**
  These are not what a React + Konva app uses.
- **Konva `FastLayer`.** It is deprecated in favour of `listening(false)`, which is what we use.

## Benchmarks

### Contract: what `perf/run.mjs` drives

The script only talks to `window.__canvasBench` (`src/bench.ts`), so it can
measure the Sygnal app unchanged if that app exposes the same object:

```ts
window.__canvasBench = {
  version: 1,
  framework: 'react-konva',               // goes into the report's file name
  generate(n): Promise<void>,             // replace the page with the stress grid, zoom to fit, resolve once painted
  select(count | 'all'): Promise<void>,   // select the first `count` top-level shapes (document order, bottom first)
  dragPoint(): { x, y },                  // page coords of a point on a selected shape, away from resize handles
  canvasCenter(): { x, y },               // page coords of the canvas centre
  count(): number,                        // shapes in the document
  frame(): Promise<void>,                 // resolves after the next frame
}
```

The stress grid (`src/model/stress.ts`) is part of the contract:
- n top-level shapes on a `ceil(sqrt(n))`-column grid with 40 px cells;
- each shape 30×30, alternating rectangle (corner radius 4) and ellipse, with no stroke;
- fills from a seeded Mulberry32 (seed 1) as `hsl(h, 70%, 60%)` in hex;
- after generating, the camera zooms to fit with 40 px padding.

At 1440×900 the canvas is 960×856 px (240 px panels on either side, 44 px
toolbar), so at 10k shapes the zoom is about 19 % and every shape is on screen.

Drag scenarios select 1, 100 or all shapes, press at `dragPoint()`, cross the
drag threshold, then move along a fixed wandering path (±160×110 px), so
snapping engages and releases. ⌘/ctrl-Z after each scenario restores the page.

### Method

- Chromium through Playwright, 1440×900 viewport, `deviceScaleFactor: 1`.
  Input is real CDP mouse/wheel input, so each app receives it however it
  listens.
- Each scenario runs 10 warm-up steps and then 120 measured steps. A step is
  one input event; then the script waits for two `requestAnimationFrame`s and
  the tasks between them.
- **busy** is the renderer main thread's task time for the step, from the CDP
  `Performance.getMetrics` `TaskDuration` delta. It covers handlers, framework
  work, canvas drawing, and style/layout/paint recording. This is the frame
  cost, and the primary metric.
- **wall** is the time from sending the input until the step settles. Headless
  Chromium runs frames at 60 Hz whatever the flags (`--disable-frame-rate-limit`
  and `--disable-gpu-vsync` have no effect there), and acknowledges input on the
  next frame. So wall time comes in ~16.7 ms quanta. It shows dropped frames,
  not small differences.
- The report also gives the loop's own cost, measured as hover moves with no
  gesture. Subtract it to compare work done.
- **Startup** is the median of 5 fresh loads: time from navigation to
  `__canvasBench` existing plus one frame, and FCP.
- **Heap** is `JSHeapUsedSize` after a forced GC (CDP), on the initial page and
  after each `generate(n)`.
- **Drop** is the time from releasing the mouse until the step settles: the
  commit back into the document, with its re-renders.

### Running it on another machine

```bash
npm install && npm run build
```

```bash
node perf/run.mjs                                   # serves ./dist itself with `vite preview` on a free port
```

```bash
node perf/run.mjs --url http://localhost:4173/      # any app implementing the contract
```

```bash
node perf/run.mjs --url 'http://localhost:4173/?nocache' --sizes 10000 --only drag
```

`node perf/run.mjs --help` lists the options: `--sizes`, `--selections`,
`--steps`, `--warmup`, `--startup-runs`, `--viewport`, `--dpr`, `--cpu`
(CDP throttling), `--only` (startup, drag, pan, zoom, heap), `--out`,
`--executable` (or `CHROMIUM_PATH`) and `--headed`.

Playwright is pinned to 1.63.0 to match the Chromium build in the Sygnal repo's
`browser-tests/` and `benchmarks/` (chromium-1243). On a machine without that
build, run `npx playwright install chromium`, or pass `--executable`.

Each run writes `perf/results/<framework>-<date>.json` (every sample statistic
plus the machine and browser) and a `.md` table next to it.

### Results in the cloud container

RESULTS_PLACEHOLDER

## Simplifications versus Figma

These are known gaps, kept small on purpose; the Sygnal build should make the
same choices:

- The marquee selects top-level nodes only.
- Frames have no auto-layout or constraints, and resizing a frame never moves its children.
- A multi-selection that mixes rotations is resized as one box (Konva's
  multi-node transform), which can skew rotated children visually until the
  transform ends.
- During a drag, the dragged nodes draw above everything else (they are in the
  drag layer), and a dragged frame child is not clipped by its frame until the drop.
- The clipboard is in-app, not the system clipboard.
- Layer reordering uses HTML5 drag and drop, with no keyboard reordering beyond ⌘[ / ⌘].
- Text has one style per node (font size and fill), and its box height is
  measured on commit.
