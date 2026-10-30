/**
 * sygnal/three <Scene>: a three.js island inside a DOM app: defineWidget({ children: true }) +
 * the three target + the pointer router.
 *
 *   <Scene className="viewport" width={640} height={400} background="#10141c">
 *     <ambientLight intensity={0.4} />
 *     <Collection of={Cube} from="cubes" />        // components inside: their own intents, isolation
 *   </Scene>
 *
 * Props: width, height (else the host's size), background, frameloop ('demand' | 'always' |
 * 'never'), headless (no WebGLRenderer: picking and the scene graph only; the default in jsdom
 * and on a host document), camera + Orbit (a controlled camera: sygnal's controlled() helper; the
 * widget's own `value` protocol is for one `value` prop, the camera is a second one).
 *
 * Keyboard: the children are accessible (defineWidget's default): a mesh with `tabIndex={0}` and a
 * role is focusable, Enter / Space click it (with no intersection on the event), and the focus
 * ring is drawn where the object is (focus()).
 *
 * Dragging (extra/pointer.ts): `capture` / `setPointerCapture` keep a drag's pointer on its element
 * (the canvas captures the browser's pointer, so the drag goes on off the canvas), `draggable` the
 * HTML drag events (processDrag); camera controls sit out a gesture that captures or drags.
 *
 * Frame loop ('demand', react-three-fiber's term): a frame is drawn after a patch of the island,
 * and continuously while any element has an `animate` prop. A frame runs the `animate`
 * functions and draws; the app's state, views and the DOM patch are not involved.
 */
import * as THREE from 'three'
import {defineWidget} from '../index'
import {controlled} from '../extra/controlled'
import {createThreeTarget} from './target'
import {pointerRouter} from '../extra/pointer'

const isHeadless = (el: any) => {
  const win = el.ownerDocument?.defaultView
  return !win?.WebGL2RenderingContext || (typeof navigator != 'undefined' && /jsdom/i.test(navigator.userAgent))
}

