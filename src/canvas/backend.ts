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
 *   64 or more live nodes that only translated since they were painted are one bitmap blit.
 */
import {aabb, overlaps, viewport, toScreen, type AABB, type Camera} from './geometry'
import {paintWorld, paintNode, type Node} from './paint'

export type PaintLayer = {items: Node[], active: Set<any> | null, outline?: string}
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
export type PaintStats = {nodes: number, culled: number, ms: number, blits: number, cached: number, shifted: number, scaled: number, statics: number}
export interface BackendInstance {
  paint(frame: Frame, stats: PaintStats): void
  dispose?(): void
}
export type CanvasBackend = (canvas: any) => BackendInstance | null

const ALL = new Set<any>()
const BLIT_MIN = 64
// device pixels a cached bitmap may have (16 M: 64 MB of RGBA)
const MAX_PIXELS = 16e6
// the overview's budget (4 M device pixels)
const OVERVIEW_PIXELS = 4e6
const sameCam = (a: Camera, b: Camera) => a.x == b.x && a.y == b.y && a.zoom == b.zoom
const sameSet = (a: Set<any> | null, b: Set<any> | null) => a === b || (!!a && !!b && a.size == b.size && [...a].every(x => b.has(x)))
const intersect = (a: AABB, b: AABB): AABB | null => { const r = {x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1)}; return r.x0 < r.x1 && r.y0 < r.y1 ? r : null }
const inside = (a: AABB, b: AABB) => a.x0 >= b.x0 - 1e-9 && a.y0 >= b.y0 - 1e-9 && a.x1 <= b.x1 + 1e-9 && a.y1 <= b.y1 + 1e-9
// an outline layer paints every node's outline (1 screen px) and is never hit
const outlined = (n: Node, color: string): Node => ({...n, type: n.type == 'ellipse' ? 'ellipse' : 'rect', fill: 'none', stroke: color, strokeWidth: 1, dash: null, opacity: 1})
const moved = (n: Node, dx: number, dy: number): Node => ({...n, x: n.x + dx, y: n.y + dy})

/** [dx, dy] when every node of b is the same node of a moved by one (dx, dy), else null */
export function translation(a: Node[], b: Node[]): [number, number] | null {
  const dx = b[0].x - a[0].x, dy = b[0].y - a[0].y
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i]
    if (p === q) { if (dx || dy) return null; continue }
    if (q.x - p.x !== dx || q.y - p.y !== dy) return null
    for (const k in q) if (k != 'x' && k != 'y' && q[k] !== p[k]) return null
  }
  return [dx, dy]
}

