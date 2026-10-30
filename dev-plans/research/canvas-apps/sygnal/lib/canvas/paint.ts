/**
 * The Canvas 2D painter and hit test (sygnal/canvas proposal): nodes are plain data in one
 * vocabulary, whether they come from a data layer (`<shapes items={…}>`) or from JSX children.
 *
 *   { id, type: 'rect' | 'ellipse' | 'text' | 'frame' | 'line' | 'path',
 *     x, y, width, height, rotation (deg), radius, fill, stroke, strokeWidth, dash, opacity,
 *     text, fontSize, fontFamily, fontWeight, hidden, locked, parent (the frame that clips it), name }
 *
 * - line: x1 y1 x2 y2 (and no box); path: d (Path2D, browser only)
 * - frame: a rect that clips the nodes whose `parent` is its id, with its `name` drawn above it
 * - hidden: not painted, not hit; locked: painted, not hit
 */
import {aabb, overlaps, hitBox, type AABB, type Camera, type Pt} from './geometry'

export type Node = {[k: string]: any, id?: any, type: string}

const DEG = Math.PI / 180
const lines = (t: any) => String(t ?? '').split('\n')
export const font = (n: Node) => `${n.fontWeight || 400} ${n.fontSize || 16}px ${n.fontFamily || 'Inter, system-ui, sans-serif'}`

let mctx: any
/** text size in world units: an offscreen canvas where there is one, an estimate elsewhere (Node, jsdom) */
export function measureText(text: string, n: {fontSize?: number, fontFamily?: string, fontWeight?: any} = {}) {
  const size = n.fontSize || 16, ls = lines(text)
  if (mctx === undefined) {
    try { mctx = typeof OffscreenCanvas != 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null } catch (_) { mctx = null }
  }
  let w = 0
  if (mctx) { mctx.font = font({type: 'text', ...n}); for (const l of ls) w = Math.max(w, mctx.measureText(l).width) }
  else for (const l of ls) w = Math.max(w, l.length * size * 0.55)
  return {width: Math.ceil(w), height: Math.ceil(ls.length * size * 1.25)}
}

const byId = new WeakMap<any[], Map<any, Node>>()
export const indexOf = (items: Node[]) => {
  let m = byId.get(items)
  if (!m) { m = new Map(); for (const n of items) if (n.id != null) m.set(n.id, n); byId.set(items, m) }
  return m
}

function shape(ctx: any, n: Node) {
  ctx.beginPath()
  const t = n.type
  if (t == 'ellipse') ctx.ellipse(n.x + n.width / 2, n.y + n.height / 2, Math.abs(n.width / 2), Math.abs(n.height / 2), 0, 0, Math.PI * 2)
  else if (t == 'line') { ctx.moveTo(n.x1, n.y1); ctx.lineTo(n.x2, n.y2) }
  else if (n.radius && ctx.roundRect) ctx.roundRect(n.x, n.y, n.width, n.height, Math.min(n.radius, Math.abs(n.width) / 2, Math.abs(n.height) / 2))
  else ctx.rect(n.x, n.y, n.width, n.height)
}

/** one node in the current transform (world or screen) */
export function paintNode(ctx: any, n: Node, unit = 1) {
  const rot = n.rotation || 0
  ctx.globalAlpha = n.opacity ?? 1
  if (rot) {
    ctx.save()
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2
    ctx.translate(cx, cy); ctx.rotate(rot * DEG); ctx.translate(-cx, -cy)
  }
  const fill = n.fill ?? (n.type == 'line' ? null : n.type == 'text' ? '#000' : null)
  if (n.type == 'text') {
    ctx.font = font(n)
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillStyle = fill
    const ls = lines(n.text), lh = (n.fontSize || 16) * 1.25
    for (let i = 0; i < ls.length; i++) ctx.fillText(ls[i], n.x, n.y + i * lh + (n.fontSize || 16) * 0.12)
  } else if (n.type == 'path') {
    const p = n.$path ||= new (globalThis as any).Path2D(n.d)
    if (fill) { ctx.fillStyle = fill; ctx.fill(p) }
    if (n.stroke) { ctx.strokeStyle = n.stroke; ctx.lineWidth = (n.strokeWidth ?? 1) * unit; ctx.stroke(p) }
  } else {
    shape(ctx, n)
    if (fill && fill != 'none') { ctx.fillStyle = fill; ctx.fill() }
    if (n.stroke && n.stroke != 'none' && (n.strokeWidth ?? 1) > 0) {
      ctx.strokeStyle = n.stroke
      ctx.lineWidth = (n.strokeWidth ?? 1) * unit
      if (n.dash) ctx.setLineDash(n.dash.map((d: number) => d * unit))
      ctx.stroke()
      if (n.dash) ctx.setLineDash([])
    }
  }
  if (rot) ctx.restore()
}

