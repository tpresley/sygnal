/**
 * The three.js target: a patched element tree (vnodes with `.elm`) mapped to THREE objects.
 *
 * - Tags: any THREE export, lowercased (`<mesh>`, `<group>`, `<boxGeometry>`,
 *   `<meshStandardMaterial>`, `<perspectiveCamera>`, `<directionalLight>`); `extend({ OrbitControls })`
 *   adds more. A tag the catalog doesn't know (a component's wrapper div, a Collection's) is
 *   transparent: its children attach to the nearest object above it.
 * - `args` are the constructor's arguments; a change of `args` makes a new object (its children
 *   and attachments move over), as react-three-fiber does.
 * - Every other prop is written to the object: a value with `.set` (Vector3, Euler, Color, Quaternion)
 *   is set from an array, a number (`scale={2}`: setScalar) or a color string; anything else is
 *   assigned. A prop that disappears goes back to the class's default.
 * - Children: an Object3D child is added to its parent Object3D. A geometry attaches as the
 *   parent's `geometry`, a material as its `material`, anything else by `attach="map"`. On removal
 *   the previous value is put back.
 * - Disposal: an object the target made (from a tag) is disposed when its element goes, unless
 *   `dispose={null}`. Objects passed in as props (`geometry={shared}`) are the app's: never disposed.
 * - `animate={{ rotation: (t, dt, obj) => [0, t, 0] }}`: per-frame values, outside state and the
 *   render flush (frame() calls them; no vnode, no patch, no app work per frame).
 * - `hit={false}`: raycasts pass through the object (CSS pointer-events: none).
 * - pick(x, y) (normalized device coordinates) → the topmost hit's element, with plain-data
 *   intersection fields for the event (point, distance, uv, normal, faceIndex) plus `object`.
 */
import * as THREE from 'three'

const catalog = new Map<string, any>()
for (const k of Object.keys(THREE)) {
  const v = (THREE as any)[k]
  if (typeof v == 'function' && /^[A-Z]/.test(k)) catalog.set(k.toLowerCase(), v)
}
export const extend = (objects: Record<string, any>) => { for (const k in objects) catalog.set(k.toLowerCase(), objects[k]) }

// the target's own props (and the element's), never written to the object
const OWN = /^(args|attach|animate|dispose|makeDefault|hit|className|class|id|key|hook|style|role|tabIndex|title|hidden|ref)$|^(aria|data)-/

interface Rec {
  el: any; obj: any; ctor: any; args: any[] | undefined
  props: Record<string, any>; v: any; seen: number
  attached?: {target: any, key: string, prev: any}
  animate?: Record<string, (t: number, dt: number, obj: any) => any>
}

const tagOf = (sel: string) => /^[^#.]*/.exec(sel)![0].toLowerCase()
const propsOf = (v: any) => {
  const d = v.data || {}, out: any = {}
  // a tag the pragma takes for SVG (<line>) gets its props as attrs, with their values as written
  for (const src of [d.attrs, d.props]) if (src) for (const k in src) if (!OWN.test(k)) out[k] = src[k]
  if (d.props) for (const k of ['args', 'attach', 'animate', 'dispose', 'makeDefault', 'hit']) if (k in d.props) out[k] = d.props[k]
  return out
}
const sameArr = (a: any, b: any) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length == b.length && a.every((x, i) => x === b[i]))

export function applyProp(obj: any, k: string, v: any) {
  const cur = obj[k]
  // a method named as a prop is called with the value as its arguments (lookAt={[0, 0, 0]})
  if (typeof cur == 'function') return Array.isArray(v) ? cur.apply(obj, v) : cur.call(obj, v)
  if (cur && typeof cur.set == 'function' && typeof cur != 'function') {
    if (Array.isArray(v)) cur.set(...v)
    else if (typeof v == 'number' && cur.setScalar) cur.setScalar(v)
    else if (v && typeof v == 'object' && cur.copy && v.constructor === cur.constructor) cur.copy(v)
    else cur.set(v)
  } else obj[k] = v
}

export interface ThreeStats { syncs: number; created: number; applied: number; disposed: number; frames: number; animatedWrites: number; picks: number }

