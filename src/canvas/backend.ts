/**
 * The painting backend: `<Canvas backend={…}>` (default `canvas2d()`, the own Canvas 2D painter).
 * A backend only paints: hit testing, routing, the camera, culling of the hit test, the
 * accessibility projection and the layer bookkeeping stay in the Canvas. A backend is
 * `(canvas) => { paint(frame, stats), dispose? } | null` (null: no context, e.g. jsdom; the Canvas
 * then runs headless: hit testing and events work, nothing is drawn). A WebGL backend (Pixi) can be
 * an optional peer behind its own subpath later (README §5).
 *
 * canvas2d()'s strategy (README §4):
 * - **Static layer**: the data layers minus their `active` (and followed) nodes are painted once
 *   into an offscreen bitmap, valid while those nodes keep their identity (an O(n) check).
 * - **Camera cache**: the bitmap covers a world region (the viewport, with a half-viewport margin
 *   once the camera moves, clipped to the content and to MAX_PIXELS). A pan at the same zoom is a
 *   copy of the bitmap at an offset while the region covers what is visible; a zoom while the
 *   camera is in a gesture (`frame.moving`) scales it, and the crisp repaint follows at rest.
 * - **Live layer**: active nodes, outline layers and the screen-space overlay repaint every frame;
 *   1,000 or more live nodes that only translated since they were painted are one bitmap blit
 *   (tried again only after a frame that did translate: nodes that move each on their own, a
 *   game's, are painted directly, B4).
 * - **Ordered** (canvas-game R4): when a layer with live nodes (`live`, `active`) lies under a
 *   static one, or a layer has `parallax`, everything is painted on the main canvas in layer order:
 *   each run of static layers (same parallax) is its own cached bitmap (transparent; a pan shifts
 *   it), the live nodes are painted between them. No camera-gesture scaling or overview there.
 */
import {aabb, overlaps, viewport, toScreen, positionsOf, layerCamera, type AABB, type Camera} from './geometry'
import {paintWorld, paintNode, sized, type Node} from './paint'

export type PaintLayer = {items: Node[], active: Set<any> | null, outline?: string, live?: boolean, parallax?: [number, number] | null}
export interface Frame {
  camera: Camera
  /** canvas size in CSS pixels, and the device pixel ratio */
  width: number, height: number, dpr: number
  background: string
  grid: boolean
  repaint: 'layers' | 'full'
  layers: PaintLayer[]
  /** screen-space nodes (handles, guides), painted last in canvas pixels */
  overlay: Node[]
  /** follow (the transient channel): these ids are painted moved by (dx, dy) */
  follow: {ids: Set<any>, dx: number, dy: number} | null
  /** the camera is in a gesture (wheel, pinch, pan drag): a zoom may scale the cached bitmap */
  moving: boolean
}
export type PaintStats = {nodes: number, culled: number, ms: number, blits: number, cached: number, shifted: number, scaled: number, statics: number, scrolled?: number, strips?: number}
export interface BackendInstance {
  paint(frame: Frame, stats: PaintStats): void
  /** the canvas's bitmap was resized (and so cleared): the next paint must not reuse it */
  resized?(): void
  /** what nodes show changed without the nodes changing (an image arrived): the next paint repaints what it cached */
  refresh?(): void
  dispose?(): void
}
export type CanvasBackend = (canvas: any) => BackendInstance | null

const ALL = new Set<any>()
// the live nodes worth a translation blit: below this, painting them is cheaper than the bitmap copy
// (Chromium at 10k shapes: 100 nodes paint in 5.5 ms a step, blit in 8.1; even at about 1,000)
const BLIT_MIN = 1000
// device pixels a cached bitmap may have (16 M: 64 MB of RGBA)
const MAX_PIXELS = 16e6
// the overview's budget (4 M device pixels)
const OVERVIEW_PIXELS = 4e6
// frames of a still camera after which the scroll canvases fold back onto the main canvas
const STILL = 30
const sameCam = (a: Camera, b: Camera) => a.x == b.x && a.y == b.y && a.zoom == b.zoom
const sameSet = (a: Set<any> | null, b: Set<any> | null) => a === b || (!!a && !!b && a.size == b.size && [...a].every(x => b.has(x)))
const intersect = (a: AABB, b: AABB): AABB | null => { const r = {x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1)}; return r.x0 < r.x1 && r.y0 < r.y1 ? r : null }
const inside = (a: AABB, b: AABB) => a.x0 >= b.x0 - 1e-9 && a.y0 >= b.y0 - 1e-9 && a.x1 <= b.x1 + 1e-9 && a.y1 <= b.y1 + 1e-9
// an outline layer paints every node's outline (1 screen px) and is never hit
const outlined = (n: Node, color: string): Node => ({...n, type: n.type == 'ellipse' ? 'ellipse' : 'rect', fill: 'none', stroke: color, strokeWidth: 1, dash: null, opacity: 1})
const moved = (n: Node, dx: number, dy: number): Node => ({...n, x: n.x + dx, y: n.y + dy})

