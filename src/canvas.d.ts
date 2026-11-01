// 'sygnal/canvas' (experimental, 7.2 dev preview): an infinite 2D canvas island and the editor kit.
// Guide: https://sygnal.js.org/renderers/canvas
import type { Widget, VNode, ABORT } from 'sygnal'

export { keymap } from 'sygnal'

/** The camera: the world point at the canvas's top-left corner, and the scale (`screen = (world - camera) * zoom`) */
export interface Camera { x: number; y: number; zoom: number }
/** A box: top-left corner and size in world units, rotation in degrees about its centre */
export interface Box { x: number; y: number; width: number; height: number; rotation?: number }
export interface Pt { x: number; y: number }
/** An axis-aligned bounding box */
export interface AABB { x0: number; y0: number; x1: number; y1: number }

/**
 * A node: plain data in one box-based vocabulary for data layers and JSX nodes alike (not SVG's:
 * an ellipse is its box, not cx cy rx ry).
 * - `rect` (`radius`), `ellipse`, `frame` (a rect that clips the nodes whose `parent` is its id,
 *   its `name` drawn above it), `line` (`x1 y1 x2 y2`), `path` (`d`)
 * - `text` (`text fontSize fontFamily fontWeight`): wraps to its `width` (`wrap`, `maxLines`,
 *   `ellipsis`, `align`, `lineHeight`); without a width, one line per `\n`. A missing width /
 *   height is the laid-out text's
 * - `image` (`src` or `image`, the crop `sx sy sw sh`, `fit`, `flipX` / `flipY`, `smoothing`,
 *   `alt`): painted once loaded; a missing width / height is the crop's natural size
 * - `hidden`: not painted, not hit; `locked`: painted, not hit; `pointerEvents: 'none'`: not hit
 * - `label` / `name` / `alt`: the accessible name of the node's projection
 */
export interface Node {
  id?: string | number;
  type: 'rect' | 'ellipse' | 'text' | 'frame' | 'line' | 'path' | 'image' | (string & {});
  x?: number; y?: number; width?: number; height?: number; rotation?: number;
  fill?: string; stroke?: string; strokeWidth?: number; radius?: number; opacity?: number; dash?: number[] | null;
  text?: string; fontSize?: number; fontFamily?: string; fontWeight?: number | string;
  /** text: where lines break when the node has a width ('word' default: at spaces and after hyphens, a longer word overflows as in the DOM; 'char': anywhere; 'none') */
  wrap?: 'word' | 'char' | 'none';
  /** text: at most this many lines; the last one kept ends in '…' unless `ellipsis: false` */
  maxLines?: number;
  /** text: '…' where it is cut (default true for `maxLines`; with `wrap: 'none'`, `true` cuts lines wider than the box) */
  ellipsis?: boolean;
  /** text: within the box (its width, else the widest line's) */
  align?: 'left' | 'center' | 'right';
  /** text: the line box as a multiple of fontSize (default 1.25) */
  lineHeight?: number;
  /** image: its URL (loaded once per URL and `crossOrigin`, shared by every canvas) */
  src?: string;
  /** image: a source the app loaded or drew (an <img>, ImageBitmap, canvas, video), painted as it is */
  image?: CanvasImageSource;
  /** image: the CORS mode of its load ('anonymous', 'use-credentials'): a cross-origin image the canvas can still export */
  crossOrigin?: string;
  /** image: the crop in image pixels (default: the whole image) */
  sx?: number; sy?: number; sw?: number; sh?: number;
  /** image: the crop into the box as CSS object-fit (centred; default 'fill') */
  fit?: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
  /** image: mirrored within its box (a sprite facing the other way) */
  flipX?: boolean; flipY?: boolean;
  /** image: `false` scales it without smoothing (pixel art; CSS `image-rendering: pixelated`) */
  smoothing?: boolean;
  /** image: its accessible name (the projection's label when there is no `label` / `name`) */
  alt?: string;
  x1?: number; y1?: number; x2?: number; y2?: number; d?: string;
  hidden?: boolean; locked?: boolean; parent?: string | number | null; name?: string; label?: string;
  [key: string]: any;
}

