/**
 * The Canvas 2D painter and hit test: nodes are plain data in one
 * vocabulary, whether they come from a data layer (`<shapes items={…}>`) or from JSX children.
 *
 *   { id, type: 'rect' | 'ellipse' | 'text' | 'frame' | 'line' | 'path' | 'image',
 *     x, y, width, height, rotation (deg), radius, fill, stroke, strokeWidth, dash, opacity,
 *     text, fontSize, fontFamily, fontWeight, hidden, locked, parent (the frame that clips it), name }
 *
 * - line: x1 y1 x2 y2 (and no box); path: d (Path2D, browser only)
 * - frame: a rect that clips the nodes whose `parent` is its id, with its `name` drawn above it
 * - text: wraps to its `width` (`wrap` 'word' | 'char' | 'none', `\n`, `maxLines` + `ellipsis`,
 *   `align`, `lineHeight`); no width: one line per `\n`, its box measured
 * - image (image.ts): `src` (loaded once per URL) or `image` (a loaded source), the crop `sx sy sw sh`,
 *   `fit` as CSS object-fit, `flipX` / `flipY`, `smoothing: false` for pixel art, `alt`
 * - hidden: not painted, not hit; locked: painted, not hit
 */
import {aabb, overlaps, hitBox, indexOf, type AABB, type Camera, type Pt} from './geometry'
import {imageOf, placement, natural} from './image'
export {indexOf}

export type Node = {[k: string]: any, id?: any, type: string}

const DEG = Math.PI / 180
export const font = (n: Node) => `${n.fontWeight || 400} ${n.fontSize || 16}px ${n.fontFamily || 'Inter, system-ui, sans-serif'}`

let mctx: any
const measurer = () => {
  if (mctx === undefined) {
    try { mctx = typeof OffscreenCanvas != 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null } catch (_) { mctx = null }
  }
  return mctx
}

export type TextOptions = {
  fontSize?: number, fontFamily?: string, fontWeight?: any,
  /** the box's width: lines wrap to it (unless `wrap` is 'none') */
  width?: number | null
  /** 'word' (default: at spaces and after hyphens; a longer word overflows, as in the DOM), 'char' (anywhere), 'none' */
  wrap?: 'word' | 'char' | 'none'
  /** at most this many lines; the last one kept ends in '…' (unless `ellipsis: false`) */
  maxLines?: number | null
  /** '…' where text is cut: by `maxLines` (default true), or, with `wrap: 'none'` and a width, a line wider than the box (only when true) */
  ellipsis?: boolean
  /** the line box as a multiple of fontSize (default 1.25) */
  lineHeight?: number
}
export type TextLayout = {lines: string[], width: number, height: number, lineHeight: number}

const ELLIPSIS = '\u2026'
// a break opportunity: a run of spaces, a word up to and with its hyphens, a word
const SEGMENTS = /\s+|[^\s-]*-+|\S+/g

/**
 * Lines and size of `text` in world units: wrapped to `width` (word by word, or anywhere with
 * `wrap: 'char'`), cut to `maxLines`. Measured on an offscreen canvas where there is one, estimated
 * elsewhere (Node, jsdom). `width` / `height` are the widest line's and the lines' (not the box's).
 */
export function layoutText(text: any, n: TextOptions = {}): TextLayout {
  const size = n.fontSize || 16, lh = size * (n.lineHeight || 1.25), ctx = measurer()
  if (ctx) ctx.font = font({type: 'text', ...n})
  const m = (s: string) => ctx ? ctx.measureText(s).width : s.length * size * 0.55
  const max = typeof n.width == 'number' && n.wrap != 'none' ? n.width + 0.5 : Infinity
  const lines: string[] = []
  for (const para of String(text ?? '').split('\n')) {
    if (max == Infinity) { lines.push(para); continue }
    if (n.wrap == 'char') {
      let line = ''
      for (const ch of para) {
        if (line && m(line + ch) > max) { lines.push(line); line = ch.trim() ? ch : '' }
        else line += ch
      }
      lines.push(line)
      continue
    }
    let line = '', space = '', first = true
    for (const seg of para.match(SEGMENTS) || []) {
      if (!seg.trim()) { space += seg; continue }
      // (a paragraph's leading spaces stay; the spaces at a break go; a word longer than the box overflows)
      if (first) line = space + seg, first = false
      else if (m(line + space + seg) > max) { lines.push(line); line = seg }
      else line += space + seg
      space = ''
    }
    lines.push(first ? space : line)
  }
  const cut = n.maxLines != null && n.maxLines > 0 && lines.length > n.maxLines
  if (cut) lines.length = n.maxLines!
  const room = typeof n.width == 'number' ? n.width + 0.5 : Infinity
  const shorten = (l: string) => {
    let s = l.trimEnd()
    while (s && m(s + ELLIPSIS) > room) s = Array.from(s).slice(0, -1).join('').trimEnd()
    return s + ELLIPSIS
  }
  if (cut && n.ellipsis !== false) lines[lines.length - 1] = shorten(lines[lines.length - 1])
  if (n.ellipsis === true && n.wrap == 'none' && room < Infinity) lines.forEach((l, i) => { if (m(l) > room) lines[i] = shorten(l) })
  let w = 0
  for (const l of lines) w = Math.max(w, m(l))
  return {lines, width: Math.ceil(w), height: Math.ceil(lines.length * lh), lineHeight: lh}
}

