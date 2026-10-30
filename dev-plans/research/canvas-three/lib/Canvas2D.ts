/**
 * <Canvas2D>: a retained 2D scene painted on a <canvas>, with hit testing turned into DOM events.
 *
 *   <Canvas2D className="chart" width={360} height={200}>
 *     {bars.map(b => <rect className="bar" key={b.id} x={b.x} y={b.y} width={20} height={b.h} fill="#4f8cff" />)}
 *     <text x={10} y={20} fill="#ccc">Sales</text>
 *   </Canvas2D>
 *
 * The vocabulary is SVG's (g, rect, circle, line, text, path), so the pragma already gives these
 * tags the SVG namespace and their props as attributes: the hidden children are real SVG elements
 * (selectable, isolated, readable by an accessibility tree), and the painter reads the attribute
 * values as the view wrote them (numbers stay numbers in the vnode).
 *
 * - g: x / y translate its children, opacity multiplies.
 * - rect (x y width height rx fill stroke strokeWidth), circle (cx cy r), line (x1 y1 x2 y2),
 *   text (x y fontSize fill textAnchor; its text children), path (d; Path2D, browser only).
 * - Hit testing: the display list in reverse paint order; `pointer-events="none"` (or
 *   pointerEvents) skips an element. A miss reaches nothing (the native canvas event still bubbles).
 * - Paint on demand: one frame after a sync.
 *
 * PixiJS or Konva could replace the painter (optional peer dependencies, D209): their scene graph
 * would be built from the same vnodes, as the three target does; their own hit testing would
 * produce the element for the router.
 */
import {defineIsland} from './island'
import {pointerRouter} from './events'

type Item = {el: any, tag: string, a: any, ox: number, oy: number, alpha: number, text?: string, path?: any}

const tagOf = (sel: string) => /^[^#.]*/.exec(sel)![0]
const num = (v: any, d = 0) => v == null || v === '' ? d : +v
const textOf = (v: any): string => v.text != null ? String(v.text) : (v.children || []).map(textOf).join('')

/** the display list: every drawable element in paint order, with its offset */
export function displayList(container: any): Item[] {
  const out: Item[] = []
  const walk = (kids: any[] | undefined, ox: number, oy: number, alpha: number) => {
    if (kids) for (const v of kids) {
      if (!v?.sel) continue
      const tag = tagOf(v.sel), a = {...v.data?.props, ...v.data?.attrs}
      if (a.display == 'none' || a.visibility == 'hidden') continue
      const al = alpha * num(a.opacity, 1)
      if (tag == 'g') { walk(v.children, ox + num(a.x), oy + num(a.y), al); continue }
      if (/^(rect|circle|line|text|path)$/.test(tag)) out.push({el: v.elm, tag, a, ox, oy, alpha: al, text: tag == 'text' ? textOf(v) : undefined})
      else walk(v.children, ox, oy, al)
    }
  }
  walk(container?.children, 0, 0, 1)
  return out
}

function paint(ctx: any, list: Item[], w: number, h: number, background?: string, dpr = 1) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h) }
  for (const it of list) {
    const a = it.a
    ctx.save()
    ctx.translate(it.ox, it.oy)
    ctx.globalAlpha = it.alpha
    ctx.lineWidth = num(a.strokeWidth ?? a['stroke-width'], 1)
    const fill = a.fill ?? (it.tag == 'line' ? 'none' : '#000'), stroke = a.stroke
    ctx.beginPath()
    if (it.tag == 'rect') {
      const r = num(a.rx)
      ctx.roundRect ? ctx.roundRect(num(a.x), num(a.y), num(a.width), num(a.height), r) : ctx.rect(num(a.x), num(a.y), num(a.width), num(a.height))
    } else if (it.tag == 'circle') ctx.arc(num(a.cx), num(a.cy), num(a.r), 0, Math.PI * 2)
    else if (it.tag == 'line') { ctx.moveTo(num(a.x1), num(a.y1)); ctx.lineTo(num(a.x2), num(a.y2)) }
    if (it.tag == 'text') {
      ctx.font = `${num(a.fontSize ?? a['font-size'], 12)}px ${a.fontFamily || 'system-ui, sans-serif'}`
      ctx.textAlign = a.textAnchor == 'middle' ? 'center' : a.textAnchor == 'end' ? 'right' : 'left'
      ctx.fillStyle = fill
      ctx.fillText(it.text, num(a.x), num(a.y))
    } else if (it.tag == 'path') {
      const p = it.path ||= new (globalThis as any).Path2D(a.d)
      if (fill != 'none') { ctx.fillStyle = fill; ctx.fill(p) }
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(p) }
    } else {
      if (fill != 'none') { ctx.fillStyle = fill; ctx.fill() }
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke() }
    }
    ctx.restore()
  }
}