export const Scene = defineWidget({
  name: 'Scene',
  children: true,
  // three's <line> is an SVG tag to the pragma: plain here
  tags: ['line'],
  events: ['camerachange'],
  mount(el: any, props: any, emit: any) {
    const doc = el.ownerDocument
    const target = createThreeTarget()
    const headless = props.headless ?? isHeadless(el)
    let renderer: any = null, canvas: any
    let w = props.width || el.clientWidth || 300, h = props.height || el.clientHeight || 150
    if (!headless) {
      renderer = new THREE.WebGLRenderer({antialias: true})
      renderer.setPixelRatio(doc.defaultView.devicePixelRatio || 1)
      canvas = renderer.domElement
    } else canvas = doc.createElement('canvas')
    el.appendChild(canvas)
    const resize = (W: number, H: number) => {
      w = W, h = H
      target.setSize(w, h)
      renderer?.setSize(w, h)
      if (!renderer) canvas.width = w, canvas.height = h
    }
    resize(w, h)
    if (props.background) target.scene.background = new THREE.Color(props.background)

    // input: native pointer events on the canvas → raycasts → DOM-shaped events on the elements
    const ndc = (x: number, y: number) => [x / w * 2 - 1, -(y / h) * 2 + 1]
    const router = pointerRouter((x, y, skip) => target.pick(ndc(x, y)[0], ndc(x, y)[1], skip), el.firstChild, {
      ray: (x, y) => { const n = ndc(x, y); return {...target.ray(n[0], n[1]), ndc: n} },
      prop: target.prop,
    })
    // the keyboard focus ring: where the focused child's object is drawn
    const ring = doc.createElement('div')
    Object.assign(ring.style, {position: 'absolute', width: '56px', height: '56px', margin: '-28px 0 0 -28px', border: '2px solid #ffb547', borderRadius: '50%', pointerEvents: 'none', display: 'none'})
    if (!el.style.position) el.style.position = 'relative'
    el.appendChild(ring)
    // a gesture that captures or drags an object: the canvas holds the browser's pointer (moves off
    // the canvas still arrive), and the camera controls sit it out
    let held: any = null
    const hold = (e: any, end: boolean) => {
      const busy = !end && !!(router.captured() || router.dragging())
      if (busy && !held) {
        held = {orbit: orbit && orbit.enabled}
        if (orbit) orbit.enabled = false
        try { e.pointerId != null && canvas.setPointerCapture?.(e.pointerId) } catch (_) {}
      } else if (!busy && held) {
        if (orbit && held.orbit) orbit.enabled = true
        held = null
      }
    }
    const on = (type: string, kind: string) => {
      const f = (e: any) => {
        router.input(kind, e.offsetX, e.offsetY, e)
        // a capture released off the canvas: its pointerleave came while captured
        if (held && (kind == 'up' || kind == 'cancel') && (e.offsetX < 0 || e.offsetY < 0 || e.offsetX > w || e.offsetY > h)) router.input('leave', e.offsetX, e.offsetY, e)
        hold(e, kind == 'up' || kind == 'cancel')
        if (kind != 'leave') invalidate()
      }
      canvas.addEventListener(type, f)
      return () => canvas.removeEventListener(type, f)
    }
    const offs = [on('pointermove', 'move'), on('pointerdown', 'down'), on('pointerup', 'up'), on('pointercancel', 'cancel'), on('pointerleave', 'leave'), on('dblclick', 'dblclick'), on('contextmenu', 'contextmenu')]

    // the frame loop
    const raf = doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView) || (globalThis as any).requestAnimationFrame
    const caf = doc.defaultView?.cancelAnimationFrame?.bind(doc.defaultView) || (globalThis as any).cancelAnimationFrame
    let frameloop = props.frameloop || 'demand', pending = 0, last = -1
    const stats = {renders: 0}
    const tick = (ms: number) => {
      pending = 0
      const t = ms / 1000, dt = last < 0 ? 0 : t - last
      last = t
      target.frame(t, dt)
      orbit?.update()
      renderer?.render(target.scene, target.camera())
      stats.renders++
      if (target.animated.size || frameloop == 'always') invalidate()
    }
    const invalidate = () => { if (!pending && frameloop != 'never' && raf) pending = raf(tick) }

    // a controlled camera (OrbitControls moves it; the app may set it): controlled.ts
    let orbit: any = null, cam: any = null
    const readCam = () => { const c = target.camera(); return {position: c.position.toArray(), target: orbit ? orbit.target.toArray() : [0, 0, 0]} }
    const writeCam = (v: any) => {
      const c = target.camera()
      c.position.set(...(v.position as [number, number, number]))
      orbit ? orbit.target.set(...(v.target || [0, 0, 0])) : c.lookAt(...((v.target || [0, 0, 0]) as [number, number, number]))
      orbit?.update()
      invalidate()
    }
    let camProp = props.camera, synced = false
    if (props.Orbit) cam = controlled(writeCam, (a: any, b: any) => JSON.stringify(a) == JSON.stringify(b))
    // after a sync: the scene's camera may be new (the first sync makes it); the controls follow it
    const afterSync = () => {
      if (props.Orbit && orbit?.object !== target.camera()) {
        orbit?.dispose()
        orbit = new props.Orbit(target.camera(), canvas)
        // the user moved the camera: one event per gesture (its end), not per frame
        orbit.addEventListener('change', invalidate)
        orbit.addEventListener('end', () => { const v = readCam(); cam.local(v); emit('camerachange', v) })
      }
      if (!synced) {
        synced = true
        // the camera starts where the prop says (the controlled value's baseline)
        if (camProp) { writeCam(camProp); cam?.prop(camProp) }
      }
    }

    const inst: any = {
      target, router, stats, canvas, el, ring, props,
      get headless() { return headless },
      invalidate, tick,
      /** raw input at canvas pixels (tests) */
      pointer: (kind: string, x: number, y: number, init?: any) => router.input(kind, x, y, init),
      /** where an element's object is, in canvas pixels */
      pixelOf(node: any) { const p = target.project(node); return p && [(p[0] + 1) / 2 * w, (1 - p[1]) / 2 * h] },
      /** a real click on an element: pointer down + up where its object is drawn, through the raycaster */
      click(node: any, init?: any) {
        const p = inst.pixelOf(node)
        if (!p) return null
        router.input('move', p[0], p[1], init)
        router.input('down', p[0], p[1], init)
        return router.input('up', p[0], p[1], init)
      },
      /** a drag: down on the element, moves (`steps`) to `to` (canvas pixels, or another element's place), up */
      drag(node: any, to: any, {steps = 5, ...init}: any = {}) {
        const a = inst.pixelOf(node), b = Array.isArray(to) ? to : inst.pixelOf(to)
        if (!a || !b) return null
        router.input('move', a[0], a[1], init)
        router.input('down', a[0], a[1], init)
        for (let i = 1; i <= steps; i++) router.input('move', a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, init)
        return router.input('up', b[0], b[1], init)
      },
      resize,
      setFrameloop(f: string) { frameloop = f; invalidate() },
      setCamera(v: any) { camProp = v; if (synced) cam ? cam.prop(v) : writeCam(v) },
      afterSync,
      cam: () => cam,
      orbit: () => orbit,
      dispose() {
        pending && caf?.(pending)
        offs.forEach(f => f())
        orbit?.dispose()
        target.dispose()
        renderer?.dispose()
        canvas.remove()
        ring.remove()
      },
    }
    return inst
  },
  update(inst: any, props: any) {
    const prev = inst.props
    inst.props = props
    if (props.width != prev.width || props.height != prev.height) inst.resize(props.width || inst.el.clientWidth, props.height || inst.el.clientHeight)
    if (props.camera !== prev.camera && props.camera) inst.setCamera(props.camera)
    if (props.background !== prev.background) inst.target.scene.background = props.background ? new THREE.Color(props.background) : null
    if (props.frameloop !== prev.frameloop) inst.setFrameloop(props.frameloop || 'demand')
    inst.invalidate()
  },
  sync(inst: any, children: any) {
    inst.target.sync(children)
    inst.afterSync()
    inst.invalidate()
  },
  focus(inst: any, child: any) {
    const p = child && inst.pixelOf(child)
    inst.ring.style.display = p ? 'block' : 'none'
    if (p) Object.assign(inst.ring.style, {left: p[0] + 'px', top: p[1] + 'px'})
  },
  unmount: (inst: any) => inst.dispose(),
})

/** the Scene instance mounted on a host element (tests: `sceneOf(el).click(meshEl)`, `.pointer()`, `.tick()`) */
export const sceneOf = (el: any): any => el?.__sw?.i
