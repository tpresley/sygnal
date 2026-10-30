/**
 * README §5: the same stress document painted and hit-tested by three backends, outside any app
 * (no Sygnal, no React): what the backing costs by itself.
 *
 * - own: lib/canvas's Canvas 2D painter (paintWorld + hitNodes), full repaint and the layered
 *   strategy (a cached static bitmap + the moving shape)
 * - konva: one Konva.Rect / Ellipse / Text per shape on a Layer; hit tests through its hit canvas
 * - pixi: one Graphics / Text per shape in a Container (WebGL); hit tests through its EventBoundary
 *
 * window.bench(name, n) → {create, frameMove, frameMoveLayered, framePan, hit, ...} in ms (medians).
 * Every timed frame ends with a 1-pixel read-back, so deferred GPU work is inside the number.
 */
import Konva from 'konva'
import {Application, Container, Graphics, Text} from 'pixi.js'
import {stress} from '../app/doc'
import {paintWorld, hitNodes, viewport, fit, union, type Camera} from '../lib/canvas'

const W = 1200, H = 800
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)] * 100) / 100 }
const time = (f: () => void, n = 30) => { const out: number[] = []; for (let i = 0; i < n; i++) { const t = performance.now(); f(); out.push(performance.now() - t) } return med(out) }
const points = (cam: Camera, k = 200) => Array.from({length: k}, (_, i) => ({sx: (i * 97) % W, sy: (i * 61) % H})).map(p => ({...p, wx: p.sx / cam.zoom + cam.x, wy: p.sy / cam.zoom + cam.y}))

function host() {
  document.body.innerHTML = ''
  const d = document.createElement('div')
  d.style.cssText = `width:${W}px;height:${H}px`
  document.body.appendChild(d)
  return d
}

async function own(n: number) {
  const el = host(), canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  el.appendChild(canvas)
  const ctx = canvas.getContext('2d')!
  const t0 = performance.now()
  let items = stress(n)
  const cam = fit(union(items), W, H, 40, 1), view = viewport(cam, W, H)
  const draw = (skip?: Set<any>) => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, 0, W, H); paintWorld(ctx, items, cam, 1, view, skip) }
  const flush = () => ctx.getImageData(0, 0, 1, 1)
  draw(); flush()
  const create = performance.now() - t0
  let k = 0
  const frameMove = time(() => { k++; items = items.map((s, i) => i == 0 ? {...s, x: k} : s); draw(); flush() })
  // layered: everything but shape 0 once as a bitmap, then per frame the bitmap + shape 0
  const bmp = document.createElement('canvas'); bmp.width = W; bmp.height = H
  const b = bmp.getContext('2d')!
  b.fillStyle = '#f5f5f5'; b.fillRect(0, 0, W, H); paintWorld(b, items, cam, 1, view, new Set(['s0']))
  const frameMoveLayered = time(() => { k++; items = items.map((s, i) => i == 0 ? {...s, x: k} : s); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bmp, 0, 0); paintWorld(ctx, [items[0]], cam, 1, view); flush() })
  let pan = 0
  const framePan = time(() => { pan++; const c = {...cam, x: cam.x - pan}; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillRect(0, 0, W, H); paintWorld(ctx, items, c, 1, viewport(c, W, H)); flush() })
  const ps = points(cam)
  const hit = time(() => { for (const p of ps) hitNodes(items, {x: p.wx, y: p.wy}) }, 5) / ps.length
  keep = items
  teardown = () => { keep = null; el.remove() }
  return {create, frameMove, frameMoveLayered, framePan, hit}
}

