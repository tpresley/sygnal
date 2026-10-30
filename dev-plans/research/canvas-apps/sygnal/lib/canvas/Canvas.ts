/**
 * <Canvas>: an infinite 2D canvas island (sygnal/canvas proposal).
 *
 *   <Canvas className="board" camera={state.camera} background="#f5f5f5" grid>
 *     <shapes className="doc" items={state.shapes} />                 // a data layer: one element
 *     <rect className="handle" data={{ part: 'se' }} space="screen" … />     // JSX nodes: one element each
 *   </Canvas>
 *
 * Children (the island's, rendered hidden but accessible):
 * - `<shapes items={nodes}>`: a data layer. The nodes are plain data (paint.ts's vocabulary) and
 *   are painted and hit-tested by the canvas; no element per node. A hit dispatches on the layer's
 *   element with `event.hit` = the node's id (`event.node` its data). `active={ids}`: nodes that
 *   are about to change every frame (a drag): painted on the live layer, so the rest stays cached.
 *   `outline={color}`: a layer that paints its nodes' outlines (1 screen px) and is never hit
 *   (selection and hover outlines, peers' selections).
 * - Any other node tag (`rect ellipse text line path frame`, a `g` to group): one element per node,
 *   for handles, guides, a marquee, a few interactive things with their own intents. World
 *   coordinates, or `space="screen"` (canvas pixels: handles keep their size at any zoom).
 *   Components and <Collection> work inside, as in any island.
 *
 * Input: native pointer events → captureRouter → DOM events on the picked element, every one with
 * `world`, `screen`, `hit`, `node`. A miss targets the children container, so one listener on the
 * Canvas's className sees every press. Pointer capture as sygnal/three defines it (router.ts):
 * `capture="all"` (default: every press) or `"explicit"` (a `capture` prop, or setPointerCapture).
 * The native events stop at the canvas element; a press blurs a focused field and prevents the
 * mouse compatibility defaults.
 *
 * Navigation (built in, `navigate={false}` turns it off): wheel pans, ctrl/⌘-wheel and trackpad
 * pinch zoom toward the cursor, space-drag and middle-drag pan. The camera is a controlled value
 * (src/extra/controlled.ts): the canvas moves it itself and reports `camerachange` (detail: the
 * camera, at most once a frame); a `camera` prop the app changes (zoom to fit, 100 %) is written.
 * Pan and zoom never go through the app's state per frame unless the app stores the camera.
 *
 * `follow={{ ids, from, map? }}` (experimental, the transient channel): while set, those data
 * nodes follow the pointer by (world − from), mapped by `map(dx, dy)`, painted by the canvas with
 * no pointermove events to the app; the app commits on pointerup. `animate` for drags.
 *
 * Painting: on demand, once a frame after a sync / camera change. `repaint="layers"` (default):
 * the data layers without their `active` nodes are cached as a bitmap until a node outside
 * `active` changes or the camera moves; the live layer (active nodes, JSX nodes) repaints every
 * time; 64 or more live nodes that only translated since they were painted are one bitmap blit.
 * `repaint="full"` repaints everything. Off-screen nodes are culled.
 */
import {defineWidget} from 'sygnal'
import {controlled} from '../../../../../../src/extra/controlled'
import {CAMERA, toWorld, viewport, zoomAt, panBy, aabb, type Camera} from './geometry'
import {paintWorld, paintNode, hitNodes, measureText, type Node} from './paint'
import {captureRouter} from './router'