/** The props `<Canvas>` takes (and the host props: `className`, `style`, `role`, `aria-*`, …) */
export interface CanvasProps {
  /** the camera, controlled: written when the app changes it, never for its own `camerachange` echoes */
  camera?: Camera;
  /** canvas size in CSS pixels (default: the host's size, observed; `canvasresize` reports it) */
  width?: number;
  height?: number;
  background?: string;
  /** a pixel grid from 400 % zoom */
  grid?: boolean;
  /** `'layers'` (default): a static layer + a live layer, blits, the camera cache; `'full'`: repaint everything every frame */
  repaint?: 'layers' | 'full';
  /** built-in pan and zoom (wheel, ctrl/⌘-wheel and pinch, space-drag, middle-drag, two-finger touch); default true. A game passes false (Space is its jump) */
  navigate?: boolean;
  /** the accessibility projection's default for every layer (a layer's own `a11y` wins); `0` turns it off for the canvas (a game) */
  a11y?: number;
  /** `'all'` (default): every press captures the pointer; `'explicit'`: only a `capture` prop or `setPointerCapture()` in a pointerdown listener */
  capture?: 'all' | 'explicit';
  /**
   * The transient channel, the escape hatch for very large selections: while set and a pointer is
   * captured, the data nodes `ids` follow the pointer by (world − from), mapped by `map`, painted by
   * the canvas with no `pointermove` to the app; the app commits on `pointerup`.
   */
  follow?: { ids: readonly (string | number)[]; from: Pt; map?: (dx: number, dy: number) => [number, number] } | null;
  /** the painter (default `canvas2d()`) */
  backend?: CanvasBackend;
  /** no painting (jsdom, a host document: the default when there is no 2D context); hit testing and events work */
  headless?: boolean;
  /** after each paint (benchmarks, devtools) */
  onPaint?: (stats: PaintStats & { paints: number; events: number; first: number }) => void;
}

/** What the canvas puts on the DOM events it dispatches */
export interface CanvasEventFields {
  /** the pointer in world coordinates */
  world: Pt;
  /** the pointer in canvas pixels */
  screen: Pt;
  /** the data node's id (a data layer's hit; while captured, the press's), else null */
  hit: string | number | null;
  /** the node's data (a data layer's node or the JSX node's props) */
  node: Node | null;
  /** captured events (between `gotpointercapture` and `lostpointercapture`) */
  captured?: true;
  /** captured events: the world move since the press */
  delta?: Pt;
}

/**
 * `<shapes items active outline />` (a data layer: one element, its nodes painted, culled and
 * hit-tested; `event.hit` is the node's id) and the node tags `rect ellipse text line path frame
 * image g` (one element each, world space or `space="screen"`) as children. `camerachange` (detail:
 * the camera, at most once a frame), `canvasresize` (detail: { width, height }), `imageload` /
 * `imageerror` (detail: { src, error? }: an image a layer names arrived or failed; the canvas has
 * repainted with it).
 */
export const Canvas: Widget<CanvasProps, CanvasInstance, 'camerachange' | 'canvasresize' | 'imageload' | 'imageerror'>

/**
 * `<Image src x y width height … />` inside `<Canvas>`: an image node whose load `<Suspense>` waits
 * for (the load starts while the view renders); a failed load throws in the view (the component's
 * `onError`). Every other prop is the node's (`sx`, `fit`, `alt`, …). `Image.preload(src)`,
 * `Image.clear(src?)`. Data layers need no tag: an `image` item loads when a canvas shows it.
 */
export const Image: ((props: Omit<Node, 'type'> & { src: string; key?: any; className?: string }) => JSX.Element) & {
  preload(src: string, options?: { crossOrigin?: string | null }): Promise<void>;
  clear(src?: string): void;
}
/** start loading an image ahead (a title screen); resolves when it has loaded or failed */
export function preloadImage(src: string, options?: { crossOrigin?: string | null }): Promise<void>
/** forget cached images (one src, or all): a failed load is tried again when next shown */
export function clearImages(src?: string): void
/** A sprite sheet: frames of one size, `columns` to a row, `margin` around them and `spacing` between (Phaser's spritesheet) */
export interface Sheet { src: string; frameWidth: number; frameHeight: number; columns: number; margin?: number; spacing?: number; crossOrigin?: string }
/** frame `index` of `sheet` as an image node's fields, to spread into it: `{ type: 'image', x, y, width, height, ...frameOf(SHEET, 3) }` */
export function frameOf(sheet: Sheet, index: number): { src: string; sx: number; sy: number; sw: number; sh: number; crossOrigin?: string }
/** the frame an animation shows at `t`: `frames` in turn, `every` steps (or ms) each; `loop: false` holds the last. Pure, so a replay shows the same frame */
export function frameAt(frames: readonly number[], t: number, every?: number, loop?: boolean): number