// a translation's tolerance in world units: (x + d) - x isn't d in floating point
const EPS = 1e-6
/** [dx, dy] when every node of b is the same node of a moved by one (dx, dy), else null */
export function translation(a: Node[], b: Node[]): [number, number] | null {
  const dx = b[0].x - a[0].x, dy = b[0].y - a[0].y
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i]
    if (p === q) { if (dx || dy) return null; continue }
    if (Math.abs(q.x - p.x - dx) > EPS || Math.abs(q.y - p.y - dy) > EPS) return null
    for (const k in q) if (k != 'x' && k != 'y' && q[k] !== p[k]) return null
  }
  return [dx, dy]
}

/** the nodes of `items` whose id is in `ids`, in their order: by position for a few (no pass over a big layer each frame) */
function activeOf(items: Node[], ids: Set<any>, prev?: Node[]): Node[] {
  if (ids.size * 16 > items.length) return items.filter(n => ids.has(n.id))
  const pos = positionsOf(items, prev), at: number[] = []
  for (const id of ids) { const j = pos.get(id); if (j !== undefined) at.push(j) }
  return at.sort((a, b) => a - b).map(j => items[j])
}

// the world AABB of a layer's nodes (lines and paths count as unbounded: they are never culled)
let bounds = new WeakMap<Node[], AABB>()
function contentOf(items: Node[]): AABB {
  let b = bounds.get(items)
  if (b) return b
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const n of items) {
    if (n.type == 'line' || n.type == 'path') { x0 = y0 = -Infinity; x1 = y1 = Infinity; break }
    const a = aabb(sized(n) as any)
    if (a.x0 < x0) x0 = a.x0; if (a.y0 < y0) y0 = a.y0; if (a.x1 > x1) x1 = a.x1; if (a.y1 > y1) y1 = a.y1
  }
  bounds.set(items, b = {x0, y0, x1, y1})
  return b
}

function grid(ctx: any, cam: Camera, w: number, h: number) {
  ctx.save()
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  const z = cam.zoom
  for (let x = Math.ceil(cam.x); x < cam.x + w / z; x++) { const sx = Math.round((x - cam.x) * z) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, h) }
  for (let y = Math.ceil(cam.y); y < cam.y + h / z; y++) { const sy = Math.round((y - cam.y) * z) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(w, sy) }
  ctx.stroke()
  ctx.restore()
}