const tagOf = (sel: string) => /^[^#.]*/.exec(sel)![0]
const NODE = /^(rect|ellipse|text|line|path|frame)$/
const OWN = /^(className|class|key|style|role|tabIndex|title|ref|hook|attrs|data|space)$|^(aria|data)-/
const textOf = (v: any): string => v.text != null ? String(v.text) : (v.children || []).map(textOf).join('')

type Layer = {el: any, items: Node[], active: Set<any> | null, els?: Map<any, any>, outline?: string}
type Live = {el: any, node: Node, screen: boolean}

// one node object per vnode: an unchanged child (a Collection item that didn't re-render keeps its
// vnode) keeps its node, so the static layer's cache survives
const nodes = new WeakMap<any, Node>()
function nodeOf(v: any, tag: string, p: any): Node {
  let n = nodes.get(v)
  if (n) return n
  n = {type: tag}
  for (const k in p) if (!OWN.test(k)) n[k.replace(/-(\w)/g, (_: string, c: string) => c.toUpperCase())] = p[k]
  if (tag == 'text') { n.text = textOf(v); const m = measureText(n.text, n); n.width ??= m.width; n.height ??= m.height }
  nodes.set(v, n)
  return n
}

/**
 * the island's children → layers + screen-space JSX nodes. A run of world-space JSX nodes is a
 * layer too (painted, culled and clipped like a data layer; its hits target each node's element)
 */
export function readChildren(container: any) {
  const layers: Layer[] = [], live: Live[] = []
  let jsx: Layer | null = null
  const walk = (kids: any[] | undefined, screen: boolean) => {
    if (kids) for (const v of kids) {
      if (!v?.sel) continue
      const tag = tagOf(v.sel), d = v.data || {}, p = {...d.attrs, ...d.props}
      if (p.display == 'none') continue
      if (tag == 'shapes') { layers.push({el: v.elm, items: d.props?.items || [], active: p.active?.length ? new Set(p.active) : null, outline: p.outline}); jsx = null; continue }
      const sc = p.space ? p.space == 'screen' : screen
      if (NODE.test(tag)) {
        const node = nodeOf(v, tag, p)
        if (sc) { if (!node.hidden) live.push({el: v.elm, node, screen: true}) }
        else {
          if (!jsx) layers.push(jsx = {el: null, items: [], active: null, els: new Map()})
          jsx.items.push(node)
          jsx.els!.set(node.id ?? node, v.elm)
        }
      } else walk(v.children, sc)
    }
  }
  walk(container?.children, false)
  return {layers, live}
}

const headless = (el: any) => typeof navigator == 'undefined' || /jsdom/i.test(navigator.userAgent) || !el.ownerDocument?.defaultView?.CanvasRenderingContext2D
const sameCam = (a: Camera, b: Camera) => a.x == b.x && a.y == b.y && a.zoom == b.zoom
// an outline layer paints every node's outline (1 screen px) and is never hit
const ALL = new Set<any>()
const outlined = (n: Node, color: string): Node => ({...n, type: n.type == 'ellipse' ? 'ellipse' : 'rect', fill: 'none', stroke: color, strokeWidth: 1, dash: null, opacity: 1, rotation: n.rotation})
const BLIT_MIN = 64
const NONE: Node[] = []
/** [dx, dy] when every node of b is the same node of a moved by one (dx, dy), else null */
function translation(a: Node[], b: Node[]): [number, number] | null {
  const dx = b[0].x - a[0].x, dy = b[0].y - a[0].y
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i]
    if (p === q) { if (dx || dy) return null; continue }
    if (q.x - p.x !== dx || q.y - p.y !== dy) return null
    for (const k in q) if (k != 'x' && k != 'y' && q[k] !== p[k]) return null
  }
  return [dx, dy]
}
const TYPING = /^(INPUT|TEXTAREA|SELECT)$/

