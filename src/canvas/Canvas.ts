/**
 * <Canvas>: an infinite 2D canvas island (sygnal/canvas, README §6 of dev-plans/research/canvas-apps).
 *
 *   <Canvas className="board" camera={state.camera} background="#f5f5f5" grid>
 *     <shapes className="doc" items={state.shapes} active={draggedIds} />   // a data layer: one element
 *     <rect className="handle" data={{ part: 'se' }} space="screen" … />    // JSX nodes: one element each
 *   </Canvas>
 *
 * Children (the island's, rendered hidden but accessible):
 * - `<shapes items={nodes}>`: a data layer. The nodes are plain data (paint.ts's vocabulary) and
 *   are painted, culled and hit-tested by the canvas; no element per node. A hit dispatches on the
 *   layer's element with `event.hit` = the node's id (`event.node` its data). `active={ids}`:
 *   nodes that change every frame (a drag): painted live, so the rest stays cached.
 *   `outline={color}`: a layer that paints its nodes' outlines (1 screen px) and is never hit.
 * - Any other node tag (`rect ellipse text line path frame`, a `g` to group): one element per
 *   node, for handles, guides, a marquee, a few interactive things with intents of their own.
 *   World coordinates, or `space="screen"` (canvas pixels: handles keep their size at any zoom).
 *   Components and <Collection> work inside, as in any island.
 * - One vocabulary, box-based (maintainer decision 1): `x y width height rotation`, `fill stroke
 *   strokeWidth radius opacity dash`, `text fontSize`, `hidden locked parent`; an ellipse is its
 *   box too (not SVG's cx cy rx ry), a line is `x1 y1 x2 y2`.
 *
 * Input: native pointer events → the shared pointer router (extra/pointer.ts, sygnal/three's) →
 * DOM events on the picked element, every one with `world`, `screen`, `hit`, `node`. A miss
 * targets the children container, so one listener on the Canvas's className sees every press.
 * Capture as sygnal/three defines it: `capture="all"` (default: every press is captured) or
 * `"explicit"` (a `capture` prop, or setPointerCapture in a pointerdown listener); captured events
 * carry `captured`, `delta` (world, from the press) and the press's `hit`. The native events stop at
 * the canvas element; a press blurs a focused field and prevents the mouse compatibility defaults.
 *
 * Navigation (built in, `navigate={false}` turns it off): wheel pans, ctrl/⌘-wheel and trackpad
 * pinch zoom toward the cursor, two-finger touch pinch zooms and pans, space-drag and middle-drag
 * pan. The camera is a controlled value (extra/controlled.ts): the canvas moves it itself and
 * reports `camerachange` (detail: the camera, at most once a frame); a `camera` prop the app
 * changes (zoom to fit, 100 %) is written.
 *
 * `follow={{ ids, from, map? }}` (the transient channel, the documented escape hatch for very large
 * selections): while set and a pointer is captured, those data nodes follow the pointer by
 * (world − from), mapped by `map(dx, dy)`, painted by the canvas with no pointermove to the app;
 * the app commits on pointerup. Everything else (snapping, live panels, peers) waits for the up.
 *
 * Painting: on demand, once a frame, by the backend (backend.ts: `canvas2d()` by default): a static
 * layer plus a live layer, translation blits, the camera cache for pan and zoom.
 *
 * Accessibility: each data layer is projected into its element as a list of buttons, one per node
 * in view (at most `a11y` of them, default 100; `a11y={0}` turns it off): the node's `label`,
 * `name` or `text`, its type as the role description. Screen readers and the sygnal/agent-ui
 * snapshot read them; activating one (click, Enter, Space) is a press and release on that node.
 * A focused JSX node or projected node gets a focus ring on the canvas.
 *
 * Dev (SYG262): a data layer whose nodes all changed identity with equal fields (a reducer that
 * rebuilds every shape) makes every frame a full repaint; reported once per layer.
 */
import {defineWidget} from '../index'
import {controlled} from '../extra/controlled'
import {pointerRouter, fire} from '../extra/pointer'
import {CAMERA, toWorld, toScreen, viewport, zoomAt, panBy, aabb, overlaps, centre, type Camera} from './geometry'
import {hitNodes, measureText, type Node} from './paint'
import {canvas2d, type PaintLayer, type PaintStats} from './backend'