/** the own Canvas 2D painter (the default backend) */
export const canvas2d = (): CanvasBackend => (canvas: any) => {
  // opaque: the canvas is always filled (no blending when it is composited)
  const ctx = canvas.getContext?.('2d', {alpha: false})
  if (!ctx) return null
  const doc = canvas.ownerDocument
  // the static layer: bitmap, the world region it covers, the zoom it was painted at, its content key
  // (`borrowed`: a scroll canvas's pixels lent to an ordered run: drawn from, never painted into)
  type Cache = {bmp: any, region: AABB | null, zoom: number, key: any, transparent?: boolean, borrowed?: boolean}
  let st: Cache = {bmp: null, region: null, zoom: 0, key: null}
  // the overview: the whole static content at a low resolution, painted when a zoom gesture first
  // shows more than the static bitmap has (what a zoom-out uncovers, until the crisp repaint at rest)
  let ov: Cache = {bmp: null, region: null, zoom: 0, key: null}
  let lastCam: Camera | null = null, lastItems: Node[][] = []
  const blits: any[] = []
  // the live layer on a canvas of its own, over the main one (transparent, no pointer events): a
  // frame whose static layer didn't change touches only it, as Konva's layers do. Without a parent
  // (a bare canvas) everything goes on the one canvas
  let live: any = null, lctx = ctx, mainValid = false, liveDirty = false
  if (canvas.parentNode) {
    live = doc.createElement('canvas')
    live.className = 'sygnal-canvas-live'
    Object.assign(live.style, {position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none'})
    live.setAttribute?.('aria-hidden', 'true')
    canvas.parentNode.insertBefore(live, canvas.nextSibling)
    lctx = live.getContext('2d') || ctx
    if (lctx === ctx) live.remove(), live = null
  }

  /** whether the static layer painted for key `a` still has the right nodes for `b` */
  const reusable = (a: any, b: any) => {
    if (!a || a.dpr != b.dpr || a.layers.length != b.layers.length) return false
    return a.layers.every((la: any, i: number) => {
      const lb = b.layers[i]
      if (la.items === lb.items && sameSet(la.skip, lb.skip)) return true
      // a new array: the same nodes outside both skip sets (a drag replaces only the active ones)
      if (la.items.length != lb.items.length || !sameSet(la.skip, lb.skip)) return false
      const sk = lb.skip
      for (let j = 0; j < lb.items.length; j++) {
        const x = la.items[j], y = lb.items[j]
        if (x !== y && !(sk && sk.has(y.id) && sk.has(x.id))) return false
      }
      return true
    })
  }

  // paint the static layer for `f` into a bitmap covering `region` at zoom `z`
  const paintInto = (c: Cache, f: Frame, key: any, skips: any[], region: AABB, z: number, s: PaintStats, transparent = false): Cache => {
    const dpr = f.dpr
    // (an ordered run's bitmap is transparent: it goes over what is under it)
    const bmp = c.bmp && !c.borrowed && !!c.transparent == transparent ? c.bmp : doc.createElement('canvas')
    const W = Math.max(1, Math.ceil((region.x1 - region.x0) * z * dpr)), H = Math.max(1, Math.ceil((region.y1 - region.y0) * z * dpr))
    if (bmp.width != W || bmp.height != H) { bmp.width = W; bmp.height = H }
    const bc = bmp.getContext('2d', {alpha: transparent}), at = {x: region.x0, y: region.y0, zoom: z}
    bc.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (transparent) { bc.globalAlpha = 1; bc.clearRect(0, 0, W / dpr, H / dpr) }
    else {
      // opaque (the background and the grid in it): a frame that it covers is a plain copy, no blending
      bc.fillStyle = f.background
      bc.fillRect(0, 0, bmp.width / dpr, bmp.height / dpr)
      if (f.grid && z >= 4) grid(bc, at, bmp.width / dpr, bmp.height / dpr)
    }
    f.layers.forEach((l, i) => skips[i] !== ALL && paintWorld(bc, l.items, at, dpr, region, skips[i], s))
    s.statics++
    return {bmp, region, zoom: z, key, transparent}
  }

  // a cached bitmap onto the canvas at camera `cam` (shifted, or scaled during a zoom gesture)
  const draw = (c: Cache, f: Frame, cam: Camera = f.camera): boolean => {
    const {region, zoom, bmp} = c, dpr = f.dpr, k = cam.zoom / zoom
    if (!region) return false
    const p = toScreen(cam, region.x0, region.y0)
    let dx = p.x * dpr, dy = p.y * dpr
    // the same zoom: whole device pixels, a copy of the part on the canvas
    if (k == 1) { dx = Math.round(dx); dy = Math.round(dy) }
    const W = canvas.width, H = canvas.height, bw = bmp.width * k, bh = bmp.height * k
    const x0 = Math.max(0, dx), y0 = Math.max(0, dy), x1 = Math.min(W, dx + bw), y1 = Math.min(H, dy + bh)
    if (x1 <= x0 || y1 <= y0) return false
    const all = x0 <= 0 && y0 <= 0 && x1 >= W && y1 >= H
    if (all && !c.transparent) ctx.globalCompositeOperation = 'copy'
    // scaled during a gesture: no smoothing (the filter is the raster cost; the crisp repaint follows at rest)
    if (k != 1) ctx.imageSmoothingEnabled = false
    ctx.drawImage(bmp, (x0 - dx) / k, (y0 - dy) / k, (x1 - x0) / k, (y1 - y0) / k, x0, y0, x1 - x0, y1 - y0)
    if (k != 1) ctx.imageSmoothingEnabled = true
    if (all && !c.transparent) ctx.globalCompositeOperation = 'source-over'
    return all
  }

  // whether the static bitmap covers the whole canvas at camera f.camera
  const covers = (f: Frame) => {
    const {region, zoom} = st
    if (!region || !zoom) return false
    return inside(viewport(f.camera, f.width, f.height), region)
  }

  // the live layer's moving nodes as a bitmap: a big set that only translated since it was painted
  // (every node the same dx, dy, nothing else changed: a drag) is one drawImage, not a repaint.
  // The bitmap is the canvas plus a half-canvas margin on each side, so what moves in is there.
  const blit = (f: Frame, i: number, act: Node[], s: PaintStats, off: number[] | null, cam: Camera = f.camera) => {
    if (act.length < BLIT_MIN) return false
    const w = f.width, h = f.height, dpr = f.dpr
    let c = blits[i]
    const z = cam.zoom, mx = w / 2, my = h / 2
    let d = c && sameCam(c.cam, cam) && c.nodes.length == act.length ? translation(c.nodes, act) : null
    if (d && (Math.abs(d[0] * z) > mx || Math.abs(d[1] * z) > my)) d = null
    if (!d || !c.valid) {
      // B4: a second frame in a row whose nodes didn't translate (they move each on their own): paint
      // them directly, keep them as the reference for the next frame, no bitmap
      const missed = !d && c?.missed
      c = blits[i] = c || {bmp: doc.createElement('canvas')}
      c.nodes = act; c.cam = cam; c.missed = !d; c.valid = false
      if (missed) return false
      const W2 = Math.round(w * 2 * dpr), H2 = Math.round(h * 2 * dpr), bc = c.bmp.getContext('2d')
      // (a canvas resized is reallocated: only when the size changed)
      if (c.bmp.width != W2 || c.bmp.height != H2) { c.bmp.width = W2; c.bmp.height = H2 }
      else { bc.setTransform(1, 0, 0, 1, 0, 0); bc.clearRect(0, 0, W2, H2) }
      const wide = {...cam, x: cam.x - mx / z, y: cam.y - my / z}
      paintWorld(bc, act, wide, dpr, viewport(wide, w * 2, h * 2), null, s)
      c.valid = true; d = [0, 0]
    } else { c.missed = false; s.blits++ }
    if (off) { d = [d[0] + off[0], d[1] + off[1]]; if (Math.abs(d[0] * z) > mx || Math.abs(d[1] * z) > my) return false }
    lctx.setTransform(1, 0, 0, 1, 0, 0)
    lctx.globalAlpha = 1
    // only the part of the bitmap that lands on the canvas, and of that only the moving nodes' bounds
    // (with room for strokes and frame names): the copy is the raster cost, a full canvas of it
    // costs more than painting a hundred nodes
    const W = canvas.width, H = canvas.height, sx = Math.round((mx - d[0] * z) * dpr), sy = Math.round((my - d[1] * z) * dpr)
    const b = contentOf(c.nodes), p = toScreen(cam, b.x0 + d[0], b.y0 + d[1]), q = toScreen(cam, b.x1 + d[0], b.y1 + d[1]), pad = 24
    // (a line or path is unbounded: the whole canvas)
    const fin = isFinite(p.x + q.x + p.y + q.y)
    const x0 = fin ? Math.max(0, Math.floor(p.x * dpr) - pad) : 0, y0 = fin ? Math.max(0, Math.floor(p.y * dpr) - pad) : 0
    const x1 = fin ? Math.min(W, Math.ceil(q.x * dpr) + pad) : W, y1 = fin ? Math.min(H, Math.ceil(q.y * dpr) + pad) : H
    if (x1 > x0 && y1 > y0) lctx.drawImage(c.bmp, sx + x0, sy + y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0)
    return true
  }


  // R14, the scrolling camera: each run of static layers (one parallax) is a canvas element of its
  // own, over the main canvas (the background alone) and under the live one, covering the view and
  // a margin; the camera moving moves the element (a CSS transform: the compositor's work, no
  // pixels copied), and when the view reaches the edge of what it has, the overlap is shifted once
  // and only the newly exposed strips are painted. A frame costs what came into view, not a copy of
  // the view. Used when the layers under the live canvas are all static (a game: scenery and tiles
  // under its actors); a live layer under a static one keeps the main-canvas strategy. Only while
  // the camera moves: more canvases cost the compositor every frame, so a camera still for
  // STILL frames folds the runs back onto the main canvas (copies of the scroll canvases' pixels)
  type Scroll = {el: any, ctx: any, key: any, region: AABB | null, zoom: number, dpr: number, tx: number, ty: number}
  const scrolls: Scroll[] = []
  let box: any = null, scrolling = false, groundKey = '', still = 0
  const unscroll = () => {
    if (!scrolling) return
    scrolling = false
    mainValid = false
    box.style.display = 'none'
  }
  const scrolled = (f: Frame, s: PaintStats, skips: any[], top: number) => {
    const dpr = f.dpr, w = f.width, h = f.height
    if (!box) {
      box = doc.createElement('div')
      box.className = 'sygnal-canvas-scroll'
      Object.assign(box.style, {position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none'})
      box.setAttribute?.('aria-hidden', 'true')
    }
    if (box.parentNode !== canvas.parentNode || box.nextSibling !== live) canvas.parentNode.insertBefore(box, live)
    if (!scrolling) box.style.display = '', scrolling = true
    // the main canvas: the background alone, painted when it changes
    const g = `${f.background} ${w} ${h} ${dpr}`
    if (!mainValid || g != groundKey) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = 1
      ctx.fillStyle = f.background
      ctx.fillRect(0, 0, w, h)
      mainValid = true; groundKey = g
    }
    const groups: {px: [number, number] | null, idx: number[]}[] = []
    for (let i = 0; i < top; i++) {
      const l = f.layers[i]
      if (skips[i] === ALL || l.items.length <= (skips[i] ? skips[i].size : 0)) continue
      const px = l.parallax || null, last = groups[groups.length - 1]
      if (last && String(last.px) === String(px)) last.idx.push(i)
      else groups.push({px, idx: [i]})
    }
    groups.forEach(({px, idx}, r) => {
      const cam = layerCamera(f.camera, px), z = cam.zoom, k = z * dpr, view = viewport(cam, w, h)
      const sk = f.layers.map((_, i) => idx.includes(i) ? skips[i] : ALL)
      const key = {dpr, layers: f.layers.map((l, i) => sk[i] === ALL ? {items: [], skip: ALL} : {items: l.items, skip: sk[i]})}
      let content: AABB | null = null
      for (const i of idx) {
        const b = contentOf(f.layers[i].items)
        content = content ? {x0: Math.min(content.x0, b.x0), y0: Math.min(content.y0, b.y0), x1: Math.max(content.x1, b.x1), y1: Math.max(content.y1, b.y1)} : b
      }
      const pad = 20 / z
      content = {x0: content!.x0 - pad, y0: content!.y0 - pad, x1: content!.x1 + pad, y1: content!.y1 + pad}
      let sc = scrolls[r]
      if (!sc) {
        const el = doc.createElement('canvas')
        el.className = 'sygnal-canvas-run'
        Object.assign(el.style, {position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', willChange: 'transform'})
        sc = scrolls[r] = {el, ctx: el.getContext('2d'), key: null, region: null, zoom: 0, dpr: 0, tx: NaN, ty: NaN}
      }
      if (box.children?.[r] !== sc.el) box.insertBefore(sc.el, box.children?.[r] || null)
      const need = intersect(view, content)
      if (!need) { sc.el.style.display = 'none'; return }
      sc.el.style.display = ''
      // the view with half a view of margin each way, clipped to the content, on the device-pixel grid
      const around = (): AABB => {
        const mw = w / 2 / z, mh = h / 2 / z
        let R = intersect({x0: view.x0 - mw, y0: view.y0 - mh, x1: view.x1 + mw, y1: view.y1 + mh}, content!) || need
        if ((R.x1 - R.x0) * (R.y1 - R.y0) * k * k > MAX_PIXELS) R = need
        return {x0: Math.floor(R.x0 * k) / k, y0: Math.floor(R.y0 * k) / k, x1: Math.ceil(R.x1 * k) / k, y1: Math.ceil(R.y1 * k) / k}
      }
      const bc = sc.ctx, at = (R: AABB) => ({x: R.x0, y: R.y0, zoom: z})
      // paint `area` (world) of the run into the element whose region is R
      const paintArea = (R: AABB, area: AABB) => {
        bc.save()
        bc.setTransform(1, 0, 0, 1, 0, 0)
        const x = Math.round((area.x0 - R.x0) * k), y = Math.round((area.y0 - R.y0) * k)
        const x1 = Math.round((area.x1 - R.x0) * k), y1 = Math.round((area.y1 - R.y0) * k)
        bc.globalCompositeOperation = 'source-over'
        bc.clearRect(x, y, x1 - x, y1 - y)
        bc.beginPath(); bc.rect(x, y, x1 - x, y1 - y); bc.clip()
        f.layers.forEach((l, i) => sk[i] !== ALL && paintWorld(bc, l.items, at(R), dpr, area, sk[i], s))
        bc.restore()
      }
      let R = sc.region
      if (!R || sc.zoom != z || sc.dpr != dpr || !reusable(sc.key, key)) {
        R = around()
        const W = Math.max(1, Math.round((R.x1 - R.x0) * k)), H = Math.max(1, Math.round((R.y1 - R.y0) * k))
        if (sc.el.width != W || sc.el.height != H) { sc.el.width = W; sc.el.height = H; sc.el.style.width = W / dpr + 'px'; sc.el.style.height = H / dpr + 'px' }
        paintArea(R, R)
        s.statics++
      } else if (!inside(need, R)) {
        const old = R
        R = around()
        const W = Math.round((R.x1 - R.x0) * k), H = Math.round((R.y1 - R.y0) * k)
        if (sc.el.width != W || sc.el.height != H) {
          sc.el.width = W; sc.el.height = H; sc.el.style.width = W / dpr + 'px'; sc.el.style.height = H / dpr + 'px'
          paintArea(R, R)
          s.statics++
        } else {
          // what both regions have, shifted in place (the element onto itself; `copy` clears the rest),
          // then only the strips the old one lacked
          bc.save()
          bc.setTransform(1, 0, 0, 1, 0, 0)
          bc.globalAlpha = 1
          bc.globalCompositeOperation = 'copy'
          bc.drawImage(sc.el, Math.round((old.x0 - R.x0) * k), Math.round((old.y0 - R.y0) * k))
          bc.restore()
          const o = intersect(old, R)
          if (!o) paintArea(R, R)
          else {
            // up to four strips around the overlap: full-height left / right, then top / bottom between them
            if (o.x0 > R.x0) paintArea(R, {x0: R.x0, y0: R.y0, x1: o.x0, y1: R.y1})
            if (o.x1 < R.x1) paintArea(R, {x0: o.x1, y0: R.y0, x1: R.x1, y1: R.y1})
            if (o.y0 > R.y0) paintArea(R, {x0: o.x0, y0: R.y0, x1: o.x1, y1: o.y0})
            if (o.y1 < R.y1) paintArea(R, {x0: o.x0, y0: o.y1, x1: o.x1, y1: R.y1})
          }
          s.strips = (s.strips || 0) + 1
        }
      } else s.scrolled = (s.scrolled || 0) + 1
      sc.region = R; sc.key = key; sc.zoom = z; sc.dpr = dpr
      // the element where the camera puts its region, in whole device pixels
      const tx = Math.round((R.x0 - cam.x) * k), ty = Math.round((R.y0 - cam.y) * k)
      if (tx != sc.tx || ty != sc.ty) { sc.el.style.transform = `translate(${tx / dpr}px, ${ty / dpr}px)`; sc.tx = tx; sc.ty = ty }
    })
    for (let r = groups.length; r < scrolls.length; r++) scrolls[r].el.remove()
    scrolls.length = groups.length
  }

  // R4: the ordered strategy. Each run of static layers (one parallax) is a transparent bitmap of
  // its own covering the view with a margin (a pan shifts it); live nodes are painted between the
  // runs, all on the main canvas, in layer order
  const runs: Cache[] = []
  // the main canvas of the last ordered frame: its camera and, per layer under `top`, items and skip
  let below: {cam: Camera, dpr: number, layers: any[]} | null = null
  const paintOrdered = (f: Frame, s: PaintStats, skips: any[]) => {
    const dpr = f.dpr, w = f.width, h = f.height, fo = f.follow
    const hasStatic = (l: PaintLayer, i: number) => skips[i] !== ALL && l.items.length > (skips[i] ? skips[i].size : 0)
    const hasLive = (l: PaintLayer, i: number) => skips[i] === ALL ? l.items.length > 0 : !!skips[i]?.size
    // the layers over the last static one (a game's actors) go on the live canvas, so the main canvas
    // (everything under them) stays as it is while its nodes and the camera don't change
    let top = 0
    for (let i = f.layers.length - 1; i >= 0; i--) if (hasStatic(f.layers[i], i)) { top = i + 1; break }
    if (!live) top = f.layers.length
    const key = {cam: f.camera, dpr, layers: f.layers.slice(0, top).map((l, i) => [l.items, skips[i]])}
    const belowLive = f.layers.some((l, i) => i < top && hasLive(l, i))
    const panned = !!lastCam && !sameCam(lastCam, f.camera)
    still = panned ? 0 : still + 1
    const scroll = !!live && !belowLive && top > 0 && !(f.grid && f.camera.zoom >= 4) && (panned || scrolling && still < STILL)
    const same = !belowLive && mainValid && !!below && below.dpr == dpr && sameCam(below.cam, f.camera) && below.layers.length == key.layers.length &&
      below.layers.every(([items, sk], i) => items === key.layers[i][0] && sameSet(sk, key.layers[i][1]))
    below = key
    // the live layers on top: on the live canvas (or, without one, after the rest on the main one)
    const paintTop = () => {
      for (let i = top; i < f.layers.length; i++) {
        const l = f.layers[i], sk = skips[i]
        if (!sk) continue
        const cam = layerCamera(f.camera, l.parallax)
        let act = sk === ALL ? l.items : activeOf(l.items, sk, lastItems[i])
        if (fo) act = act.map(n => fo.ids.has(n.id) ? moved(n, fo.dx, fo.dy) : n)
        if (l.outline) act = act.map(n => outlined(n, l.outline!))
        if (act.length && lctx !== ctx) liveDirty = true
        if (!blit(f, i, act, s, null, cam)) paintWorld(lctx, act, cam, dpr, viewport(cam, w, h), null, s)
      }
    }
    if (scroll) {
      below = null
      scrolled(f, s, skips, top)
      paintTop()
      return
    }
    if (scrolling) {
      // back on the main canvas: the runs are the scroll canvases' pixels (a copy each, no repaint)
      scrolls.forEach((sc, r) => { if (sc.region) runs[r] = {bmp: sc.el, region: sc.region, zoom: sc.zoom, key: sc.key, transparent: true, borrowed: true} })
      runs.length = scrolls.length
      unscroll()
    }
    if (same) { s.cached++; paintTop(); return }
    mainValid = !!live && !belowLive
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = f.background
    ctx.fillRect(0, 0, w, h)
    if (f.grid && f.camera.zoom >= 4) grid(ctx, f.camera, w, h)
    let run: number[] = [], px: [number, number] | null = null, r = 0
    const flush = () => {
      if (!run.length) return
      const cam = layerCamera(f.camera, px), view = viewport(cam, w, h)
      const sk = f.layers.map((_, i) => run.includes(i) ? skips[i] : ALL)
      const key = {dpr, layers: f.layers.map((l, i) => sk[i] === ALL ? {items: [], skip: ALL} : {items: l.items, skip: sk[i]})}
      let content: AABB | null = null
      for (const i of run) {
        const b = contentOf(f.layers[i].items)
        content = content ? {x0: Math.min(content.x0, b.x0), y0: Math.min(content.y0, b.y0), x1: Math.max(content.x1, b.x1), y1: Math.max(content.y1, b.y1)} : b
      }
      const pad = 20 / cam.zoom
      content = {x0: content!.x0 - pad, y0: content!.y0 - pad, x1: content!.x1 + pad, y1: content!.y1 + pad}
      const need = intersect(view, content)
      let c = runs[r] || {bmp: null, region: null, zoom: 0, key: null}
      if (need) {
        if (reusable(c.key, key) && c.zoom == cam.zoom && c.region && inside(need, c.region)) s.shifted++
        else {
          const mw = w / 2 / cam.zoom, mh = h / 2 / cam.zoom
          const around = intersect({x0: view.x0 - mw, y0: view.y0 - mh, x1: view.x1 + mw, y1: view.y1 + mh}, content) || view
          let region = {x0: Math.min(view.x0, around.x0), y0: Math.min(view.y0, around.y0), x1: Math.max(view.x1, around.x1), y1: Math.max(view.y1, around.y1)}
          if ((region.x1 - region.x0) * (region.y1 - region.y0) * (cam.zoom * dpr) ** 2 > MAX_PIXELS) region = view
          c = paintInto(c, f, key, sk, region, cam.zoom, s, true)
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalAlpha = 1
        draw(c, f, cam)
      }
      runs[r++] = c
      run = []
    }
    f.layers.forEach((l, i) => {
      if (i >= top) return
      const sk = skips[i], lp = l.parallax || null
      if (run.length && String(lp) !== String(px)) flush()
      if (sk !== ALL && l.items.length > (sk ? sk.size : 0)) { if (!run.length) px = lp; run.push(i) }
      if (!sk) return
      // this layer's live nodes: over its own static nodes and those under it, under the ones above
      flush()
      const cam = layerCamera(f.camera, lp)
      let act = sk === ALL ? l.items : activeOf(l.items, sk, lastItems[i])
      if (fo) act = act.map(n => fo.ids.has(n.id) ? moved(n, fo.dx, fo.dy) : n)
      if (l.outline) act = act.map(n => outlined(n, l.outline!))
      paintWorld(ctx, act, cam, dpr, viewport(cam, w, h), null, s)
    })
    flush()
    runs.length = r
    paintTop()
  }

  return {
    paint(f: Frame, s: PaintStats) {
      const cam = f.camera, w = f.width, h = f.height, dpr = f.dpr, view = viewport(cam, w, h), fo = f.follow
      if (live) {
        // a resize clears both canvases
        if (live.width != canvas.width || live.height != canvas.height) { live.width = canvas.width; live.height = canvas.height; mainValid = false }
        if (liveDirty) { lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height); liveDirty = false }
      } else mainValid = false
      // the canvas's background and grid, where no static bitmap covers it
      const ground = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.globalAlpha = 1
        ctx.fillStyle = f.background
        ctx.fillRect(0, 0, w, h)
        if (f.grid && cam.zoom >= 4) grid(ctx, cam, w, h)
      }
      // the active (or following) nodes of each layer, painted live
      const skips = f.layers.map(l => l.outline || l.live ? ALL : fo ? new Set([...(l.active || []), ...fo.ids]) : l.active)
      // R4: a layer with live nodes under one with static nodes, or a parallax layer: paint in order
      // (a game's `live` layer over static ones, with a live canvas: the scroll canvases)
      let ordered = f.layers.some(l => l.parallax) || !!live && f.layers.some(l => l.live), under = false
      if (!ordered) f.layers.forEach((l, i) => {
        if (under && skips[i] !== ALL && l.items.length > (skips[i]?.size ?? 0)) ordered = true
        if (skips[i] === ALL ? l.items.length : skips[i]?.size) under = true
      })
      if (f.repaint == 'full') {
        unscroll()
        ground()
        mainValid = false
        f.layers.forEach(l => {
          let items = fo ? l.items.map(n => fo.ids.has(n.id) ? moved(n, fo.dx, fo.dy) : n) : l.items
          if (l.outline) items = items.map(n => outlined(n, l.outline!))
          const lc = layerCamera(cam, l.parallax)
          paintWorld(ctx, items, lc, dpr, l.parallax ? viewport(lc, w, h) : view, null, s)
        })
      } else if (ordered) {
        paintOrdered(f, s, skips)
        st = {bmp: st.bmp, region: null, zoom: 0, key: null}
      } else {
        unscroll()
        runs.length = 0
        // (back from the ordered strategy: the main canvas is repainted)
        if (below) { below = null; mainValid = false }
        const key = {dpr, layers: f.layers.map((l, i) => skips[i] === ALL ? {items: [], skip: ALL} : {items: l.items, skip: skips[i]})}
        const same = reusable(st.key, key), k = st.zoom ? cam.zoom / st.zoom : 0
        let grounded = false
        // the same nodes, the camera of the last frame: the bitmap as it is (no per-frame O(n) work:
        // a drag's new array each frame must not cost a pass over every node)
        const cachedFrame = same && k == 1 && !!lastCam && sameCam(lastCam, cam)
        if (cachedFrame) s.cached++
        else {
          // what must be on screen: the visible part of the static content (with room for the
          // frame names drawn above their frames)
          let content: AABB | null = null
          for (let i = 0; i < f.layers.length; i++) if (skips[i] !== ALL && f.layers[i].items.length) {
            const b = contentOf(f.layers[i].items)
            content = content ? {x0: Math.min(content.x0, b.x0), y0: Math.min(content.y0, b.y0), x1: Math.max(content.x1, b.x1), y1: Math.max(content.y1, b.y1)} : b
          }
          const pad = 20 / cam.zoom
          if (content) content = {x0: content.x0 - pad, y0: content.y0 - pad, x1: content.x1 + pad, y1: content.y1 + pad}
          const need = content && intersect(view, content)
          const covered = !need || !!st.region && inside(need, st.region)
          if (same && covered && k == 1) s.shifted++
          // a zoom gesture: the bitmap scaled (up to 2×: then it repaints, sharper); what a zoom-out
          // uncovers comes from the overview
          else if (same && f.moving && k != 1 && k <= 2 && (covered || k >= 0.25)) {
            s.scaled++
            if (!covered) {
              if (!ov.region || !reusable(ov.key, key)) {
                const area = (content!.x1 - content!.x0) * (content!.y1 - content!.y0) * dpr * dpr
                ov = paintInto(ov, f, key, skips, content!, Math.min(cam.zoom, Math.sqrt(OVERVIEW_PIXELS / area)), s)
              }
              ground()
              ctx.setTransform(1, 0, 0, 1, 0, 0)
              draw(ov, f)
              grounded = true
            }
          } else if (need) {
            // a pan (the camera moved at the same zoom): paint a margin around the viewport, so the
            // next pans are copies. A zoom repaints the view alone (it rescales from there)
            const panning = (f.moving || !!lastCam && !sameCam(lastCam, cam)) && k == 1
            const mw = panning ? w / 2 / cam.zoom : 0, mh = panning ? h / 2 / cam.zoom : 0
            // the whole view (so a frame is a copy), and the content in the margin around it
            const around = intersect({x0: view.x0 - mw, y0: view.y0 - mh, x1: view.x1 + mw, y1: view.y1 + mh}, content!) || view
            let region = {x0: Math.min(view.x0, around.x0), y0: Math.min(view.y0, around.y0), x1: Math.max(view.x1, around.x1), y1: Math.max(view.y1, around.y1)}
            const px = (r: AABB) => (r.x1 - r.x0) * (r.y1 - r.y0) * (cam.zoom * dpr) ** 2
            if (px(region) > MAX_PIXELS) region = view
            st = paintInto(st, f, key, skips, region, cam.zoom, s)
          } else st = {bmp: st.bmp, region: null, zoom: cam.zoom, key}
        }
        // a bitmap that covers the canvas replaces it; else the ground, then the bitmap's part
        // (the overview, when drawn, is the ground already)
        // (with a live canvas, an unchanged static layer stays on the main canvas as it is)
        if (!(cachedFrame && mainValid)) {
          if (!grounded && !covers(f)) ground()
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.globalAlpha = 1
          draw(st, f)
          mainValid = !!live
        }
        // the live layer: active nodes in their layer's order, outline layers whole
        f.layers.forEach((l, i) => {
          const sk = skips[i]
          if (!sk) return
          let act = sk === ALL ? l.items : activeOf(l.items, sk, lastItems[i])
          // a big followed set is a known translation: its unshifted nodes, blitted at the offset
          const whole = !!fo && act.length >= BLIT_MIN && act.every(n => fo.ids.has(n.id))
          if (fo && !whole) act = act.map(n => fo.ids.has(n.id) ? moved(n, fo.dx, fo.dy) : n)
          if (l.outline) act = act.map(n => outlined(n, l.outline!))
          if (act.length) liveDirty = true
          if (!blit(f, i, act, s, whole ? [fo!.dx, fo!.dy] : null)) paintWorld(lctx, whole ? act.map(n => moved(n, fo!.dx, fo!.dy)) : act, cam, dpr, view, null, s)
        })
      }
      // screen-space JSX nodes (handles, guides) on top, in canvas pixels
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (const n of f.overlay) paintNode(lctx, n, 1)
      if (f.overlay.length) liveDirty = true
      lctx.globalAlpha = 1
      lastCam = cam
      lastItems = f.layers.map(l => l.items)
    },
    resized() { mainValid = false },
    refresh() {
      st = {...st, key: null}; ov = {...ov, key: null}
      runs.forEach(c => c.key = null)
      scrolls.forEach(c => c.region = null)
      blits.length = 0; below = null; mainValid = false
      bounds = new WeakMap()
    },
    dispose() { st = ov = {bmp: null, region: null, zoom: 0, key: null}; blits.length = 0; runs.length = 0; scrolls.length = 0; box?.remove(); live?.remove() },
  }
}
