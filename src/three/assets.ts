/**
 * sygnal/three assets: `<Model src>` and `<Texture src>`, loaded models and textures as tags.
 *
 *   <Suspense fallback={<p>Loading…</p>}>
 *     <Scene>
 *       <Model src="/tree.glb" className="tree" position={[0, 0, -2]} />
 *       <mesh><planeGeometry args={[8, 8]} /><meshStandardMaterial><Texture src="/grass.jpg" /></meshStandardMaterial></mesh>
 *     </Scene>
 *   </Suspense>
 *
 * - The tags are controls (the pragma calls `__sygnalControl` while the view renders), so the
 *   load starts in the view, before the scene exists: a Suspense boundary around the Scene (or
 *   inside it) shows its fallback until every asset below it has arrived, and the Scene mounts
 *   once with its assets. 0 B in the core: the loading placeholder is a `pres` marker (the
 *   registry the core already has) that remembers its owner, and the owner renders again
 *   (Inst.refresh, as lazy() does) when the load settles.
 * - While loading: `<sygnal-asset data-sygnal-lazy="loading">` (what Suspense waits for, as a
 *   lazy component's placeholder). Loaded: `<primitive>` with the asset: the target places a
 *   clone of the model's scene (`<Model>`: one object per element; geometries and materials
 *   shared) or the value itself (`<Texture>`: attached as `map` unless `attach` says otherwise).
 *   Failed: the tag throws in the view, so the component's `onError` renders (SYG406), as for a
 *   view that threw.
 * - Cache: per loader and URL, shared by every Scene and app on the page. An asset counts the
 *   elements using it; when the last one goes (and no element takes it again in the same
 *   microtask: a remount), its geometries, materials and textures are disposed and it leaves the
 *   cache. `preload(src)` loads ahead; `clear(src)` forgets it (a failed load can be tried again).
 * - Loaders: `loader={OBJLoader}` (a class) or a configured instance (a GLTFLoader with DRACO);
 *   by default .glb / .gltf use GLTFLoader (three's add-on, imported when first needed) and
 *   `<Texture>` THREE.TextureLoader (sRGB, for color maps).
 */
import * as THREE from 'three'
import {__pres as pres} from '../index'

const SEL = 'sygnal-asset'

export interface Asset {
  src: string
  /** 0 loading, 1 loaded, 2 failed */
  s: 0 | 1 | 2
  value?: any
  error?: Error
  promise: Promise<void>
  /** the elements using it (the target's take / release) */
  users: number
  /** owners whose view rendered the placeholder: they render again when the load settles */
  owners: Set<any>
  model: boolean
  take(): any
  release(): void
}

const cache = new Map<any, Map<string, Asset>>()
const GLTF = 'gltf', IMAGE = 'image'