const tagOf = (sel: string) => /^[^#.]*/.exec(sel)![0]
const NODE = /^(rect|ellipse|text|line|path|frame)$/
const OWN = /^(className|class|key|style|role|tabIndex|title|ref|hook|attrs|data|space)$|^(aria|data)-/
const textOf = (v: any): string => v.text != null ? String(v.text) : (v.children || []).map(textOf).join('')

type Layer = {el: any, items: Node[], active: Set<any> | null, els?: Map<any, any>, outline?: string, label?: string, a11y?: number}
type Live = {el: any, node: Node}

// one node object per vnode: an unchanged child (a Collection item that didn't re-render keeps its
// vnode) keeps its node, so the static layer's cache survives
const nodes = new WeakMap<any, Node>()
function nodeOf(v: any, tag: string, p: any): Node {
  let n = nodes.get(v)
  if (n) return n
  n = {type: tag}
  for (const k in p) if (!OWN.test(k)) n[k.replace(/-(\w)/g, (_: string, c: string) => c.toUpperCase())] = p[k]
  if (tag == 'text') { n.text = textOf(v); const m = measureText(n.text, n as any); n.width ??= m.width; n.height ??= m.height }
  nodes.set(v, n)
  return n
}

/**
 * the island's children → layers + screen-space JSX nodes. A run of world-space JSX nodes is a
 * layer too (painted, culled and clipped like a data layer; its hits target each node's element)
 */
export function readChildren(container: any) {
  const layers: Layer[] = [], live: Live[] = [], props = new Map<any, Node>()
  let jsx: Layer | null = null
  const walk = (kids: any[] | undefined, screen: boolean) => {
    if (kids) for (const v of kids) {
      if (!v?.sel) continue
      const tag = tagOf(v.sel), d = v.data || {}, p = {...d.attrs, ...d.props}
      if (p.display == 'none') continue
      if (tag == 'shapes') {
        layers.push({el: v.elm, items: d.props?.items || p.items || [], active: p.active?.length ? new Set(p.active) : null, outline: p.outline, label: p['aria-label'], a11y: p.a11y})
        jsx = null
        continue
      }
      const sc = p.space ? p.space == 'screen' : screen
      if (NODE.test(tag)) {
        const node = nodeOf(v, tag, p)
        props.set(v.elm, node)
        if (sc) { if (!node.hidden) live.push({el: v.elm, node}) }
        else {
          if (!jsx) layers.push(jsx = {el: null, items: [], active: null, els: new Map()})
          jsx.items.push(node)
          jsx.els!.set(node.id ?? node, v.elm)
        }
      } else walk(v.children, sc)
    }
  }
  walk(container?.children, false)
  return {layers, live, props}
}

const isHeadless = (el: any) => typeof navigator == 'undefined' || /jsdom/i.test(navigator.userAgent) || !el.ownerDocument?.defaultView?.CanvasRenderingContext2D
const sameCam = (a: Camera, b: Camera) => a.x == b.x && a.y == b.y && a.zoom == b.zoom
const TYPING = /^(INPUT|TEXTAREA|SELECT)$/
// after the last wheel event of a gesture: the camera is at rest (a crisp repaint after a zoom)
const REST_MS = 120

// SYG262: more than half of a big layer's nodes changed identity with equal fields
const shallowEqual = (a: any, b: any) => {
  if (!a || !b) return false
  let n = 0
  for (const k in a) { if (a[k] !== b[k]) return false; n++ }
  for (const _ in b) n--
  return n == 0
}
const prevItems = new WeakMap<any, Node[]>(), reported = new WeakSet<any>()
function checkRebuild(el: any, items: Node[]) {
  const d = (globalThis as any).__SYGNAL_DIAGNOSTICS__, prev = el && prevItems.get(el)
  if (el) prevItems.set(el, items)
  if (!d || !prev || prev === items || items.length < 64 || prev.length != items.length || reported.has(el)) return
  let same = 0
  const need = items.length / 2
  for (let i = 0; i < items.length && same < need; i++) if (items[i] !== prev[i] && shallowEqual(items[i], prev[i])) same++
  if (same < need) return
  reported.add(el)
  try {
    d.report('SYG262', {
      severity: 'warn', data: {nodes: items.length, layer: el.className?.baseVal ?? el.className},
      message: `A <shapes> data layer got ${items.length} new node objects whose fields didn't change: the canvas keys its static layer, translation blits and the camera cache on node identity, so every frame repaints everything`,
      fix: 'Keep the nodes that did not change: patch only the ones that did (shapes.map(s => s.id === id ? { ...s, x } : s)), not shapes.map(s => ({ ...s }))',
    })
  } catch (e) { queueMicrotask(() => { throw e }) }
}

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
    const headless = props.headless ?? isHeadless(el)
    const backend = headless ? null : (props.backend || canvas2d())(canvas)
    const dpr = win?.devicePixelRatio || 1
    let w = props.width || el.clientWidth || 800, h = props.height || el.clientHeight || 600
    const raf = win?.requestAnimationFrame?.bind(win), caf = win?.cancelAnimationFrame?.bind(win)
    const st: PaintStats & Record<string, any> = {paints: 0, nodes: 0, culled: 0, ms: 0, blits: 0, cached: 0, shifted: 0, scaled: 0, statics: 0, events: 0, first: 0}
    const inst: any = {el, canvas, backend, props, st, headless, layers: [] as Layer[], live: [] as Live[], nodeProps: new Map(), camera: props.camera || CAMERA, follow: null, focused: null}
    let pending = 0, camPending = 0, rest: any = 0, moving = false

    const size = (W: number, H: number) => {
      w = W, h = H
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
    }
    size(w, h)

    const invalidate = inst.invalidate = () => {
      if (backend && !pending && raf) pending = raf(() => { pending = 0; draw() })
      scheduleA11y()
    }
    const followDelta = () => {
      const f = inst.follow, p = inst.pointerWorld
      if (!f || !p || !f.ids?.length || !router.captured()) return null
      const dx = p.x - f.from.x, dy = p.y - f.from.y, m = f.map ? f.map(dx, dy) : [dx, dy]
      return {ids: new Set(f.ids), dx: m[0], dy: m[1]}
    }
    const draw = inst.draw = () => {
      if (!backend) return
      const t0 = performance.now(), cam = inst.camera
      const s: PaintStats = {nodes: 0, culled: 0, ms: 0, blits: 0, cached: 0, shifted: 0, scaled: 0, statics: 0}
      const overlay = inst.live.map((l: Live) => l.node)
      const ring = focusRing()
      if (ring) overlay.push(ring)
      backend.paint({
        camera: cam, width: w, height: h, dpr, background: inst.props.background || '#f5f5f5', grid: !!inst.props.grid,
        repaint: inst.props.repaint == 'full' ? 'full' : 'layers', moving,
        layers: inst.layers.map((l: Layer): PaintLayer => ({items: l.items, active: l.active, outline: l.outline})),
        overlay, follow: followDelta(),
      }, s)
      // the first paint with content (benchmarks: startup)
      if (!st.first && s.nodes) st.first = performance.now()
      st.paints++; st.nodes = s.nodes; st.culled = s.culled; st.blits = s.blits
      st.cached += s.cached; st.shifted += s.shifted; st.scaled += s.scaled; st.statics += s.statics
      st.ms = performance.now() - t0
      inst.props.onPaint?.(st)
    }
    inst.paintNow = () => { if (pending) caf?.(pending), pending = 0; draw() }

    // picking: JSX nodes in screen space (topmost first), then the layers, else the background
    let grab: any = null
    const pick = (sx: number, sy: number, skip?: any) => {
      const world = toWorld(inst.camera, sx, sy), screen = {x: sx, y: sy}, slop = 2 / inst.camera.zoom
      inst.pointerWorld = world
      for (let i = inst.live.length - 1; i >= 0; i--) {
        const {el: e, node} = inst.live[i]
        if (e !== skip && hitNodes([node], screen, 2)) return {el: e, hit: null, node, world, screen}
      }
      for (let i = inst.layers.length - 1; i >= 0; i--) {
        const l = inst.layers[i], n = l.outline ? null : hitNodes(l.items, world, slop)
        const t = n && (l.els ? l.els.get(n.id ?? n) : l.el)
        if (n && t !== skip) return {el: t, hit: n.id ?? null, node: n, world, screen}
      }
      return {el: el.firstChild, hit: null, node: null, world, screen}
    }
    const router = inst.router = pointerRouter(pick, el.firstChild, {
      capture: (hit: any) => inst.props.capture == 'explicit' ? (hit.node?.capture ? true : undefined) : true,
      prop: (e: any, k: string) => inst.nodeProps.get(e)?.[k],
      fields: (x: number, y: number) => {
        const world = toWorld(inst.camera, x, y)
        inst.pointerWorld = world
        return {world, screen: {x, y}, hit: grab?.hit ?? null, node: grab?.node ?? null, delta: grab ? {x: world.x - grab.world.x, y: world.y - grab.world.y} : {x: 0, y: 0}}
      },
    })
    inst.pointer = (kind: string, x: number, y: number, init: any = {}) => {
      st.events++
      // following (the transient channel): the canvas paints the drag; the app hears only the up
      if (inst.follow && kind == 'move' && router.captured()) { inst.pointerWorld = toWorld(inst.camera, x, y); invalidate(); return null }
      const r = router.input(kind, x, y, init)
      if (kind == 'down') grab = r
      if (kind == 'up' || kind == 'cancel') { grab = null; scheduleA11y() }
      return r
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
    // a camera gesture: the backend may scale its cache; at rest it repaints crisp
    const gesture = (on: boolean) => {
      if (on == moving) return
      moving = on
      if (!on) invalidate()
    }
    const wheeled = () => {
      gesture(true)
      if (rest) win.clearTimeout(rest)
      rest = win?.setTimeout ? win.setTimeout(() => { rest = 0; gesture(false) }, REST_MS) : 0
    }
    inst.setCamera = (v: Camera) => cam.prop(v)
    inst.cam = cam

    // focus: a focused JSX node or projected node gets a ring
    const focusRing = (): Node | null => {
      const n = inst.focused
      if (!n || n.type == 'line' || n.x == null) return null
      const screen = inst.live.some((l: Live) => l.node === n)
      const p = screen ? {x: n.x, y: n.y} : toScreen(inst.camera, n.x, n.y), z = screen ? 1 : inst.camera.zoom
      return {type: n.type == 'ellipse' ? 'ellipse' : 'rect', x: p.x - 3, y: p.y - 3, width: n.width * z + 6, height: n.height * z + 6, rotation: n.rotation || 0, fill: 'none', stroke: '#ffb547', strokeWidth: 2}
    }

    // ---------------------------------------------------------------- accessibility projection
    // a list of buttons per data layer, inside its element: the nodes in view, at most `a11y`
    let a11yQueued = false
    const scheduleA11y = () => {
      // not during a drag or a camera gesture: at its end
      if (a11yQueued || moving || router?.captured?.()) return
      a11yQueued = true
      queueMicrotask(() => { a11yQueued = false; project() })
    }
    const proj = new Map<any, {list: any, items: Map<any, any>, nodes: Map<any, Node>}>()
    const project = inst.project = () => {
      const view = viewport(inst.camera, w, h), seen = new Set<any>()
      for (const l of inst.layers as Layer[]) {
        if (!l.el || l.outline) continue
        const max = l.a11y ?? 100
        seen.add(l.el)
        let p = proj.get(l.el)
        if (!max) { if (p) { p.list.remove(); proj.delete(l.el) } continue }
        if (!p || p.list.parentNode !== l.el) {
          const list = doc.createElement('div')
          list.setAttribute('role', 'group')
          list.className = 'sygnal-canvas-nodes'
          l.el.appendChild(list)
          p = {list, items: new Map(), nodes: new Map()}
          proj.set(l.el, p)
          const P = p
          list.addEventListener('click', (e: any) => {
            const it = e.target?.closest?.('[data-node]'), n = it && P.nodes.get(it.getAttribute('data-node'))
            if (!n) return
            e.stopPropagation()
            activate(l.el, n, e)
          })
          list.addEventListener('keydown', (e: any) => {
            const it = e.target?.closest?.('[data-node]')
            if (!it) return
            if (e.key == 'Enter' || e.key == ' ') { e.preventDefault(); e.stopPropagation(); it.click() }
            else if (/^Arrow/.test(e.key)) {
              const all = [...P.items.values()], i = all.indexOf(it), j = i + (e.key == 'ArrowUp' || e.key == 'ArrowLeft' ? -1 : 1)
              if (all[j]) { e.preventDefault(); all[j].focus() }
            }
          })
          list.addEventListener('focusin', (e: any) => { inst.focused = P.nodes.get(e.target?.getAttribute?.('data-node')) || null; invalidate() })
          list.addEventListener('focusout', () => { inst.focused = null; invalidate() })
        }
        p.list.setAttribute('aria-label', l.label || 'Shapes')
        // topmost first, as a layers panel lists them
        const keep = new Map<any, Node>()
        for (let i = l.items.length - 1; i >= 0 && keep.size < max; i--) {
          const n = l.items[i]
          if (n.hidden || n.id == null || (n.type != 'line' && n.type != 'path' && !overlaps(aabb(n as any), view))) continue
          keep.set(String(n.id), n)
        }
        for (const [id, it] of p.items) if (!keep.has(id)) { it.remove(); p.items.delete(id); p.nodes.delete(id) }
        let prev: any = null
        for (const [id, n] of keep) {
          let it = p.items.get(id)
          if (!it) { it = doc.createElement('div'); it.setAttribute('role', 'button'); it.setAttribute('tabindex', '0'); it.setAttribute('data-node', id); p.items.set(id, it) }
          if (p.nodes.get(id) !== n) {
            it.setAttribute('aria-label', String(n.label ?? n.name ?? n.text ?? n.type))
            it.setAttribute('aria-roledescription', n.type)
            if (n.locked) it.setAttribute('aria-disabled', 'true'); else it.removeAttribute('aria-disabled')
            p.nodes.set(id, n)
          }
          const at = prev ? prev.nextSibling : p.list.firstChild
          if (at !== it) p.list.insertBefore(it, at)
          prev = it
        }
      }
      for (const [k, p] of proj) if (!seen.has(k)) { p.list.remove(); proj.delete(k) }
    }
    // a projected node activated (a screen reader, the keyboard, an agent): a press and release on it
    const activate = (layer: any, n: Node, e: any) => {
      const c = centre(n as any), s = toScreen(inst.camera, c.x, c.y), ex = {world: c, screen: s, hit: n.id, node: n}
      const init = {clientX: s.x, clientY: s.y, button: 0, pointerId: 1, pointerType: 'mouse', shiftKey: !!e.shiftKey, metaKey: !!e.metaKey, ctrlKey: !!e.ctrlKey, altKey: !!e.altKey}
      fire(layer, 'pointerdown', init, ex)
      fire(layer, 'pointerup', init, ex)
      fire(layer, 'click', init, ex)
    }
    const onFocus = (e: any) => { const n = inst.nodeProps.get(e.target); if (n) { inst.focused = n; invalidate() } }
    const onBlur = (e: any) => { if (inst.nodeProps.has(e.target)) { inst.focused = null; invalidate() } }
    el.firstChild?.addEventListener?.('focusin', onFocus)
    el.firstChild?.addEventListener?.('focusout', onBlur)

    // ---------------------------------------------------------------- native input
    let space = false, pan: any = null
    const touches = new Map<any, {x: number, y: number}>()
    let pinch: {d: number, mid: {x: number, y: number}, cam: Camera} | null = null
    const rect = () => canvas.getBoundingClientRect()
    const local = (e: any) => { const r = rect(); return [e.clientX - r.left, e.clientY - r.top] }
    // (a sygnal/host document has no listeners of its own: no keys there)
    const on = (t: any, type: string, f: any, o?: any) => { t.addEventListener?.(type, f, o); return () => t.removeEventListener?.(type, f, o) }
    const nav = () => inst.props.navigate !== false
    // the native events stop at the canvas: the app hears the routed ones (with world, hit, …)
    const native = (f: any) => (e: any) => { e.stopPropagation(); f(e) }
    const twoFinger = () => {
      const [a, b] = [...touches.values()]
      return {d: Math.hypot(b.x - a.x, b.y - a.y) || 1, mid: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}}
    }
    const offs = [
      on(canvas, 'pointerdown', native((e: any) => {
        try { canvas.setPointerCapture?.(e.pointerId) } catch (_) {}
        // a press on the canvas commits a field being edited (its change event), and no mouse
        // compatibility default (focus, text selection) follows
        const a = doc.activeElement
        if (a && a !== doc.body && !el.contains(a)) a.blur?.()
        e.preventDefault()
        const [x, y] = local(e)
        if (e.pointerType == 'touch') {
          touches.set(e.pointerId, {x, y})
          if (touches.size == 2 && nav()) {
            // the second finger: the first one's press is cancelled, the two pinch
            if (router.captured()) inst.pointer('cancel', x, y, e)
            pinch = {...twoFinger(), cam: inst.camera}
            gesture(true)
            return
          }
          if (pinch || touches.size > 2) return
        }
        if (nav() && (space || e.button == 1)) { pan = {x, y}; gesture(true); canvas.style.cursor = 'grabbing'; return }
        inst.pointer('down', x, y, e)
      })),
      on(canvas, 'pointermove', native((e: any) => {
        const [x, y] = local(e)
        if (e.pointerType == 'touch' && touches.has(e.pointerId)) {
          touches.set(e.pointerId, {x, y})
          if (pinch && touches.size == 2) {
            const t = twoFinger(), c = panBy(pinch.cam, t.mid.x - pinch.mid.x, t.mid.y - pinch.mid.y)
            setLocal(zoomAt(c, pinch.cam.zoom * t.d / pinch.d, t.mid.x, t.mid.y))
            return
          }
          if (pinch) return
        }
        if (pan) { setLocal(panBy(inst.camera, x - pan.x, y - pan.y)); pan = {x, y}; return }
        inst.pointer('move', x, y, e)
      })),
      ...['pointerup', 'pointercancel'].map(type => on(canvas, type, native((e: any) => {
        const [x, y] = local(e)
        if (e.pointerType == 'touch' && touches.delete(e.pointerId) && pinch) {
          if (!touches.size) { pinch = null; gesture(false) }
          return
        }
        if (pan) { pan = null; gesture(false); canvas.style.cursor = space ? 'grab' : ''; return }
        inst.pointer(type == 'pointerup' ? 'up' : 'cancel', x, y, e)
      }))),
      on(canvas, 'pointerleave', (e: any) => { if (!router.captured()) inst.pointer('leave', 0, 0, e) }),
      on(canvas, 'dblclick', native((e: any) => { const [x, y] = local(e); inst.pointer('dblclick', x, y, e) })),
      on(canvas, 'contextmenu', native((e: any) => { const [x, y] = local(e); inst.pointer('contextmenu', x, y, e) })),
      on(canvas, 'click', (e: any) => e.stopPropagation()),
      on(canvas, 'wheel', (e: any) => {
        if (!nav()) return
        e.preventDefault()
        const [x, y] = local(e)
        wheeled()
        if (e.ctrlKey || e.metaKey) setLocal(zoomAt(inst.camera, inst.camera.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)), x, y))
        else setLocal(panBy(inst.camera, -e.deltaX * (e.shiftKey && !e.deltaX ? 0 : 1) - (e.shiftKey && !e.deltaX ? e.deltaY : 0), e.shiftKey && !e.deltaX ? 0 : -e.deltaY))
      }, {passive: false}),
      on(doc, 'keydown', (e: any) => {
        if (e.code == 'Space' && !TYPING.test(e.target?.tagName) && !e.target?.isContentEditable && !e.target?.closest?.('[data-node]') && nav()) { if (!space) space = true, canvas.style.cursor = 'grab'; e.preventDefault() }
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
    inst.moving = () => moving
    inst.dispose = () => {
      offs.forEach(f => f()); ro?.disconnect()
      el.firstChild?.removeEventListener?.('focusin', onFocus); el.firstChild?.removeEventListener?.('focusout', onBlur)
      pending && caf?.(pending); camPending && caf?.(camPending); rest && win.clearTimeout(rest)
      for (const p of proj.values()) p.list.remove()
      backend?.dispose?.()
      canvas.remove()
    }
    /** tests and benchmarks: the world point under a canvas pixel */
    inst.toWorld = (sx: number, sy: number) => toWorld(inst.camera, sx, sy)
    inst.toScreen = (wx: number, wy: number) => toScreen(inst.camera, wx, wy)
    return inst
  },
  update(inst: any, props: any) {
    const prev = inst.props
    inst.props = props
    if (props.width && (props.width != prev.width || props.height != prev.height)) inst.resize(props.width, props.height)
    if (props.camera !== prev.camera && props.camera) inst.setCamera(props.camera)
    if (props.follow !== prev.follow) inst.follow = props.follow || null
    inst.invalidate()
  },
  sync(inst: any, children: any) {
    const {layers, live, props} = readChildren(children)
    for (const l of layers) if (!l.els) checkRebuild(l.el, l.items)
    inst.layers = layers
    inst.live = live
    inst.nodeProps = props
    inst.follow = inst.props.follow || null
    inst.invalidate()
  },
  unmount: (inst: any) => inst.dispose(),
})

/** the Canvas instance mounted on its host element (tests: `canvasOf(el).pointer('down', x, y)`, benchmarks, devtools) */
export const canvasOf = (el: any): any => el?.__sw?.i
