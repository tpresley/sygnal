/*
 * 'sygnal/canvas' (experimental, 7.2 dev preview; research and the maintainer's decisions:
 * dev-plans/research/canvas-apps): an infinite 2D canvas island for editors, whiteboards and
 * diagrams, plus the editor kit.
 *
 *   import { Canvas, pointer } from 'sygnal/canvas'
 *   <Canvas className="board" camera={state.camera}>
 *     <shapes className="doc" items={state.shapes} active={dragged} />   // a data layer: painted, culled, hit-tested
 *     {handles(selectionBox(state.shapes, state.selection), state.camera)}   // JSX nodes in screen space
 *   </Canvas>
 *   intent: DOWN: DOM.select('.board').events('pointerdown').map(pointer)   // e.hit: the shape's id
 *
 * - Level 1, the island (canvas/Canvas.ts): data layers, JSX nodes, a controlled camera with
 *   built-in pan and zoom, pointer capture through the router sygnal/three shares
 *   (extra/pointer.ts), a static + live layer, translation blits, the camera cache, an
 *   accessibility projection of the data layers, `follow` (the transient escape hatch), the
 *   scroll canvases of a game's camera, images (loaded once per URL; `<Image>` for Suspense).
 * - Level 2, the kit: geometry (screen ↔ world, fit, union, selectionBox, follow() for a game's
 *   camera), gesture, snap, history (sygnal/yjs-aware), handles and the transform math, exportSVG,
 *   measureText / layoutText (wrapped text), frameOf / frameAt (sprite sheets);
 *   `keymap` is the main export's (re-exported here).
 * - The painter is a backend (canvas/backend.ts: canvas2d(), the default).
 * - 'sygnal' stays external (one core per app); no dependencies of its own.
 */
export {Canvas, canvasOf, readChildren} from './canvas/Canvas'
export {canvas2d} from './canvas/backend'
export {exportSVG} from './canvas/svg'
export {measureText, layoutText, hitNodes, paintWorld, paintNode, indexOf} from './canvas/paint'
export {Image, preloadImage, clearImages, frameOf, frameAt} from './canvas/image'
export {
  CAMERA, toWorld, toScreen, zoomAt, panBy, fit, follow, centre, rotate, toLocal, corners, aabb, union,
  overlaps, contains, rectOf, viewport, hitBox, boxOf, selectionBox, positionsOf,
} from './canvas/geometry'
export {pointer} from './canvas/pointer'
export {gesture} from './canvas/gesture'
export {snap, snapTargets} from './canvas/snap'
export {history, handles, resize, rotation, scaleInto, turn, boxPoint, PARTS} from './canvas/kit'
export {keymap} from './index'
export type {Camera, Box, Pt, AABB, FollowOptions} from './canvas/geometry'
export type {Node, TextOptions, TextLayout} from './canvas/paint'
export type {Sheet} from './canvas/image'
export type {Pointer} from './canvas/pointer'
export type {Gesture} from './canvas/gesture'
export type {Guide, Targets} from './canvas/snap'
export type {History} from './canvas/kit'
export type {CanvasBackend, BackendInstance, Frame, PaintLayer, PaintStats} from './canvas/backend'