/** The props of `<shapes>`, a data layer inside `<Canvas>` */
export interface ShapesProps<N extends Node = Node> {
  className?: string;
  /** the nodes, in paint order (the last is on top). Keep the identity of nodes that didn't change (SYG262) */
  items: readonly N[];
  /** ids of nodes that change every frame (a drag): painted live, so the rest stays cached */
  active?: readonly (string | number)[] | null;
  /**
   * every node changes every frame (a game's actors, particles): the whole layer is painted live
   * (no ids needed), has no accessibility projection unless `a11y` says so, and isn't checked for
   * SYG262. Layers paint in their order: a live layer under a static one stays under it
   */
  live?: boolean;
  /**
   * the layer scrolls at `f` times the camera (`[fx, fy]` per axis): a background far away (0.5),
   * a foreground near (1.5). Hit testing sees it where it is drawn; a static parallax layer is
   * cached like any other
   */
  parallax?: number | [number, number];
  /** paint every node's outline (1 screen px) in this colour; never hit (selection outlines, peers) */
  outline?: string;
  /** the accessible name of the layer's projection (default 'Shapes') */
  'aria-label'?: string;
  /** how many nodes in view the accessibility projection lists (default 100; 0 turns it off) */
  a11y?: number;
}
declare global {
  namespace JSX {
    interface IntrinsicElements {
      shapes: ShapesProps<any>;
    }
  }
}

/** The mounted canvas (`canvasOf(hostElement)`): tests, benchmarks, devtools */
export interface CanvasInstance {
  readonly canvas: HTMLCanvasElement;
  readonly camera: Camera;
  readonly headless: boolean;
  readonly st: PaintStats & { paints: number; events: number; first: number };
  /** raw input at canvas pixels, as a real pointer: 'move' | 'down' | 'up' | 'cancel' | 'leave' | 'dblclick' | 'contextmenu' */
  pointer(kind: string, x: number, y: number, init?: Record<string, any>): any;
  /** paint now (not on the next frame) */
  paintNow(): void;
  /** rebuild the accessibility projection now (it follows a microtask after a change) */
  project(): void;
  toWorld(sx: number, sy: number): Pt;
  toScreen(wx: number, wy: number): Pt;
  size(): { width: number; height: number };
}
export function canvasOf(host: Element | null | undefined): CanvasInstance | undefined
export function readChildren(container: VNode | any): { layers: any[]; live: any[]; props: Map<any, Node> }

// ---------------------------------------------------------------- backends

export interface PaintLayer { items: readonly Node[]; active: Set<any> | null; outline?: string; live?: boolean; parallax?: [number, number] | null }
export interface Frame {
  camera: Camera; width: number; height: number; dpr: number;
  background: string; grid: boolean; repaint: 'layers' | 'full';
  layers: PaintLayer[];
  /** screen-space nodes, painted last in canvas pixels */
  overlay: Node[];
  follow: { ids: Set<any>; dx: number; dy: number } | null;
  /** the camera is in a gesture: a zoom may scale the cached bitmap, the crisp repaint follows at rest */
  moving: boolean;
}
export interface PaintStats {
  nodes: number; culled: number; ms: number; blits: number; cached: number; shifted: number; scaled: number; statics: number;
  /** static runs on scroll canvases that only moved (a CSS transform, no pixels) */
  scrolled?: number;
  /** scroll canvases that reached the edge of what they had: shifted once, only the newly exposed strips painted */
  strips?: number;
}
export interface BackendInstance {
  paint(frame: Frame, stats: PaintStats): void;
  /** the canvas's bitmap was resized (and so cleared) */
  resized?(): void;
  /** what nodes show changed without the nodes changing (an image arrived): repaint what is cached */
  refresh?(): void;
  dispose?(): void;
}
/** A painter: `(canvas) => instance`, or null without a context (the canvas then runs headless) */
export type CanvasBackend = (canvas: HTMLCanvasElement) => BackendInstance | null
/** The own Canvas 2D painter (the default) */
export function canvas2d(): CanvasBackend