// (a loader given or THREE's: at once, so a load starts in the render that asks for it)
const loaderFor = (model: boolean, src: string, loader: any): any => {
  if (loader) return typeof loader == 'function' ? new loader() : loader
  if (!model) return new THREE.TextureLoader()
  if (/\.(glb|gltf)([?#]|$)/i.test(src)) return import('three/addons/loaders/GLTFLoader.js').then(m => new m.GLTFLoader())
  throw new Error(`no loader for this file: pass one, <Model src="${src}" loader={OBJLoader} />`)
}
const load = (l: any, src: string) => l.loadAsync ? l.loadAsync(src) : new Promise((res, rej) => l.load(src, res, undefined, rej))

const keyOf = (model: boolean, src: string, loader: any) => loader || (model && /\.(glb|gltf)([?#]|$)/i.test(src) ? GLTF : model ? 'model' : IMAGE)

// a GLTF result's scene, or the object a loader made (OBJLoader, FBXLoader: a Group)
const root = (v: any) => v?.scene?.isObject3D ? v.scene : v

function free(v: any) {
  const seen = new Set<any>()
  const one = (x: any) => { if (x && !seen.has(x) && typeof x.dispose == 'function') seen.add(x), x.dispose() }
  const r = root(v)
  if (r?.isObject3D) r.traverse((o: any) => {
    one(o.geometry)
    for (const m of [].concat(o.material || [])) {
      for (const k in m as any) if ((m as any)[k]?.isTexture) one((m as any)[k])
      one(m)
    }
  })
  else one(v)
}

/** the cache entry for (src, loader), loading it the first time */
export function asset(model: boolean, src: string, loader?: any): Asset {
  if (typeof src != 'string' || !src) throw new Error(`<${model ? 'Model' : 'Texture'}> needs a src`)
  const k = keyOf(model, src, loader)
  let m = cache.get(k)
  if (!m) cache.set(k, m = new Map())
  let a = m.get(src)
  if (a) return a
  const settle = () => { a!.owners.forEach(o => o.refresh()); a!.owners.clear() }
  a = {
    src, s: 0, users: 0, owners: new Set(), model,
    promise: null as any,
    take() {
      a!.users++
      const r = root(a!.value)
      return model && r?.isObject3D ? r.clone() : a!.value
    },
    release() {
      // a remount (a new Scene, new `args`) takes it again in the same patch: wait a microtask
      if (--a!.users <= 0) queueMicrotask(() => { if (a!.users <= 0 && m!.get(src) === a) m!.delete(src), free(a!.value) })
    },
  }
  m.set(src, a)
  let p: Promise<any>
  try {
    const l = loaderFor(model, src, loader)
    p = l.then ? l.then((x: any) => load(x, src)) : load(l, src)
  } catch (e) { p = Promise.reject(e) }
  a.promise = p
    .then((v: any) => {
      if (!model && !loader && v?.isTexture) v.colorSpace = THREE.SRGBColorSpace
      a!.value = v, a!.s = 1
    }, (e: any) => {
      a!.error = Object.assign(new Error(`could not load ${src}: ${e?.message || e}`), {cause: e}), a!.s = 2
    })
    .then(settle)
  return a
}

/** start loading ahead (on hover, at startup); resolves when it has loaded or failed */
export const preload = (src: string, loader?: any) => asset(!/\.(png|jpe?g|webp|gif|avif|ktx2|hdr|exr)([?#]|$)/i.test(src), src, loader).promise

/** forget a cached asset (all of them without a src): a failed load is tried again on the next render; one in use is freed when its last element goes */
export function clear(src?: string, loader?: any) {
  for (const [k, m] of cache) if (!loader || k === loader) for (const [s, a] of m) if (src == null || s === src) {
    m.delete(s)
    if (a.s == 1 && a.users <= 0) free(a.value)
  }
}

/** the placeholder's owner: it renders again when the load settles (pres: the core's reconcile walk) */
const wait = (n: any, owner: any) => {
  const a: Asset = n.data.a
  if (a.s == 0) a.owners.add(owner)
  else queueMicrotask(() => owner.refresh())
  return n
}

const tag = (model: boolean, name: string) => {
  const T: any = () => { throw new Error(`<${name}> is a JSX tag`) }
  T.__sygnalControl = (data: any, children: any[], ce: any) => {
    const {src, loader, children: _, ...rest} = data || {}
    const a = asset(model, src, loader)
    if (a.s == 2) throw a.error
    if (a.s == 0) {
      pres[SEL] ||= wait
      return {sel: SEL, data: {attrs: {'data-sygnal-lazy': 'loading', 'data-src': src}, a}, children: [], text: undefined, elm: undefined, key: rest.key}
    }
    if (!model && rest.attach == null && a.value?.isTexture) rest.attach = 'map'
    return ce('primitive', {...rest, asset: a}, ...(children || []))
  }
  T.preload = (src: string, loader?: any) => asset(model, src, loader).promise
  T.clear = clear
  Object.defineProperty(T, 'name', {value: name})
  return T
}

/** a loaded model: GLTF (.glb, .gltf) by default, any loader with `loader`; one clone of its scene per element */
export const Model = tag(true, 'Model')
/** a loaded texture (or any loader's value that attaches: an STL geometry, an HDR environment); `attach` defaults to `map` */
export const Texture = tag(false, 'Texture')