/** the topmost element at (x, y) */
export function hitTest(list: Item[], x: number, y: number, ctx?: any): Item | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i], a = it.a
    if ((a.pointerEvents ?? a['pointer-events']) == 'none') continue
    const px = x - it.ox, py = y - it.oy
    let hit = false
    if (it.tag == 'rect') hit = px >= num(a.x) && px <= num(a.x) + num(a.width) && py >= num(a.y) && py <= num(a.y) + num(a.height)
    else if (it.tag == 'circle') hit = Math.hypot(px - num(a.cx), py - num(a.cy)) <= num(a.r)
    else if (it.tag == 'line') {
      const x1 = num(a.x1), y1 = num(a.y1), dx = num(a.x2) - x1, dy = num(a.y2) - y1, l = dx * dx + dy * dy
      const t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0
      hit = Math.hypot(px - x1 - t * dx, py - y1 - t * dy) <= Math.max(3, num(a.strokeWidth, 1) / 2)
    } else if (it.tag == 'text') {
      // an estimate without a context to measure with
      const size = num(a.fontSize, 12), w = ctx ? (ctx.font = `${size}px system-ui, sans-serif`, ctx.measureText(it.text).width) : it.text!.length * size * 0.6
      const x0 = num(a.x) - (a.textAnchor == 'middle' ? w / 2 : a.textAnchor == 'end' ? w : 0)
      hit = px >= x0 && px <= x0 + w && py <= num(a.y) && py >= num(a.y) - size
    } else if (it.tag == 'path' && ctx && (globalThis as any).Path2D) hit = ctx.isPointInPath(it.path ||= new (globalThis as any).Path2D(a.d), px, py)
    if (hit) return it
  }
  return null
}

const headless = (el: any) => typeof navigator == 'undefined' || /jsdom/i.test(navigator.userAgent) || !el.ownerDocument?.defaultView?.CanvasRenderingContext2D

export const Canvas2D = defineIsland({
  name: 'canvas2d',
  mount(el, props) {
    const doc = el.ownerDocument, win = doc.defaultView
    const canvas = doc.createElement('canvas')
    const dpr = win?.devicePixelRatio || 1
    let w = props.width || 300, h = props.height || 150
    const size = () => { canvas.width = w * dpr; canvas.height = h * dpr; if (canvas.style) canvas.style.width = w + 'px', canvas.style.height = h + 'px' }
    size()
    el.appendChild(canvas)
    const ctx = headless(el) ? null : canvas.getContext('2d')
    const inst: any = {canvas, ctx, list: [] as Item[], paints: 0, background: props.background}
    const raf = win?.requestAnimationFrame?.bind(win)
    let pending = 0
    inst.invalidate = () => {
      if (!ctx || pending) return
      pending = raf ? raf(inst.draw) : setTimeout(inst.draw, 0)
    }
    inst.draw = () => { pending = 0; paint(ctx, inst.list, w, h, inst.background, dpr); inst.paints++ }
    inst.resize = (W: number, H: number) => { w = W; h = H; size(); inst.invalidate() }
    inst.pick = (x: number, y: number) => {
      const it = hitTest(inst.list, x, y, ctx)
      return it && {el: it.el, x, y, local: [x - it.ox, y - it.oy]}
    }
    inst.router = pointerRouter(inst.pick, el.firstChild)
    inst.pointer = (kind: string, x: number, y: number, init?: any) => inst.router.input(kind, x, y, init)
    const offs = [['pointermove', 'move'], ['pointerdown', 'down'], ['pointerup', 'up'], ['pointerleave', 'leave'], ['dblclick', 'dblclick']].map(([type, kind]) => {
      const f = (e: any) => inst.router.input(kind, e.offsetX, e.offsetY, e)
      canvas.addEventListener(type, f)
      return () => canvas.removeEventListener(type, f)
    })
    inst.dispose = () => { offs.forEach(f => f()); canvas.remove() }
    return inst
  },
  update(inst, props, prev) {
    if (props.width != prev.width || props.height != prev.height) inst.resize(props.width || 300, props.height || 150)
    if (props.background != prev.background) { inst.background = props.background; inst.invalidate() }
  },
  sync(inst, children) {
    inst.list = displayList(children)
    inst.invalidate()
  },
  unmount: (inst) => inst.dispose(),
})