async function konva(n: number) {
  const el = host()
  const t0 = performance.now()
  const items = stress(n)
  const cam = fit(union(items), W, H, 40, 1)
  const stage = new Konva.Stage({container: el, width: W, height: H})
  const layer = new Konva.Layer({scaleX: cam.zoom, scaleY: cam.zoom, x: -cam.x * cam.zoom, y: -cam.y * cam.zoom})
  stage.add(layer)
  const nodes: any[] = []
  for (const s of items) {
    const common = {id: s.id, fill: s.fill, rotation: s.rotation, opacity: s.opacity}
    const node = s.type == 'ellipse' ? new Konva.Ellipse({...common, x: s.x + s.width / 2, y: s.y + s.height / 2, radiusX: s.width / 2, radiusY: s.height / 2})
      : s.type == 'text' ? new Konva.Text({...common, x: s.x, y: s.y, text: s.text, fontSize: s.fontSize})
      : new Konva.Rect({...common, x: s.x, y: s.y, width: s.width, height: s.height, cornerRadius: s.radius})
    nodes.push(node)
    layer.add(node)
  }
  const canvas: HTMLCanvasElement = (layer.getCanvas() as any)._canvas
  const c2 = canvas.getContext('2d')!
  const flush = () => c2.getImageData(0, 0, 1, 1)
  layer.draw(); flush()
  const create = performance.now() - t0
  let k = 0
  const frameMove = time(() => { k++; nodes[0].x(k); layer.draw(); flush() })
  // Konva's own answer for a drag: move the node to a second layer (its docs: "drag layer")
  const top = new Konva.Layer({scaleX: cam.zoom, scaleY: cam.zoom, x: -cam.x * cam.zoom, y: -cam.y * cam.zoom}); stage.add(top)
  nodes[0].moveTo(top); layer.draw(); top.draw()
  const tc = (top.getCanvas() as any)._canvas.getContext('2d')
  const frameMoveLayered = time(() => { k++; nodes[0].x(k); top.draw(); tc.getImageData(0, 0, 1, 1) })
  nodes[0].moveTo(layer)
  let pan = 0
  const framePan = time(() => { pan++; layer.x(-cam.x * cam.zoom + pan); layer.draw(); flush() })
  const ps = points(cam)
  stage.getIntersection({x: 1, y: 1}) // the hit graph is drawn on first use
  const hit = time(() => { for (const p of ps) stage.getIntersection({x: p.sx, y: p.sy}) }, 5) / ps.length
  // the hit canvas is redrawn after a change: the first hit test after a move pays for it
  const hitAfterMove = time(() => { k++; nodes[0].x(k); layer.draw(); stage.getIntersection({x: 5, y: 5}) }, 10)
  teardown = () => stage.destroy()
  return {create, frameMove, frameMoveLayered, framePan, hit, hitAfterMove}
}

async function pixi(n: number) {
  const el = host()
  const t0 = performance.now()
  const items = stress(n)
  const cam = fit(union(items), W, H, 40, 1)
  const app = new Application()
  await app.init({width: W, height: H, background: '#f5f5f5', preference: 'webgl', antialias: true, autoStart: false, preserveDrawingBuffer: true})
  el.appendChild(app.canvas)
  const world = new Container({scale: cam.zoom, x: -cam.x * cam.zoom, y: -cam.y * cam.zoom})
  app.stage.addChild(world)
  app.stage.eventMode = 'static'
  const nodes: any[] = []
  for (const s of items) {
    let node: any
    if (s.type == 'text') node = new Text({text: s.text, style: {fontSize: s.fontSize, fill: s.fill}, x: s.x, y: s.y})
    else {
      node = new Graphics()
      if (s.type == 'ellipse') node.ellipse(s.width / 2, s.height / 2, s.width / 2, s.height / 2)
      else node.rect(0, 0, s.width, s.height)
      node.fill(s.fill)
      node.position.set(s.x, s.y)
    }
    node.eventMode = 'static'
    node.label = s.id
    nodes.push(node)
    world.addChild(node)
  }
  const gl: any = (app.renderer as any).gl
  const flush = () => { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) }
  app.render(); flush()
  const create = performance.now() - t0
  let k = 0
  const frameMove = time(() => { k++; nodes[0].x = k; app.render(); flush() })
  let pan = 0
  const framePan = time(() => { pan++; world.x = -cam.x * cam.zoom + pan; app.render(); flush() })
  const ps = points(cam)
  const boundary = (app.renderer as any).events.rootBoundary
  // set by the event system's own pointer listeners; a direct hit test needs it
  boundary.rootTarget = app.stage
  const hit = time(() => { for (const p of ps) boundary.hitTest(p.sx, p.sy) }, 5) / ps.length
  const renderer = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)
  teardown = () => app.destroy(true, {children: true})
  return {create, frameMove, frameMoveLayered: null, framePan, hit, renderer}
}

let teardown = () => {}, keep: any = null
;(window as any).teardown = () => { teardown(); teardown = () => {}; void keep }
;(window as any).bench = async (name: string, n: number) => {
  const r: any = await ({own, konva, pixi} as any)[name](n)
  for (const k in r) if (typeof r[k] == 'number') r[k] = Math.round(r[k] * 1000) / 1000
  return r
}