export const Canvas = defineWidget({
  name: 'Canvas',
  children: true,
  // no `tags`: it is app-wide (the pragma's tag table), so it would turn the toolbar's SVG icons
  // into HTML elements. rect/ellipse/text/line/path/g stay SVG; sync reads attrs and props alike.
  events: ['camerachange', 'canvasresize'],
  mount(el: any, props: any, emit: any) {
    const doc = el.ownerDocument, win = doc.defaultView
    const canvas = doc.createElement('canvas')
    canvas.className = 'sygnal-canvas'
    Object.assign(canvas.style, {display: 'block', width: '100%', height: '100%', touchAction: 'none'})
    el.appendChild(canvas)
    // the canvas fills the host; a static host becomes the containing block (an absolute one stays)
    if (win?.getComputedStyle?.(el).position == 'static') el.style.position = 'relative'
    const ctx = headless(el) ? null : canvas.getContext('2d')
    const dpr = win?.devicePixelRatio || 1
    let w = props.width || el.clientWidth || 800, h = props.height || el.clientHeight || 600
    const raf = win?.requestAnimationFrame?.bind(win), caf = win?.cancelAnimationFrame?.bind(win)
    const st: any = {paints: 0, cached: 0, ms: 0, nodes: 0, culled: 0, events: 0, first: 0}
    const inst: any = {el, canvas, ctx, props, st, layers: [] as Layer[], live: [] as Live[], camera: props.camera || CAMERA, follow: null}
    let pending = 0, camPending = 0
    let staticCanvas: any = null, staticKey: any = null

    const size = (W: number, H: number) => {
      w = W, h = H
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      staticKey = null
    }
    size(w, h)

    const invalidate = inst.invalidate = () => { if (ctx && !pending && raf) pending = raf(() => { pending = 0; draw() }) }
    const followDelta = () => {
      const f = inst.follow, p = inst.pointerWorld
      if (!f || !p) return null
      const dx = p.x - f.from.x, dy = p.y - f.from.y
      return f.map ? f.map(dx, dy) : [dx, dy]
    }
    const draw = inst.draw = () => {
      if (!ctx) return
      const t0 = performance.now(), cam = inst.camera, view = viewport(cam, w, h)
      const mode = inst.props.repaint || 'layers'
      const stat: any = {nodes: 0, culled: 0, ms: 0}
      const fd = followDelta(), fids = fd && inst.follow?.ids?.length ? new Set(inst.follow.ids) : null
      const bg = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.globalAlpha = 1
        ctx.fillStyle = inst.props.background || '#f5f5f5'
        ctx.fillRect(0, 0, w, h)
        if (inst.props.grid && cam.zoom >= 4) grid(ctx, cam, w, h)
      }
      // the active (or following) nodes of each layer, painted live
      const skips = inst.layers.map((l: Layer) => l.outline ? ALL : fids ? new Set([...(l.active || []), ...fids]) : l.active)
      if (mode == 'layers') {
        const key = {cam, w, h, layers: inst.layers.map((l: Layer, i: number) => skips[i] === ALL ? {items: NONE, skip: ALL} : {items: l.items, skip: skips[i]})}
        if (!staticCanvas) { staticCanvas = doc.createElement('canvas') }
        if (!reusable(staticKey, key)) {
          staticCanvas.width = canvas.width; staticCanvas.height = canvas.height
          const sc = staticCanvas.getContext('2d')
          // the static layer: background, grid and the data layers without their active nodes
          sc.setTransform(dpr, 0, 0, dpr, 0, 0)
          sc.fillStyle = inst.props.background || '#f5f5f5'
          sc.fillRect(0, 0, w, h)
          if (inst.props.grid && cam.zoom >= 4) grid(sc, cam, w, h)
          inst.layers.forEach((l: Layer, i: number) => skips[i] !== ALL && paintWorld(sc, l.items, cam, dpr, view, skips[i], stat))
          staticKey = key
        } else st.cached++
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalAlpha = 1
        ctx.drawImage(staticCanvas, 0, 0)
        // the live layer: active nodes in their layer's order, outline layers whole
        inst.layers.forEach((l: Layer, i: number) => {
          const sk = skips[i]
          if (!sk) return
          let act = sk === ALL ? l.items : l.items.filter(n => sk.has(n.id))
          if (fids && fd) act = act.map(n => fids.has(n.id) ? {...n, x: n.x + fd[0], y: n.y + fd[1]} : n)
          if (l.outline) act = act.map(n => outlined(n, l.outline!))
          if (!blit(i, act, cam, stat)) paintWorld(ctx, act, cam, dpr, view, null, stat)
        })
      } else {
        bg()
        inst.layers.forEach((l: Layer) => {
          let items = fids && fd ? l.items.map(n => fids.has(n.id) ? {...n, x: n.x + fd[0], y: n.y + fd[1]} : n) : l.items
          if (l.outline) items = items.map(n => outlined(n, l.outline!))
          paintWorld(ctx, items, cam, dpr, view, null, stat)
        })
      }
      // screen-space JSX nodes (handles, guides) on top, in canvas pixels
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (const {node} of inst.live) paintNode(ctx, node, 1)
      ctx.globalAlpha = 1
      // the first paint with content (benchmarks: startup)
      if (!st.first && stat.nodes) st.first = performance.now()
      st.paints++; st.nodes = stat.nodes; st.culled = stat.culled; st.blits = stat.blits || 0; st.ms = performance.now() - t0
      inst.props.onPaint?.(st)
    }
    // the live layer's moving nodes as a bitmap: a big set that only translated since it was painted
    // (every node the same dx, dy, nothing else changed: a drag) is one drawImage, not a repaint.
    // The bitmap is the canvas plus a half-canvas margin on each side, so what moves in is there.
    const blits: any[] = []
    const blit = (i: number, act: Node[], cam: Camera, stat: any) => {
      if (act.length < BLIT_MIN) return false
      let c = blits[i]
      const z = cam.zoom, mx = w / 2, my = h / 2
      let d = c && sameCam(c.cam, cam) && c.nodes.length == act.length ? translation(c.nodes, act) : null
      if (d && (Math.abs(d[0] * z) > mx || Math.abs(d[1] * z) > my)) d = null
      if (!d) {
        c = blits[i] = c || {bmp: doc.createElement('canvas')}
        c.bmp.width = Math.round(w * 2 * dpr); c.bmp.height = Math.round(h * 2 * dpr)
        const bc = c.bmp.getContext('2d'), wide = {...cam, x: cam.x - mx / z, y: cam.y - my / z}
        paintWorld(bc, act, wide, dpr, viewport(wide, w * 2, h * 2), null, stat)
        c.nodes = act; c.cam = cam; d = [0, 0]
      } else stat.blits = (stat.blits || 0) + 1
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = 1
      // only the part of the bitmap that lands on the canvas (a quarter of it): the copy is the raster cost
      const W = canvas.width, H = canvas.height, sx = Math.round((mx - d[0] * z) * dpr), sy = Math.round((my - d[1] * z) * dpr)
      ctx.drawImage(c.bmp, sx, sy, W, H, 0, 0, W, H)
      return true
    }
    inst.paintNow = () => { if (pending) caf?.(pending), pending = 0; draw() }

    // picking: JSX nodes (topmost first, screen ones in pixels), then the data layers, else the background
    const at = (sx: number, sy: number, h0?: any) => {
      const world = toWorld(inst.camera, sx, sy)
      inst.pointerWorld = world
      return {...(h0 || {}), world, screen: {x: sx, y: sy}}
    }
    const pick = (sx: number, sy: number) => {
      const world = toWorld(inst.camera, sx, sy), screen = {x: sx, y: sy}, slop = 2 / inst.camera.zoom
      inst.pointerWorld = world
      for (let i = inst.live.length - 1; i >= 0; i--) {
        const {el: e, node, screen: sc} = inst.live[i]
        if (hitNodes([node], screen, 2)) return {el: e, hit: null, node, world, screen}
      }
      for (let i = inst.layers.length - 1; i >= 0; i--) {
        const l = inst.layers[i], n = l.outline ? null : hitNodes(l.items, world, slop)
        if (n) return {el: l.els ? l.els.get(n.id ?? n) : l.el, hit: n.id ?? null, node: n, world, screen}
      }
      return {el: el.firstChild, hit: null, node: null, world, screen}
    }
    const router = inst.router = captureRouter(pick, el.firstChild, at, () => inst.props.capture == 'explicit' ? 'explicit' : 'all')
    inst.pointer = (kind: string, x: number, y: number, init?: any) => {
      st.events++
      // following (the transient channel): the canvas paints the drag; the app hears only the up
      if (inst.follow && kind == 'move' && router.captured()) { at(x, y); invalidate(); return null }
      return router.input(kind, x, y, init)
    }

    // the camera: a controlled value
    const cam = controlled((v: Camera) => { inst.camera = v; invalidate() }, sameCam)
    cam.prop(inst.camera)
    const setLocal = (v: Camera) => {
      inst.camera = v
      cam.local(v)
      invalidate()
      if (!camPending) camPending = raf ? raf(() => { camPending = 0; emit('camerachange', inst.camera) }) : (emit('camerachange', v), 0)
    }
    inst.setProps = (p: any) => { if (p.camera) cam.prop(p.camera) }
    inst.cam = cam

    // native input
    let space = false, pan: any = null
    const rect = () => canvas.getBoundingClientRect()
    const local = (e: any) => { const r = rect(); return [e.clientX - r.left, e.clientY - r.top] }
    const on = (t: any, type: string, f: any, o?: any) => { t.addEventListener(type, f, o); return () => t.removeEventListener(type, f, o) }
    const nav = () => inst.props.navigate !== false
    // the native events stop at the canvas: the app hears the routed ones (with world, hit, …)
    const native = (f: any) => (e: any) => { e.stopPropagation(); f(e) }
    const offs = [
      on(canvas, 'pointerdown', native((e: any) => {
        canvas.setPointerCapture?.(e.pointerId)
        // a press on the canvas commits a field being edited (its change event), and no mouse
        // compatibility default (focus, text selection) follows
        const a = doc.activeElement
        if (a && a !== doc.body && !el.contains(a)) a.blur?.()
        e.preventDefault()
        const [x, y] = local(e)
        if (nav() && (space || e.button == 1)) { pan = {x, y}; canvas.style.cursor = 'grabbing'; e.preventDefault(); return }
        inst.pointer('down', x, y, e)
      })),
      on(canvas, 'pointermove', native((e: any) => {
        const [x, y] = local(e)
        if (pan) { setLocal(panBy(inst.camera, x - pan.x, y - pan.y)); pan = {x, y}; return }
        inst.pointer('move', x, y, e)
      })),
      on(canvas, 'pointerup', native((e: any) => {
        const [x, y] = local(e)
        if (pan) { pan = null; canvas.style.cursor = space ? 'grab' : ''; return }
        inst.pointer('up', x, y, e)
      })),
      on(canvas, 'pointercancel', native((e: any) => { pan = null; const [x, y] = local(e); inst.pointer('cancel', x, y, e) })),
      on(canvas, 'pointerleave', (e: any) => { if (!router.captured()) inst.pointer('leave', 0, 0, e) }),
      on(canvas, 'dblclick', native((e: any) => { const [x, y] = local(e); inst.pointer('dblclick', x, y, e) })),
      on(canvas, 'click', (e: any) => e.stopPropagation()),
      on(canvas, 'wheel', (e: any) => {
        if (!nav()) return
        e.preventDefault()
        const [x, y] = local(e)
        if (e.ctrlKey || e.metaKey) setLocal(zoomAt(inst.camera, inst.camera.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)), x, y))
        else setLocal(panBy(inst.camera, -e.deltaX * (e.shiftKey && !e.deltaX ? 0 : 1) - (e.shiftKey && !e.deltaX ? e.deltaY : 0), e.shiftKey && !e.deltaX ? 0 : -e.deltaY))
      }, {passive: false}),
      on(doc, 'keydown', (e: any) => {
        if (e.code == 'Space' && !TYPING.test(e.target?.tagName) && !e.target?.isContentEditable && nav()) { if (!space) space = true, canvas.style.cursor = 'grab'; e.preventDefault() }
      }),
      on(doc, 'keyup', (e: any) => { if (e.code == 'Space') space = false, canvas.style.cursor = '' }),
    ]
    let ro: any
    if (!props.width && win?.ResizeObserver) {
      let first = true
      ro = new win.ResizeObserver(() => {
        const W = el.clientWidth, H = el.clientHeight
        // the first observation reports the size too: the app learns it (zoom to fit, culling)
        if (W && H && (first || W != w || H != h)) { first = false; size(W, H); invalidate(); emit('canvasresize', {width: W, height: H}) }
      })
      ro.observe(el)
    }
    inst.size = () => ({width: w, height: h})
    inst.resize = (W: number, H: number) => { size(W, H); invalidate() }
    inst.dispose = () => { offs.forEach(f => f()); ro?.disconnect(); pending && caf?.(pending); camPending && caf?.(camPending); canvas.remove() }
    /** tests and benchmarks: a node's screen point, the world point under a screen point */
    inst.toWorld = (sx: number, sy: number) => toWorld(inst.camera, sx, sy)
    return inst
  },
  update(inst: any, props: any) {
    const prev = inst.props
    inst.props = props
    if (props.width && (props.width != prev.width || props.height != prev.height)) inst.resize(props.width, props.height)
    if (props.camera !== prev.camera && props.camera) inst.setProps(props)
    if (props.follow !== prev.follow) inst.follow = props.follow || null
    inst.invalidate()
  },
  sync(inst: any, children: any) {
    const {layers, live} = readChildren(children)
    inst.layers = layers
    inst.live = live
    inst.follow = inst.props.follow || null
    inst.invalidate()
  },
  unmount: (inst: any) => inst.dispose(),
})

/** whether the static layer painted for `a` is still right for `b` */
function reusable(a: any, b: any) {
  if (!a || !sameCam(a.cam, b.cam) || a.w != b.w || a.h != b.h || a.layers.length != b.layers.length) return false
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
const sameSet = (a: Set<any> | null, b: Set<any> | null) => a === b || (!!a && !!b && a.size == b.size && [...a].every(x => b.has(x)))

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

/** the Canvas instance mounted on its host element (tests, benchmarks, devtools) */
export const canvasOf = (el: any): any => el?.__sw?.i
export {aabb}
