# Figma-lite: a canvas editor on sygnal/canvas

A small design editor on `sygnal/canvas` (experimental). The shapes are one array in state, painted, culled and hit-tested by one `<shapes>` data layer: no element or component per shape. A press on a shape is an ordinary DOM event with `event.hit` set to its id, so the whole editor is reducers over plain pointer data.

- Infinite canvas: the wheel pans, ctrl/⌘-wheel and trackpad pinch zoom toward the cursor, space-drag and middle-drag pan; −, +, 100 % and Fit (⌘= ⌘- ⌘0 ⇧1).
- Rectangle, ellipse, text (double-click edits it; the box follows the text) and frame (clips its children; a shape dropped on a frame joins it). Tools from the toolbar or V R O T F.
- Click, shift-click and marquee selection; drag with snapping to other shapes' edges and centres, with guides (⌘ held: no snapping).
- Eight resize handles (shift keeps the aspect ratio; rotated shapes resize in their own frame) and a rotate handle (shift: 15° steps), for one shape or a group.
- A layers panel on `<VirtualCollection>` (a 10,000-row tree renders about 30 rows): select, rename, hide, lock, drag to reorder or into a frame. A properties panel, both ways.
- Undo and redo (one step per gesture), copy, paste, duplicate, delete, arrow nudge, all from one `keymap` table. Export the selection or the page as SVG.
- Stress documents of 1k, 5k and 10k shapes (the toolbar, or `?shapes=10000`).

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # the whole editor in jsdom: the canvas runs headless, raw pointer input at canvas pixels
```

`src/model.ts` is the tool state machine, `src/App.tsx` the view, the overlay (handles, guides, marquee) and the intents, `src/doc.ts` the document's tree operations. `src/bench.ts` installs the benchmark contract that the React + react-konva baseline's `perf/run.mjs` drives (`dev-plans/research/canvas-apps`).

Guide: [Canvas](https://sygnal.js.org/renderers/canvas/).