// the world AABB of a layer's nodes (lines and paths count as unbounded: they are never culled)
const bounds = new WeakMap<Node[], AABB>()
function contentOf(items: Node[]): AABB {
  let b = bounds.get(items)
  if (b) return b
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const n of items) {
    if (n.type == 'line' || n.type == 'path') { x0 = y0 = -Infinity; x1 = y1 = Infinity; break }
    const a = aabb(n as any)
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
  type Cache = {bmp: any, region: AABB | null, zoom: number, key: any}
  let st: Cache = {bmp: null, region: null, zoom: 0, key: null}
  // the overview: the whole static content at a low resolution, painted when a zoom gesture first
  // shows more than the static bitmap has (what a zoom-out uncovers, until the crisp repaint at rest)
  let ov: Cache = {bmp: null, region: null, zoom: 0, key: null}
  let lastCam: Camera | null = null
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
  const paintInto = (c: Cache, f: Frame, key: any, skips: any[], region: AABB, z: number, s: PaintStats): Cache => {
    const dpr = f.dpr
    const bmp = c.bmp || doc.createElement('canvas')
    bmp.width = Math.max(1, Math.ceil((region.x1 - region.x0) * z * dpr))
    bmp.height = Math.max(1, Math.ceil((region.y1 - region.y0) * z * dpr))
    const bc = bmp.getContext('2d', {alpha: false}), at = {x: region.x0, y: region.y0, zoom: z}
    // opaque (the background and the grid in it): a frame that it covers is a plain copy, no blending
    bc.setTransform(dpr, 0, 0, dpr, 0, 0)
    bc.fillStyle = f.background
    bc.fillRect(0, 0, bmp.width / dpr, bmp.height / dpr)
    if (f.grid && z >= 4) grid(bc, at, bmp.width / dpr, bmp.height / dpr)
    f.layers.forEach((l, i) => skips[i] !== ALL && paintWorld(bc, l.items, at, dpr, region, skips[i], s))
    s.statics++
    return {bmp, region, zoom: z, key}
  }

  // a cached bitmap onto the canvas at camera `cam` (shifted, or scaled during a zoom gesture)
  const draw = (c: Cache, f: Frame): boolean => {
    const {region, zoom, bmp} = c, cam = f.camera, dpr = f.dpr, k = cam.zoom / zoom
    if (!region) return false
    const p = toScreen(cam, region.x0, region.y0)
    let dx = p.x * dpr, dy = p.y * dpr
    // the same zoom: whole device pixels, a copy of the part on the canvas
    if (k == 1) { dx = Math.round(dx); dy = Math.round(dy) }
    const W = canvas.width, H = canvas.height, bw = bmp.width * k, bh = bmp.height * k
    const x0 = Math.max(0, dx), y0 = Math.max(0, dy), x1 = Math.min(W, dx + bw), y1 = Math.min(H, dy + bh)
    if (x1 <= x0 || y1 <= y0) return false
    const all = x0 <= 0 && y0 <= 0 && x1 >= W && y1 >= H
    if (all) ctx.globalCompositeOperation = 'copy'
    // scaled during a gesture: no smoothing (the filter is the raster cost; the crisp repaint follows at rest)
    if (k != 1) ctx.imageSmoothingEnabled = false
    ctx.drawImage(bmp, (x0 - dx) / k, (y0 - dy) / k, (x1 - x0) / k, (y1 - y0) / k, x0, y0, x1 - x0, y1 - y0)
    if (k != 1) ctx.imageSmoothingEnabled = true
    if (all) ctx.globalCompositeOperation = 'source-over'
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
  const blit = (f: Frame, i: number, act: Node[], s: PaintStats, off: number[] | null) => {
    if (act.length < BLIT_MIN) return false
    const cam = f.camera, w = f.width, h = f.height, dpr = f.dpr
    let c = blits[i]
    const z = cam.zoom, mx = w / 2, my = h / 2
    let d = c && sameCam(c.cam, cam) && c.nodes.length == act.length ? translation(c.nodes, act) : null
    if (d && (Math.abs(d[0] * z) > mx || Math.abs(d[1] * z) > my)) d = null
    if (!d) {
      c = blits[i] = c || {bmp: doc.createElement('canvas')}
      c.bmp.width = Math.round(w * 2 * dpr); c.bmp.height = Math.round(h * 2 * dpr)
      const bc = c.bmp.getContext('2d'), wide = {...cam, x: cam.x - mx / z, y: cam.y - my / z}
      paintWorld(bc, act, wide, dpr, viewport(wide, w * 2, h * 2), null, s)
      c.nodes = act; c.cam = cam; d = [0, 0]
    } else s.blits++
    if (off) { d = [d[0] + off[0], d[1] + off[1]]; if (Math.abs(d[0] * z) > mx || Math.abs(d[1] * z) > my) return false }
    lctx.setTransform(1, 0, 0, 1, 0, 0)
    lctx.globalAlpha = 1
    // only the part of the bitmap that lands on the canvas (a quarter of it): the copy is the raster cost
    const W = canvas.width, H = canvas.height, sx = Math.round((mx - d[0] * z) * dpr), sy = Math.round((my - d[1] * z) * dpr)
    lctx.drawImage(c.bmp, sx, sy, W, H, 0, 0, W, H)
    return true
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
      const skips = f.layers.map(l => l.outline ? ALL : fo ? new Set([...(l.active || []), ...fo.ids]) : l.active)
      if (f.repaint == 'full') {
        ground()
        mainValid = false
        f.layers.forEach(l => {
          let items = fo ? l.items.map(n => fo.ids.has(n.id) ? moved(n, fo.dx, fo.dy) : n) : l.items
          if (l.outline) items = items.map(n => outlined(n, l.outline!))
          paintWorld(ctx, items, cam, dpr, view, null, s)
        })
      } else {
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
          let act = sk === ALL ? l.items : l.items.filter(n => sk.has(n.id))
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
    },
    dispose() { st = ov = {bmp: null, region: null, zoom: 0, key: null}; blits.length = 0; live?.remove() },
  }
}