export type PaintStats = {nodes: number, culled: number, ms: number}

/**
 * paint `items` in world coordinates under camera `cam`; `view` culls (world AABB); `skip` leaves
 * out ids (the layered strategy paints them elsewhere)
 */
export function paintWorld(ctx: any, items: Node[], cam: Camera, dpr: number, view: AABB | null, skip?: Set<any> | null, st?: PaintStats) {
  const z = cam.zoom
  ctx.setTransform(dpr * z, 0, 0, dpr * z, -cam.x * z * dpr, -cam.y * z * dpr)
  const idx = indexOf(items)
  let clip: any = undefined, drawn = 0, culled = 0
  for (const n of items) {
    if (n.hidden || skip?.has(n.id)) continue
    const parent = n.parent != null ? idx.get(n.parent) : null
    if (parent?.hidden) continue
    if (view && n.type != 'line' && n.type != 'path' && !overlaps(aabb(n as any), view)) { culled++; continue }
    // a frame clips its children: one clip per run of siblings
    if (parent !== clip) {
      if (clip) ctx.restore()
      clip = parent
      if (clip) {
        ctx.save()
        if (clip.rotation) { const cx = clip.x + clip.width / 2, cy = clip.y + clip.height / 2; ctx.translate(cx, cy); ctx.rotate(clip.rotation * DEG); ctx.translate(-cx, -cy) }
        shape(ctx, {...clip, type: 'rect'})
        ctx.clip()
        if (clip.rotation) { const cx = clip.x + clip.width / 2, cy = clip.y + clip.height / 2; ctx.translate(cx, cy); ctx.rotate(-clip.rotation * DEG); ctx.translate(-cx, -cy) }
      }
    }
    paintNode(ctx, n.type == 'frame' ? {...n, type: 'rect', fill: n.fill ?? '#fff'} : n, 1 / z)
    drawn++
  }
  if (clip) ctx.restore()
  // frame names above their frames, at a constant screen size
  ctx.globalAlpha = 1
  for (const n of items) if (n.type == 'frame' && !n.hidden && !skip?.has(n.id) && n.parent == null && (!view || overlaps(aabb(n as any), view))) {
    ctx.font = `${11 / z}px Inter, system-ui, sans-serif`
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = '#666'
    ctx.fillText(n.name || 'Frame', n.x, n.y - 4 / z)
  }
  if (st) { st.nodes += drawn; st.culled += culled }
}

/** the topmost node at world point p: reverse paint order, frames clip their children */
export function hitNodes(items: Node[], p: Pt, slop = 0): Node | null {
  const idx = indexOf(items)
  for (let i = items.length - 1; i >= 0; i--) {
    const n = items[i]
    if (n.hidden || n.locked || n.pointerEvents == 'none') continue
    const parent = n.parent != null ? idx.get(n.parent) : null
    if (parent && (parent.hidden || !hitBox(parent as any, p))) continue
    if (n.type == 'line') {
      const dx = n.x2 - n.x1, dy = n.y2 - n.y1, l = dx * dx + dy * dy
      const t = l ? Math.max(0, Math.min(1, ((p.x - n.x1) * dx + (p.y - n.y1) * dy) / l)) : 0
      if (Math.hypot(p.x - n.x1 - t * dx, p.y - n.y1 - t * dy) <= Math.max(slop, (n.strokeWidth || 1) / 2)) return n
    } else if (n.type != 'path' && hitBox(n as any, p, slop)) return n
  }
  return null
}