/**
 * text's natural size in world units: one line per `\n`, unwrapped (its font from `n`, which may be
 * the node itself: its width and wrapping are ignored). An auto-width text box's size; `layoutText`
 * for the lines a box of a given width shows
 */
export function measureText(text: string, n: TextOptions = {}) {
  const l = layoutText(text, {fontSize: n.fontSize, fontFamily: n.fontFamily, fontWeight: n.fontWeight, lineHeight: n.lineHeight})
  return {width: l.width, height: l.height}
}

// one layout per text node (nodes are immutable data: identity is the key)
const layouts = new WeakMap<object, TextLayout>()
export const textLayout = (n: Node): TextLayout => {
  let l = layouts.get(n)
  if (!l) layouts.set(n, l = layoutText(n.text, n as TextOptions))
  return l
}

const sizes = new WeakMap<object, Node>()
/**
 * the node with its box: a text node without width / height gets its laid-out size, an image
 * without them its natural size once loaded (the DOM's <img>). Others as they are
 */
export function sized(n: Node): Node {
  if (n.width != null && n.height != null || n.type != 'text' && n.type != 'image') return n
  let s = sizes.get(n)
  if (s) return s
  let w = 0, h = 0
  if (n.type == 'text') { const l = textLayout(n); w = l.width; h = l.height }
  else {
    const img = imageOf(n)
    if (!img) return {...n, width: n.width ?? 0, height: n.height ?? 0}
    const [W, H] = natural(img), sw = n.sw ?? W - (n.sx ?? 0), sh = n.sh ?? H - (n.sy ?? 0)
    // one side given: the other keeps the aspect ratio
    w = n.width ?? (n.height != null && sh ? n.height * sw / sh : sw); h = n.height ?? (n.width != null && sw ? n.width * sh / sw : sh)
  }
  sizes.set(n, s = {...n, width: n.width ?? w, height: n.height ?? h})
  return s
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
    const b = sized(n), cx = n.x + b.width / 2, cy = n.y + b.height / 2
    ctx.translate(cx, cy); ctx.rotate(rot * DEG); ctx.translate(-cx, -cy)
  }
  const fill = n.fill ?? (n.type == 'line' ? null : n.type == 'text' ? '#000' : null)
  if (n.type == 'text') {
    const L = textLayout(n), size = n.fontSize || 16, a = n.align
    ctx.font = font(n)
    ctx.textBaseline = 'top'
    ctx.textAlign = a == 'center' || a == 'right' ? a : 'left'
    ctx.fillStyle = fill
    // aligned in the box (its width, else the widest line's); the glyphs centred in each line box
    const x = n.x + (a == 'center' ? (n.width ?? L.width) / 2 : a == 'right' ? n.width ?? L.width : 0)
    const off = size * 0.12 + (L.lineHeight - size * 1.25) / 2
    for (let i = 0; i < L.lines.length; i++) ctx.fillText(L.lines[i], x, n.y + i * L.lineHeight + off)
  } else if (n.type == 'image') {
    const img = imageOf(n), p = img && placement(n, img)
    if (p) {
      const flip = n.flipX || n.flipY
      if (flip) {
        const b = sized(n), cx = n.x + b.width / 2, cy = n.y + b.height / 2
        ctx.save(); ctx.translate(cx, cy); ctx.scale(n.flipX ? -1 : 1, n.flipY ? -1 : 1); ctx.translate(-cx, -cy)
      }
      if (n.smoothing === false) ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh)
      if (n.smoothing === false) ctx.imageSmoothingEnabled = true
      if (flip) ctx.restore()
    }
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
    if (view && n.type != 'line' && n.type != 'path' && !overlaps(aabb(sized(n) as any), view)) { culled++; continue }
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
    } else if (n.type != 'path' && hitBox(sized(n) as any, p, slop)) return n
  }
  return null
}