export function createThreeTarget() {
  const scene = new THREE.Scene()
  const root: Rec = {el: null, obj: scene, ctor: THREE.Scene, args: undefined, props: {}, v: null, seen: 0}
  const fallback = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
  fallback.position.set(0, 0, 5)
  let camera: any = null, aspect = 1
  const recs = new Map<any, Rec>(), byObj = new WeakMap<any, Rec>(), animated = new Set<Rec>(), defaults = new Map<any, any>()
  const raycaster = new THREE.Raycaster()
  const stats: ThreeStats = {syncs: 0, created: 0, applied: 0, disposed: 0, frames: 0, animatedWrites: 0, picks: 0}
  let gen = 0

  const dflt = (ctor: any) => {
    if (!defaults.has(ctor)) { let d = null; try { d = new ctor() } catch (_) {} defaults.set(ctor, d) }
    return defaults.get(ctor)
  }
  const make = (r: Rec, props: any) => {
    r.obj = new r.ctor(...(props.args || []))
    r.args = props.args
    byObj.set(r.obj, r)
    stats.created++
    if (r.obj.isCamera && (props.makeDefault || !camera)) camera = r.obj, fit()
  }
  const dispose = (r: Rec) => {
    const o = r.obj
    if (r.props.dispose !== null && typeof o.dispose == 'function') o.dispose(), stats.disposed++
  }
  const detach = (r: Rec) => {
    const o = r.obj
    o.isObject3D && o.parent?.remove(o)
    if (r.attached && r.attached.target[r.attached.key] === o) r.attached.target[r.attached.key] = r.attached.prev
    r.attached = undefined
    if (o === camera) camera = null
  }
  const remove = (r: Rec) => {
    detach(r)
    recs.delete(r.el)
    animated.delete(r)
    dispose(r)
  }
  const apply = (r: Rec, props: any) => {
    const o = r.obj, old = r.props
    for (const k in old) if (!(k in props) && !OWN.test(k) && k != 'args') {
      const d = dflt(r.ctor)
      if (d && k in d) { const x = d[k]; x && typeof x.clone == 'function' ? applyProp(o, k, x.clone()) : (o[k] = x) }
      else delete o[k]
    }
    // a key `animate` drove and no longer does: its static prop applies again
    const stopped = old.animate ? Object.keys(old.animate).filter(k => !props.animate || !(k in props.animate)) : []
    for (const k in props) {
      if (OWN.test(k) || k == 'args' || (sameArr(props[k], old[k]) && !stopped.includes(k))) continue
      applyProp(o, k, props[k])
      stats.applied++
    }
    r.props = props
    r.animate = props.animate
    props.animate ? animated.add(r) : animated.delete(r)
    if (o.isCamera) fit(o)
  }
  // an object goes into its parent: an Object3D as a child, anything else attached
  const place = (r: Rec, parent: Rec) => {
    const o = r.obj, p = parent.obj
    if (o.isObject3D && p.isObject3D) { if (o.parent !== p) p.add(o); return }
    const key = r.props.attach || (o.isBufferGeometry ? 'geometry' : o.isMaterial ? 'material' : o.isFog ? 'fog' : null)
    if (!key || (r.attached && r.attached.target === p && p[key] === o)) return
    if (r.attached) detach(r)
    r.attached = {target: p, key, prev: p[key]}
    p[key] = o
  }
  const walk = (kids: any[] | undefined, parent: Rec) => {
    if (kids) for (const k of kids) {
      if (!k || !k.sel) continue
      const ctor = catalog.get(tagOf(k.sel))
      if (!ctor) { walk(k.children, parent); continue }
      let r = recs.get(k.elm)
      const props = propsOf(k)
      if (!r || r.ctor !== ctor) {
        if (r) remove(r)
        r = {el: k.elm, obj: null, ctor, args: undefined, props: {}, v: null, seen: 0}
        make(r, props)
        recs.set(k.elm, r)
      } else if (!sameArr(r.args, props.args)) {
        // new constructor arguments: a new object; its children and attachments move over in the walk below
        const old = r.obj, kids3 = old.isObject3D ? [...old.children] : []
        detach(r)
        dispose(r)
        make(r, props)
        for (const c of kids3) r.obj.add(c)
        r.props = {}, r.v = null
      }
      r.seen = gen
      if (r.v !== k) apply(r, props), r.v = k
      place(r, parent)
      walk(k.children, r)
    }
  }
  const fit = (c: any = camera) => {
    if (c?.isPerspectiveCamera && !('aspect' in (byObj.get(c)?.props || {}))) c.aspect = aspect
    c?.updateProjectionMatrix?.()
  }

  return {
    scene,
    stats,
    animated,
    camera: () => camera || fallback,
    /** after each patch of the island: its children container's vnode */
    sync(container: any) {
      stats.syncs++
      gen++
      walk(container?.children, root)
      for (const r of [...recs.values()]) if (r.seen !== gen) remove(r)
    },
    setSize(w: number, h: number) { aspect = w / h; fit(); fit(fallback) },
    /** per-frame values (`animate` props): no vnode, no patch */
    frame(t: number, dt: number) {
      stats.frames++
      for (const r of animated) for (const k in r.animate!) {
        const v = r.animate![k](t, dt, r.obj)
        if (v !== undefined) applyProp(r.obj, k, v), stats.animatedWrites++
      }
    },
    /** the topmost element under (x, y) in normalized device coordinates (-1..1, y up) */
    pick(x: number, y: number) {
      stats.picks++
      const cam = camera || fallback
      scene.updateMatrixWorld()
      cam.updateMatrixWorld()
      raycaster.setFromCamera(new THREE.Vector2(x, y), cam)
      for (const h of raycaster.intersectObject(scene, true)) {
        let o: any = h.object, r: Rec | undefined, visible = true
        for (let a: any = o; a; a = a.parent) if (!a.visible) visible = false
        if (!visible) continue
        while (o && !(r = byObj.get(o))) o = o.parent
        if (!r || r.props.hit === false) continue
        return {
          el: r.el, object: h.object, distance: h.distance, point: h.point.toArray(),
          uv: h.uv?.toArray(), normal: h.face?.normal.toArray(), faceIndex: h.faceIndex, ndc: [x, y],
        }
      }
      return null
    },
    /** where an element's object is on screen, in normalized device coordinates (tests, a11y focus rings) */
    project(el: any): [number, number] | null {
      const r = recs.get(el)
      if (!r?.obj.isObject3D) return null
      scene.updateMatrixWorld()
      const cam = camera || fallback
      cam.updateMatrixWorld()
      const box = new THREE.Box3().setFromObject(r.obj)
      const c = box.isEmpty() ? r.obj.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3())
      c.project(cam)
      return [c.x, c.y]
    },
    objectOf: (el: any) => recs.get(el)?.obj,
    size: () => recs.size,
    dispose() { for (const r of [...recs.values()]) remove(r) },
  }
}

export type ThreeTarget = ReturnType<typeof createThreeTarget>