// ---------------------------------------------------------------- geometry

export const CAMERA: Camera
export function toWorld(camera: Camera, sx: number, sy: number): Pt
export function toScreen(camera: Camera, wx: number, wy: number): Pt
/** the camera zoomed to `zoom` with the world point under screen (sx, sy) kept in place */
export function zoomAt(camera: Camera, zoom: number, sx: number, sy: number, min?: number, max?: number): Camera
export function panBy(camera: Camera, dsx: number, dsy: number): Camera
/** the camera showing `bounds` inside a width × height canvas with `pad` screen pixels around it */
export function fit(bounds: AABB | null, width: number, height: number, pad?: number, maxZoom?: number): Camera
export interface FollowOptions {
  /** the canvas size in CSS pixels */
  width: number; height: number;
  /** a box around the anchor (screen pixels) the target moves in freely; the camera moves only when it leaves */
  deadzone?: { width?: number; height?: number };
  /** where the target sits relative to the view's centre (screen pixels): `{ x: -100 }` keeps it left of centre, a look-ahead */
  offset?: { x?: number; y?: number };
  /** the share of the way the camera moves per call, 0–1 (`[x, y]` per axis; default 1: at once) */
  lerp?: number | [number, number];
  /** the time since the last call (ms): `lerp` is then per 1/60 s, so a variable frame time eases the same */
  dt?: number;
  /** the world the camera never shows past (a level's bounds); a world smaller than the view is centred */
  bounds?: AABB | null;
  /** whole screen pixels (pixel art): the camera moves at least a pixel while it has a pixel to go */
  round?: boolean;
}
/**
 * The camera after one step of following `target` (a point, or a box: its centre), as Phaser's
 * `startFollow` and Godot's Camera2D do: dead zone, look-ahead offset, smoothing, world bounds. Pure:
 * the model calls it each step with the camera in state and stores the result (the same object
 * when it didn't move), so a run replays to the same pixel
 */
export function follow(camera: Camera, target: Pt | Box, options: FollowOptions): Camera
export function centre(b: Box): Pt
export function rotate(p: Pt, origin: Pt, deg: number): Pt
export function toLocal(b: Box, p: Pt): Pt
export function corners(b: Box): Pt[]
export function aabb(b: Box): AABB
export function union(boxes: readonly Box[]): AABB | null
export function overlaps(a: AABB, b: AABB): boolean
export function contains(a: AABB, b: AABB): boolean
export function rectOf(p: Pt, q: Pt): AABB
/** the visible world rectangle of a width × height canvas */
export function viewport(camera: Camera, width: number, height: number): AABB
export function hitBox(b: Box & { type?: string }, p: Pt, slop?: number): boolean
export function boxOf(a: AABB): Box
/** one node's own (rotated) box, or the bounds of several; null when none of `ids` is in `nodes` */
export function selectionBox(nodes: readonly (Box & { id?: any })[], ids: Iterable<any>): Box | null
/**
 * id → index of a node array, once per array. An array that differs from `prev` only in nodes that
 * keep their id (a drag's new array) shares prev's map after identity checks: no map of n ids per
 * change. The canvas keeps one per data layer; selectionBox uses it when there is one
 */
export function positionsOf(items: readonly { id?: any }[], prev?: readonly { id?: any }[] | null): Map<any, number>

// ---------------------------------------------------------------- painting, hit testing, export

/** How text lays out: the font, and the box's width it wraps to (a text node's own fields) */
export interface TextOptions {
  fontSize?: number; fontFamily?: string; fontWeight?: any;
  width?: number | null; wrap?: 'word' | 'char' | 'none'; maxLines?: number | null; ellipsis?: boolean; lineHeight?: number;
}
export interface TextLayout { lines: string[]; width: number; height: number; lineHeight: number }
/** text's lines and size in world units, as a text node paints them: wrapped to `width`, cut to `maxLines` (`width` / `height`: the widest line's and the lines') */
export function layoutText(text: string, options?: TextOptions): TextLayout
/** text's natural size (one line per `\n`, unwrapped): an auto-width text box's; the node itself may be passed (its width is ignored) */
export function measureText(text: string, font?: { fontSize?: number; fontFamily?: string; fontWeight?: any; lineHeight?: number }): { width: number; height: number }
/** the topmost node at world point p (frames clip their children) */
export function hitNodes(items: readonly Node[], p: Pt, slop?: number): Node | null
export function paintWorld(ctx: CanvasRenderingContext2D, items: readonly Node[], camera: Camera, dpr: number, view: AABB | null, skip?: Set<any> | null, stats?: PaintStats): void
export function paintNode(ctx: CanvasRenderingContext2D, node: Node, unit?: number): void
export function indexOf(items: readonly Node[]): Map<any, Node>
/** the nodes (`ids`: only these and their descendants) as an SVG document; frames clip as on the canvas */
export function exportSVG(items: readonly Node[], ids?: readonly any[] | null, pad?: number): string

