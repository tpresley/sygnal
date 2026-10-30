# Canvas-heavy apps: a Figma-lite on Sygnal, and what `sygnal/canvas` should be

Research spike, branch `claude/explore-canvas-apps-30158d` (on `claude/advanced-integration`).
Nothing here touches `src/`: the prototype of the proposed subpath is `sygnal/lib/canvas/`, and the
app is `sygnal/app/`. The React + react-konva baseline of the same spec is to live in
`react-konva/` (branch `claude/explore-canvas-react-baseline`, a cloud session); see §8 for its state.

```bash
cd dev-plans/research/canvas-apps/sygnal
npm install                 # konva + pixi.js, only for the backend comparison (§5)
npm run dev                 # the app (Vite, against src/: no build of the root needed)
npm test                    # 25 tests: the whole editor in jsdom, both versions (§6)
node perf/run.mjs           # §2–§4 in Playwright Chromium from the cache (≈ 25 min, 3 runs)
node perf/backends.mjs [--gpu]   # §5
node perf/e2e.mjs           # real input in real Chromium: pan, zoom, capture, text focus, DnD
npx vitest run --config perf/vitest.cost.mjs   # §7: the model's own cost per move, in Node
```

URL switches: `?shapes=10000` (the stress document), `?render=collection` (one Collection item per
shape), `?input=transient`, `?repaint=full`, `?app=proposed` (the rewrite on the proposed API).

## Summary

{{SUMMARY}}

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

Files (non-blank, non-comment lines):

| | lines | |
|---|---|---|
| `app/doc.ts` | 104 | the document: shapes in one array in tree order; pure tree ops |
| `app/model.ts` | 324 | every reducer: the tool state machine, snapping, history, layers, props |
| `app/App.tsx` | 215 | view, overlay (handles, guides, marquee), intents, the model table |
| `app/LayerRow.tsx` | 49 | a layers-panel row (VirtualCollection item) |
| `lib/canvas/*` | 628 | the canvas island, painter, hit test, router, camera, geometry, snap, SVG export |
| `app/ShapeNode.tsx` | 8 | research only: the per-shape component of `?render=collection` |

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

---

## 2. Per-shape cost: one Collection item per shape vs shapes as data

{{SECTION2}}

---

## 3. High-frequency input: drags through the action queue vs a transient channel

{{SECTION3}}

---

## 4. Viewport and painting

{{SECTION4}}

---

## 5. Backend: the own Canvas 2D painter vs Konva vs PixiJS

{{SECTION5}}

---

## 6. The `sygnal/canvas` API proposal

{{SECTION6}}

---

## 7. Worker and multiplayer

{{SECTION7}}

---

## 8. Against the React + react-konva baseline

{{SECTION8}}

---

## Risks

{{RISKS}}

## Open questions for the maintainer

{{QUESTIONS}}
