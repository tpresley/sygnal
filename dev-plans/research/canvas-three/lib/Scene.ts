/**
 * <Scene>: a three.js island inside a DOM app (defineIsland + the three target + the pointer router).
 *
 *   <Scene className="viewport" width={640} height={400} background="#10141c">
 *     <ambientLight intensity={0.4} />
 *     <Collection of={Cube} from="cubes" />        // components inside: their own intents, isolation
 *   </Scene>
 *
 * Props: width, height (else the host's size), background, frameloop ('demand' | 'always' |
 * 'never'), headless (no WebGLRenderer: picking and the scene graph only; the default in jsdom
 * and on a host document), camera + orbit (a controlled camera: controlled.ts).
 *
 * Frame loop ('demand', react-three-fiber's term): a frame is drawn after a patch of the island,
 * and continuously while any element has an `animate` prop. A frame runs the `animate`
 * functions and draws; the app's state, views and the DOM patch are not involved.
 */
import * as THREE from 'three'
import {defineIsland} from './island'
import {createThreeTarget} from './three'
import {pointerRouter} from './events'
import {controlled} from './controlled'

const isHeadless = (el: any) => {
  const win = el.ownerDocument?.defaultView
  return !win?.WebGL2RenderingContext || (typeof navigator != 'undefined' && /jsdom/i.test(navigator.userAgent))
}

export const Scene = defineIsland({
  name: 'scene',
  mount(el, props, emit) {
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
    const router = pointerRouter((x, y) => target.pick(x / w * 2 - 1, -(y / h) * 2 + 1), el.firstChild)
    const on = (type: string, kind: string) => {
      const f = (e: any) => { router.input(kind, e.offsetX, e.offsetY, e); if (kind != 'leave') invalidate() }
      canvas.addEventListener(type, f)
      return () => canvas.removeEventListener(type, f)
    }
    const offs = [on('pointermove', 'move'), on('pointerdown', 'down'), on('pointerup', 'up'), on('pointerleave', 'leave'), on('dblclick', 'dblclick'), on('contextmenu', 'contextmenu')]

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
    if (props.Orbit) {
      orbit = new props.Orbit(target.camera(), canvas)
      cam = controlled({write: writeCam, equals: (a: any, b: any) => JSON.stringify(a) == JSON.stringify(b)})
      // the user moved the camera: an event per gesture end (not per frame)
      orbit.addEventListener('change', invalidate)
      orbit.addEventListener('end', () => { const v = readCam(); cam.local(v); emit('camerachange', v) })
    }

    const inst = {
      target, router, stats, canvas, el,
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
      resize,
      setFrameloop(f: string) { frameloop = f; invalidate() },
      setCamera(v: any) { cam ? cam.prop(v) : writeCam(v) },
      cam: () => cam,
      dispose() {
        pending && caf?.(pending)
        offs.forEach(f => f())
        orbit?.dispose()
        target.dispose()
        renderer?.dispose()
        canvas.remove()
      },
    }
    if (props.camera) inst.setCamera(props.camera)
    return inst
  },
  update(inst, props, prev) {
    if (props.width != prev.width || props.height != prev.height) inst.resize(props.width || inst.el.clientWidth, props.height || inst.el.clientHeight)
    if (props.camera !== prev.camera && props.camera) inst.setCamera(props.camera)
    if (props.background !== prev.background) inst.target.scene.background = props.background ? new THREE.Color(props.background) : null
    if (props.frameloop !== prev.frameloop) inst.setFrameloop(props.frameloop || 'demand')
    inst.invalidate()
  },
  sync(inst, children) {
    inst.target.sync(children)
    inst.invalidate()
  },
  unmount: (inst) => inst.dispose(),
})