// ---------------------------------------------------------------- the kit

/** A canvas event as plain data for an intent: `DOM.select('.board').events('pointerdown').map(pointer)` */
export interface Pointer {
  /** world */
  x: number; y: number;
  /** canvas pixels */
  sx: number; sy: number;
  /** the data node's id, or null */
  hit: any;
  /** the `data-part` of the JSX node hit (a handle), or null */
  part: string | null;
  shift: boolean; alt: boolean;
  /** ⌘ on macOS, Ctrl elsewhere */
  mod: boolean;
  button: number;
}
export function pointer(e: Event | Record<string, any>): Pointer

/** A press-drag-release gesture as state */
export type Gesture<D = {}> = { kind: string; from: Pt; at: Pt; moved: boolean; shift: boolean; alt: boolean } & D
export const gesture: {
  start<D>(kind: string, p: Pt & { shift?: boolean; alt?: boolean }, data?: D): Gesture<D>;
  /** `moved` turns true past `slop` screen pixels (a click that jitters is no drag) */
  move<G extends Gesture>(g: G, p: Pt & { shift?: boolean; alt?: boolean }, zoom?: number, slop?: number): G;
  delta(g: Gesture): { dx: number; dy: number };
}

export interface Targets { xs: Float64Array; xb: AABB[]; ys: Float64Array; yb: AABB[] }
export interface Guide { x1: number; y1: number; x2: number; y2: number }
/** the snap lines of `boxes` (edges and centres), sorted: once per gesture */
export function snapTargets(boxes: readonly AABB[]): Targets
/** the move (dx, dy) of `box` snapped to `targets` within `tolerance` (world units), and the guides to draw */
export function snap(box: AABB, dx: number, dy: number, targets: Targets, tolerance: number): { dx: number; dy: number; guides: Guide[] }

/**
 * Undo / redo over one state field. A shared field (sygnal/yjs `uses: { [field]: shared() }`) routes
 * to this user's UndoManager: the same model entries, one undo step per commit.
 */
export interface History<S> {
  readonly field: string;
  /** `next` as the field's new value, one undo step back to `before` (default: the value now; a gesture passes its start) */
  commit(s: S, next: any, before?: any): S;
  undo(s: S): S | typeof ABORT;
  redo(s: S): S | typeof ABORT;
  canUndo(s: S): boolean;
  canRedo(s: S): boolean;
}
export function history<S extends Record<string, any>>(field: keyof S & string, options?: {
  /** steps kept (default 200; local history) */
  limit?: number;
  /** fix up the rest of the state after an undo / redo */
  after?: (s: S) => S;
  /** the state key of the step counter a shared history bumps (default `<field>Step`) */
  step?: string;
}): History<S>

export const PARTS: Record<'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w', [number, number]>
export function boxPoint(b: Box, u: number, v: number, dy?: number): Pt
/** the selection box, the 8 resize handles (`data-part` nw … w) and the rotate handle (`rotate`) as screen-space JSX nodes */
export function handles(box: Box, camera: Camera, options?: { color?: string; size?: number; rotateOffset?: number; grips?: boolean }): VNode[]
/** the box after dragging handle `part` to world point p (rotated boxes resize in their own frame); keep: the aspect ratio */
export function resize(b: Box, part: string, p: Pt, keep?: boolean): Box
/** a box inside group box `b` after the group became `nb` */
export function scaleInto<T extends Box>(o: T, b: Box, nb: Box): T
/** degrees turned around the box's centre from `from` to `to`; `step` snaps the resulting angle */
export function rotation(b: Box, from: Pt, to: Pt, step?: number): number
/** a box turned by `deg` around point c */
export function turn<T extends Box>(o: T, c: Pt, deg: number): T
